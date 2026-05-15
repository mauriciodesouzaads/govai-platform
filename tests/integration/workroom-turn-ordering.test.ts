// Workroom Phase 2 (issue #51) — per-workroom monotonic turn ordering.
//
// Deterministic concurrency test: N concurrent message appends must yield
// contiguous, unique turn_numbers. The advisory xact lock serializes the
// counter and the (workroom_id, turn_number) unique index is the backstop —
// so the contiguity invariant holds regardless of scheduling. The test asserts
// the invariant, never timing.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  startStack,
  stopStack,
  seedOrg,
  addApiKey,
  inject,
  type Stack,
} from './helpers/server-fixture.js';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 240_000);
afterAll(async () => {
  if (stack) await stopStack(stack);
});

type DevOrg = {
  org_id: string;
  user_id: string;
  workspace_id: string;
  api_key: string;
};

async function devOrg(): Promise<DevOrg> {
  const org = await seedOrg(stack);
  const dev = await addApiKey(stack, org.org_id, org.user_id, ['developer']);
  return {
    org_id: org.org_id,
    user_id: org.user_id,
    workspace_id: org.workspace_id,
    api_key: dev.api_key,
  };
}

async function createWorkroom(org: DevOrg): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
    workspace_id: org.workspace_id,
    name: `room-${randomUUID().slice(0, 8)}`,
  });
  expect(r.statusCode).toBe(201);
  return ((r.body as Record<string, unknown>)['workroom'] as Record<string, unknown>)[
    'id'
  ] as string;
}

async function queryAsOrg<T = Record<string, unknown>>(
  orgId: string,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const r = await c.query(sql, params);
    await c.query('COMMIT');
    return r.rows as T[];
  } finally {
    c.release();
  }
}

describe('workroom-turn-ordering', () => {
  it('N concurrent message appends produce contiguous, unique turn numbers', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const N = 12;

    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        inject(stack, 'POST', `/v1/workrooms/${workroomId}/messages`, org.api_key, {
          role: 'user',
          content: `concurrent message ${i}`,
        }),
      ),
    );
    for (const r of results) {
      expect(r.statusCode).toBe(201);
    }

    // turn_numbers reported by the responses are unique and contiguous.
    const reported = results
      .map((r) => {
        const msg = (r.body as Record<string, unknown>)['message'] as Record<string, unknown>;
        return msg['turn_number'] as number;
      })
      .sort((a, b) => a - b);
    expect(new Set(reported).size).toBe(N);
    for (let i = 1; i < reported.length; i++) {
      expect(reported[i]! - reported[i - 1]!).toBe(1);
    }

    // The message turns persisted in the DB are exactly turn_number 2..N+1
    // (turn #1 is the workroom.lifecycle creation turn).
    const turns = await queryAsOrg<{ turn_number: string }>(
      org.org_id,
      `SELECT turn_number FROM govai.workroom_turns
        WHERE workroom_id = $1::uuid AND kind = 'message'
        ORDER BY turn_number`,
      [workroomId],
    );
    const turnNumbers = turns.map((t) => Number(t.turn_number));
    expect(turnNumbers.length).toBe(N);
    expect(new Set(turnNumbers).size).toBe(N);
    expect(turnNumbers[0]).toBe(2);
    expect(turnNumbers[turnNumbers.length - 1]).toBe(N + 1);
    for (let i = 1; i < turnNumbers.length; i++) {
      expect(turnNumbers[i]! - turnNumbers[i - 1]!).toBe(1);
    }

    // Every workroom_turn for this workroom is globally unique on turn_number.
    const all = await queryAsOrg<{ n: string; distinct: string }>(
      org.org_id,
      `SELECT COUNT(*) AS n, COUNT(DISTINCT turn_number) AS distinct
         FROM govai.workroom_turns WHERE workroom_id = $1::uuid`,
      [workroomId],
    );
    expect(all[0]!.n).toBe(all[0]!.distinct);
  });
});
