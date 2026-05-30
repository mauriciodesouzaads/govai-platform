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
  OTEL_SERVICE_NAME: z.string().default('govai-api'),
  OTEL_TRACES_SAMPLER_ARG: z.coerce.number().min(0).max(1).default(1.0),

  GOVAI_LIVE_TESTS: z
    .union([z.literal('0'), z.literal('1')])
    .default('0')
    .transform((v) => v === '1'),

  GOVAI_PROVIDER_BASE_URL: z.string().optional(),
  GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION: z
    .union([z.literal('0'), z.literal('1')])
    .default('0')
    .transform((v) => v === '1'),
});

export type GovAIEnv = z.infer<typeof EnvSchema>;

export class BootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootError';
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): GovAIEnv {
  const parsed = EnvSchema.safeParse(source);
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
