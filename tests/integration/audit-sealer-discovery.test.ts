// EP-SEALER-DEPLOY — integration: the sealer discovers the FULL tenant set from the DB via the
// least-privilege enumerator RUNTIME URL (closing the silent-drop), and a discovery failure makes
// the runner FAIL READINESS (org_discovery_failed) rather than run healthy-while-blind.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { startStack, stopStack, seedOrg, type Stack } from './helpers/server-fixture.js';
import { migrate } from './setup.js';
import { createKmsFromEnv } from '@govai/core-identity/kms';
import { listOrgsFromDb } from '../../apps/audit-sealer/src/org-discovery.js';
import { loadSealerConfig } from '../../apps/audit-sealer/src/config.js';
import { createRunner } from '../../apps/audit-sealer/src/runner.js';

let stack: Stack;
let enumPool: Pool;

beforeAll(async () => {
  stack = await startStack();
  // Provision the enumerator LOGIN (re-run migrate with its password) + connect a runtime pool AS
  // the enumerator — exactly how the shipped sealer discovers (a runtime URL, not the provision pw).
  await migrate(stack.db.adminUrl, stack.db.appPassword, stack.db.enumeratorPassword);
  enumPool = new Pool({ connectionString: stack.db.enumeratorUrl });
  enumPool.on('error', () => undefined);
}, 240_000);

afterAll(async () => {
  await enumPool?.end().catch(() => undefined);
  if (stack) await stopStack(stack);
});

describe('EP-SEALER-DEPLOY — DB discovery via the enumerator runtime URL', () => {
  it('listOrgsFromDb (as the enumerator) returns EVERY seeded org — the source of truth, no silent drop', async () => {
    const a = await seedOrg(stack);
    const b = await seedOrg(stack);
    const c = await seedOrg(stack);
    const ids = await listOrgsFromDb(enumPool)();
    expect(ids).toContain(a.org_id);
    expect(ids).toContain(b.org_id);
    expect(ids).toContain(c.org_id);
    expect(ids.length).toBeGreaterThanOrEqual(3);
  });

  it('INV-1: the enumerator reads ONLY orgs.id — a non-id column is denied (42501)', async () => {
    const client = await enumPool.connect();
    try {
      await expect(client.query('SELECT name FROM govai.orgs LIMIT 1')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      client.release();
    }
  });

  it('the runner FAILS readiness (org_discovery_failed) when discovery is broken — never healthy-while-blind', async () => {
    // A real superuser pool ⇒ validateStartup passes (roles + functions exist on the migrated DB),
    // so the run reaches the startup DISCOVERY probe; an injected always-failing listOrgs is the
    // broken discovery. start() is deterministic (it awaits the probe) — no loop-timing flake.
    const pool = new Pool({ connectionString: stack.db.adminUrl });
    const kms = createKmsFromEnv({
      NODE_ENV: 'test',
      GOVAI_KMS_PROVIDER: 'dev',
      KMS_DEV_SEED: 'a'.repeat(64),
    });
    const config = loadSealerConfig({
      AUDIT_SEALER_DATABASE_URL: stack.db.adminUrl,
      AUDIT_SEALER_HEALTH_FILE: `/tmp/sealer-health-${randomUUID()}.json`,
    } as NodeJS.ProcessEnv);
    const runner = createRunner({
      config,
      kms,
      pool,
      listOrgs: async () => {
        throw new Error('discovery down (enumerator unreachable)');
      },
    });
    try {
      const res = await runner.start();
      expect(res.started).toBe(true); // started (loop runs so it can recover) but NOT ready
      expect(res.ready).toBe(false);
      expect(runner.health.readiness().reason).toBe('org_discovery_failed');
    } finally {
      await runner.stop();
      await pool.end().catch(() => undefined);
    }
  });
});
