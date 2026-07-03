import { describe, it, expect } from 'vitest';
import { loadEnv, BootError, assertCorsSafeForProd } from './index.js';

describe('config / boot fail conditions', () => {
  it('production + KMS_DEV_SEED → boot fail', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        KMS_DEV_SEED: 'a'.repeat(64),
      }),
    ).toThrow(BootError);
  });

  it('production + GOVAI_KMS_PROVIDER=dev → boot fail', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        GOVAI_KMS_PROVIDER: 'dev',
      }),
    ).toThrow(BootError);
  });

  it('production + cors credentials + origin=* → boot fail', () => {
    const env = loadEnv({
      NODE_ENV: 'production',
      GOVAI_KMS_PROVIDER: 'aws',
      API_CORS_ORIGINS: '*',
      API_CORS_CREDENTIALS: 'true',
    });
    expect(() => assertCorsSafeForProd(env)).toThrow(BootError);
  });

  it('development with dev KMS works', () => {
    const env = loadEnv({
      NODE_ENV: 'development',
      GOVAI_KMS_PROVIDER: 'dev',
      KMS_DEV_SEED: 'b'.repeat(64),
    });
    expect(env.NODE_ENV).toBe('development');
  });
});

describe('config / AWS KMS env vars', () => {
  const awsBase = {
    NODE_ENV: 'production' as const,
    GOVAI_KMS_PROVIDER: 'aws' as const,
    GOVAI_KMS_AWS_REGION: 'us-east-1',
    GOVAI_KMS_AWS_KEY_ID: 'alias/govai-foundation',
    GOVAI_KMS_AWS_MASTER_CIPHERTEXT_FILE: '/secrets/govai.ciphertext',
  };

  it('accepts a fully-configured aws provider in production', () => {
    const env = loadEnv({ ...awsBase });
    expect(env.GOVAI_KMS_PROVIDER).toBe('aws');
    expect(env.GOVAI_KMS_AWS_REGION).toBe('us-east-1');
    // TTL default applied when unset.
    expect(env.GOVAI_KMS_SEED_CACHE_TTL_SECONDS).toBe(900);
  });

  it('accepts aws provider env without KMS config at the schema layer', () => {
    // loadEnv does NOT require region/key/file — that is enforced authoritatively by
    // createKmsFromEnv() in @govai/core-identity (see aws-kms.test.ts). loadEnv only
    // parses/validates the schema and the dev-material-in-prod guards.
    const env = loadEnv({ NODE_ENV: 'production', GOVAI_KMS_PROVIDER: 'aws' });
    expect(env.GOVAI_KMS_PROVIDER).toBe('aws');
  });

  it('coerces a valid TTL string to a number', () => {
    const env = loadEnv({ ...awsBase, GOVAI_KMS_SEED_CACHE_TTL_SECONDS: '120' });
    expect(env.GOVAI_KMS_SEED_CACHE_TTL_SECONDS).toBe(120);
  });

  it('rejects invalid TTL (zero, negative, non-numeric)', () => {
    for (const ttl of ['0', '-5', 'abc']) {
      expect(() =>
        loadEnv({ ...awsBase, GOVAI_KMS_SEED_CACHE_TTL_SECONDS: ttl }),
      ).toThrow(BootError);
    }
  });

  it('production + KMS_DEV_SEED still boot-fails even with aws provider', () => {
    expect(() => loadEnv({ ...awsBase, KMS_DEV_SEED: 'a'.repeat(64) })).toThrow(BootError);
  });
});

describe('config / empty-env normalization (absent === empty) — EP-EVIDENCE-GAUGE-WIRING FIXUP1', () => {
  it('normalizes exported-empty vars to unset so the documented off-state boots', () => {
    // .env.example ships these empty (DATABASE_URL=, GOVAI_EVIDENCE_ENUMERATOR_URL=, …); an
    // exported-empty var must read as "unset", not '' (which a .min(1) schema would reject).
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: '',
      DATABASE_ADMIN_URL: '',
      GOVAI_EVIDENCE_ENUMERATOR_URL: '',
      OTEL_EXPORTER_OTLP_ENDPOINT: '',
    });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.DATABASE_ADMIN_URL).toBeUndefined();
    expect(env.GOVAI_EVIDENCE_ENUMERATOR_URL).toBeUndefined();
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  });

  it('an empty coerce-key falls back to its default (not coerced to 0)', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      API_PORT: '',
      EVIDENCE_T_SEAL_SECONDS: '',
      EVIDENCE_DEFAULT_WINDOW_SECONDS: '',
    });
    expect(env.API_PORT).toBe(8080);
    expect(env.EVIDENCE_T_SEAL_SECONDS).toBe(300);
    expect(env.EVIDENCE_DEFAULT_WINDOW_SECONDS).toBe(86_400);
  });

  it('a present non-empty value still validates (min(1) intact)', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://u:p@localhost:5432/govai',
      GOVAI_EVIDENCE_ENUMERATOR_URL: 'postgres://govai_evidence_enumerator:pw@localhost:5432/govai',
    });
    expect(env.DATABASE_URL).toBe('postgres://u:p@localhost:5432/govai');
    expect(env.GOVAI_EVIDENCE_ENUMERATOR_URL).toBe(
      'postgres://govai_evidence_enumerator:pw@localhost:5432/govai',
    );
  });
});
