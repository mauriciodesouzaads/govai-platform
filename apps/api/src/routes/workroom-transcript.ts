// /v1/workrooms/{id}/{messages,tasks,evidence,audit} — Workroom Phase 2 (issue #51).
//
// The append-only transcript + evidence layer above the Phase 1 control plane
// (architecture: docs/architecture/workroom-governance-room.md, umbrella #33).
//
// Scope (Phase 2):
//   - POST /v1/workrooms/{id}/messages
//   - POST /v1/workrooms/{id}/tasks
//   - GET  /v1/workrooms/{id}/evidence
//   - GET  /v1/workrooms/{id}/audit
//
// Every write persists real rows and emits a real audit event. Workroom does
// not create a new audit chain: message/task events route onto the existing
// `run` ChainCategory via govai.audit_events. Message content is
// envelope-encrypted at rest in govai.audit_event_payloads on the write path —
// govai.workroom_messages stores only `content_ref` + `payload_hash`, never
// plaintext. `workroom_governance_mode` is always read from the persisted
// parent workroom row, never defaulted.
//
// A message append creates exactly one `message` turn and one `workroom.message`
// event; the derived evidence_artifacts row anchors to that same turn and audit
// event — no duplicate standalone `workroom.evidence` event is emitted.
//
// Idempotency remains deferred — no shared idempotency abstraction exists.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { auditAppend, sha256 } from '@govai/core-audit';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { chainIdFor, WorkroomMessageSchema, WorkroomTaskCreatedSchema } from '@govai/core-events';
import { hasAnyRole } from '@govai/core-identity';
import { authenticateApiKey, AuthError, type AuthIdentity } from '../pipeline/auth.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// govai_app HMAC/payload key binding — same key id/version Phase 1 uses for
// audit events. Re-used for envelopeEncrypt so audit_event_payloads.key_id /
// key_version record what wrapped the DEK.
const AUDIT_KEY_ID = 'audit-1';
const AUDIT_KEY_VERSION = 1;

const MessageBody = z.object({
  role: z.enum(['user', 'assistant', 'auditor_note']),
  content: z.string().min(1).max(50_000),
  provider_invocation_id: z.string().uuid().optional(),
  tokens_in: z.number().int().nonnegative().optional(),
  tokens_out: z.number().int().nonnegative().optional(),
});

const TaskBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  risk_class: z.enum(['A', 'B', 'C', 'D', 'E']),
  requires_approval: z.boolean(),
  assigned_participant_id: z.string().uuid().optional(),
});

const EvidenceQuery = z.object({
  artifact_kind: z
    .enum([
      'prompt',
      'agent_response',
      'auditor_finding',
      'external_artifact',
      'human_approval',
      'merge_decision',
      'file_diff',
      'commit',
      'pr',
      'ci_run',
      'tool_invocation_result',
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before_seq: z.coerce.number().int().min(1).optional(),
});

const AuditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before_seq: z.coerce.number().int().min(1).optional(),
});

const ARTIFACT_KIND_FOR_ROLE: Record<'user' | 'assistant' | 'auditor_note', string> = {
  user: 'prompt',
  assistant: 'agent_response',
  auditor_note: 'auditor_finding',
};

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
): Promise<{ id: string; governance_mode: 'governance_active' | 'audit_only' } | null> {
  const r = await client.query<{ id: string; governance_mode: 'governance_active' | 'audit_only' }>(
    'SELECT id, governance_mode FROM govai.workrooms WHERE id = $1::uuid',
    [workroomId],
  );
  return r.rows[0] ?? null;
}

/** Resolve the caller's active human participant binding in the workroom. */
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

