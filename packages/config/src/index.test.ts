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
