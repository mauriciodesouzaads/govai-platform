// /v1/workrooms/{id}/approvals — Workroom Phase 4: approval requests + decisions
// (issue #57).
//
// The human-in-the-loop approval layer above the Phase 1-3 Workroom control
// plane (architecture: docs/architecture/workroom-governance-room.md,
// umbrella #33).
//
// Scope (Phase 4 first slice):
//   - POST /v1/workrooms/{id}/approvals
//   - GET  /v1/workrooms/{id}/approvals
//   - GET  /v1/workrooms/{id}/approvals/{approval_id}
//   - POST /v1/workrooms/{id}/approvals/{approval_id}/decisions
//   - POST /v1/workrooms/{id}/approvals/{approval_id}/revoke
//
// A `passthrough_run` approval request is forward-looking: it is raised before
// the run exists and is bound to the exact intended run parameters via
// `intended_action_hash`. The intended run request is envelope-encrypted at
// rest in govai.audit_event_payloads on the write path — the request row stores
// only the payload pointer + the binding hash, never plaintext run input.
//
// Every write persists real rows and emits a real audit event. Workroom does
// not create a new audit chain: approval events route onto the existing
// `policy` ChainCategory. Each approval event anchors exactly one
// `workroom_turns` row (`approval_request` / `approval_decision`), so approvals
// surface in the existing audit subview.
//
// Decisions only authorize; they do not execute runs. Execution stays on
// POST /v1/workrooms/{id}/runs, which consumes a granted approval one-time.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { auditAppend, sha256 } from '@govai/core-audit';
import { setLocalAppOrgId } from '@govai/core-tenant';
import {
  chainIdFor,
  WorkroomApprovalRequestedSchema,
  WorkroomApprovalDecisionSchema,
} from '@govai/core-events';
import { hasAnyRole } from '@govai/core-identity';
import { authenticateApiKey, AuthError, type AuthIdentity } from '../pipeline/auth.js';
import { intendedActionHash } from '../pipeline/run-orchestrator.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Same audit key id/version Phase 1-3 use; re-used so audit_event_payloads
// records what wrapped the DEK for the encrypted intended-run payload.
const AUDIT_KEY_ID = 'audit-1';
const AUDIT_KEY_VERSION = 1;

const RiskClass = z.enum(['A', 'B', 'C', 'D', 'E']);

const CreateApprovalBody = z.object({
  // First slice approves only a passthrough run; default keeps the body terse.
  subject_kind: z.literal('passthrough_run').default('passthrough_run'),
  intended_run: z.object({
    capability: z.string().min(1).max(200),
    model: z.string().min(1),
    input: z.string().min(1).max(50_000),
  }),
  risk_class: RiskClass.optional(),
  expires_at: z.string().datetime().optional(),
});

const DecisionBody = z.object({
  decision: z.enum(['granted', 'denied']),
  reason: z.string().min(1).max(2000).optional(),
});

const RevokeBody = z.object({
  reason: z.string().min(1).max(2000).optional(),
});

const ListApprovalsQuery = z
  .object({
    status: z.enum(['pending', 'granted', 'denied', 'expired', 'revoked']).optional(),
    subject_kind: z.literal('passthrough_run').optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before_created_at: z.string().datetime().optional(),
    before_id: z.string().uuid().optional(),
  })
  .refine((d) => (d.before_created_at === undefined) === (d.before_id === undefined), {
    message: 'before_created_at and before_id must be provided together',
    path: ['before_id'],
  });

function extractApiKey(req: FastifyRequest): string {
  const header = req.headers['x-govai-api-key'];
  if (typeof header === 'string') return header;
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length);
  }
  return '';
}

async function authenticate(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthIdentity | null> {
  const apiKey = extractApiKey(req);
  const client = await app.govai.pool.connect();
  try {
    return await authenticateApiKey(client, apiKey);
  } catch (err) {
    if (err instanceof AuthError) {
      reply.code(err.status);
      reply.send({ error: 'auth_error', message: err.message });
      return null;
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reserve the next per-workroom monotonic turn number. The advisory xact lock
 * serializes concurrent turn creation for the same workroom; the
 * (workroom_id, turn_number) unique index is the backstop.
 */
async function nextTurnNumber(client: PoolClient, workroomId: string): Promise<number> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('workroom_turn:' || $1)::bigint)", [
    workroomId,
  ]);
  const r = await client.query<{ next: string }>(
    'SELECT COALESCE(MAX(turn_number), 0) + 1 AS next FROM govai.workroom_turns WHERE workroom_id = $1',
    [workroomId],
  );
  return Number(r.rows[0]?.next ?? 1);
}

