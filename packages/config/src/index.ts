import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  KMS_DEV_SEED: z.string().optional(),
  GOVAI_KMS_PROVIDER: z.enum(['dev', 'aws', 'gcp', 'azure']).default('dev'),

  // AWS KMS production adapter — consumed by createKmsFromEnv (@govai/core-identity) when
  // GOVAI_KMS_PROVIDER=aws, which is the authoritative fail-closed gate for region/key-id/
  // ciphertext-file. Never store secrets here: the master seed lives only as KMS-encrypted
  // ciphertext in a file OUTSIDE the repo, referenced by GOVAI_KMS_AWS_MASTER_CIPHERTEXT_FILE.
  GOVAI_KMS_AWS_REGION: z.string().optional(),
  GOVAI_KMS_AWS_KEY_ID: z.string().optional(),
  GOVAI_KMS_AWS_MASTER_CIPHERTEXT_FILE: z.string().optional(),
  GOVAI_KMS_SEED_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_ADMIN_URL: z.string().min(1).optional(),
  // EP-EVIDENCE-GAUGE-WIRING: optional connection string for the least-privilege
  // govai_evidence_enumerator role (enumerate-only — SELECT on govai.orgs, nothing
  // else). When unset, the evidence-gauge boot wiring is fully off (server.ts). This
  // is NEVER the app or admin credential; leaking it enumerates org UUIDs and nothing more.
  GOVAI_EVIDENCE_ENUMERATOR_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  API_HOST: z.string().default('0.0.0.0'),
  API_CORS_ORIGINS: z.string().default(''),
  API_CORS_CREDENTIALS: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((v) => v === 'true'),

  JWT_ISSUER: z.string().default('https://govai.local'),
  JWT_AUDIENCE: z.string().default('govai-api'),
  JWT_PUBLIC_KEY_PEM: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  // Optional (no shared default): each app supplies its own service.name fallback
  // via @govai/observability resolveServiceName(); an explicit value still overrides.
  // (A shared 'govai-api' default made the sealer's fallback dead code — EP-OBS-REFACTOR.)
  OTEL_SERVICE_NAME: z.string().optional(),
  OTEL_TRACES_SAMPLER_ARG: z.coerce.number().min(0).max(1).default(1.0),

  // Evidence-completeness reports (EP-008D). T_seal is the B3 backlog seal SLO:
  // a capture still unsealed older than this counts as past-SLO (EC-1 / EC-3.seal).
  // The default window bounds the report scans when the read-API omits ?window=.
  // Both are read-only knobs; no boot-fail coupling (evidence is off the hot path).
  EVIDENCE_T_SEAL_SECONDS: z.coerce.number().int().nonnegative().default(300),
  EVIDENCE_DEFAULT_WINDOW_SECONDS: z.coerce.number().int().positive().default(86_400),

  GOVAI_LIVE_TESTS: z
    .union([z.literal('0'), z.literal('1')])
    .default('0')
    .transform((v) => v === '1'),

  GOVAI_PROVIDER_BASE_URL: z.string().optional(),
  GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION: z
    .union([z.literal('0'), z.literal('1')])
    .default('0')
    .transform((v) => v === '1'),

  // EP-P03A-A (F3) — durable provider dispatch. The timeout bounds the provider
  // fetch via AbortSignal (owner-adjudicated default 300s, hard bounds 1s–15min);
  // the recovery knobs drive the stale-run sweeper. All are validated loud —
  // none is an off-switch, so '' fails instead of silently becoming a default.
  GOVAI_PROVIDER_DISPATCH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(900_000)
    .default(300_000),
  RUN_DISPATCH_RECOVERY_ENABLED: z
    .union([z.literal('0'), z.literal('1')])
    .default('1')
    .transform((v) => v === '1'),
  RUN_DISPATCH_RECOVERY_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(30_000),
  RUN_DISPATCH_PREPARED_GRACE_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(60_000),
  // min(0) means the coercion idiom Number('') === 0 would let an exported-empty
  // value silently pass as an intentional zero grace (every sibling knob has
  // min >= 1, where ''→0 already fails loud). Map '' to NaN BEFORE coercion so
  // it fails like every other non-off-switch key; an explicit '0' stays valid.
  RUN_DISPATCH_RECOVERY_GRACE_MS: z.preprocess(
    (v) => (v === '' ? Number.NaN : v),
    z.coerce.number().int().min(0).max(3_600_000).default(30_000),
  ),
  RUN_DISPATCH_RECOVERY_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
});

