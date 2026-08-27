// The detached conversation-worker RUNNER (EP-AI-CONVERSATION-CONTINUITY-V1 P0-C; spec §7.7/§9).
//
// The loop that turns discovery into execution: discover a bounded page of candidates, process
// each through the §8 protocol, page until the cursor is exhausted, sleep, repeat.
//
// ★ THIS IS THE FIRST REAL CONVERSATION-WORKER ACTIVATION IN THE REPOSITORY, and it is why the
// two P0-A2 pre-activation gates had to close first:
//   * P0A2-P3-A1 — a checked-out client with no `error` listener is a process kill the moment a
//     backend drops. A background loop holds checkouts continuously, so this stops being
//     theoretical exactly here.
//   * P0A2-P3-A4 — this runner is the "future caller" the finding named. It receives the OPAQUE
//     `ConversationWorkerDb`; there is no raw pool for it to bypass the trust boundary with.
//
// ★ IT IS NOT REGISTERED IN `server.ts`, BY DESIGN. The request-serving API process must not
// become the detached execution authority (§9): if it were, execution would again live and die
// with the process that happens to be serving HTTP, and a browser-facing deploy unit would own
// provider calls. `startConversationWorker` is invoked ONLY by the dedicated entrypoint
// (`apps/api/src/conversation-worker/main.ts`) and by tests that drive it deterministically.
//
// ★ SWEEP-ONLY, NOT NOTIFICATION-DEPENDENT. §26 permits PostgreSQL LISTEN/NOTIFY as a WAKE
// ACCELERATION but forbids it as a source of truth, and a missed notification must never lose
// state. P0-C therefore ships the durable half ONLY: the sweep is the sole driver, so there is
// no notification whose loss could strand a turn. Adding the accelerator later changes latency,
// never correctness.

import {
  discoverRecoveryCandidates,
  DISCOVERY_MAX_LIMIT,
  type RecoveryCandidate,
  type RecoveryDiscoveryCursor,
} from '../../pipeline/ai-conversation-recovery-discovery.js';
import {
  processCandidate,
  type ConversationExecutorDeps,
  type ExecutionOutcome,
} from './execute-turn.js';

export type ConversationWorkerRunnerConfig = {
  /** Candidates fetched per discovery page. Bounded by the database function at 500. */
  batchSize: number;
  /** Idle wait between sweeps. */
  intervalMs: number;
  /** Hard ceiling on pages per sweep, so one sweep cannot run unboundedly. */
  maxPagesPerSweep: number;
  /**
   * Cooperative shutdown signal, checked between pages and between candidates.
   *
   * ★ IT STOPS THE SWEEP FROM STARTING NEW WORK; IT NEVER ABORTS WORK IN FLIGHT. Cancelling a
   * dispatch that has already POSTed would manufacture exactly the `outcome_unknown` that
   * shutdown is supposed to avoid — the provider's fate becomes unprovable precisely because we
   * stopped listening. So the bound on a clean shutdown is ONE in-flight candidate, not the whole
   * backlog.
   */
  shouldStop?: () => boolean;
};

export type SweepReport = {
  discovered: number;
  processed: number;
  outcomes: Record<string, number>;
};

/**
 * ONE sweep: discover and process until the page is short or the page ceiling is hit.
 *
 * Exported separately from the loop so tests drive execution DETERMINISTICALLY — the hermetic
 * stack runs no timer, exactly as the P0.3-A run-dispatch recovery suite does
 * (`RUN_DISPATCH_RECOVERY_ENABLED: false` in `server-fixture.ts`). A test that had to wait for an
 * interval would be a flaky test.
 */
export async function runConversationSweepOnce(
  deps: ConversationExecutorDeps,
  config: ConversationWorkerRunnerConfig,
): Promise<SweepReport> {
  if (config.batchSize < 1 || config.batchSize > DISCOVERY_MAX_LIMIT) {
    throw new RangeError(
      `conversation worker batchSize must be within [1, ${DISCOVERY_MAX_LIMIT}] (got ${config.batchSize})`,
    );
  }
  const report: SweepReport = { discovered: 0, processed: 0, outcomes: {} };
  let cursor: RecoveryDiscoveryCursor | null = null;

  const stopping = (): boolean => config.shouldStop?.() === true;

  for (let page = 0; page < config.maxPagesPerSweep; page += 1) {
    // Shutdown asked for: do not open ANOTHER page of work. Discovery is cheap, but each page it
    // returns commits the sweep to a further batch of dispatches.
    if (stopping()) break;
    const candidates: RecoveryCandidate[] = await discoverRecoveryCandidates(deps.db, {
      recoveryGraceMs: deps.recoveryGraceMs,
      limit: config.batchSize,
      after: cursor,
    });
    report.discovered += candidates.length;

    for (const candidate of candidates) {
      // The candidate is simply not started; it stays durably queued and the next runner — or
      // this one after restart — discovers it unchanged. Nothing is lost by declining to begin.
      if (stopping()) break;
      // ★ ONE CANDIDATE'S FAILURE NEVER STOPS THE SWEEP. A single conversation that cannot be
      // driven — a KMS fault, a provider outage, a lost race — must not strand every other
      // owner's queued work behind it. The outcome is recorded and the loop continues.
      let outcome: ExecutionOutcome | 'error';
      try {
        outcome = await processCandidate(deps, {
          orgId: candidate.orgId,
          ownerUserId: candidate.ownerUserId,
          conversationId: candidate.conversationId,
          attemptId: candidate.attemptId,
          state: candidate.state,
          reason: candidate.reason,
          claimToken: candidate.claimToken,
          isBranchHead: candidate.isBranchHead,
        });
      } catch (err) {
        outcome = 'error';
        deps.log.error(
          {
            attempt_id: candidate.attemptId,
            reason: candidate.reason,
            err_class: err instanceof Error ? err.name : 'unknown',
          },
          'conversation worker: candidate processing failed',
        );
      }
      report.processed += 1;
      report.outcomes[outcome] = (report.outcomes[outcome] ?? 0) + 1;
    }

    if (stopping()) break;
    // A short page means the candidate set is exhausted (the 0029 keyset rule).
    if (candidates.length < config.batchSize) break;
    const last = candidates[candidates.length - 1]!;
    cursor = { createdAtText: last.attemptCreatedAtText, attemptId: last.attemptId };
  }

  // No silent cap: if the sweep stopped because it hit the page ceiling rather than because the
  // set drained, say so — an operator reading "processed 500" must not mistake it for "covered
  // everything".
  if (report.processed >= config.batchSize * config.maxPagesPerSweep) {
    deps.log.warn(
      { processed: report.processed, max_pages: config.maxPagesPerSweep },
      'conversation worker: sweep hit its page ceiling; more candidates may remain',
    );
  }
  return report;
}

