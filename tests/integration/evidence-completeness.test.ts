// EP-008A — Evidence-Completeness Read Views (migration 0027).
//
// Acceptance tests for three additive, read-only SECURITY INVOKER views over the
// existing evidence-plane tables:
//   - govai.evidence_capture_completeness  (EC-1.a) — outbox status counts + ages
//   - govai.evidence_chain_backlog         (EC-1.b) — per-chain unsealed backlog
//   - govai.evidence_provider_without_audit (EC-3a) — Path-A provider invocations
//     with no terminal run.* audit event (expected empty; a row is an integrity gap)
//
// Seeding goes through the REAL grant/RLS model (no bypass): outbox rows via the
// SECURITY DEFINER `audit_capture_insert_locked` as govai_app (then advanced via
// `claim_for_seal`/`mark_sealed`/`mark_failed` as govai_audit_sealer);
// runs/provider_invocations as govai_app (INSERT grant); audit_events as
// govai_audit_writer (its FOR INSERT policy). `app.org_id` is set per the harness.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { startStack, stopStack, seedOrg, type Stack } from './helpers/server-fixture.js';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { chainLockKey } from '@govai/core-audit';

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

const VIEWS = [
  'evidence_capture_completeness',
  'evidence_chain_backlog',
  'evidence_provider_without_audit',
] as const;

const H32 = (b: string): Buffer => Buffer.from(b.repeat(32), 'hex');

