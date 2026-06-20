// Pure exponential-backoff-with-jitter math (SPEC-B3 §4.1). Extracted so the
// loop's timing policy is unit-testable without a clock or a DB.

export interface BackoffParams {
  minMs: number;
  maxMs: number;
}

/**
 * Exponential backoff for the Nth consecutive event (attempt 0 → minMs,
 * doubling each step), capped at maxMs, BEFORE jitter. Pure.
 */
export function backoffBaseMs(attempt: number, params: BackoffParams): number {
  const safeAttempt = attempt < 0 ? 0 : Math.floor(attempt);
  // Cap the exponent so `2 ** n` never overflows to Infinity before the min().
  const exp = Math.min(safeAttempt, 53);
  const doubled = params.minMs * 2 ** exp;
  return Math.min(doubled, params.maxMs);
}

/**
 * Full jitter on a base delay: a value in [base/2, base]. Keeps the backoff
 * growing (never below half the base) while decorrelating retries to avoid a
 * thundering herd. `rand` is injectable for deterministic tests.
 */
export function jitter(baseMs: number, rand: () => number = Math.random): number {
  const half = baseMs / 2;
  return Math.round(half + rand() * half);
}

/** Base backoff for the attempt, with jitter applied. */
export function backoffWithJitterMs(
  attempt: number,
  params: BackoffParams,
  rand: () => number = Math.random,
): number {
  return jitter(backoffBaseMs(attempt, params), rand);
}
