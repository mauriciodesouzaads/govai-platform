// Pagination test for GET /v1/audit-events ?limit + ?before_seq.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startStack, stopStack, seedOrg, inject, type Stack } from './helpers/server-fixture.js';

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

describe('GET /v1/audit-events pagination', () => {
  it('limit caps result count and before_seq paginates older entries', async () => {
    const org = await seedOrg(stack);
    // Each completed governed run emits 2 audit events: `run.completed` (legacy)
    // + `passthrough.invoked v3` (Batch G canonical fact). Three runs yield 6
    // total events (sequences 1..6) on the org's run chain.
    for (let i = 0; i < 3; i++) {
      const r = await inject(stack, 'POST', '/v1/runs', org.api_key, {
        workspace_id: org.workspace_id,
        capability: 'anthropic.messages.create',
        model: 'claude-fixture-1',
        input: `hello ${i}`,
      });
      expect(r.statusCode).toBe(200);
    }

    // Page 1: top 2 by sequence DESC.
    const p1 = await inject(stack, 'GET', '/v1/audit-events?chain_category=run&limit=2', org.api_key);
    expect(p1.statusCode).toBe(200);
    const b1 = p1.body as { events: Array<{ sequence_number: number }> };
    expect(b1.events.length).toBe(2);
    expect(b1.events[0]!.sequence_number).toBe(6);
    expect(b1.events[1]!.sequence_number).toBe(5);

    // Page 2: before_seq=5 → next two.
    const p2 = await inject(
      stack,
      'GET',
      `/v1/audit-events?chain_category=run&limit=2&before_seq=${b1.events[1]!.sequence_number}`,
      org.api_key,
    );
    expect(p2.statusCode).toBe(200);
    const b2 = p2.body as { events: Array<{ sequence_number: number }> };
    expect(b2.events.length).toBe(2);
    expect(b2.events[0]!.sequence_number).toBe(4);
    expect(b2.events[1]!.sequence_number).toBe(3);

    // Page 3: last two.
    const p3 = await inject(
      stack,
      'GET',
      `/v1/audit-events?chain_category=run&limit=2&before_seq=${b2.events[1]!.sequence_number}`,
      org.api_key,
    );
    expect(p3.statusCode).toBe(200);
    const b3 = p3.body as { events: Array<{ sequence_number: number }> };
    expect(b3.events.length).toBe(2);
    expect(b3.events[0]!.sequence_number).toBe(2);
    expect(b3.events[1]!.sequence_number).toBe(1);
  });
});
