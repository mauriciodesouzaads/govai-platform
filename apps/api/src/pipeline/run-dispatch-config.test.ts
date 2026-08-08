// Unit tests for run-dispatch-config (EP-P03A-A / F3).

import { describe, it, expect } from 'vitest';
import type { GovAIEnv } from '@govai/config';
import { runDispatchConfigFromEnv, RUN_DISPATCH_DEFAULTS } from './run-dispatch-config.js';

function env(partial: Partial<GovAIEnv> = {}): GovAIEnv {
  return partial as GovAIEnv;
}

describe('runDispatchConfigFromEnv', () => {
  it('resolves owner-adjudicated defaults when knobs are absent (fixture-style partial env)', () => {
    const c = runDispatchConfigFromEnv(env());
    expect(c.timeoutMs).toBe(300_000);
    expect(c.recoveryIntervalMs).toBe(30_000);
    expect(c.preparedGraceMs).toBe(60_000);
    expect(c.recoveryGraceMs).toBe(30_000);
    expect(c.recoveryBatchSize).toBe(50);
    expect(c.recoveryEnabled).toBe(false);
    expect(c).toMatchObject(RUN_DISPATCH_DEFAULTS);
  });

  it('passes explicit values through', () => {
    const c = runDispatchConfigFromEnv(
      env({
        GOVAI_PROVIDER_DISPATCH_TIMEOUT_MS: 1_500,
        RUN_DISPATCH_RECOVERY_INTERVAL_MS: 1_000,
        RUN_DISPATCH_PREPARED_GRACE_MS: 2_000,
        RUN_DISPATCH_RECOVERY_GRACE_MS: 0,
        RUN_DISPATCH_RECOVERY_BATCH_SIZE: 1,
        RUN_DISPATCH_RECOVERY_ENABLED: true,
      }),
    );
    expect(c.timeoutMs).toBe(1_500);
    expect(c.recoveryIntervalMs).toBe(1_000);
    expect(c.preparedGraceMs).toBe(2_000);
    expect(c.recoveryGraceMs).toBe(0);
    expect(c.recoveryBatchSize).toBe(1);
    expect(c.recoveryEnabled).toBe(true);
  });

  it('timeout below 1000ms → throws loud', () => {
    expect(() =>
      runDispatchConfigFromEnv(env({ GOVAI_PROVIDER_DISPATCH_TIMEOUT_MS: 999 })),
    ).toThrow(/GOVAI_PROVIDER_DISPATCH_TIMEOUT_MS/);
  });

  it('timeout above 900000ms → throws loud', () => {
    expect(() =>
      runDispatchConfigFromEnv(env({ GOVAI_PROVIDER_DISPATCH_TIMEOUT_MS: 900_001 })),
    ).toThrow(/GOVAI_PROVIDER_DISPATCH_TIMEOUT_MS/);
  });

  it('non-integer / out-of-bounds recovery knobs → throw loud', () => {
    expect(() =>
      runDispatchConfigFromEnv(env({ RUN_DISPATCH_RECOVERY_INTERVAL_MS: 500 })),
    ).toThrow(/RUN_DISPATCH_RECOVERY_INTERVAL_MS/);
    expect(() => runDispatchConfigFromEnv(env({ RUN_DISPATCH_PREPARED_GRACE_MS: 10 }))).toThrow(
      /RUN_DISPATCH_PREPARED_GRACE_MS/,
    );
    expect(() => runDispatchConfigFromEnv(env({ RUN_DISPATCH_RECOVERY_GRACE_MS: -1 }))).toThrow(
      /RUN_DISPATCH_RECOVERY_GRACE_MS/,
    );
    expect(() => runDispatchConfigFromEnv(env({ RUN_DISPATCH_RECOVERY_BATCH_SIZE: 0 }))).toThrow(
      /RUN_DISPATCH_RECOVERY_BATCH_SIZE/,
    );
    expect(() => runDispatchConfigFromEnv(env({ RUN_DISPATCH_RECOVERY_BATCH_SIZE: 501 }))).toThrow(
      /RUN_DISPATCH_RECOVERY_BATCH_SIZE/,
    );
    expect(() =>
      runDispatchConfigFromEnv(
        env({ GOVAI_PROVIDER_DISPATCH_TIMEOUT_MS: 1000.5 as unknown as number }),
      ),
    ).toThrow(/GOVAI_PROVIDER_DISPATCH_TIMEOUT_MS/);
  });
});
