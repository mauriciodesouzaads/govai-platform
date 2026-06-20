// The bounded claim loop (SPEC-B3 §4.1). Per org (RLS-scoped under app.org_id):
// measure backlog → discover chains with claimable work → run the Shape-S
// per-seal tx for each (bounded by maxInFlight) → interleave the stale-recovery
// sweep (the SEPARATE path). No busy loop, no provider calls, no throttling of
// the provider request path. `runScanTick` is the testable unit; `startClaimLoop`
// wraps it with idle/empty/error backoff + graceful drain.

import type { Pool, PoolClient } from 'pg';
import type { Kms } from '@govai/core-identity';
import { sanitizeSealerError } from '@govai/core-audit';
import type { SealerConfig } from './config.js';
import type { SealerMetrics } from './metrics.js';
import type { SealerLogger } from './logging.js';
import { setLocalAppOrgId } from './tenant-context.js';
import { sealOnce } from './seal-once.js';
import { sweepStaleRecoveries } from './stale-recovery.js';
import { backoffWithJitterMs } from './backoff.js';
import { orgHash } from './labels.js';

const ROLE_SEALER = 'govai_audit_sealer';
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface ClaimLoopDeps {
  pool: Pool;
  kms: Kms;
  config: SealerConfig;
  metrics: SealerMetrics;
  logger: SealerLogger;
  /** Enumerate the orgs to scan. RLS scopes the outbox per app.org_id, so the
   *  org list is an injected seam (config / a granted discovery view in prod;
   *  the seeded test org in tests). */
  listOrgs: () => Promise<string[]>;
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
  /** Optional hook fired when the backlog crosses an alert threshold. */
  onBacklogAlert?: (healthy: boolean) => void;
}

export interface ScanTickSummary {
  orgsScanned: number;
  sealed: number;
  idleChains: number;
  staleRecovered: number;
  staleFailed: number;
  backlogAlert: boolean;
}

