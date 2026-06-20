// Stale-`sealing` recovery — a SEPARATE PATH from Shape S (SPEC-B3 §4.2, GATE A–D).
//
// A row stuck in status='sealing' is OUTSIDE the reach of the normal Shape-S
// seal composite, because that composite begins with the claim primitive →
// `audit_capture_claim_for_seal`, whose UPDATE matches `… AND o.status =
// 'captured'`. A `sealing` row is NEVER returned by the claim. So recovery does
// NOT call the normal seal composite or the claim primitive. It reconstructs the
// capture via the EP-005.5 library
// helper `loadSealingCaptureForRecovery` (which maps the row through the SAME
// `mapOutboxRowToClaimedAuditCapture` the claim path uses AND enforces the tenant
// guard), re-derives the deterministic id, and re-runs auditAppend (idempotent)
// + mark_sealed to ADVANCE it. A recoverable row is ADVANCED, never failed.
// `markAuditCaptureFailed` is reserved for truly-unrecoverable cases (a
// correspondence/integrity throw from `assertExistingEventMatches`, or exhausting
// retries on a persistent error) and then emits the terminal-stall alert/metric.

import type { Pool } from 'pg';
import type { Kms } from '@govai/core-identity';
import {
  loadSealingCaptureForRecovery,
  buildAuditCaptureSealingEvent,
  deriveAuditSealerCaptureEventId,
  auditAppend,
  markAuditCaptureSealed,
  markAuditCaptureFailed,
  sanitizeSealerError,
} from '@govai/core-audit';
import { setLocalAppOrgId } from './tenant-context.js';
import { backoffWithJitterMs, type BackoffParams } from './backoff.js';
import type { SealerMetrics } from './metrics.js';
import type { SealerLogger } from './logging.js';
import { orgHash } from './labels.js';

const ROLE_SEALER = 'govai_audit_sealer';
const ROLE_APP = 'govai_app';

export type RecoverOutcome =
  | { outcome: 'sealed'; captureId: string; auditEventId: string }
  | { outcome: 'skipped'; captureId: string } // no longer sealing (raced)
  | { outcome: 'failed'; captureId: string; reason: 'divergent_content' | 'max_retries' }
  | { outcome: 'error'; captureId: string; reason: 'tenant_context' };

export interface SweepSummary {
  staleDetected: number;
  recovered: number;
  failed: number;
  skipped: number;
  errored: number;
}

