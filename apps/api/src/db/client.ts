import { Pool, type PoolConfig } from 'pg';

export type DbConfig = {
  connectionString: string;
  max?: number;
};

export function createPool(cfg: DbConfig): Pool {
  const pgCfg: PoolConfig = {
    connectionString: cfg.connectionString,
    max: cfg.max ?? 10,
    application_name: 'govai-api',
  };
  return new Pool(pgCfg);
}
