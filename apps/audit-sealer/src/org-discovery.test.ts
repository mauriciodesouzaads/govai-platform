import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  parseOrgIdsCsv,
  listOrgsFromEnv,
  listOrgsFromDb,
  resolveOrgDiscovery,
} from './org-discovery.js';
import { SealerConfigError, loadSealerConfig, type SealerConfig } from './config.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

/** A SealerConfig with a valid own-URL and an optional enumerator URL. */
function cfg(enumeratorUrl?: string): SealerConfig {
  return loadSealerConfig({
    AUDIT_SEALER_DATABASE_URL: 'postgres://app@localhost/govai',
    ...(enumeratorUrl ? { AUDIT_SEALER_ENUMERATOR_DATABASE_URL: enumeratorUrl } : {}),
  } as NodeJS.ProcessEnv);
}

/** A fake Pool whose query returns the given org ids as { id } rows. */
function fakePool(ids: string[]): Pool {
  return { query: vi.fn(async () => ({ rows: ids.map((id) => ({ id })) })) } as unknown as Pool;
}

describe('parseOrgIdsCsv — FIX 3: a malformed token is a config error, not a silent drop', () => {
  it('returns the ids for a clean CSV', () => {
    expect(parseOrgIdsCsv(`${A},${B}`)).toEqual([A, B]);
  });

  it('ignores empty / whitespace-only segments from the split', () => {
    expect(parseOrgIdsCsv(`${A}, ,,${B} ,`)).toEqual([A, B]);
    expect(parseOrgIdsCsv('')).toEqual([]);
    expect(parseOrgIdsCsv('   ')).toEqual([]);
  });

  it('THROWS a config error on a NON-EMPTY malformed token (the silent-drop fix)', () => {
    expect(() => parseOrgIdsCsv(`${A},not-a-uuid`)).toThrow(SealerConfigError);
    expect(() => parseOrgIdsCsv('zzzz')).toThrow(/malformed org id/);
  });

  it('listOrgsFromEnv parses eagerly so a bad token fails at boot, not at first scan', () => {
    expect(() =>
      listOrgsFromEnv({ AUDIT_SEALER_ORG_IDS: `${A},bad` } as NodeJS.ProcessEnv),
    ).toThrow(SealerConfigError);
  });
});

describe('listOrgsFromDb — read the full tenant set from govai.orgs (as the enumerator)', () => {
  it('returns the org ids the query yields', async () => {
    const pool = fakePool([A, B]);
    expect(await listOrgsFromDb(pool)()).toEqual([A, B]);
    expect(pool.query).toHaveBeenCalledWith(expect.stringMatching(/SELECT id.*FROM govai\.orgs/s));
  });
  it('propagates a query failure (so readiness can fail loud — never a silent empty set)', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('connect ECONNREFUSED'); }) } as unknown as Pool;
    await expect(listOrgsFromDb(pool)()).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe('resolveOrgDiscovery — DB is the DEFAULT source; CSV is an explicit override', () => {
  it('DEFAULT: no CSV, enumerator URL set ⇒ DB discovery (pool created from the runtime URL)', () => {
    const makePool = vi.fn((_url: string) => fakePool([A]));
    const r = resolveOrgDiscovery(cfg('postgres://enum@localhost/govai'), {} as NodeJS.ProcessEnv, makePool);
    expect(r.source).toBe('db');
    expect(r.enumeratorPool).toBeDefined();
    expect(makePool).toHaveBeenCalledWith('postgres://enum@localhost/govai');
  });

  it('OVERRIDE: AUDIT_SEALER_ORG_IDS set ⇒ CSV source, enumerator pool NOT created (even if URL set)', () => {
    const makePool = vi.fn((_url: string) => fakePool([A]));
    const r = resolveOrgDiscovery(
      cfg('postgres://enum@localhost/govai'),
      { AUDIT_SEALER_ORG_IDS: `${A},${B}` } as NodeJS.ProcessEnv,
      makePool,
    );
    expect(r.source).toBe('csv');
    expect(r.enumeratorPool).toBeUndefined();
    expect(makePool).not.toHaveBeenCalled();
  });

  it('FAIL LOUD: neither the enumerator URL nor the CSV ⇒ SealerConfigError at boot', () => {
    expect(() => resolveOrgDiscovery(cfg(undefined), {} as NodeJS.ProcessEnv, vi.fn())).toThrow(
      SealerConfigError,
    );
  });
});
