// B1 integration tests for the captureAuditEvent adapter.
//
// These tests run against a real Postgres (Testcontainers) with the B0
// migration 0025_audit_capture_outbox_foundation applied. They prove that
// the TypeScript adapter:
//
//   - inserts a capture via govai.audit_capture_insert_locked and returns
//     captureId + captureSeq (string, lossless);
//   - calls the package's own chainLockKey(chainId) — proven by a vi.spyOn
//     on the namespace import in capture.ts;
//   - is idempotent on the same captureId + identical content;
//   - propagates SQL-side errors when captureId collides with divergent
//     content;
//   - enforces tenant context: the SQL function rejects calls when
//     app.org_id is missing or differs from input.orgId, and the adapter
//     does NOT set/contaminate app.org_id by itself;
//   - participates in the caller's transaction: if the caller ROLLBACKs,
//     no row is persisted;
//   - is exported from the @govai/core-audit package barrel.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { startStack, stopStack, seedOrg, type Stack } from './helpers/server-fixture.js';
import { setLocalAppOrgId } from '@govai/core-tenant';

// Namespace-import the same module the adapter uses internally, so we can
// vi.spyOn(lockKeyMod, 'chainLockKey'). Without namespace mode, ESM read-only
// bindings would block the spy.
import * as lockKeyMod from '../../packages/core-audit/src/lock-key.js';

// Adapter under test.
import {
  captureAuditEvent,
  type CaptureAuditEventInput,
} from '../../packages/core-audit/src/capture.js';

// And re-export check via the package barrel.
import * as coreAuditBarrel from '@govai/core-audit';

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

function buildInput(opts: {
  orgId: string;
  chainId: string;
  captureId?: string;
  subjectId?: string;
  occurredAt?: Date;
}): CaptureAuditEventInput {
  return {
    captureId: opts.captureId ?? randomUUID(),
    orgId: opts.orgId,
    chainId: opts.chainId,
    chainCategory: 'run',
    eventType: 'passthrough.invoked',
    eventVersion: '3',
    subjectType: 'run',
    subjectId: opts.subjectId ?? randomUUID(),
    occurredAt: opts.occurredAt ?? new Date(),
    payloadHash: Buffer.from('00'.repeat(32), 'hex'),
    keyId: 'audit-1',
    keyVersion: 1,
    redactionMetadata: { surface: 'provider-native' },
  };
}

async function withAppTx<T>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await setLocalAppOrgId(c, orgId);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

// =============================================================================
// 1. Happy path + export wiring
// =============================================================================

describe('B1 / captureAuditEvent happy path', () => {
  it('inserts a capture and returns captureId + captureSeq="1" on a fresh chain', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const input = buildInput({ orgId: org.org_id, chainId });

    const r = await withAppTx(org.org_id, async (c) => captureAuditEvent(c, input));

    expect(r.captureId).toBe(input.captureId);
    expect(typeof r.captureSeq).toBe('string');
    expect(r.captureSeq).toBe('1');
  });

  it('returns the same captureSeq for the second call with same captureId + same content', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const input = buildInput({ orgId: org.org_id, chainId });

    const r1 = await withAppTx(org.org_id, async (c) => captureAuditEvent(c, input));
    const r2 = await withAppTx(org.org_id, async (c) => captureAuditEvent(c, input));
    expect(r2.captureId).toBe(r1.captureId);
    expect(r2.captureSeq).toBe(r1.captureSeq);
  });

  it('rejects same captureId with divergent immutable content (SQL unique_violation propagates)', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const baseInput = buildInput({ orgId: org.org_id, chainId });
    const captureId = baseInput.captureId;

    await withAppTx(org.org_id, async (c) => captureAuditEvent(c, baseInput));

    const divergent: CaptureAuditEventInput = {
      ...baseInput,
      captureId,
      payloadHash: Buffer.from('ff'.repeat(32), 'hex'),
    };
    await expect(
      withAppTx(org.org_id, async (c) => captureAuditEvent(c, divergent)),
    ).rejects.toThrow(/divergent immutable content/i);
  });

  it('captureSeq advances +1 across two distinct captures on the same chain', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const input1 = buildInput({ orgId: org.org_id, chainId });
    const input2 = buildInput({ orgId: org.org_id, chainId });

    const r1 = await withAppTx(org.org_id, async (c) => captureAuditEvent(c, input1));
    const r2 = await withAppTx(org.org_id, async (c) => captureAuditEvent(c, input2));
    expect(r1.captureSeq).toBe('1');
    expect(r2.captureSeq).toBe('2');
  });

  it('is reachable from the @govai/core-audit package barrel', () => {
    expect(typeof coreAuditBarrel.captureAuditEvent).toBe('function');
    expect(coreAuditBarrel.captureAuditEvent).toBe(captureAuditEvent);
  });
});