export type ConversationWorkerHandle = {
  /**
   * Stop the loop and await the in-flight sweep. Idempotent.
   *
   * ★ THE BOUND IS ONE CANDIDATE, NOT ONE SWEEP, AND THE DIFFERENCE IS HOURS. Clearing the next
   * timer and awaiting the running sweep sounds equivalent, but that sweep does not observe the
   * stop: it would continue through every configured page and candidate, each dispatch bounded
   * only by `dispatchTimeoutMs`. Under a backlog that exceeds any orchestrator's grace period, so
   * the process is SIGKILLed mid-dispatch — turning a clean shutdown into the `outcome_unknown`
   * it was meant to avoid.
   *
   * The sweep now checks the stop signal between pages and between candidates, so a shutdown waits
   * for at most the ONE dispatch already in flight. Declining to start a candidate costs nothing:
   * it stays durably queued and is rediscovered unchanged.
   */
  stop(): Promise<void>;
};

/**
 * Start the periodic sweep loop.
 *
 * ★ NO OVERLAPPING SWEEPS. The next tick is scheduled only after the previous sweep settles
 * (`setTimeout` chaining, not `setInterval`), so a slow provider cannot stack sweeps on top of
 * each other and exhaust the small worker pool. This is the audit-sealer claim-loop shape.
 *
 * ★ THE TIMER IS DELIBERATELY **REFERENCED**, AND THAT IS THE WHOLE LIFECYCLE OF THIS PROCESS.
 * An earlier revision `unref`'d it, reasoning that a sweep timer should never hold a process open.
 * That is sound advice for a timer running BESIDE a live server listener — and this function has
 * exactly one caller, the DEDICATED worker entrypoint, where nothing else holds the event loop at
 * all: the signal handlers do not, and the pool is lazy and has not connected. The `unref`'d timer
 * was therefore the only referenced handle, so the process exited normally BEFORE its first sweep
 * and no durable turn was ever discovered. The deployable unit was a silent no-op.
 *
 * Shutdown does not depend on the `unref`: `stop()` clears the timer and drains the in-flight
 * sweep, and the entrypoint's signal handler calls `process.exit(0)` explicitly.
 */
export function startConversationWorker(
  deps: ConversationExecutorDeps,
  config: ConversationWorkerRunnerConfig,
): ConversationWorkerHandle {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<unknown> = Promise.resolve();

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = (async () => {
        try {
              await runConversationSweepOnce(deps, { ...config, shouldStop: () => stopped });
        } catch (err) {
          deps.log.error(
            { err_class: err instanceof Error ? err.name : 'unknown' },
            'conversation worker: sweep failed',
          );
        } finally {
          schedule();
        }
      })();
    }, config.intervalMs);
  };
  schedule();

  // ★ ONE SHARED DRAIN, NOT AN IDEMPOTENT NO-OP. `if (stopped) return` looks like correct
  // idempotence and is not: a SECOND call resolves IMMEDIATELY while the first is still awaiting
  // an active candidate. The entrypoint calls `process.exit(0)` as soon as its `stop()` resolves,
  // so a second SIGTERM — an impatient operator, or an orchestrator that sends TERM twice — exits
  // the process mid-dispatch and recreates exactly the `outcome_unknown` this bounded shutdown
  // exists to prevent. Every caller must await the SAME drain.
  let shutdown: Promise<void> | null = null;

  return {
    stop(): Promise<void> {
      shutdown ??= (async () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        timer = null;
        // Safe to read once: `stopped` is set synchronously above, so no further sweep can be
        // scheduled and this value cannot be replaced after this point.
        await inFlight.catch(() => undefined);
      })();
      return shutdown;
    },
  };
}
