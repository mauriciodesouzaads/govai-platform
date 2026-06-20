// Typed runtime config for the B3 AuditSealer runner (SPEC-B3 §3/§4).
//
// Deliberately SEPARATE from `@govai/config` (apps/api): the runner reads its
// OWN database URL (`AUDIT_SEALER_DATABASE_URL`) so it never shares the request
// pool, plus the loop/stale/backlog knobs. All values are env-overridable; only
// the database URL is required. The KMS env (read by `createKmsFromEnv`) is the
// shared `@govai/config` set and is loaded separately in `main.ts`.

import { z } from 'zod';

const ConfigSchema = z.object({
  databaseUrl: z.string().min(1, 'AUDIT_SEALER_DATABASE_URL is required'),
  poolMax: z.number().int().positive(),
  workerId: z.string().min(1),
  healthFilePath: z.string().min(1),
  healthIntervalMs: z.number().int().positive(),
  loop: z.object({
    claimBatch: z.number().int().positive(),
    maxInFlight: z.number().int().positive(),
    idleSleepMs: z.number().int().nonnegative(),
    emptyBackoffMinMs: z.number().int().positive(),
    emptyBackoffMaxMs: z.number().int().positive(),
    errorBackoffMinMs: z.number().int().positive(),
    errorBackoffMaxMs: z.number().int().positive(),
    drainMs: z.number().int().nonnegative(),
  }),
  stale: z.object({
    thresholdMs: z.number().int().positive(),
    maxRetries: z.number().int().positive(),
    recoveryBackoffMinMs: z.number().int().positive(),
    recoveryBackoffMaxMs: z.number().int().positive(),
    recoveryBatch: z.number().int().positive(),
  }),
  backlog: z.object({
    oldestPendingSec: z.number().int().positive(),
    pendingCount: z.number().int().positive(),
  }),
});

export type SealerConfig = z.infer<typeof ConfigSchema>;

/** Thrown when the runner config is invalid. The message is safe to log. */
export class SealerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SealerConfigError';
  }
}

function num(source: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = source[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new SealerConfigError(`${key} must be a number (got ${JSON.stringify(raw)})`);
  }
  return n;
}

function str(source: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const raw = source[key];
  return raw === undefined || raw === '' ? fallback : raw;
}

/**
 * Build the runner config from the environment. Throws `SealerConfigError` with
 * a payload-free message when invalid (missing DB URL, non-numeric override).
 * Defaults are the ADR-024/ADR-023 values from SPEC-B3 §4.
 */
export function loadSealerConfig(source: NodeJS.ProcessEnv = process.env): SealerConfig {
  const candidate = {
    databaseUrl: str(source, 'AUDIT_SEALER_DATABASE_URL', ''),
    poolMax: num(source, 'AUDIT_SEALER_POOL_MAX', 2),
    workerId: str(source, 'AUDIT_SEALER_WORKER_ID', 'audit-sealer-1'),
    healthFilePath: str(source, 'AUDIT_SEALER_HEALTH_FILE', '/tmp/audit-sealer-health.json'),
    healthIntervalMs: num(source, 'AUDIT_SEALER_HEALTH_INTERVAL_MS', 5000),
    loop: {
      claimBatch: num(source, 'AUDIT_SEALER_CLAIM_BATCH', 10),
      maxInFlight: num(source, 'AUDIT_SEALER_MAX_IN_FLIGHT', 2),
      idleSleepMs: num(source, 'AUDIT_SEALER_IDLE_SLEEP_MS', 1000),
      emptyBackoffMinMs: num(source, 'AUDIT_SEALER_EMPTY_BACKOFF_MIN_MS', 1000),
      emptyBackoffMaxMs: num(source, 'AUDIT_SEALER_EMPTY_BACKOFF_MAX_MS', 30_000),
      errorBackoffMinMs: num(source, 'AUDIT_SEALER_ERROR_BACKOFF_MIN_MS', 30_000),
      errorBackoffMaxMs: num(source, 'AUDIT_SEALER_ERROR_BACKOFF_MAX_MS', 300_000),
      drainMs: num(source, 'AUDIT_SEALER_DRAIN_MS', 30_000),
    },
    stale: {
      thresholdMs: num(source, 'AUDIT_SEALER_STALE_THRESHOLD_MS', 600_000),
      maxRetries: num(source, 'AUDIT_SEALER_STALE_MAX_RETRIES', 3),
      recoveryBackoffMinMs: num(source, 'AUDIT_SEALER_RECOVERY_BACKOFF_MIN_MS', 30_000),
      recoveryBackoffMaxMs: num(source, 'AUDIT_SEALER_RECOVERY_BACKOFF_MAX_MS', 300_000),
      recoveryBatch: num(source, 'AUDIT_SEALER_RECOVERY_BATCH', 10),
    },
    backlog: {
      oldestPendingSec: num(source, 'AUDIT_SEALER_BACKLOG_OLDEST_PENDING_SEC', 300),
      pendingCount: num(source, 'AUDIT_SEALER_BACKLOG_PENDING_COUNT', 1000),
    },
  };

  const parsed = ConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new SealerConfigError(
      `invalid AuditSealer config: ${first ? `${first.path.join('.')}: ${first.message}` : 'unknown error'}`,
    );
  }
  return parsed.data;
}