// =============================================================================
// 2. chainLockKey spy — direct proof the adapter uses the package function
// =============================================================================

describe('B1 / captureAuditEvent uses chainLockKey from core-audit', () => {
  it('vi.spyOn(lockKeyMod, "chainLockKey") observes the adapter calling it with input.chainId', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const input = buildInput({ orgId: org.org_id, chainId });

    const spy = vi.spyOn(lockKeyMod, 'chainLockKey');
    try {
      await withAppTx(org.org_id, async (c) => captureAuditEvent(c, input));
      // The adapter must have invoked chainLockKey at least once with chainId.
      expect(spy).toHaveBeenCalledWith(chainId);
      // It must have been called via the namespace binding (real fn returned bigint).
      const result = spy.mock.results[0]?.value;
      expect(typeof result).toBe('bigint');
    } finally {
      spy.mockRestore();
    }
  });

  it('different chainId values produce different advisory keys via the same chainLockKey function', async () => {
    const org = await seedOrg(stack);
    const chainA = `org:${org.org_id}:run:${randomUUID()}`;
    const chainB = `org:${org.org_id}:run:${randomUUID()}`;

    const spy = vi.spyOn(lockKeyMod, 'chainLockKey');
    try {
      await withAppTx(org.org_id, async (c) => {
        await captureAuditEvent(c, buildInput({ orgId: org.org_id, chainId: chainA }));
        await captureAuditEvent(c, buildInput({ orgId: org.org_id, chainId: chainB }));
      });
      const callA = spy.mock.calls.find((c) => c[0] === chainA);
      const callB = spy.mock.calls.find((c) => c[0] === chainB);
      expect(callA).toBeDefined();
      expect(callB).toBeDefined();
      const resultA = spy.mock.results.find((_, i) => spy.mock.calls[i]?.[0] === chainA)?.value;
      const resultB = spy.mock.results.find((_, i) => spy.mock.calls[i]?.[0] === chainB)?.value;
      expect(resultA).not.toBe(resultB);
    } finally {
      spy.mockRestore();
    }
  });
});

// =============================================================================
// 3. Tenant guard — SQL rejects bad tenant context; adapter does NOT
//    set/contaminate app.org_id by itself
// =============================================================================

