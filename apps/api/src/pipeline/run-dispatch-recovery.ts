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
  /** §18.1 — stale running claims whose durable boundary was NEVER committed:
   *  recovered to the KNOWN failure `dispatch_never_started` (provider
   *  provably not called), not to outcome_unknown. */
  runningNeverStarted: number;
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
  /** Bounded shutdown wait for an in-flight sweep (default 5000ms). A sweep
   *  whose PostgreSQL/audit operation STALLS (rather than rejects) must not
   *  hold the whole API in shutdown past its termination grace: past the
   *  bound the sweep is abandoned. Abandonment is safe by construction —
   *  every recovery transition is one short idempotent transaction under FOR
   *  UPDATE SKIP LOCKED, so an interrupted transition rolls back with its
   *  connection and the next worker run re-discovers the candidate. */
  shutdownMaxWaitMs?: number;
  /** Bounded sweep RUNTIME during normal operation (default 120000ms). One
   *  permanently stalled candidate must not freeze recovery platform-wide:
   *  past the bound the worker abandons the sweep (same idempotent-re-entry
   *  safety as above) and later ticks keep sweeping every other stale run. */
  sweepMaxRuntimeMs?: number;
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
    runningNeverStarted: 0,
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
          if (done === 'outcome_unknown') result.runningUnknown += 1;
          else if (done === 'failed_never_started') result.runningNeverStarted += 1;
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
    // The sweep runs under a RUNTIME bound (Codex P2 on 8f700f7): a per-run
    // transition that stalls forever (partitioned database, hung audit/KMS
    // call) would otherwise pin `inFlight` and freeze recovery for every
    // organization until a restart. Past the bound the sweep is abandoned —
    // idempotent re-entry makes that safe — and later ticks keep sweeping.
    // `abandoned` guards the late completion of a zombie sweep so it can
    // never clobber a newer sweep's cursor or log as if current.
    let abandoned = false;
    const sweep = runDispatchRecoverySweepOnce(deps, carry)
      .then((r) => {
        if (abandoned) return;
        carry = r.nextCursor;
        if (r.candidates > 0) {
          deps.log?.info({ ...r }, 'run dispatch recovery sweep');
        }
      })
      .catch((err) => {
        if (abandoned) return;
        carry = null;
        deps.log?.error(
          { error_name: err instanceof Error ? err.name : 'unknown' },
          'run dispatch recovery sweep failed',
        );
      });
    let sweepSettled = false;
    void sweep.then(
      () => {
        sweepSettled = true;
      },
      () => {
        sweepSettled = true;
      },
    );
    const runtimeBoundMs = deps.sweepMaxRuntimeMs ?? 120_000;
    inFlight = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const bound = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, runtimeBoundMs);
        timer.unref?.();
      });
      await Promise.race([sweep, bound]);
      clearTimeout(timer);
      if (!sweepSettled) {
        abandoned = true;
        carry = null; // restart from the oldest on the next sweep
        deps.log?.error(
          { waited_ms: runtimeBoundMs },
          'run dispatch recovery: sweep exceeded its runtime bound; abandoned so later ticks continue (idempotent re-entry)',
        );
      }
    })().finally(() => {
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
      if (inFlight) {
        // BOUNDED wait (Codex P2 on 35953a6): a stalled sweep — a database
        // partition or blocked audit/KMS call that hangs instead of rejecting
        // — must not keep the API in shutdown past its termination grace.
        // New ticks are already prevented (stopped + cleared interval); past
        // the bound the in-flight sweep is abandoned, which is safe because
        // every transition is idempotent and re-entrant (see RecoveryDeps.
        // shutdownMaxWaitMs). The tick chain owns its own .catch/.finally, so
        // an abandoned promise can never surface as an unhandled rejection.
        const waitMs = deps.shutdownMaxWaitMs ?? 5_000;
        const current = inFlight;
        let sweepFinished = false;
        void current.then(
          () => {
            sweepFinished = true;
          },
          () => {
            sweepFinished = true;
          },
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        const bound = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, waitMs);
          timer.unref?.();
        });
        await Promise.race([current, bound]);
        clearTimeout(timer);
        if (!sweepFinished) {
          deps.log?.error(
            { waited_ms: waitMs },
            'run dispatch recovery: in-flight sweep still running at the shutdown bound; abandoned (idempotent re-entry on next start)',
          );
        }
      }
    },
  };
}