export async function workroomTranscriptRoute(app: FastifyInstance): Promise<void> {
  // ==========================================================================
  // POST /v1/workrooms/:id/messages — append an encrypted transcript message
  // ==========================================================================
  app.post<{ Params: { id: string } }>('/v1/workrooms/:id/messages', async (req, reply) => {
    const workroomId = req.params.id;
    if (typeof workroomId !== 'string' || !UUID_RE.test(workroomId)) {
      reply.code(400);
      return { error: 'invalid_workroom_id' };
    }
    const parsed = MessageBody.safeParse(req.body);
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
    const messageId = randomUUID();
    const turnId = randomUUID();
    const evidenceId = randomUUID();

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

        const plaintext = Buffer.from(body.content, 'utf8');
        const payloadHash = sha256(plaintext);
        const enc = await app.govai.kms.envelopeEncrypt({
          orgId: identity.org_id,
          keyId: AUDIT_KEY_ID,
          version: AUDIT_KEY_VERSION,
          plaintext: new Uint8Array(plaintext),
        });

        const turnNumber = await nextTurnNumber(client, workroomId);
        const occurredAt = new Date();
        const messageEvent = {
          event_type: 'workroom.message' as const,
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
          message_id: messageId,
          participant_id: participantId,
          role: body.role,
          workroom_governance_mode: workroom.governance_mode,
          content_ref: randomUUID(), // placeholder; replaced with the real payload id
          payload_hash: Buffer.from(payloadHash).toString('hex'),
          occurred_at: occurredAt.toISOString(),
          audit_event_id: randomUUID(), // placeholder; replaced with the chain event id
          chain_category: 'run' as const,
        };

        const auditOut = await auditAppend(client, app.govai.kms, {
          orgId: identity.org_id,
          chainId: chainIdFor(identity.org_id, 'run'),
          eventType: 'workroom.message',
          eventVersion: '1',
          subjectType: 'workroom_message',
          subjectId: messageId,
          occurredAt,
          payloadHash,
          payloadEncrypted: enc.ciphertext,
          dekWrapped: enc.dekWrapped,
          keyId: AUDIT_KEY_ID,
          keyVersion: AUDIT_KEY_VERSION,
          redactionMetadata: {
            workroom_message: {
              ...messageEvent,
              content_ref: undefined,
              audit_event_id: undefined,
            },
          },
        });
        if (!auditOut.payloadId) {
          throw new Error('auditAppend did not return a payload id for an encrypted message');
        }
        // Schema-validate the canonical event with the real chain ids.
        WorkroomMessageSchema.parse({
          ...messageEvent,
          content_ref: auditOut.payloadId,
          audit_event_id: auditOut.eventId,
        });

        await client.query(
          `INSERT INTO govai.workroom_turns
             (id, org_id, workroom_id, turn_number, actor_participant_id, kind,
              occurred_at, audit_event_id, payload_ref)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::uuid, 'message',
                   $6::timestamptz, $7::uuid, $8::uuid)`,
          [
            turnId,
            identity.org_id,
            workroomId,
            turnNumber,
            participantId,
            occurredAt.toISOString(),
            auditOut.eventId,
            messageId,
          ],
        );

        await client.query(
          `INSERT INTO govai.workroom_messages
             (id, org_id, workroom_id, workroom_turn_id, participant_id, role,
              content_ref, payload_hash, tokens_in, tokens_out, provider_invocation_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::text,
                   $7::uuid, $8::bytea, $9::integer, $10::integer, $11::uuid)`,
          [
            messageId,
            identity.org_id,
            workroomId,
            turnId,
            participantId,
            body.role,
            auditOut.payloadId,
            Buffer.from(payloadHash),
            body.tokens_in ?? null,
            body.tokens_out ?? null,
            body.provider_invocation_id ?? null,
          ],
        );

        await client.query(
          `INSERT INTO govai.workroom_evidence_artifacts
             (id, org_id, workroom_id, workroom_turn_id, audit_event_id, artifact_kind,
              payload_ref, payload_hash, redaction_metadata)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::text,
                   $7::uuid, $8::bytea, $9::jsonb)`,
          [
            evidenceId,
            identity.org_id,
            workroomId,
            turnId,
            auditOut.eventId,
            ARTIFACT_KIND_FOR_ROLE[body.role],
            auditOut.payloadId,
            Buffer.from(payloadHash),
            JSON.stringify({ derived_from: 'workroom.message', role: body.role }),
          ],
        );

        await client.query('COMMIT');

        reply.code(201);
        return {
          message: {
            id: messageId,
            workroom_id: workroomId,
            workroom_turn_id: turnId,
            turn_number: turnNumber,
            participant_id: participantId,
            role: body.role,
            content_ref: auditOut.payloadId,
            payload_hash: Buffer.from(payloadHash).toString('hex'),
            tokens_in: body.tokens_in ?? null,
            tokens_out: body.tokens_out ?? null,
            created_at: occurredAt.toISOString(),
          },
          evidence_artifact_id: evidenceId,
          governance_mode: workroom.governance_mode,
          audit_event_id: auditOut.eventId,
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        req.log.error(
          { err_name: err instanceof Error ? err.name : 'unknown', org_id: identity.org_id },
          'workroom message append failed',
        );
        reply.code(500);
        return { error: 'internal_error' };
      }
    } finally {
      client.release();
    }
  });

  // ==========================================================================
  // POST /v1/workrooms/:id/tasks — create a task
  // ==========================================================================
  app.post<{ Params: { id: string } }>('/v1/workrooms/:id/tasks', async (req, reply) => {
    const workroomId = req.params.id;
    if (typeof workroomId !== 'string' || !UUID_RE.test(workroomId)) {
      reply.code(400);
      return { error: 'invalid_workroom_id' };
    }
    const parsed = TaskBody.safeParse(req.body);
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
    const taskId = randomUUID();
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

        if (body.assigned_participant_id) {
          const assignee = await client.query<{ id: string }>(
            `SELECT id FROM govai.workroom_participants
              WHERE id = $1::uuid AND workroom_id = $2::uuid AND status = 'active'
              LIMIT 1`,
            [body.assigned_participant_id, workroomId],
          );
          if (!assignee.rows[0]) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(404);
            return { error: 'assigned_participant_not_found' };
          }
        }

        const turnNumber = await nextTurnNumber(client, workroomId);
        const occurredAt = new Date();
        const taskEvent = {
          event_type: 'workroom.task.created' as const,
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
          task_id: taskId,
          created_by_participant_id: participantId,
          assigned_participant_id: body.assigned_participant_id ?? null,
          title: body.title,
          risk_class: body.risk_class,
          requires_approval: body.requires_approval,
          status: 'queued' as const,
          workroom_governance_mode: workroom.governance_mode,
          occurred_at: occurredAt.toISOString(),
          audit_event_id: randomUUID(), // placeholder; replaced with the chain event id
          chain_category: 'run' as const,
        };

        const auditOut = await auditAppend(client, app.govai.kms, {
          orgId: identity.org_id,
          chainId: chainIdFor(identity.org_id, 'run'),
          eventType: 'workroom.task.created',
          eventVersion: '1',
          subjectType: 'workroom_task',
          subjectId: taskId,
          occurredAt,
          payloadHash: sha256(Buffer.from(JSON.stringify(taskEvent), 'utf8')),
          keyId: AUDIT_KEY_ID,
          keyVersion: AUDIT_KEY_VERSION,
          redactionMetadata: {
            workroom_task_created: { ...taskEvent, audit_event_id: undefined },
          },
        });
        WorkroomTaskCreatedSchema.parse({ ...taskEvent, audit_event_id: auditOut.eventId });

        await client.query(
          `INSERT INTO govai.workroom_turns
             (id, org_id, workroom_id, turn_number, actor_participant_id, kind,
              occurred_at, audit_event_id, payload_ref)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::uuid, 'task',
                   $6::timestamptz, $7::uuid, $8::uuid)`,
          [
            turnId,
            identity.org_id,
            workroomId,
            turnNumber,
            participantId,
            occurredAt.toISOString(),
            auditOut.eventId,
            taskId,
          ],
        );

        await client.query(
          `INSERT INTO govai.workroom_tasks
             (id, org_id, workroom_id, workroom_turn_id, title, description, status,
              assigned_participant_id, risk_class, requires_approval, created_by_participant_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::text, 'queued',
                   $7::uuid, $8::text, $9::boolean, $10::uuid)`,
          [
            taskId,
            identity.org_id,
            workroomId,
            turnId,
            body.title,
            body.description ?? '',
            body.assigned_participant_id ?? null,
            body.risk_class,
            body.requires_approval,
            participantId,
          ],
        );

        await client.query('COMMIT');

        reply.code(201);
        return {
          task: {
            id: taskId,
            workroom_id: workroomId,
            workroom_turn_id: turnId,
            turn_number: turnNumber,
            title: body.title,
            description: body.description ?? '',
            status: 'queued',
            risk_class: body.risk_class,
            requires_approval: body.requires_approval,
            assigned_participant_id: body.assigned_participant_id ?? null,
            created_by_participant_id: participantId,
          },
          governance_mode: workroom.governance_mode,
          audit_event_id: auditOut.eventId,
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        req.log.error(
          { err_name: err instanceof Error ? err.name : 'unknown', org_id: identity.org_id },
          'workroom task create failed',
        );
        reply.code(500);
        return { error: 'internal_error' };
      }
    } finally {
      client.release();
    }
  });

  // ==========================================================================
  // GET /v1/workrooms/:id/evidence — query the evidence index
  // ==========================================================================
  app.get<{ Params: { id: string } }>('/v1/workrooms/:id/evidence', async (req, reply) => {
    const workroomId = req.params.id;
    if (typeof workroomId !== 'string' || !UUID_RE.test(workroomId)) {
      reply.code(400);
      return { error: 'invalid_workroom_id' };
    }
    const parsed = EvidenceQuery.safeParse(req.query);
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

        const params: unknown[] = [workroomId];
        let where = 'ea.workroom_id = $1::uuid';
        if (parsed.data.artifact_kind) {
          params.push(parsed.data.artifact_kind);
          where += ` AND ea.artifact_kind = $${params.length}`;
        }
        if (parsed.data.before_seq !== undefined) {
          params.push(parsed.data.before_seq);
          where += ` AND ae.sequence_number < $${params.length}`;
        }
        params.push(parsed.data.limit);
        const r = await client.query<{
          id: string;
          artifact_kind: string;
          workroom_turn_id: string;
          turn_number: string;
          audit_event_id: string;
          sequence_number: string;
          event_type: string;
          payload_ref: string;
          payload_hash: Buffer;
          redaction_metadata: Record<string, unknown>;
          status: string;
          created_at: Date;
        }>(
          `SELECT ea.id, ea.artifact_kind, ea.workroom_turn_id, wt.turn_number,
                  ea.audit_event_id, ae.sequence_number, ae.event_type,
                  ea.payload_ref, ea.payload_hash, ea.redaction_metadata, ea.status,
                  ea.created_at
             FROM govai.workroom_evidence_artifacts ea
             JOIN govai.workroom_turns wt ON wt.id = ea.workroom_turn_id
             JOIN govai.audit_events ae ON ae.id = ea.audit_event_id
            WHERE ${where}
            ORDER BY ae.sequence_number DESC
            LIMIT $${params.length}`,
          params,
        );
        await client.query('COMMIT');

        const evidence = r.rows.map((row) => ({
          evidence_artifact_id: row.id,
          artifact_kind: row.artifact_kind,
          workroom_id: workroomId,
          workroom_turn_id: row.workroom_turn_id,
          turn_number: Number(row.turn_number),
          audit_event_id: row.audit_event_id,
          audit_sequence_number: Number(row.sequence_number),
          event_type: row.event_type,
          payload_ref: row.payload_ref,
          payload_hash: row.payload_hash.toString('hex'),
          redaction_metadata: row.redaction_metadata,
          status: row.status,
          workroom_governance_mode: workroom.governance_mode,
          created_at: row.created_at.toISOString(),
        }));
        const nextBeforeSeq =
          evidence.length === parsed.data.limit
            ? evidence[evidence.length - 1]!.audit_sequence_number
            : null;

        return {
          workroom_id: workroomId,
          workroom_governance_mode: workroom.governance_mode,
          evidence,
          next_before_seq: nextBeforeSeq,
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        req.log.error(
          { err_name: err instanceof Error ? err.name : 'unknown', org_id: identity.org_id },
          'workroom evidence query failed',
        );
        reply.code(500);
        return { error: 'internal_error' };
      }
    } finally {
      client.release();
    }
  });

  // ==========================================================================
  // GET /v1/workrooms/:id/audit — workroom-scoped audit subview
  // ==========================================================================
  app.get<{ Params: { id: string } }>('/v1/workrooms/:id/audit', async (req, reply) => {
    const workroomId = req.params.id;
    if (typeof workroomId !== 'string' || !UUID_RE.test(workroomId)) {
      reply.code(400);
      return { error: 'invalid_workroom_id' };
    }
    const parsed = AuditQuery.safeParse(req.query);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'invalid_query',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }

    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;

    // The audit subview is an auditor surface.
    if (!hasAnyRole(identity.roles, ['auditor', 'admin'])) {
      reply.code(403);
      return { error: 'forbidden', required_role: 'auditor' };
    }

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

        const params: unknown[] = [workroomId];
        let where = 'wt.workroom_id = $1::uuid';
        if (parsed.data.before_seq !== undefined) {
          params.push(parsed.data.before_seq);
          where += ` AND ae.sequence_number < $${params.length}`;
        }
        params.push(parsed.data.limit);
        // Workroom-scoped subview over the EXISTING audit chain: join through
        // workroom_turns.audit_event_id — audit_events.subject_id alone is not
        // workroom-scoped (participant/message/task subjects differ).
        const r = await client.query<{
          id: string;
          sequence_number: string;
          event_type: string;
          event_version: string;
          subject_type: string;
          subject_id: string;
          chain_id: string;
          occurred_at: Date;
          payload_hash: Buffer;
          redaction_metadata: Record<string, unknown>;
          turn_id: string;
          turn_number: string;
          turn_kind: string;
          payload_ref: string | null;
        }>(
          `SELECT ae.id, ae.sequence_number, ae.event_type, ae.event_version,
                  ae.subject_type, ae.subject_id, ae.chain_id, ae.occurred_at,
                  ae.payload_hash, ae.redaction_metadata,
                  wt.id AS turn_id, wt.turn_number, wt.kind AS turn_kind, wt.payload_ref
             FROM govai.workroom_turns wt
             JOIN govai.audit_events ae ON ae.id = wt.audit_event_id
            WHERE ${where}
            ORDER BY ae.sequence_number DESC
            LIMIT $${params.length}`,
          params,
        );
        await client.query('COMMIT');

        const auditEvents = r.rows.map((row) => ({
          audit_event_id: row.id,
          sequence_number: Number(row.sequence_number),
          event_type: row.event_type,
          event_version: row.event_version,
          chain_category: row.chain_id.slice(row.chain_id.lastIndexOf(':') + 1),
          subject_type: row.subject_type,
          subject_id: row.subject_id,
          payload_hash: row.payload_hash.toString('hex'),
          redaction_metadata: row.redaction_metadata,
          occurred_at: row.occurred_at.toISOString(),
          workroom_turn_id: row.turn_id,
          turn_number: Number(row.turn_number),
          turn_kind: row.turn_kind,
          payload_ref: row.payload_ref,
          workroom_governance_mode: workroom.governance_mode,
        }));
        const nextBeforeSeq =
          auditEvents.length === parsed.data.limit
            ? auditEvents[auditEvents.length - 1]!.sequence_number
            : null;

        return {
          workroom_id: workroomId,
          workroom_governance_mode: workroom.governance_mode,
          audit_events: auditEvents,
          next_before_seq: nextBeforeSeq,
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        req.log.error(
          { err_name: err instanceof Error ? err.name : 'unknown', org_id: identity.org_id },
          'workroom audit subview failed',
        );
        reply.code(500);
        return { error: 'internal_error' };
      }
    } finally {
      client.release();
    }
  });
}
