// Run dispatch recovery worker (EP-P03A-A / F3 §25).
//
// Discovery goes through the SECURITY DEFINER function
// govai.run_dispatch_recovery_candidates (id-only, advisory); every actual
// transition happens per-run in run-dispatch-state.ts under per-org RLS with
// FOR UPDATE SKIP LOCKED re-validation on DATABASE time. Multiple replicas
// therefore process disjoint sets — no global leadership, no advisory-lock
// leader election.
//
// The worker NEVER calls a provider, NEVER generates a dispatch token, and
// NEVER prevents process shutdown: the interval is cleared on stop() and an
// in-flight sweep is awaited, not abandoned.

import type { Pool } from 'pg';
import type { Kms } from '@govai/core-identity';
import type { RunDispatchConfig } from './run-dispatch-config.js';
import { recoverQueuedStale, recoverRunningStale } from './run-dispatch-state.js';

/** Keyset resume point, TEXT-precision (see CandidateRow.created_at_text). */
export type SweepCursor = { createdAtText: string; runId: string };

export type RecoverySweepResult = {
  candidates: number;
  queuedFailed: number;
  runningUnknown: number;
  /** Candidates skipped because another replica held the row lock or the row
   *  was no longer stale at re-validation time. */
  skipped: number;
  errors: number;
  /** Non-null when the sweep ended at the page cap with candidates possibly
   *  remaining: the resume point for the NEXT sweep. Null after an exhausted
   *  sweep — the next one restarts from the oldest (retry semantics). Without
   *  the carry, a head-of-line group deeper than cap×batch of non-advancing
   *  candidates would make every younger stale run permanently unreachable. */
  nextCursor: SweepCursor | null;
};

export type RecoveryDeps = {
  pool: Pool;
  kms: Kms;
  config: RunDispatchConfig;
  log?: {
    info: (obj: Record<string, unknown>, msg?: string) => void;
    error: (obj: Record<string, unknown>, msg?: string) => void;
  };
};

type CandidateRow = {
  org_id: string;
  run_id: string;
  reason: 'queued_stale' | 'running_stale';
  /** Keyset cursor part, kept as TEXT end-to-end: node-postgres would parse a
   *  timestamptz into a millisecond JS Date, truncating the microsecond value
   *  — a truncated cursor re-qualifies the very row it points at, and a
   *  non-advancing candidate would then be re-selected forever. */
  created_at_text: string;
};

/** Hard cap on discovery pages per sweep: bounds one sweep's runtime while
 *  still letting it advance past a head-of-line group of non-progressing
 *  (failing or row-locked) candidates. The next sweep resumes from the oldest. */
const MAX_BATCHES_PER_SWEEP = 20;

/** One full sweep. Exported for tests (T7/T8/T16/T21/T22) and reused by the
 *  worker. Pages through the stale set with a keyset cursor so a batch of
 *  candidates that repeatedly fail (or stay locked) can never permanently
 *  starve every younger stale run behind them. `resumeFrom` continues a
 *  previous cap-ended sweep (the worker carries `nextCursor` across ticks). */
export async function runDispatchRecoverySweepOnce(
  deps: RecoveryDeps,
  resumeFrom: SweepCursor | null = null,
): Promise<RecoverySweepResult> {
  const { pool, kms, config } = deps;
  const result: RecoverySweepResult = {
    candidates: 0,
    queuedFailed: 0,
    runningUnknown: 0,
    skipped: 0,
    errors: 0,
    nextCursor: null,
  };
  let cursor: SweepCursor | null = resumeFrom;
  let exhausted = false;
  for (let page = 0; page < MAX_BATCHES_PER_SWEEP; page++) {
    const params: [number, number, number, string | null, string | null] = [
      config.preparedGraceMs,
      config.recoveryGraceMs,
      config.recoveryBatchSize,
      cursor?.createdAtText ?? null,
      cursor?.runId ?? null,
    ];
    const discovered = await pool.query<CandidateRow>(
      `SELECT org_id, run_id, reason, run_created_at::text AS created_at_text
         FROM govai.run_dispatch_recovery_candidates(
           $1::integer, $2::integer, $3::integer, $4::timestamptz, $5::uuid)`,
      params,
    );
    if (discovered.rows.length === 0) {
      exhausted = true;
      break;
    }
    result.candidates += discovered.rows.length;
    for (const c of discovered.rows) {
      try {
        if (c.reason === 'queued_stale') {
          const done = await recoverQueuedStale(pool, kms, {
            orgId: c.org_id,
            runId: c.run_id,
            preparedGraceMs: config.preparedGraceMs,
          });
          if (done) result.queuedFailed += 1;
          else result.skipped += 1;
        } else {
          const done = await recoverRunningStale(pool, kms, {
            orgId: c.org_id,
            runId: c.run_id,
            recoveryGraceMs: config.recoveryGraceMs,
          });
          if (done) result.runningUnknown += 1;
          else result.skipped += 1;
        }
      } catch (err) {
        result.errors += 1;
        // Sanitized: ids + error NAME only — never a raw provider/DB message body.
        deps.log?.error(
          {
            run_id: c.run_id,
            reason: c.reason,
            error_name: err instanceof Error ? err.name : 'unknown',
          },
          'run dispatch recovery: per-run transition failed',
        );
      }
    }
    if (discovered.rows.length < config.recoveryBatchSize) {
      exhausted = true;
      break;
    }
    const last: CandidateRow = discovered.rows[discovered.rows.length - 1]!;
    cursor = { createdAtText: last.created_at_text, runId: last.run_id };
  }
  // Cap-ended sweep: hand the resume point to the next tick. Exhausted sweep:
  // restart from the oldest next time (retries previously failing rows).
  result.nextCursor = exhausted ? null : cursor;
  return result;
}

export type RecoveryWorkerHandle = {
  stop: () => Promise<void>;
};

/**
 * Periodic worker wired into the API lifecycle (server.ts): started onReady,
 * stopped onClose. Overlapping sweeps are prevented (a tick is skipped while
 * the previous sweep is still running); no promise is left floating.
 */
export function startRunDispatchRecoveryWorker(deps: RecoveryDeps): RecoveryWorkerHandle {
  let inFlight: Promise<void> | null = null;
  let stopped = false;
  // Carried across ticks: resume a cap-ended sweep instead of restarting at
  // the oldest candidates (which could be a permanently non-advancing group).
  let carry: SweepCursor | null = null;

  const tick = (): void => {
    if (stopped || inFlight) return;
    inFlight = runDispatchRecoverySweepOnce(deps, carry)
      .then((r) => {
        carry = r.nextCursor;
        if (r.candidates > 0) {
          deps.log?.info({ ...r }, 'run dispatch recovery sweep');
        }
      })
      .catch((err) => {
        carry = null;
        deps.log?.error(
          { error_name: err instanceof Error ? err.name : 'unknown' },
          'run dispatch recovery sweep failed',
        );
      })
      .finally(() => {
        inFlight = null;
      });
  };

  const interval = setInterval(tick, deps.config.recoveryIntervalMs);
  // Never keep the process alive just for recovery ticks.
  interval.unref?.();

  return {
    stop: async () => {
      stopped = true;
      clearInterval(interval);
      if (inFlight) await inFlight;
    },
  };
}