async function withOrgScopedSealer<T>(
  pool: Pool,
  orgId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${ROLE_SEALER}`);
    await setLocalAppOrgId(client, orgId);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Chains with claimable work for the current org (last_sealed < last_captured). */
async function discoverClaimableChains(pool: Pool, orgId: string, batch: number): Promise<string[]> {
  return withOrgScopedSealer(pool, orgId, async (c) => {
    const r = await c.query<{ chain_id: string }>(
      `SELECT chain_id
         FROM govai.audit_capture_chain_state
        WHERE org_id = $1::uuid
          AND last_sealed_capture_seq < last_captured_seq
        ORDER BY chain_id
        LIMIT $2::int`,
      [orgId, batch],
    );
    return r.rows.map((row) => row.chain_id);
  });
}

/** Pending (captured|sealing) count + oldest pending age for the org. */
async function measureBacklog(
  pool: Pool,
  orgId: string,
): Promise<{ pending: number; oldestPendingAgeSec: number }> {
  return withOrgScopedSealer(pool, orgId, async (c) => {
    const r = await c.query<{ pending: string; oldest_age_sec: string | null }>(
      `SELECT count(*)::text AS pending,
              COALESCE(extract(epoch FROM now() - min(captured_at)), 0)::text AS oldest_age_sec
         FROM govai.audit_capture_outbox
        WHERE org_id = $1::uuid AND status IN ('captured', 'sealing')`,
      [orgId],
    );
    const row = r.rows[0];
    return {
      pending: Number(row?.pending ?? '0'),
      oldestPendingAgeSec: Math.floor(Number(row?.oldest_age_sec ?? '0')),
    };
  });
}

/** Seal a single chain to completion within this tick (bounded by claimBatch). */
async function drainChain(
  deps: ClaimLoopDeps,
  orgId: string,
  chainId: string,
): Promise<{ sealed: number }> {
  let sealed = 0;
  for (let i = 0; i < deps.config.loop.claimBatch; i += 1) {
    let result;
    try {
      result = await sealOnce(deps.pool, deps.kms, {
        orgId,
        chainId,
        workerId: deps.config.workerId,
      });
    } catch (err) {
      // best_effort: the seal tx rolled back (row back to `captured`); log + stop
      // this chain for the tick. The next tick retries.
      deps.metrics.failedTotal({ orgId, reason: 'seal_error' });
      deps.logger.warn(
        { org_hash: orgHash(orgId), err: sanitizeSealerError(err) },
        'audit_sealer: seal attempt failed; chain deferred to next tick',
      );
      break;
    }
    deps.metrics.claimTotal({ orgId });
    if (result.status === 'idle') break;
    sealed += 1;
    deps.metrics.sealedTotal({ orgId, result: 'normal' });
  }
  return { sealed };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function runScanTick(deps: ClaimLoopDeps): Promise<ScanTickSummary> {
  const orgs = await deps.listOrgs();
  const summary: ScanTickSummary = {
    orgsScanned: orgs.length,
    sealed: 0,
    idleChains: 0,
    staleRecovered: 0,
    staleFailed: 0,
    backlogAlert: false,
  };

  for (const orgId of orgs) {
    // Backlog measurement + alert.
    const backlog = await measureBacklog(deps.pool, orgId);
    deps.metrics.backlogDepth(backlog.pending, { orgId });
    deps.metrics.oldestPendingAgeSeconds(backlog.oldestPendingAgeSec, { orgId });
    const alert =
      backlog.pending > deps.config.backlog.pendingCount ||
      backlog.oldestPendingAgeSec > deps.config.backlog.oldestPendingSec;
    if (alert) {
      summary.backlogAlert = true;
      deps.onBacklogAlert?.(false);
      deps.logger.warn(
        { org_hash: orgHash(orgId), pending: backlog.pending, oldest_age_sec: backlog.oldestPendingAgeSec },
        'audit_sealer: backlog alert',
      );
    } else {
      deps.onBacklogAlert?.(true);
    }

    // Normal captured→sealed: discover chains (≤ claimBatch), drain each, bounded
    // by maxInFlight concurrency.
    const chains = await discoverClaimableChains(deps.pool, orgId, deps.config.loop.claimBatch);
    for (const wave of chunk(chains, deps.config.loop.maxInFlight)) {
      const results = await Promise.all(wave.map((chainId) => drainChain(deps, orgId, chainId)));
      for (const r of results) {
        summary.sealed += r.sealed;
        if (r.sealed === 0) summary.idleChains += 1;
      }
    }

    // Interleave the SEPARATE stale-recovery sweep.
    const sweep = await sweepStaleRecoveries(deps.pool, deps.kms, {
      orgId,
      thresholdMs: deps.config.stale.thresholdMs,
      batch: deps.config.stale.recoveryBatch,
      maxRetries: deps.config.stale.maxRetries,
      recoveryBackoff: {
        minMs: deps.config.stale.recoveryBackoffMinMs,
        maxMs: deps.config.stale.recoveryBackoffMaxMs,
      },
      workerId: deps.config.workerId,
      metrics: deps.metrics,
      logger: deps.logger,
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      ...(deps.rand ? { rand: deps.rand } : {}),
    });
    summary.staleRecovered += sweep.recovered;
    summary.staleFailed += sweep.failed;
  }

  return summary;
}

export interface ClaimLoopHandle {
  stop: () => Promise<void>;
}

/** The continuous loop with empty/error backoff + graceful drain. */
export function startClaimLoop(deps: ClaimLoopDeps): ClaimLoopHandle {
  const sleep = deps.sleep ?? defaultSleep;
  let stopping = false;
  let emptyStreak = 0;
  let errorStreak = 0;

  const runPromise = (async () => {
    while (!stopping) {
      try {
        const tick = await runScanTick(deps);
        errorStreak = 0;
        if (tick.sealed === 0 && tick.staleRecovered === 0) {
          emptyStreak += 1;
          const backoff = backoffWithJitterMs(
            emptyStreak - 1,
            { minMs: deps.config.loop.emptyBackoffMinMs, maxMs: deps.config.loop.emptyBackoffMaxMs },
            deps.rand,
          );
          await sleep(Math.max(deps.config.loop.idleSleepMs, backoff));
        } else {
          emptyStreak = 0;
          await sleep(deps.config.loop.idleSleepMs);
        }
      } catch (err) {
        errorStreak += 1;
        deps.logger.error(
          { err: sanitizeSealerError(err) },
          'audit_sealer: scan tick failed',
        );
        await sleep(
          backoffWithJitterMs(
            errorStreak - 1,
            { minMs: deps.config.loop.errorBackoffMinMs, maxMs: deps.config.loop.errorBackoffMaxMs },
            deps.rand,
          ),
        );
      }
    }
  })();

  return {
    stop: async () => {
      stopping = true;
      // Drain: the current tick's in-flight seals are atomic (one tx each), so a
      // clean shutdown leaves no stuck `sealing` row. Wait for the current tick,
      // bounded by drainMs.
      await Promise.race([
        runPromise,
        sleep(deps.config.loop.drainMs),
      ]);
    },
  };
}
