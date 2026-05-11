// Unit tests for grant-api-key-role CLI parser + grant logic.
// The DB+integration path (with real testcontainers) is covered indirectly
// by tests that use the helper grantAdminRole in server-fixture; here we
// pin the CLI surface contract: argv refusal, prefix-only, idempotency,
// and metadata-only output.

import { describe, it, expect } from 'vitest';
import {
  parseArgs,
  GRANT_DEPRECATION_NOTICE,
  grantAdminRoleByPrefix,
} from './grant-api-key-role.js';
import type { Pool, PoolClient } from 'pg';

describe('grant-api-key-role / parseArgs', () => {
  const validBase = (extra: string[] = []): string[] => [
    '--api-key-prefix',
    'govai_sk_abc12',
    '--role',
    'admin',
    '--reason',
    'first admin bootstrap',
    ...extra,
  ];

  it('accepts valid argv', () => {
    const parsed = parseArgs(validBase());
    expect(parsed.api_key_prefix).toBe('govai_sk_abc12');
    expect(parsed.role).toBe('admin');
    expect(parsed.reason).toBe('first admin bootstrap');
  });

  it('refuses --api-key', () => {
    expect(() =>
      parseArgs([...validBase(), '--api-key', 'sk-ant-leak-canary-XYZABC123-DO-NOT-LEAK']),
    ).toThrowError(/--api-key is not accepted/);
  });

  it('refuses --api-key=...', () => {
    let caught: Error | null = null;
    try {
      parseArgs([...validBase(), '--api-key=sk-ant-leak-canary-XYZABC123-DO-NOT-LEAK']);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).not.toContain('leak-canary');
  });

  it('refuses --secret', () => {
    expect(() =>
      parseArgs([...validBase(), '--secret', 'sk-ant-leak-canary-XYZABC123-DO-NOT-LEAK']),
    ).toThrowError(/--secret is not accepted/);
  });

  it('rejects missing --api-key-prefix', () => {
    expect(() =>
      parseArgs(['--role', 'admin', '--reason', 'x']),
    ).toThrowError(/--api-key-prefix is required/);
  });

  it('rejects prefix that looks like an embedded key value', () => {
    expect(() =>
      parseArgs([
        '--api-key-prefix',
        'sk-ant-some-real-looking=embedded',
        '--role',
        'admin',
        '--reason',
        'x',
      ]),
    ).toThrowError(/--api-key-prefix must be the public prefix/);
  });

  it('rejects very short prefix', () => {
    expect(() =>
      parseArgs(['--api-key-prefix', 'short', '--role', 'admin', '--reason', 'x']),
    ).toThrowError(/--api-key-prefix must be the public prefix/);
  });

  it('rejects role other than admin', () => {
    expect(() =>
      parseArgs([
        '--api-key-prefix',
        'govai_sk_abc12',
        '--role',
        'developer',
        '--reason',
        'x',
      ]),
    ).toThrowError(/--role must be 'admin'/);
  });

  it('rejects missing --reason', () => {
    expect(() =>
      parseArgs(['--api-key-prefix', 'govai_sk_abc12', '--role', 'admin']),
    ).toThrowError(/--reason is required/);
  });
});

describe('grant-api-key-role / GRANT_DEPRECATION_NOTICE', () => {
  it('contains the bridge marker', () => {
    expect(GRANT_DEPRECATION_NOTICE).toContain('bridge');
  });

  it('points operators to the HTTP admin surface', () => {
    expect(GRANT_DEPRECATION_NOTICE).toContain('HTTP admin');
  });

  it('contains no canary or secret substring', () => {
    expect(GRANT_DEPRECATION_NOTICE).not.toContain('leak-canary');
    expect(GRANT_DEPRECATION_NOTICE).not.toContain('sk-');
  });
});

interface CapturedQuery {
  sql: string;
  params: unknown[];
}