/** Resolve the workroom for the tenant under RLS; null when cross-tenant/absent. */
async function getWorkroom(
  client: PoolClient,
  workroomId: string,
): Promise<{
  id: string;
  governance_mode: 'governance_active' | 'audit_only';
  workspace_id: string;
} | null> {
  const r = await client.query<{
    id: string;
    governance_mode: 'governance_active' | 'audit_only';
    workspace_id: string;
  }>('SELECT id, governance_mode, workspace_id FROM govai.workrooms WHERE id = $1::uuid', [
    workroomId,
  ]);
  return r.rows[0] ?? null;
}

/** The caller's active human participant binding (id only). */
async function getActiveParticipant(
  client: PoolClient,
  workroomId: string,
  userId: string,
): Promise<string | null> {
  const r = await client.query<{ id: string }>(
    `SELECT id FROM govai.workroom_participants
      WHERE workroom_id = $1::uuid AND kind = 'human' AND user_id = $2::uuid AND status = 'active'
      LIMIT 1`,
    [workroomId, userId],
  );
  return r.rows[0]?.id ?? null;
}

/** The caller's active human participant binding with its role. */
async function getActiveHumanParticipant(
  client: PoolClient,
  workroomId: string,
  userId: string,
): Promise<{ id: string; role: string } | null> {
  const r = await client.query<{ id: string; role: string }>(
    `SELECT id, role FROM govai.workroom_participants
      WHERE workroom_id = $1::uuid AND kind = 'human' AND user_id = $2::uuid AND status = 'active'
      LIMIT 1`,
    [workroomId, userId],
  );
  return r.rows[0] ?? null;
}

type ApprovalRequestRow = {
  id: string;
  workroom_id: string;
  requested_by_participant_id: string;
  subject_kind: string;
  subject_ref_id: string | null;
  risk_class: string | null;
  status: string;
  intended_action_payload_id: string | null;
  intended_action_hash: Buffer;
  workroom_governance_mode: string;
  required_approver_count: number;
  expires_at: Date | null;
  decided_at: Date | null;
  consumed_run_id: string | null;
  consumed_at: Date | null;
  created_at: Date;
};

const APPROVAL_REQUEST_COLUMNS = `id, workroom_id, requested_by_participant_id, subject_kind,
  subject_ref_id, risk_class, status, intended_action_payload_id, intended_action_hash,
  workroom_governance_mode, required_approver_count, expires_at, decided_at,
  consumed_run_id, consumed_at, created_at`;

/**
 * Read-time semantic expiry: a still-`pending` request whose `expires_at` has
 * passed is surfaced as `expired`. The stored status is left untouched — there
 * is no background sweeper in this slice.
 */
function effectiveStatus(row: ApprovalRequestRow): string {
  if (
    row.status === 'pending' &&
    row.expires_at !== null &&
    row.expires_at.getTime() <= Date.now()
  ) {
    return 'expired';
  }
  return row.status;
}

function serializeApprovalRequest(row: ApprovalRequestRow): Record<string, unknown> {
  return {
    id: row.id,
    workroom_id: row.workroom_id,
    requested_by_participant_id: row.requested_by_participant_id,
    subject_kind: row.subject_kind,
    subject_ref_id: row.subject_ref_id,
    risk_class: row.risk_class,
    status: effectiveStatus(row),
    intended_action_hash: row.intended_action_hash.toString('hex'),
    intended_action_payload_ref: row.intended_action_payload_id,
    workroom_governance_mode: row.workroom_governance_mode,
    required_approver_count: row.required_approver_count,
    expires_at: row.expires_at ? row.expires_at.toISOString() : null,
    decided_at: row.decided_at ? row.decided_at.toISOString() : null,
    consumed_run_id: row.consumed_run_id,
    consumed_at: row.consumed_at ? row.consumed_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
  };
}

