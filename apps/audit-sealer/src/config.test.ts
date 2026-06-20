import { describe, it, expect } from 'vitest';
import { loadSealerConfig, SealerConfigError } from './config.js';

const base = { AUDIT_SEALER_DATABASE_URL: 'postgres://u:p@h:5432/db' } as NodeJS.ProcessEnv;

describe('loadSealerConfig', () => {
  it('applies the SPEC-B3 defaults', () => {
    const c = loadSealerConfig(base);
    expect(c.poolMax).toBe(2);
    expect(c.workerId).toBe('audit-sealer-1');
    expect(c.loop.claimBatch).toBe(10);
    expect(c.loop.maxInFlight).toBe(2);
    expect(c.loop.idleSleepMs).toBe(1000);
    expect(c.loop.emptyBackoffMinMs).toBe(1000);
    expect(c.loop.emptyBackoffMaxMs).toBe(30_000);
    expect(c.loop.errorBackoffMinMs).toBe(30_000);
    expect(c.loop.errorBackoffMaxMs).toBe(300_000);
    expect(c.loop.drainMs).toBe(30_000);
    expect(c.stale.thresholdMs).toBe(600_000);
    expect(c.stale.maxRetries).toBe(3);
    expect(c.stale.recoveryBatch).toBe(10);
    expect(c.backlog.oldestPendingSec).toBe(300);
    expect(c.backlog.pendingCount).toBe(1000);
  });

  it('overrides numeric + string knobs from env', () => {
    const c = loadSealerConfig({
      ...base,
      AUDIT_SEALER_POOL_MAX: '5',
      AUDIT_SEALER_CLAIM_BATCH: '7',
      AUDIT_SEALER_MAX_IN_FLIGHT: '3',
      AUDIT_SEALER_STALE_THRESHOLD_MS: '120000',
      AUDIT_SEALER_WORKER_ID: 'sealer-prod-2',
    } as NodeJS.ProcessEnv);
    expect(c.poolMax).toBe(5);
    expect(c.loop.claimBatch).toBe(7);
    expect(c.loop.maxInFlight).toBe(3);
    expect(c.stale.thresholdMs).toBe(120_000);
    expect(c.workerId).toBe('sealer-prod-2');
  });

  it('throws when AUDIT_SEALER_DATABASE_URL is missing', () => {
    expect(() => loadSealerConfig({} as NodeJS.ProcessEnv)).toThrow(SealerConfigError);
  });

  it('throws on a non-numeric override', () => {
    expect(() =>
      loadSealerConfig({ ...base, AUDIT_SEALER_POOL_MAX: 'not-a-number' } as NodeJS.ProcessEnv),
    ).toThrow(SealerConfigError);
  });

  it('rejects a non-positive pool max', () => {
    expect(() =>
      loadSealerConfig({ ...base, AUDIT_SEALER_POOL_MAX: '0' } as NodeJS.ProcessEnv),
    ).toThrow(SealerConfigError);
  });
});
