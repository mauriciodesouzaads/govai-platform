// Shared evidence-plane seed helpers for the EP-008D integration tests
// (evidence reports + the operator/auditor cockpit isolation suite). Seeding
// goes through the REAL grant/RLS model (no bypass): outbox rows via the
// SECURITY DEFINER audit_capture_insert_locked as govai_app (advanced via
// claim/seal/fail as govai_audit_sealer); runs/provider_invocations as
// govai_app; audit_events as govai_audit_writer (its FOR INSERT policy).
//
// Bound to a Stack via createSeedHelpers(stack); mirrors the helpers proven in
// evidence-completeness.test.ts (EP-008A) and adds insertRawCapture for the
// EC-2 contiguity-gap seed (a direct outbox INSERT at a chosen capture_seq, as
// the writer — the SECURITY DEFINER path only ever assigns contiguous seqs).

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { chainLockKey } from '@govai/core-audit';
import type { Stack } from './server-fixture.js';

export const H32 = (b: string): Buffer => Buffer.from(b.repeat(32), 'hex');

export type EvidenceRole = 'govai_app' | 'govai_audit_sealer' | 'govai_audit_writer';

export function createSeedHelpers(stack: Stack) {
  async function asRole<T>(
    role: EvidenceRole,
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

  // Direct outbox INSERT at a chosen capture_seq (writer's FOR INSERT policy).
  // Used only to seed an EC-2 contiguity gap (e.g. seqs 1 and 3, skipping 2),
  // which the SECURITY DEFINER insert path cannot produce by construction.
  async function insertRawCapture(
    orgId: string,
    chainId: string,
    seq: number,
    opts: { chainCategory?: string; status?: string } = {},
  ): Promise<string> {
    return asRole('govai_audit_writer', orgId, async (c) => {
      const captureId = randomUUID();
      await c.query(
        `INSERT INTO govai.audit_capture_outbox
           (capture_id, org_id, chain_id, chain_category, capture_seq,
            event_type, event_version, subject_type, subject_id, occurred_at,
            payload_hash, key_id, key_version, status)
         VALUES ($1::uuid, $2::uuid, $3::text, $4::text, $5::bigint,
            'passthrough.invoked', '4', 'runtime_event', $6::uuid, now(),
            $7::bytea, 'audit-1', 1, $8::text)`,
        [
          captureId,
          orgId,
          chainId,
          opts.chainCategory ?? 'run',
          seq,
          randomUUID(),
          H32('00'),
          opts.status ?? 'captured',
        ],
      );
      return captureId;
    });
  }

  async function claim(orgId: string, chainId: string): Promise<void> {
    await asRole('govai_audit_sealer', orgId, async (c) => {
      await c.query(`SELECT * FROM govai.audit_capture_claim_for_seal($1::uuid, $2::text, $3::bigint)`, [
        orgId,
        chainId,
        chainLockKey(chainId).toString(),
      ]);
    });
  }

  async function markSealed(orgId: string, captureId: string, chainId: string): Promise<void> {
    await asRole('govai_audit_sealer', orgId, async (c) => {
      await c.query(`SELECT govai.audit_capture_mark_sealed($1::uuid, $2::uuid, $3::uuid, $4::bigint)`, [
        orgId,
        captureId,
        randomUUID(),
        chainLockKey(chainId).toString(),
      ]);
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

  async function seedCaptureInStatus(
    orgId: string,
    status: 'captured' | 'sealing' | 'sealed' | 'failed',
  ): Promise<{ chainId: string; captureId: string }> {
    const chainId = `org:${orgId}:run:${randomUUID()}`;
    const { captureId } = await insertCapture(orgId, chainId);
    if (status === 'sealing') await claim(orgId, chainId);
    else if (status === 'sealed') {
      await claim(orgId, chainId);
      await markSealed(orgId, captureId, chainId);
    } else if (status === 'failed') await markFailed(orgId, captureId);
    return { chainId, captureId };
  }

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

  async function queryAsApp<T extends Record<string, unknown>>(
    orgId: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return asRole('govai_app', orgId, async (c) => (await c.query<T>(sql, params)).rows);
  }

  return {
    asRole,
    insertCapture,
    insertRawCapture,
    claim,
    markSealed,
    markFailed,
    seedCaptureInStatus,
    seedRunWithInvocation,
    queryAsApp,
  };
}

export type SeedHelpers = ReturnType<typeof createSeedHelpers>;