export interface SweepDeps {
  orgId: string;
  thresholdMs: number;
  batch: number;
  maxRetries: number;
  recoveryBackoff: BackoffParams;
  workerId: string;
  metrics: SealerMetrics;
  logger: SealerLogger;
  /** Injectable sleep/rand for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function classifyError(err: unknown): 'divergent' | 'tenant_context' | 'transient' {
  const msg = err instanceof Error ? err.message : String(err);
  if (/divergent immutable content/i.test(msg)) return 'divergent';
  if (/tenant context missing or mismatched/i.test(msg)) return 'tenant_context';
  return 'transient';
}

/** Detect stale `sealing` capture ids for the CURRENT app.org_id (RLS-scoped). */
export async function detectStaleSealingCaptureIds(
  pool: Pool,
  orgId: string,
  opts: { thresholdMs: number; batch: number },
): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${ROLE_SEALER}`);
    await setLocalAppOrgId(client, orgId);
    const r = await client.query<{ capture_id: string }>(
      `SELECT capture_id::text AS capture_id
         FROM govai.audit_capture_outbox
        WHERE status = 'sealing'
          AND sealing_started_at < now() - ($1::bigint * interval '1 millisecond')
        ORDER BY sealing_started_at ASC
        LIMIT $2::int`,
      [opts.thresholdMs, opts.batch],
    );
    await client.query('COMMIT');
    return r.rows.map((row) => row.capture_id);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** One recovery attempt in its OWN fresh transaction (never reuse an aborted one). */
async function attemptRecovery(
  pool: Pool,
  kms: Kms,
  input: { orgId: string; captureId: string; workerId: string },
): Promise<{ status: 'sealed'; auditEventId: string } | { status: 'absent' }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${ROLE_SEALER}`);
    await setLocalAppOrgId(client, input.orgId);

    // SHARED mapping (GATE A): the recovery reconstruction goes through the
    // EP-005.5 helper — NOT a bespoke ClaimedAuditCapture literal, NOT a
    // re-derived column list / conversion. The loader also enforces the tenant
    // guard (throws on missing/mismatched app.org_id).
    const claimed = await loadSealingCaptureForRecovery(client, {
      orgId: input.orgId,
      captureId: input.captureId,
    });
    if (claimed === null) {
      // Raced: no longer in `sealing` (recovered/failed by another pass). Nothing to do.
      await client.query('COMMIT');
      return { status: 'absent' };
    }

    const event = buildAuditCaptureSealingEvent(claimed, { workerId: input.workerId });
    const eventId = deriveAuditSealerCaptureEventId({
      orgId: input.orgId,
      captureId: input.captureId,
    });

    // append phase (idempotent: lookup-before-append finds the existing event if
    // the earlier append committed, else inserts — NO duplicate).
    await client.query(`SET LOCAL ROLE ${ROLE_APP}`);
    await setLocalAppOrgId(client, input.orgId);
    const appendOut = await auditAppend(client, kms, { ...event, eventId });

    // mark_sealed phase → ADVANCE the chain (sealing → sealed).
    await client.query(`SET LOCAL ROLE ${ROLE_SEALER}`);
    await setLocalAppOrgId(client, input.orgId);
    await markAuditCaptureSealed(client, {
      orgId: input.orgId,
      chainId: claimed.chainId,
      captureId: input.captureId,
      auditEventId: appendOut.eventId,
    });

    await client.query('COMMIT');
    return { status: 'sealed', auditEventId: appendOut.eventId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Mark a capture terminally `failed` in a FRESH tx, and emit the stall alert. */
async function markFailedTerminal(
  pool: Pool,
  input: { orgId: string; captureId: string; error: unknown },
  metrics: SealerMetrics,
  logger: SealerLogger,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${ROLE_SEALER}`);
    await setLocalAppOrgId(client, input.orgId);
    await markAuditCaptureFailed(client, {
      orgId: input.orgId,
      captureId: input.captureId,
      error: input.error,
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error(
      { org_hash: orgHash(input.orgId), err: sanitizeSealerError(err) },
      'audit_sealer: mark_failed itself failed',
    );
  } finally {
    client.release();
  }
  // GATE C: a `failed` terminal at the next-expected seq STALLS the chain (no
  // failed→sealing transition; mark_sealed needs last_sealed+1). Surface it,
  // never silently retry. The fix (a B0 migration / admin tool) is a separate
  // future decision, NOT this runner.
  metrics.failedTotal({ orgId: input.orgId, result: 'terminal' });
  metrics.terminalFailureTotal({ orgId: input.orgId });
  logger.error(
    {
      org_hash: orgHash(input.orgId),
      reason: 'terminal_failure',
      error: sanitizeSealerError(input.error),
    },
    'audit_sealer.terminal_failure: capture failed at next-expected seq — chain STALLED, manual intervention required (ADR-023)',
  );
}

/** Recover ONE stale row, with bounded retries + outcome classification. */
export async function recoverStaleRow(
  pool: Pool,
  kms: Kms,
  deps: SweepDeps & { captureId: string },
): Promise<RecoverOutcome> {
  const { orgId, captureId, workerId, maxRetries, metrics, logger } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    if (attempt > 0) {
      metrics.retryTotal({ orgId, reason: 'stale_recovery' });
      await sleep(backoffWithJitterMs(attempt - 1, deps.recoveryBackoff, deps.rand));
    }
    try {
      const r = await attemptRecovery(pool, kms, { orgId, captureId, workerId });
      if (r.status === 'absent') return { outcome: 'skipped', captureId };
      metrics.sealedTotal({ orgId, result: 'recovered' });
      return { outcome: 'sealed', captureId, auditEventId: r.auditEventId };
    } catch (err) {
      lastErr = err;
      const cls = classifyError(err);
      if (cls === 'divergent') {
        // Truly-unrecoverable: an event exists at the deterministic id with
        // divergent immutable content → fail safe (terminal), no forged append.
        await markFailedTerminal(pool, { orgId, captureId, error: err }, metrics, logger);
        return { outcome: 'failed', captureId, reason: 'divergent_content' };
      }
      if (cls === 'tenant_context') {
        // A runner MISCONFIGURATION (app.org_id missing/mismatched), NOT a row
        // problem. Surface it; do NOT mark the (recoverable) row failed.
        metrics.failedTotal({ orgId, reason: 'tenant_context' });
        logger.error(
          { org_hash: orgHash(orgId), reason: 'tenant_context', err: sanitizeSealerError(err) },
          'audit_sealer: tenant context error during recovery — surfacing, NOT failing the row',
        );
        return { outcome: 'error', captureId, reason: 'tenant_context' };
      }
      logger.warn(
        { org_hash: orgHash(orgId), attempt, err: sanitizeSealerError(err) },
        'audit_sealer: stale recovery attempt failed; will retry',
      );
    }
  }
  // Exhausted retries on a persistent (effectively non-transient) error → terminal.
  await markFailedTerminal(pool, { orgId, captureId, error: lastErr }, metrics, logger);
  return { outcome: 'failed', captureId, reason: 'max_retries' };
}

/** Detect + recover stale `sealing` rows for one org. */
export async function sweepStaleRecoveries(
  pool: Pool,
  kms: Kms,
  deps: SweepDeps,
): Promise<SweepSummary> {
  const captureIds = await detectStaleSealingCaptureIds(pool, deps.orgId, {
    thresholdMs: deps.thresholdMs,
    batch: deps.batch,
  });
  deps.metrics.staleCount(captureIds.length, { orgId: deps.orgId });
  const summary: SweepSummary = {
    staleDetected: captureIds.length,
    recovered: 0,
    failed: 0,
    skipped: 0,
    errored: 0,
  };
  for (const captureId of captureIds) {
    const outcome = await recoverStaleRow(pool, kms, { ...deps, captureId });
    if (outcome.outcome === 'sealed') summary.recovered += 1;
    else if (outcome.outcome === 'failed') summary.failed += 1;
    else if (outcome.outcome === 'skipped') summary.skipped += 1;
    else summary.errored += 1;
  }
  return summary;
}