async function asRole<T>(
  role: 'govai_app' | 'govai_audit_sealer' | 'govai_audit_writer',
  orgId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await stack.db.adminPool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${role}`);
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

// Insert a capture (status='captured') via the SECURITY DEFINER fn, as govai_app.
async function insertCapture(
  orgId: string,
  chainId: string,
  opts: { chainCategory?: string } = {},
): Promise<{ captureId: string; captureSeq: number }> {
  return asRole('govai_app', orgId, async (c) => {
    const captureId = randomUUID();
    const r = await c.query<{ capture_id: string; capture_seq: string }>(
      `SELECT capture_id::text, capture_seq::text
         FROM govai.audit_capture_insert_locked(
           $1::uuid, $2::uuid, $3::text, $4::text, $5::bigint,
           'passthrough.invoked', '4', 'run', $6::uuid, now(),
           $7::bytea, NULL::bytea, NULL::bytea, 'audit-1', 1,
           '{}'::jsonb, 'hmac_internal', NULL::bytea, NULL::text, 'best_effort')`,
      [
        captureId,
        orgId,
        chainId,
        opts.chainCategory ?? 'run',
        chainLockKey(chainId).toString(),
        randomUUID(),
        H32('00'),
      ],
    );
    return { captureId, captureSeq: Number(r.rows[0]!.capture_seq) };
  });
}

async function claim(orgId: string, chainId: string): Promise<void> {
  await asRole('govai_audit_sealer', orgId, async (c) => {
    await c.query(
      `SELECT * FROM govai.audit_capture_claim_for_seal($1::uuid, $2::text, $3::bigint)`,
      [orgId, chainId, chainLockKey(chainId).toString()],
    );
  });
}

async function markSealed(orgId: string, captureId: string, chainId: string): Promise<void> {
  await asRole('govai_audit_sealer', orgId, async (c) => {
    await c.query(
      `SELECT govai.audit_capture_mark_sealed($1::uuid, $2::uuid, $3::uuid, $4::bigint)`,
      [orgId, captureId, randomUUID(), chainLockKey(chainId).toString()],
    );
  });
}

async function markFailed(orgId: string, captureId: string): Promise<void> {
  await asRole('govai_audit_sealer', orgId, async (c) => {
    await c.query(`SELECT govai.audit_capture_mark_failed($1::uuid, $2::uuid, $3::text, $4::text)`, [
      orgId,
      captureId,
      'network_error',
      'seed',
    ]);
  });
}

// A captured row on a fresh chain advanced to a target status.
async function seedCaptureInStatus(
  orgId: string,
  status: 'captured' | 'sealing' | 'sealed' | 'failed',
): Promise<void> {
  const chainId = `org:${orgId}:run:${randomUUID()}`;
  const { captureId } = await insertCapture(orgId, chainId);
  if (status === 'sealing') await claim(orgId, chainId);
  else if (status === 'sealed') {
    await claim(orgId, chainId);
    await markSealed(orgId, captureId, chainId);
  } else if (status === 'failed') await markFailed(orgId, captureId);
}

// Path-A: a run + its provider_invocation, optionally with the terminal run.* audit event.
async function seedRunWithInvocation(orgId: string, opts: { withAudit: boolean }): Promise<string> {
  const runId = randomUUID();
  await asRole('govai_app', orgId, async (c) => {
    await c.query(
      `INSERT INTO govai.runs (id, org_id, workspace_id, actor_user_id, provider, model, mode, status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'claude-fixture', 'governed', 'completed')`,
      [runId, orgId, randomUUID(), randomUUID()],
    );
    await c.query(
      `INSERT INTO govai.provider_invocations
         (id, run_id, org_id, provider, native_endpoint, native_method, native_request_hash, usage_json, status_code)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'anthropic', '/v1/messages', 'POST', $4::bytea, '{}'::jsonb, 200)`,
      [randomUUID(), runId, orgId, H32('aa')],
    );
  });
  if (opts.withAudit) {
    await asRole('govai_audit_writer', orgId, async (c) => {
      await c.query(
        `INSERT INTO govai.audit_events
           (id, org_id, chain_id, sequence_number, event_type, event_version,
            subject_type, subject_id, occurred_at, payload_hash, hmac, canonical_hash, canonical_bytes, key_id, key_version)
         VALUES ($1::uuid, $2::uuid, $3::text, 1, 'run.completed', '1',
            'run', $4::uuid, now(), $5::bytea, $5::bytea, $5::bytea, $5::bytea, 'audit-1', 1)`,
        [randomUUID(), orgId, `org:${orgId}:run:${runId}`, runId, H32('bb')],
      );
    });
  }
  return runId;
}

async function queryViewAsApp<T extends Record<string, unknown>>(
  orgId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return asRole('govai_app', orgId, async (c) => (await c.query<T>(sql, params)).rows);
}

// =============================================================================
// 1. evidence_capture_completeness — counts + ages
// =============================================================================
describe('EC-1.a / evidence_capture_completeness counts', () => {
  it('tallies total + per-status counts and ages per (org, chain_category)', async () => {
    const org = await seedOrg(stack);
    await seedCaptureInStatus(org.org_id, 'captured');
    await seedCaptureInStatus(org.org_id, 'sealing');
    await seedCaptureInStatus(org.org_id, 'sealed');
    await seedCaptureInStatus(org.org_id, 'failed');

    const rows = await queryViewAsApp<{
      org_id: string;
      chain_category: string;
      total: string;
      captured: string;
      sealing: string;
      sealed: string;
      failed: string;
      oldest_unsealed_at: string | null;
      oldest_sealing_at: string | null;
      max_attempts: string;
    }>(
      org.org_id,
      `SELECT * FROM govai.evidence_capture_completeness WHERE org_id = $1::uuid AND chain_category = 'run'`,
      [org.org_id],
    );

    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(Number(r.total)).toBe(4);
    expect(Number(r.captured)).toBe(1);
    expect(Number(r.sealing)).toBe(1);
    expect(Number(r.sealed)).toBe(1);
    expect(Number(r.failed)).toBe(1);
    expect(r.oldest_unsealed_at).not.toBeNull(); // a captured row exists
    expect(r.oldest_sealing_at).not.toBeNull(); // a sealing row exists
    expect(Number(r.max_attempts)).toBeGreaterThanOrEqual(1); // claimed rows have attempts>=1
  });
});

// =============================================================================
// 2. evidence_chain_backlog — unsealed depth; fully-sealed excluded
// =============================================================================
describe('EC-1.b / evidence_chain_backlog', () => {
  it('reports unsealed_depth and excludes fully-sealed chains (depth 0)', async () => {
    const org = await seedOrg(stack);

    // Backlog chain: 2 captured, 0 sealed -> depth 2.
    const backlogChain = `org:${org.org_id}:run:${randomUUID()}`;
    await insertCapture(org.org_id, backlogChain);
    await insertCapture(org.org_id, backlogChain);

    // Fully-sealed chain: 1 captured, then sealed -> depth 0 (excluded).
    const sealedChain = `org:${org.org_id}:run:${randomUUID()}`;
    const { captureId } = await insertCapture(org.org_id, sealedChain);
    await claim(org.org_id, sealedChain);
    await markSealed(org.org_id, captureId, sealedChain);

    const rows = await queryViewAsApp<{ chain_id: string; unsealed_depth: string }>(
      org.org_id,
      `SELECT chain_id, unsealed_depth::text FROM govai.evidence_chain_backlog WHERE org_id = $1::uuid`,
      [org.org_id],
    );
    const byChain = new Map(rows.map((r) => [r.chain_id, Number(r.unsealed_depth)]));
    expect(byChain.get(backlogChain)).toBe(2);
    expect(byChain.has(sealedChain)).toBe(false); // fully sealed -> excluded
  });
});

// =============================================================================
// 3 + 4. evidence_provider_without_audit — EC-3a invariant
// =============================================================================
describe('EC-3a / evidence_provider_without_audit', () => {
  it('healthy: a completed Path-A run (provider_invocation + terminal run.* event) yields no rows', async () => {
    const org = await seedOrg(stack);
    const runId = await seedRunWithInvocation(org.org_id, { withAudit: true });
    const rows = await queryViewAsApp<{ run_id: string }>(
      org.org_id,
      `SELECT run_id::text FROM govai.evidence_provider_without_audit WHERE run_id = $1::uuid`,
      [runId],
    );
    expect(rows).toHaveLength(0);
  });

  it('gap: a provider_invocation whose run has no terminal event surfaces exactly that row', async () => {
    const org = await seedOrg(stack);
    const gapRun = await seedRunWithInvocation(org.org_id, { withAudit: false });
    const healthyRun = await seedRunWithInvocation(org.org_id, { withAudit: true });

    const rows = await queryViewAsApp<{ run_id: string; provider: string }>(
      org.org_id,
      `SELECT run_id::text, provider FROM govai.evidence_provider_without_audit WHERE org_id = $1::uuid`,
      [org.org_id],
    );
    expect(rows.map((r) => r.run_id)).toEqual([gapRun]);
    expect(rows.map((r) => r.run_id)).not.toContain(healthyRun);
  });
});

// =============================================================================
// 5. ★ Tenant isolation (the gate)
// =============================================================================
describe('EC / tenant isolation', () => {
  it('positive isolation: with the session GUC set to org A, every view returns only org-A rows', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);

    // Seed both orgs across all three view surfaces.
    for (const org of [orgA, orgB]) {
      await seedCaptureInStatus(org.org_id, 'captured'); // capture_completeness
      const backlog = `org:${org.org_id}:run:${randomUUID()}`;
      await insertCapture(org.org_id, backlog);
      await insertCapture(org.org_id, backlog); // chain_backlog (depth 2)
      await seedRunWithInvocation(org.org_id, { withAudit: false }); // provider_without_audit gap
    }

    // As org A, no WHERE filter — rely entirely on the views' security_invoker RLS.
    for (const view of VIEWS) {
      const rows = await queryViewAsApp<{ org_id: string }>(
        orgA.org_id,
        `SELECT org_id::text FROM govai.${view}`,
      );
      expect(rows.length).toBeGreaterThan(0); // org A has data in each view
      for (const r of rows) expect(r.org_id).toBe(orgA.org_id); // ...and ONLY org A
      expect(rows.some((r) => r.org_id === orgB.org_id)).toBe(false);
    }
  });

  it('durable catalog guard: each view carries security_invoker=true in pg_class.reloptions', async () => {
    const c = await stack.db.adminPool.connect();
    try {
      for (const view of VIEWS) {
        const r = await c.query<{ reloptions: string[] | null }>(
          `SELECT reloptions FROM pg_class WHERE relname = $1 AND relnamespace = 'govai'::regnamespace`,
          [view],
        );
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0]!.reloptions ?? []).toContain('security_invoker=true');
      }
    } finally {
      c.release();
    }
  });
});

// =============================================================================
// 6. No write surface — govai_app holds SELECT only on the EC views
// =============================================================================
describe('EC / no write surface', () => {
  it('INSERT / UPDATE / DELETE on each view are rejected for govai_app', async () => {
    const org = await seedOrg(stack);
    for (const view of VIEWS) {
      await expect(
        asRole('govai_app', org.org_id, async (c) => {
          await c.query(`INSERT INTO govai.${view} DEFAULT VALUES`);
        }),
      ).rejects.toThrow(/permission denied|cannot insert|not.*updatable/i);
      await expect(
        asRole('govai_app', org.org_id, async (c) => {
          await c.query(`UPDATE govai.${view} SET org_id = org_id`);
        }),
      ).rejects.toThrow(/permission denied|cannot update|not.*updatable/i);
      await expect(
        asRole('govai_app', org.org_id, async (c) => {
          await c.query(`DELETE FROM govai.${view}`);
        }),
      ).rejects.toThrow(/permission denied|cannot delete|not.*updatable/i);
    }
  });
});