export type GovAIEnv = z.infer<typeof EnvSchema>;

export class BootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootError';
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): GovAIEnv {
  // Empty-as-unset is a property of designated OFF-SWITCHES, not a global env-contract
  // change: for the allowlisted optional off-switches/overrides below, an exported-empty
  // value (a `.env` line `DATABASE_URL=` etc., the documented "off" idiom) reads as "unset".
  // For EVERY other key — NODE_ENV, API_PORT, and all future keys — `''` reaches the schema
  // and fails LOUD; an explicitly-provided invalid value must never silently become a
  // default (@codex 3522162726: NODE_ENV='' must not silently downgrade a production boot).
  const EMPTY_MEANS_UNSET = new Set([
    'DATABASE_URL',
    'DATABASE_ADMIN_URL',
    'REDIS_URL',
    'GOVAI_EVIDENCE_ENUMERATOR_URL',
    'OTEL_EXPORTER_OTLP_ENDPOINT',
    'GOVAI_PROVIDER_BASE_URL',
    // Listed to preserve the tSeal-0 kill: EVIDENCE_T_SEAL_SECONDS is
    // .nonnegative().default(300), so an un-filtered '' would coerce to a SILENT 0.
    'EVIDENCE_T_SEAL_SECONDS',
    'EVIDENCE_DEFAULT_WINDOW_SECONDS',
  ]);
  const normalized = Object.fromEntries(
    Object.entries(source).filter(([k, v]) => !(v === '' && EMPTY_MEANS_UNSET.has(k))),
  );
  const parsed = EnvSchema.safeParse(normalized);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new BootError(`invalid environment: ${issues}`);
  }
  const env = parsed.data;

  // Boot-fail conditions enforced regardless of subsystem.
  if (env.NODE_ENV === 'production') {
    if (env.KMS_DEV_SEED && env.KMS_DEV_SEED.length > 0) {
      throw new BootError(
        'KMS_DEV_SEED set in production. Remove env var. Runbook: docs/runbooks/kms-production.md',
      );
    }
    if (env.GOVAI_KMS_PROVIDER === 'dev') {
      throw new BootError(
        'DevKMS detected in production. Configure GOVAI_KMS_PROVIDER. Runbook: docs/runbooks/kms-production.md',
      );
    }
    // NOTE: when GOVAI_KMS_PROVIDER=aws, the required region/key-id/ciphertext-file
    // (and a readable, non-empty ciphertext file) are validated authoritatively by
    // createKmsFromEnv() in @govai/core-identity, which is the single fail-closed gate
    // for the AWS adapter. We deliberately do NOT duplicate that check here so loadEnv
    // stays decoupled from KMS bootstrapping.
    if (env.GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION) {
      throw new BootError(
        'GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION cannot be set in production. Remove env var. Runbook: docs/runbooks/planned-capability-guard.md',
      );
    }
  }

  return env;
}

export function originsFromCsv(csv: string): string[] {
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function assertCorsSafeForProd(env: GovAIEnv): void {
  if (env.NODE_ENV !== 'production') return;
  const origins = originsFromCsv(env.API_CORS_ORIGINS);
  if (env.API_CORS_CREDENTIALS && origins.includes('*')) {
    throw new BootError(
      'CORS credentials=true with origin=* is unsafe in production. Set explicit origins.',
    );
  }
}