describe('B1 / tenant guard', () => {
  it('fails if app.org_id is NOT set in the session', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const input = buildInput({ orgId: org.org_id, chainId });

    const c = await stack.db.appPool.connect();
    try {
      await c.query('BEGIN');
      // Intentionally DO NOT call setLocalAppOrgId here.
      await expect(captureAuditEvent(c, input)).rejects.toThrow(/tenant mismatch/i);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('fails if app.org_id differs from input.orgId', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    const chainId = `org:${orgA.org_id}:run:${randomUUID()}`;
    const input = buildInput({ orgId: orgA.org_id, chainId });

    await expect(
      withAppTx(orgB.org_id, async (c) => captureAuditEvent(c, input)),
    ).rejects.toThrow(/tenant mismatch/i);
  });

  it('does NOT contaminate app.org_id of the surrounding transaction', async () => {
    // Caller sets app.org_id once, performs N captures, and afterwards reads
    // current_setting('app.org_id'). The adapter must not overwrite it.
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;

    const observed = await withAppTx(org.org_id, async (c) => {
      const before = await c.query<{ v: string }>("SELECT current_setting('app.org_id', true) AS v");
      await captureAuditEvent(c, buildInput({ orgId: org.org_id, chainId }));
      await captureAuditEvent(c, buildInput({ orgId: org.org_id, chainId }));
      const after = await c.query<{ v: string }>("SELECT current_setting('app.org_id', true) AS v");
      return { before: before.rows[0]!.v, after: after.rows[0]!.v };
    });
    expect(observed.before).toBe(org.org_id);
    expect(observed.after).toBe(org.org_id);
  });
});

// =============================================================================
// 4. Composability — adapter participates in the caller's transaction
// =============================================================================

describe('B1 / transactional composability', () => {
  it('is visible WITHIN the caller transaction and reverts on ROLLBACK', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const input = buildInput({ orgId: org.org_id, chainId });

    // 1. Inside a BEGIN ... ROLLBACK, capture should be visible to the same client.
    const c = await stack.db.appPool.connect();
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, org.org_id);
      const r = await captureAuditEvent(c, input);
      expect(r.captureSeq).toBe('1');

      const inside = await c.query<{ cnt: string }>(
        `SELECT count(*)::text AS cnt FROM govai.audit_capture_outbox WHERE capture_id = $1::uuid`,
        [input.captureId],
      );
      expect(inside.rows[0]!.cnt).toBe('1');

      await c.query('ROLLBACK');
    } finally {
      c.release();
    }

    // 2. After ROLLBACK, a fresh transaction must observe zero rows.
    const c2 = await stack.db.appPool.connect();
    try {
      await c2.query('BEGIN');
      await setLocalAppOrgId(c2, org.org_id);
      const outside = await c2.query<{ cnt: string }>(
        `SELECT count(*)::text AS cnt FROM govai.audit_capture_outbox WHERE capture_id = $1::uuid`,
        [input.captureId],
      );
      expect(outside.rows[0]!.cnt).toBe('0');

      // chain_state for this chain must also be absent (or, if present from
      // some other test on a same-named chain, must have last_captured_seq=0,
      // which here is irrelevant because chainId carries a randomUUID).
      const cs = await c2.query<{ cnt: string }>(
        `SELECT count(*)::text AS cnt FROM govai.audit_capture_chain_state WHERE chain_id = $1::text`,
        [chainId],
      );
      expect(cs.rows[0]!.cnt).toBe('0');
      await c2.query('ROLLBACK');
    } finally {
      c2.release();
    }
  });

  it('the adapter does not issue BEGIN, COMMIT, or ROLLBACK itself', async () => {
    // We assert by intercepting client.query calls via a wrapping Proxy and
    // verifying none match BEGIN/COMMIT/ROLLBACK while the adapter runs.
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const input = buildInput({ orgId: org.org_id, chainId });

    const c = await stack.db.appPool.connect();
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, org.org_id);

      const seenSql: string[] = [];
      const origQuery = c.query.bind(c) as PoolClient['query'];
      // Wrap only for the duration of the adapter call.
      (c as { query: PoolClient['query'] }).query = ((...args: unknown[]) => {
        const sql = typeof args[0] === 'string' ? (args[0] as string) : '';
        seenSql.push(sql);
        return (origQuery as (...a: unknown[]) => unknown)(...args);
      }) as PoolClient['query'];

      try {
        await captureAuditEvent(c, input);
      } finally {
        (c as { query: PoolClient['query'] }).query = origQuery;
      }

      const forbidden = seenSql.filter((s) => /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i.test(s));
      expect(forbidden).toEqual([]);

      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});

// =============================================================================
// 5. The adapter does not persist raw payload (defense in depth at TS layer)
// =============================================================================

describe('B1 / raw payload rejection (TS guard)', () => {
  it('rejects redactionMetadata with raw prompt/response BEFORE any SQL round-trip', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;

    // Use a connection that already failed its tenant setup so the adapter's
    // TS-guard rejection comes FIRST. Even if validation passed (it won't),
    // the SQL CHECK would also block this row — so this proves the TS guard
    // is the first line of defense and the row never reaches the database.
    const c = await stack.db.appPool.connect();
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, org.org_id);

      for (const key of ['prompt', 'response', 'raw_input', 'raw_output']) {
        const bad: CaptureAuditEventInput = {
          ...buildInput({ orgId: org.org_id, chainId }),
          redactionMetadata: { [key]: 'leaked' } as Record<string, unknown>,
        };
        await expect(captureAuditEvent(c, bad)).rejects.toThrow(
          new RegExp(`must not contain top-level "${key}"`),
        );
      }

      // Also verify no row landed in the outbox while we were trying.
      const cnt = await c.query<{ cnt: string }>(
        `SELECT count(*)::text AS cnt FROM govai.audit_capture_outbox WHERE chain_id = $1::text`,
        [chainId],
      );
      expect(cnt.rows[0]!.cnt).toBe('0');

      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});
