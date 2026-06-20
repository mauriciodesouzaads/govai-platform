// The runner's DEDICATED pg.Pool (ADR-022). Built from
// `AUDIT_SEALER_DATABASE_URL`; never the apps/api request pool. Capped small
// (default max 2) — sealing throughput is bounded to this deploy unit.

import { Pool, type PoolConfig } from 'pg';
import type { SealerConfig } from './config.js';

export function createSealerPool(config: SealerConfig): Pool {
  const poolConfig: PoolConfig = {
    connectionString: config.databaseUrl,
    max: config.poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: `govai-audit-sealer:${config.workerId}`,
  };
  return new Pool(poolConfig);
}