function makeStubPool(behaviors: {
  selectRows?: Array<{ org_id: string; roles: string[] | null }>;
  shouldUpdateThrow?: boolean;
}): { pool: Pool; queries: CapturedQuery[] } {
  const queries: CapturedQuery[] = [];
  let releaseCalls = 0;
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT org_id, roles')) {
        return { rows: behaviors.selectRows ?? [] };
      }
      if (sql.startsWith('UPDATE govai.api_keys')) {
        if (behaviors.shouldUpdateThrow) throw new Error('update failed');
        return { rows: [] };
      }
      return { rows: [] };
    },
    release: () => {
      releaseCalls += 1;
    },
  } as unknown as PoolClient;
  const pool = {
    connect: async () => client,
    end: async () => undefined,
    _releaseCalls: () => releaseCalls,
  } as unknown as Pool;
  return { pool, queries };
}

describe('grant-api-key-role / grantAdminRoleByPrefix', () => {
  it('throws when api_key_prefix is not found', async () => {
    const { pool } = makeStubPool({ selectRows: [] });
    let captured: Error | null = null;
    try {
      await grantAdminRoleByPrefix(pool, 'govai_sk_xxxx');
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeInstanceOf(Error);
    expect((captured as { code?: string }).code ?? captured!.message).toMatch(
      /api_key_prefix_not_found|no active api key/,
    );
  });

  it('idempotent: returns updated=false when admin already present', async () => {
    const { pool, queries } = makeStubPool({
      selectRows: [
        {
          org_id: '11111111-1111-1111-1111-111111111111',
          roles: ['developer', 'admin'],
        },
      ],
    });
    const result = await grantAdminRoleByPrefix(pool, 'govai_sk_abc12');
    expect(result.updated).toBe(false);
    expect(result.roles).toEqual(['developer', 'admin']);
    const updates = queries.filter((q) => q.sql.startsWith('UPDATE govai.api_keys'));
    expect(updates.length).toBe(0);
  });

  it('appends admin when missing', async () => {
    const { pool, queries } = makeStubPool({
      selectRows: [
        {
          org_id: '11111111-1111-1111-1111-111111111111',
          roles: ['developer'],
        },
      ],
    });
    const result = await grantAdminRoleByPrefix(pool, 'govai_sk_abc12');
    expect(result.updated).toBe(true);
    expect(result.roles).toEqual(['developer', 'admin']);
    const update = queries.find((q) => q.sql.startsWith('UPDATE govai.api_keys'));
    expect(update).toBeDefined();
    expect(update!.params[1]).toEqual(['developer', 'admin']);
  });

  it('handles null roles column gracefully', async () => {
    const { pool } = makeStubPool({
      selectRows: [
        {
          org_id: '11111111-1111-1111-1111-111111111111',
          roles: null,
        },
      ],
    });
    const result = await grantAdminRoleByPrefix(pool, 'govai_sk_abc12');
    expect(result.updated).toBe(true);
    expect(result.roles).toEqual(['admin']);
  });

  it('filters out unknown roles defensively before append', async () => {
    const { pool } = makeStubPool({
      selectRows: [
        {
          org_id: '11111111-1111-1111-1111-111111111111',
          roles: ['developer', 'mythic_role_unknown'],
        },
      ],
    });
    const result = await grantAdminRoleByPrefix(pool, 'govai_sk_abc12');
    expect(result.updated).toBe(true);
    // unknown role filtered out; only canonical roles kept + new admin.
    expect(result.roles).toEqual(['developer', 'admin']);
  });

  it('SQL: sets tenant context before UPDATE so RLS allows the write', async () => {
    const { pool, queries } = makeStubPool({
      selectRows: [
        {
          org_id: '22222222-2222-2222-2222-222222222222',
          roles: [],
        },
      ],
    });
    await grantAdminRoleByPrefix(pool, 'govai_sk_abc12');
    const setContext = queries.find((q) => q.sql.includes('set_config'));
    expect(setContext).toBeDefined();
    expect(setContext!.params[0]).toBe('22222222-2222-2222-2222-222222222222');
  });
});
