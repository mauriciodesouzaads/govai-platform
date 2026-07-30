// Dispatch/recovery configuration (EP-P03A-A / F3).
//
// loadEnv() already validates every knob with hard zod bounds; this module
// re-derives a typed config with the SAME bounds applied defensively, because
// integration fixtures build partial GovAIEnv objects via `as GovAIEnv` casts
// and a missing knob must resolve to its owner-adjudicated default rather than
// undefined reaching a make_interval / AbortSignal call.

import type { GovAIEnv } from '@govai/config';

export type RunDispatchConfig = {
  /** Provider fetch AbortSignal budget (§19). */
  timeoutMs: number;
  /** Recovery sweep cadence (§25.1). */
  recoveryIntervalMs: number;
  /** Age beyond which a v1 queued run with no claim is provably dead (§25.2). */
  preparedGraceMs: number;
  /** Slack past dispatch_deadline_at before a running claim is stale (§25.3). */
  recoveryGraceMs: number;
  /** Max candidates per sweep (§25.1). */
  recoveryBatchSize: number;
  /** Whether the periodic recovery worker starts with the API lifecycle. */
  recoveryEnabled: boolean;
};

export const RUN_DISPATCH_DEFAULTS = {
  timeoutMs: 300_000,
  recoveryIntervalMs: 30_000,
  preparedGraceMs: 60_000,
  recoveryGraceMs: 30_000,
  recoveryBatchSize: 50,
} as const;

function bounded(value: number | undefined, def: number, min: number, max: number, name: string): number {
  const v = value ?? def;
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new Error(`run-dispatch-config: ${name}=${v} outside safe bounds [${min}, ${max}]`);
  }
  return v;
}

export function runDispatchConfigFromEnv(env: GovAIEnv): RunDispatchConfig {
  return {
    timeoutMs: bounded(
      env.GOVAI_PROVIDER_DISPATCH_TIMEOUT_MS,
      RUN_DISPATCH_DEFAULTS.timeoutMs,
      1_000,
      900_000,
      'GOVAI_PROVIDER_DISPATCH_TIMEOUT_MS',
    ),
    recoveryIntervalMs: bounded(
      env.RUN_DISPATCH_RECOVERY_INTERVAL_MS,
      RUN_DISPATCH_DEFAULTS.recoveryIntervalMs,
      1_000,
      3_600_000,
      'RUN_DISPATCH_RECOVERY_INTERVAL_MS',
    ),
    preparedGraceMs: bounded(
      env.RUN_DISPATCH_PREPARED_GRACE_MS,
      RUN_DISPATCH_DEFAULTS.preparedGraceMs,
      1_000,
      3_600_000,
      'RUN_DISPATCH_PREPARED_GRACE_MS',
    ),
    recoveryGraceMs: bounded(
      env.RUN_DISPATCH_RECOVERY_GRACE_MS,
      RUN_DISPATCH_DEFAULTS.recoveryGraceMs,
      0,
      3_600_000,
      'RUN_DISPATCH_RECOVERY_GRACE_MS',
    ),
    recoveryBatchSize: bounded(
      env.RUN_DISPATCH_RECOVERY_BATCH_SIZE,
      RUN_DISPATCH_DEFAULTS.recoveryBatchSize,
      1,
      500,
      'RUN_DISPATCH_RECOVERY_BATCH_SIZE',
    ),
    recoveryEnabled: env.RUN_DISPATCH_RECOVERY_ENABLED === true,
  };
}