export async function workroomApprovalsRoute(app: FastifyInstance): Promise<void> {
  // ==========================================================================
  // POST /v1/workrooms/:id/approvals — raise an approval request
  // ==========================================================================
  app.post<{ Params: { id: string } }>('/v1/workrooms/:id/approvals', async (req, reply) => {
    const workroomId = req.params.id;
    if (typeof workroomId !== 'string' || !UUID_RE.test(workroomId)) {
      reply.code(400);
      return { error: 'invalid_workroom_id' };
    }
    const parsed = CreateApprovalBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'invalid_request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }

    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;

    const body = parsed.data;
    const approvalRequestId = randomUUID();
    const turnId = randomUUID();

    const client = await app.govai.pool.connect();
    try {
      await client.query('BEGIN');
      try {
        await setLocalAppOrgId(client, identity.org_id);

        const workroom = await getWorkroom(client, workroomId);
        if (!workroom) {
          await client.query('ROLLBACK').catch(() => undefined);
          reply.code(404);
          return { error: 'workroom_not_found' };
        }

        const participantId = await getActiveParticipant(client, workroomId, identity.user_id);
        if (!participantId) {
          await client.query('ROLLBACK').catch(() => undefined);
          reply.code(403);
          return {
            error: 'forbidden',
            message: 'caller must be an active participant of the workroom',
          };
        }

        // The intended run action — exactly what a later passthrough run must
        // reproduce. The grant is bound to its canonical sha256.
        const action = {
          mode: 'passthrough' as const,
          capability: body.intended_run.capability,
          model: body.intended_run.model,
          input: body.intended_run.input,
          workspace_id: workroom.workspace_id,
        };
        const actionHash = intendedActionHash(action);

        // Envelope-encrypt the intended run request at rest. The request row and
        // every emitted event carry only the hash + the payload pointer.
        const plaintext = Buffer.from(JSON.stringify(action), 'utf8');
        const payloadHash = sha256(plaintext);
        const enc = await app.govai.kms.envelopeEncrypt({
          orgId: identity.org_id,
          keyId: AUDIT_KEY_ID,
          version: AUDIT_KEY_VERSION,
          plaintext: new Uint8Array(plaintext),
        });

        const turnNumber = await nextTurnNumber(client, workroomId);
        const occurredAt = new Date();
        const requestedEvent = {
          event_type: 'workroom.approval.requested' as const,
          schema_version: 1 as const,
          tenant_context: {
            org_id: identity.org_id,
            user_id: identity.user_id,
            tier: identity.tier,
            operational_mode: identity.operational_mode,
          },
          workroom_id: workroomId,
          workroom_turn_id: turnId,
          turn_number: turnNumber,
          approval_request_id: approvalRequestId,
          requested_by_participant_id: participantId,
          subject_kind: body.subject_kind,
          subject_ref_id: null,
          risk_class: body.risk_class ?? null,
          status: 'pending' as const,
          workroom_governance_mode: workroom.governance_mode,
          intended_action_hash: actionHash.toString('hex'),
          intended_action_payload_ref: randomUUID(), // placeholder; real payload id below
          expires_at: body.expires_at ?? null,
          occurred_at: occurredAt.toISOString(),
          audit_event_id: randomUUID(), // placeholder; real chain event id below
          chain_category: 'policy' as const,
        };

        const auditOut = await auditAppend(client, app.govai.kms, {
          orgId: identity.org_id,
          chainId: chainIdFor(identity.org_id, 'policy'),
          eventType: 'workroom.approval.requested',
          eventVersion: '1',
          subjectType: 'workroom_approval_request',
          subjectId: approvalRequestId,
          occurredAt,
          payloadHash,
          payloadEncrypted: enc.ciphertext,
          dekWrapped: enc.dekWrapped,
          keyId: AUDIT_KEY_ID,
          keyVersion: AUDIT_KEY_VERSION,
          redactionMetadata: {
            workroom_approval_requested: {
              ...requestedEvent,
              audit_event_id: undefined,
              intended_action_payload_ref: undefined,
            },
          },
        });
        if (!auditOut.payloadId) {
          throw new Error('auditAppend did not return a payload id for an encrypted approval');
        }
        // Schema-validate the canonical event with the real chain ids.
        WorkroomApprovalRequestedSchema.parse({
          ...requestedEvent,
          intended_action_payload_ref: auditOut.payloadId,
          audit_event_id: auditOut.eventId,
        });

        await client.query(
          `INSERT INTO govai.workroom_turns
             (id, org_id, workroom_id, turn_number, actor_participant_id, kind,
              occurred_at, audit_event_id, payload_ref)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::uuid, 'approval_request',
                   $6::timestamptz, $7::uuid, $8::uuid)`,
          [
            turnId,
            identity.org_id,
            workroomId,
            turnNumber,
            participantId,
            occurredAt.toISOString(),
            auditOut.eventId,
            approvalRequestId,
          ],
        );

        const insertRes = await client.query<ApprovalRequestRow>(
          `INSERT INTO govai.workroom_approval_requests
             (id, org_id, workroom_id, requested_by_participant_id, subject_kind, subject_ref_id,
              risk_class, status, intended_action_payload_id, intended_action_hash,
              workroom_governance_mode, expires_at, requested_audit_event_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, NULL,
                   $6::text, 'pending', $7::uuid, $8::bytea,
                   $9::text, $10::timestamptz, $11::uuid)
           RETURNING ${APPROVAL_REQUEST_COLUMNS}`,
          [
            approvalRequestId,
            identity.org_id,
            workroomId,
            participantId,
            body.subject_kind,
            body.risk_class ?? null,
            auditOut.payloadId,
            actionHash,
            workroom.governance_mode,
            body.expires_at ?? null,
            auditOut.eventId,
          ],
        );

        await client.query('COMMIT');

        reply.code(201);
        return {
          approval_request: serializeApprovalRequest(insertRes.rows[0]!),
          workroom_turn_id: turnId,
          turn_number: turnNumber,
          audit_event_id: auditOut.eventId,
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        req.log.error(
          { err_name: err instanceof Error ? err.name : 'unknown', org_id: identity.org_id },
          'workroom approval request failed',
        );
        reply.code(500);
        return { error: 'internal_error' };
      }
    } finally {
      client.release();
    }
  });

  // ==========================================================================
  // GET /v1/workrooms/:id/approvals — list approval requests
  // ==========================================================================
  app.get<{ Params: { id: string } }>('/v1/workrooms/:id/approvals', async (req, reply) => {
    const workroomId = req.params.id;
    if (typeof workroomId !== 'string' || !UUID_RE.test(workroomId)) {
      reply.code(400);
      return { error: 'invalid_workroom_id' };
    }
    const parsed = ListApprovalsQuery.safeParse(req.query);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'invalid_query',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }

    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;

    const client = await app.govai.pool.connect();
    try {
      await client.query('BEGIN');
      try {
        await setLocalAppOrgId(client, identity.org_id);

        const workroom = await getWorkroom(client, workroomId);
        if (!workroom) {
          await client.query('ROLLBACK').catch(() => undefined);
          reply.code(404);
          return { error: 'workroom_not_found' };
        }

        const participantId = await getActiveParticipant(client, workroomId, identity.user_id);
        const isAuditor = hasAnyRole(identity.roles, ['auditor', 'admin']);
        if (!participantId && !isAuditor) {
          await client.query('ROLLBACK').catch(() => undefined);
          reply.code(403);
          return {
            error: 'forbidden',
            message: 'caller must be an active participant or hold the auditor/admin role',
          };
        }

        // Status filtering applies the SAME read-time expiry semantics as the
        // rendered response: a still-`pending` request past its `expires_at` is
        // effectively `expired`. Filtering the stored column alone would
        // disagree with the rendered status, so `pending` / `expired` are
        // expanded here against now(). No stored status is mutated on read.
        const params: unknown[] = [workroomId];
        let where = 'workroom_id = $1::uuid';
        if (parsed.data.status === 'expired') {
          where +=
            " AND (status = 'expired'" +
            " OR (status = 'pending' AND expires_at IS NOT NULL AND expires_at <= now()))";
        } else if (parsed.data.status === 'pending') {
          where += " AND status = 'pending' AND (expires_at IS NULL OR expires_at > now())";
        } else if (parsed.data.status) {
          // granted / denied / revoked — terminal stored statuses.
          params.push(parsed.data.status);
          where += ` AND status = $${params.length}`;
        }
        if (parsed.data.subject_kind) {
          params.push(parsed.data.subject_kind);
          where += ` AND subject_kind = $${params.length}`;
        }
        if (parsed.data.before_created_at && parsed.data.before_id) {
          params.push(parsed.data.before_created_at);
          const tsIdx = params.length;
          params.push(parsed.data.before_id);
          const idIdx = params.length;
          where +=
            ` AND (created_at < $${tsIdx}::timestamptz` +
            ` OR (created_at = $${tsIdx}::timestamptz AND id < $${idIdx}::uuid))`;
        }
        params.push(parsed.data.limit);
        const r = await client.query<ApprovalRequestRow>(
          `SELECT ${APPROVAL_REQUEST_COLUMNS}
             FROM govai.workroom_approval_requests
            WHERE ${where}
            ORDER BY created_at DESC, id DESC
            LIMIT $${params.length}`,
          params,
        );
        await client.query('COMMIT');

        const approvals = r.rows.map(serializeApprovalRequest);
        const lastRow = r.rows.length === parsed.data.limit ? r.rows[r.rows.length - 1]! : null;
        const nextCursor = lastRow
          ? { before_created_at: lastRow.created_at.toISOString(), before_id: lastRow.id }
          : null;

        return {
          workroom_id: workroomId,
          workroom_governance_mode: workroom.governance_mode,
          approvals,
          next_cursor: nextCursor,
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        req.log.error(
          { err_name: err instanceof Error ? err.name : 'unknown', org_id: identity.org_id },
          'workroom approval list failed',
        );
        reply.code(500);
        return { error: 'internal_error' };
      }
    } finally {
      client.release();
    }
  });

  // ==========================================================================
  // GET /v1/workrooms/:id/approvals/:approvalId — fetch one approval request
  // ==========================================================================
  app.get<{ Params: { id: string; approvalId: string } }>(
    '/v1/workrooms/:id/approvals/:approvalId',
    async (req, reply) => {
      const workroomId = req.params.id;
      const approvalId = req.params.approvalId;
      if (
        typeof workroomId !== 'string' ||
        !UUID_RE.test(workroomId) ||
        typeof approvalId !== 'string' ||
        !UUID_RE.test(approvalId)
      ) {
        reply.code(400);
        return { error: 'invalid_approval_id' };
      }

      const identity = await authenticate(app, req, reply);
      if (!identity) return reply;

      const client = await app.govai.pool.connect();
      try {
        await client.query('BEGIN');
        try {
          await setLocalAppOrgId(client, identity.org_id);

          const workroom = await getWorkroom(client, workroomId);
          if (!workroom) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(404);
            return { error: 'workroom_not_found' };
          }

          const participantId = await getActiveParticipant(client, workroomId, identity.user_id);
          const isAuditor = hasAnyRole(identity.roles, ['auditor', 'admin']);
          if (!participantId && !isAuditor) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(403);
            return {
              error: 'forbidden',
              message: 'caller must be an active participant or hold the auditor/admin role',
            };
          }

          const r = await client.query<ApprovalRequestRow>(
            `SELECT ${APPROVAL_REQUEST_COLUMNS}
               FROM govai.workroom_approval_requests
              WHERE id = $1::uuid AND workroom_id = $2::uuid`,
            [approvalId, workroomId],
          );
          const row = r.rows[0];
          if (!row) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(404);
            return { error: 'approval_request_not_found' };
          }

          const d = await client.query<{
            id: string;
            decided_by_participant_id: string;
            decision: string;
            reason: string | null;
            decision_audit_event_id: string;
            created_at: Date;
          }>(
            `SELECT id, decided_by_participant_id, decision, reason, decision_audit_event_id,
                    created_at
               FROM govai.workroom_approval_decisions
              WHERE approval_request_id = $1::uuid`,
            [approvalId],
          );
          await client.query('COMMIT');

          const decisionRow = d.rows[0];
          return {
            approval_request: serializeApprovalRequest(row),
            decision: decisionRow
              ? {
                  id: decisionRow.id,
                  decided_by_participant_id: decisionRow.decided_by_participant_id,
                  decision: decisionRow.decision,
                  reason: decisionRow.reason,
                  audit_event_id: decisionRow.decision_audit_event_id,
                  created_at: decisionRow.created_at.toISOString(),
                }
              : null,
            workroom_governance_mode: workroom.governance_mode,
          };
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          req.log.error(
            { err_name: err instanceof Error ? err.name : 'unknown', org_id: identity.org_id },
            'workroom approval get failed',
          );
          reply.code(500);
          return { error: 'internal_error' };
        }
      } finally {
        client.release();
      }
    },
  );

  // ==========================================================================
  // POST /v1/workrooms/:id/approvals/:approvalId/decisions — grant / deny
  // ==========================================================================
  app.post<{ Params: { id: string; approvalId: string } }>(
    '/v1/workrooms/:id/approvals/:approvalId/decisions',
    async (req, reply) => {
      const workroomId = req.params.id;
      const approvalId = req.params.approvalId;
      if (
        typeof workroomId !== 'string' ||
        !UUID_RE.test(workroomId) ||
        typeof approvalId !== 'string' ||
        !UUID_RE.test(approvalId)
      ) {
        reply.code(400);
        return { error: 'invalid_approval_id' };
      }
      const parsed = DecisionBody.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return {
          error: 'invalid_request',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        };
      }
      const body = parsed.data;
      // A denial must carry a reason (DB enforces this too).
      if (body.decision === 'denied' && (body.reason === undefined || body.reason.length === 0)) {
        reply.code(400);
        return { error: 'reason_required_for_denial' };
      }

      const identity = await authenticate(app, req, reply);
      if (!identity) return reply;

      const decisionId = randomUUID();
      const turnId = randomUUID();

      const client = await app.govai.pool.connect();
      try {
        await client.query('BEGIN');
        try {
          await setLocalAppOrgId(client, identity.org_id);

          const workroom = await getWorkroom(client, workroomId);
          if (!workroom) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(404);
            return { error: 'workroom_not_found' };
          }

          // Only an active human owner / approver may decide. An auditor/admin
          // API key alone — without a qualifying participant row — cannot.
          const decider = await getActiveHumanParticipant(client, workroomId, identity.user_id);
          if (!decider) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(403);
            return {
              error: 'forbidden',
              message: 'caller must be an active participant of the workroom',
            };
          }
          if (decider.role !== 'human_owner' && decider.role !== 'human_approver') {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(403);
            return {
              error: 'forbidden',
              message: 'only a human_owner or human_approver participant may decide approvals',
            };
          }

          // Lock the request row: serializes concurrent decisions so a second
          // decider sees the now-terminal status and is rejected.
          const reqRes = await client.query<ApprovalRequestRow>(
            `SELECT ${APPROVAL_REQUEST_COLUMNS}
               FROM govai.workroom_approval_requests
              WHERE id = $1::uuid AND workroom_id = $2::uuid
              FOR UPDATE`,
            [approvalId, workroomId],
          );
          const request = reqRes.rows[0];
          if (!request) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(404);
            return { error: 'approval_request_not_found' };
          }
          if (request.status !== 'pending') {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(409);
            return { error: 'workroom_approval_not_pending', status: request.status };
          }
          if (
            request.expires_at !== null &&
            request.expires_at.getTime() <= Date.now()
          ) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(409);
            return { error: 'workroom_approval_expired' };
          }
          // Separation of duties: the requester can never decide their own
          // request (the DB trigger is the backstop).
          if (request.requested_by_participant_id === decider.id) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(403);
            return {
              error: 'workroom_separation_of_duties',
              message: 'the requester cannot decide their own approval request',
            };
          }

          const turnNumber = await nextTurnNumber(client, workroomId);
          const occurredAt = new Date();
          const newStatus = body.decision === 'granted' ? 'granted' : 'denied';
          const decisionEvent = {
            event_type:
              body.decision === 'granted'
                ? ('workroom.approval.granted' as const)
                : ('workroom.approval.denied' as const),
            schema_version: 1 as const,
            tenant_context: {
              org_id: identity.org_id,
              user_id: identity.user_id,
              tier: identity.tier,
              operational_mode: identity.operational_mode,
            },
            workroom_id: workroomId,
            workroom_turn_id: turnId,
            turn_number: turnNumber,
            approval_request_id: approvalId,
            approval_decision_id: decisionId,
            requested_by_participant_id: request.requested_by_participant_id,
            decided_by_participant_id: decider.id,
            outcome: newStatus,
            reason: body.reason ?? null,
            subject_kind: 'passthrough_run' as const,
            status: newStatus,
            workroom_governance_mode: request.workroom_governance_mode as
              | 'governance_active'
              | 'audit_only',
            intended_action_hash: request.intended_action_hash.toString('hex'),
            consumed_run_id: null,
            occurred_at: occurredAt.toISOString(),
            audit_event_id: randomUUID(), // placeholder; real chain event id below
            chain_category: 'policy' as const,
          };

          const auditOut = await auditAppend(client, app.govai.kms, {
            orgId: identity.org_id,
            chainId: chainIdFor(identity.org_id, 'policy'),
            eventType: decisionEvent.event_type,
            eventVersion: '1',
            subjectType: 'workroom_approval_decision',
            subjectId: decisionId,
            occurredAt,
            payloadHash: sha256(Buffer.from(JSON.stringify(decisionEvent), 'utf8')),
            keyId: AUDIT_KEY_ID,
            keyVersion: AUDIT_KEY_VERSION,
            redactionMetadata: {
              workroom_approval_decision: { ...decisionEvent, audit_event_id: undefined },
            },
          });
          WorkroomApprovalDecisionSchema.parse({
            ...decisionEvent,
            audit_event_id: auditOut.eventId,
          });

          await client.query(
            `INSERT INTO govai.workroom_approval_decisions
               (id, org_id, approval_request_id, decided_by_participant_id, decision, reason,
                decision_audit_event_id)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::text, $7::uuid)`,
            [
              decisionId,
              identity.org_id,
              approvalId,
              decider.id,
              body.decision,
              body.reason ?? null,
              auditOut.eventId,
            ],
          );

          const updRes = await client.query<ApprovalRequestRow>(
            `UPDATE govai.workroom_approval_requests
                SET status = $2::text, decided_at = $3::timestamptz
              WHERE id = $1::uuid
              RETURNING ${APPROVAL_REQUEST_COLUMNS}`,
            [approvalId, newStatus, occurredAt.toISOString()],
          );

          await client.query(
            `INSERT INTO govai.workroom_turns
               (id, org_id, workroom_id, turn_number, actor_participant_id, kind,
                occurred_at, audit_event_id, payload_ref)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::uuid, 'approval_decision',
                     $6::timestamptz, $7::uuid, $8::uuid)`,
            [
              turnId,
              identity.org_id,
              workroomId,
              turnNumber,
              decider.id,
              occurredAt.toISOString(),
              auditOut.eventId,
              decisionId,
            ],
          );

          await client.query('COMMIT');

          reply.code(201);
          return {
            approval_request: serializeApprovalRequest(updRes.rows[0]!),
            decision: {
              id: decisionId,
              approval_request_id: approvalId,
              decided_by_participant_id: decider.id,
              decision: body.decision,
              reason: body.reason ?? null,
              audit_event_id: auditOut.eventId,
            },
            workroom_turn_id: turnId,
            turn_number: turnNumber,
            audit_event_id: auditOut.eventId,
          };
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          req.log.error(
            { err_name: err instanceof Error ? err.name : 'unknown', org_id: identity.org_id },
            'workroom approval decision failed',
          );
          reply.code(500);
          return { error: 'internal_error' };
        }
      } finally {
        client.release();
      }
    },
  );

  // ==========================================================================
  // POST /v1/workrooms/:id/approvals/:approvalId/revoke — revoke a pending req
  // ==========================================================================
  app.post<{ Params: { id: string; approvalId: string } }>(
    '/v1/workrooms/:id/approvals/:approvalId/revoke',
    async (req, reply) => {
      const workroomId = req.params.id;
      const approvalId = req.params.approvalId;
      if (
        typeof workroomId !== 'string' ||
        !UUID_RE.test(workroomId) ||
        typeof approvalId !== 'string' ||
        !UUID_RE.test(approvalId)
      ) {
        reply.code(400);
        return { error: 'invalid_approval_id' };
      }
      const parsed = RevokeBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        reply.code(400);
        return {
          error: 'invalid_request',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        };
      }
      const body = parsed.data;

      const identity = await authenticate(app, req, reply);
      if (!identity) return reply;

      const turnId = randomUUID();

      const client = await app.govai.pool.connect();
      try {
        await client.query('BEGIN');
        try {
          await setLocalAppOrgId(client, identity.org_id);

          const workroom = await getWorkroom(client, workroomId);
          if (!workroom) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(404);
            return { error: 'workroom_not_found' };
          }

          const revoker = await getActiveHumanParticipant(client, workroomId, identity.user_id);
          if (!revoker) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(403);
            return {
              error: 'forbidden',
              message: 'caller must be an active participant of the workroom',
            };
          }

          const reqRes = await client.query<ApprovalRequestRow>(
            `SELECT ${APPROVAL_REQUEST_COLUMNS}
               FROM govai.workroom_approval_requests
              WHERE id = $1::uuid AND workroom_id = $2::uuid
              FOR UPDATE`,
            [approvalId, workroomId],
          );
          const request = reqRes.rows[0];
          if (!request) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(404);
            return { error: 'approval_request_not_found' };
          }
          if (request.status !== 'pending') {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(409);
            return { error: 'workroom_approval_not_pending', status: request.status };
          }
          // Only the requester, or a human_owner, may revoke a pending request.
          const isRequester = request.requested_by_participant_id === revoker.id;
          if (!isRequester && revoker.role !== 'human_owner') {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(403);
            return {
              error: 'forbidden',
              message: 'only the requester or a human_owner participant may revoke a request',
            };
          }

          const turnNumber = await nextTurnNumber(client, workroomId);
          const occurredAt = new Date();
          const revokedEvent = {
            event_type: 'workroom.approval.revoked' as const,
            schema_version: 1 as const,
            tenant_context: {
              org_id: identity.org_id,
              user_id: identity.user_id,
              tier: identity.tier,
              operational_mode: identity.operational_mode,
            },
            workroom_id: workroomId,
            workroom_turn_id: turnId,
            turn_number: turnNumber,
            approval_request_id: approvalId,
            approval_decision_id: null,
            requested_by_participant_id: request.requested_by_participant_id,
            decided_by_participant_id: revoker.id,
            outcome: 'revoked' as const,
            reason: body.reason ?? null,
            subject_kind: 'passthrough_run' as const,
            status: 'revoked' as const,
            workroom_governance_mode: request.workroom_governance_mode as
              | 'governance_active'
              | 'audit_only',
            intended_action_hash: request.intended_action_hash.toString('hex'),
            consumed_run_id: null,
            occurred_at: occurredAt.toISOString(),
            audit_event_id: randomUUID(), // placeholder; real chain event id below
            chain_category: 'policy' as const,
          };

          const auditOut = await auditAppend(client, app.govai.kms, {
            orgId: identity.org_id,
            chainId: chainIdFor(identity.org_id, 'policy'),
            eventType: 'workroom.approval.revoked',
            eventVersion: '1',
            subjectType: 'workroom_approval_request',
            subjectId: approvalId,
            occurredAt,
            payloadHash: sha256(Buffer.from(JSON.stringify(revokedEvent), 'utf8')),
            keyId: AUDIT_KEY_ID,
            keyVersion: AUDIT_KEY_VERSION,
            redactionMetadata: {
              workroom_approval_decision: { ...revokedEvent, audit_event_id: undefined },
            },
          });
          WorkroomApprovalDecisionSchema.parse({ ...revokedEvent, audit_event_id: auditOut.eventId });

          const updRes = await client.query<ApprovalRequestRow>(
            `UPDATE govai.workroom_approval_requests
                SET status = 'revoked', decided_at = $2::timestamptz
              WHERE id = $1::uuid
              RETURNING ${APPROVAL_REQUEST_COLUMNS}`,
            [approvalId, occurredAt.toISOString()],
          );

          // A revocation creates no decision row; the turn points at the
          // request itself.
          await client.query(
            `INSERT INTO govai.workroom_turns
               (id, org_id, workroom_id, turn_number, actor_participant_id, kind,
                occurred_at, audit_event_id, payload_ref)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::uuid, 'approval_decision',
                     $6::timestamptz, $7::uuid, $8::uuid)`,
            [
              turnId,
              identity.org_id,
              workroomId,
              turnNumber,
              revoker.id,
              occurredAt.toISOString(),
              auditOut.eventId,
              approvalId,
            ],
          );

          await client.query('COMMIT');

          return {
            approval_request: serializeApprovalRequest(updRes.rows[0]!),
            workroom_turn_id: turnId,
            turn_number: turnNumber,
            audit_event_id: auditOut.eventId,
          };
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          req.log.error(
            { err_name: err instanceof Error ? err.name : 'unknown', org_id: identity.org_id },
            'workroom approval revoke failed',
          );
          reply.code(500);
          return { error: 'internal_error' };
        }
      } finally {
        client.release();
      }
    },
  );
}
