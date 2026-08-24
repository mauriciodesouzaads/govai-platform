// EP-AI-CONVERSATION-CONTINUITY-V1 P0-A1 — owner-context helper unit tests.
//
// Validation + query-sequence contract only; transaction-local visibility,
// commit/rollback clearing and pooled-connection isolation are proven against
// a real Postgres in tests/integration/ai-conversation-owner-context.test.ts.

import { describe, it, expect } from 'vitest';
import type { PoolClient } from 'pg';
import {
  isUuid,
  setLocalAppOrgId,
  setLocalAppUserId,
  clearAppUserId,
  withTenant,
  withOwnerContext,
} from './index.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

type RecordedQuery = { text: string; values: unknown[] | undefined };

function mockClient(failOn?: string): { client: PoolClient; queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (failOn && text.includes(failOn)) {
        throw new Error(`mock failure on: ${failOn}`);
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;
  return { client, queries };
}

describe('isUuid', () => {
  it('accepts canonical UUIDs and rejects everything else', () => {
    expect(isUuid(ORG)).toBe(true);
    expect(isUuid('')).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(`${ORG}'; DROP TABLE x; --`)).toBe(false);
  });
});

describe('setLocalAppUserId', () => {
  it('rejects a non-UUID user id before touching the database', async () => {
    const { client, queries } = mockClient();
    await expect(setLocalAppUserId(client, 'evil')).rejects.toThrow(/not a UUID/);
    expect(queries.length).toBe(0);
  });

  it('sets app.user_id transaction-locally via set_config(..., true)', async () => {
    const { client, queries } = mockClient();
    await setLocalAppUserId(client, USER);
    expect(queries.length).toBe(1);
    expect(queries[0]!.text).toContain("set_config('app.user_id', $1, true)");
    expect(queries[0]!.values).toEqual([USER]);
  });
});

describe('clearAppUserId', () => {
  it('clears app.user_id transaction-locally', async () => {
    const { client, queries } = mockClient();
    await clearAppUserId(client);
    expect(queries.length).toBe(1);
    expect(queries[0]!.text).toContain("set_config('app.user_id', '', true)");
  });
});

describe('withOwnerContext', () => {
  it('runs BEGIN → org GUC → user GUC → fn → COMMIT in order', async () => {
    const { client, queries } = mockClient();
    const result = await withOwnerContext(client, ORG, USER, async () => 'ok');
    expect(result).toBe('ok');
    expect(queries.map((q) => q.text)).toEqual([
      'BEGIN',
      "SELECT set_config('app.org_id', $1, true)",
      "SELECT set_config('app.user_id', $1, true)",
      'COMMIT',
    ]);
    expect(queries[1]!.values).toEqual([ORG]);
    expect(queries[2]!.values).toEqual([USER]);
  });

  it('rolls back when fn throws', async () => {
    const { client, queries } = mockClient();
    await expect(
      withOwnerContext(client, ORG, USER, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(queries.map((q) => q.text)).toEqual([
      'BEGIN',
      "SELECT set_config('app.org_id', $1, true)",
      "SELECT set_config('app.user_id', $1, true)",
      'ROLLBACK',
    ]);
  });

  it('rejects a non-UUID org id inside an already-open transaction and rolls back', async () => {
    const { client, queries } = mockClient();
    await expect(withOwnerContext(client, 'evil', USER, async () => 'x')).rejects.toThrow(
      /not a UUID/,
    );
    expect(queries.map((q) => q.text)).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('rejects a non-UUID user id and rolls back after the org GUC', async () => {
    const { client, queries } = mockClient();
    await expect(withOwnerContext(client, ORG, 'evil', async () => 'x')).rejects.toThrow(
      /not a UUID/,
    );
    expect(queries.map((q) => q.text)).toEqual([
      'BEGIN',
      "SELECT set_config('app.org_id', $1, true)",
      'ROLLBACK',
    ]);
  });
});

describe('withTenant (unchanged org-only semantics)', () => {
  it('still runs BEGIN → org GUC only → fn → COMMIT (no app.user_id)', async () => {
    const { client, queries } = mockClient();
    await withTenant(client, ORG, async () => undefined);
    expect(queries.map((q) => q.text)).toEqual([
      'BEGIN',
      "SELECT set_config('app.org_id', $1, true)",
      'COMMIT',
    ]);
    for (const q of queries) {
      expect(q.text).not.toContain('app.user_id');
    }
  });

  it('setLocalAppOrgId still validates its UUID', async () => {
    const { client, queries } = mockClient();
    await expect(setLocalAppOrgId(client, 'evil')).rejects.toThrow(/not a UUID/);
    expect(queries.length).toBe(0);
  });
});
