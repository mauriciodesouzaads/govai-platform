// /v1/workrooms — Workroom Phase 1 control plane (issue #49).
//
// Real control-plane endpoints for the GovAI Workroom domain skeleton
// (architecture: docs/architecture/workroom-governance-room.md, umbrella #33).
//
// Scope (Phase 1):
//   - POST   /v1/workrooms
//   - GET    /v1/workrooms/{id}
//   - GET    /v1/workrooms?status=...
//   - POST   /v1/workrooms/{id}/participants
//   - DELETE /v1/workrooms/{id}/participants/{participant_id}
//
// Every write endpoint persists real rows and emits the audit event it claims
// to emit. Workroom does not create a new audit chain: lifecycle events route
// onto the `run` chain, participant events onto the `admin` chain — both via
// the existing govai.audit_events / chainIdFor routing. No in-memory state.
//
// `governance_mode` is selected at creation (default `governance_active`),
// persisted on the workroom row, and surfaced in every workroom response. It
// is immutable in Phase 1 — there is no mode-transition endpoint here.
//
// Idempotency: the blueprint contemplates a client `Idempotency-Key` on the
// write endpoints, but no idempotency abstraction exists in the codebase yet.
// Phase 1 does NOT implement idempotency and does not claim it; correctness of
// repeated participant adds rests on the partial-unique active-participant
// indexes (duplicate active participant → 409). Cursor-based listing is
// likewise deferred — GET list returns a bounded, ordered slice.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { auditAppend, sha256 } from '@govai/core-audit';
import { setLocalAppOrgId } from '@govai/core-tenant';
import {
  chainIdFor,
  WorkroomLifecycleSchema,
  WorkroomParticipantSchema,
  WorkroomParticipantRole,
} from '@govai/core-events';
import { hasAnyRole } from '@govai/core-identity';
import { authenticateApiKey, AuthError, type AuthIdentity } from '../pipeline/auth.js';
import { AUDIT_CHAIN_KEY } from '../pipeline/audit-keys.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GovernanceMode = z.enum(['governance_active', 'audit_only']);
const ProviderSurface = z.enum(['governed', 'passthrough']);
const RiskClass = z.enum(['A', 'B', 'C', 'D', 'E']);

const CreateBody = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  governance_mode: GovernanceMode.optional(),
  max_risk_without_approval: RiskClass.optional(),
  default_provider_surface: ProviderSurface.optional(),
  purpose: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const ParticipantBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('human'),
    role: WorkroomParticipantRole,
    user_id: z.string().uuid(),
    permission_scope: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal('agent'),
    role: WorkroomParticipantRole,
    agent_profile_id: z.string().uuid(),
    permission_scope: z.record(z.string(), z.unknown()).optional(),
  }),
]);

const ListQuery = z.object({
  status: z
    .enum(['draft', 'open', 'blocked_on_approval', 'completed', 'cancelled', 'archived'])
    .optional(),
  workspace_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
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

/**
 * Authenticate the request's API key. On failure, writes the HTTP response and
 * returns null so the caller can `return reply`.
 */
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

type WorkroomRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  name: string;
  purpose: string;
  status: string;
  governance_mode: string;
  policy_profile_id: string;
  created_by_user_id: string;
  retention_class: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  archived_at: Date | null;
};

function serializeWorkroom(row: WorkroomRow): Record<string, unknown> {
  return {
    id: row.id,
    org_id: row.org_id,
    workspace_id: row.workspace_id,
    name: row.name,
    purpose: row.purpose,
    status: row.status,
    governance_mode: row.governance_mode,
    policy_profile_id: row.policy_profile_id,
    created_by_user_id: row.created_by_user_id,
    retention_class: row.retention_class,
    metadata: row.metadata,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    closed_at: row.closed_at ? row.closed_at.toISOString() : null,
    archived_at: row.archived_at ? row.archived_at.toISOString() : null,
  };
}

/**
 * Reserve the next per-workroom monotonic turn number. The advisory xact lock
 * serializes concurrent turn creation for the same workroom; the
 * (workroom_id, turn_number) unique index is the backstop.
 */
async function nextTurnNumber(
  client: import('pg').PoolClient,
  workroomId: string,
): Promise<number> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('workroom_turn:' || $1)::bigint)", [
    workroomId,
  ]);
  const r = await client.query<{ next: string }>(
    'SELECT COALESCE(MAX(turn_number), 0) + 1 AS next FROM govai.workroom_turns WHERE workroom_id = $1',
    [workroomId],
  );
  return Number(r.rows[0]?.next ?? 1);
}

export async function workroomsRoute(app: FastifyInstance): Promise<void> {
  // ==========================================================================
  // POST /v1/workrooms — create a workroom
  // ==========================================================================
  app.post('/v1/workrooms', async (req, reply) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'invalid_request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }

    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;

    // Workroom creation requires a developer-or-higher API key. We do not
    // invent a new global RBAC role: the existing `developer` and `admin`
    // roles from @govai/core-identity are the gate.
    if (!hasAnyRole(identity.roles, ['developer', 'admin'])) {
      reply.code(403);
      return { error: 'forbidden', required_role: 'developer' };
    }

    const body = parsed.data;
    const governanceMode = body.governance_mode ?? 'governance_active';
    const providerSurface =
      body.default_provider_surface ??
      (governanceMode === 'audit_only' ? 'passthrough' : 'governed');
    const maxRisk = body.max_risk_without_approval ?? 'C';
    const purpose = body.purpose ?? '';
    const metadata = body.metadata ?? {};

    const workroomId = randomUUID();
    const policyProfileId = randomUUID();
    const participantId = randomUUID();

    const client = await app.govai.pool.connect();
    try {
      await client.query('BEGIN');
      try {
        await setLocalAppOrgId(client, identity.org_id);

        // Org-level admission gate: a tenant may disallow audit_only entirely.
        if (governanceMode === 'audit_only') {
          const orgRes = await client.query<{ workroom_audit_only_disallowed: boolean }>(
            'SELECT workroom_audit_only_disallowed FROM govai.orgs WHERE id = $1::uuid',
            [identity.org_id],
          );
          if (orgRes.rows[0]?.workroom_audit_only_disallowed === true) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(403);
            return {
              error: 'audit_only_disallowed',
              message: 'org policy disallows audit_only workrooms',
            };
          }
        }

        await client.query(
          `INSERT INTO govai.workroom_policy_profiles
             (id, org_id, name, governance_mode, default_provider_surface, max_risk_without_approval)
           VALUES ($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text)`,
          [
            policyProfileId,
            identity.org_id,
            `workroom-policy:${workroomId}`,
            governanceMode,
            providerSurface,
            maxRisk,
          ],
        );

        const workroomRes = await client.query<WorkroomRow>(
          `INSERT INTO govai.workrooms
             (id, org_id, workspace_id, name, purpose, status, governance_mode,
              policy_profile_id, created_by_user_id, metadata)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, 'open', $6::text,
                   $7::uuid, $8::uuid, $9::jsonb)
           RETURNING id, org_id, workspace_id, name, purpose, status, governance_mode,
                     policy_profile_id, created_by_user_id, retention_class, metadata,
                     created_at, updated_at, closed_at, archived_at`,
          [
            workroomId,
            identity.org_id,
            body.workspace_id,
            body.name,
            purpose,
            governanceMode,
            policyProfileId,
            identity.user_id,
            JSON.stringify(metadata),
          ],
        );
        const workroomRow = workroomRes.rows[0]!;

        const participantRes = await client.query<{ added_at: Date }>(
          `INSERT INTO govai.workroom_participants
             (id, org_id, workroom_id, kind, role, user_id, status)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'human', 'human_owner', $4::uuid, 'active')
           RETURNING added_at`,
          [participantId, identity.org_id, workroomId, identity.user_id],
        );
        void participantRes;

        const occurredAt = new Date();
        const lifecyclePayload = {
          event_type: 'workroom.lifecycle' as const,
          schema_version: 1 as const,
          tenant_context: {
            org_id: identity.org_id,
            user_id: identity.user_id,
            tier: identity.tier,
            operational_mode: identity.operational_mode,
          },
          workroom_id: workroomId,
          workspace_id: body.workspace_id,
          governance_mode: governanceMode,
          transition: 'created' as const,
          status: 'open' as const,
          created_by_user_id: identity.user_id,
          policy_profile_id: policyProfileId,
          occurred_at: occurredAt.toISOString(),
          audit_event_id: randomUUID(),
          chain_category: 'run' as const,
        };
        const auditOut = await auditAppend(client, app.govai.kms, {
          orgId: identity.org_id,
          chainId: chainIdFor(identity.org_id, 'run'),
          eventType: 'workroom.lifecycle',
          eventVersion: '1',
          subjectType: 'workroom',
          subjectId: workroomId,
          occurredAt,
          payloadHash: sha256(Buffer.from(JSON.stringify(lifecyclePayload), 'utf8')),
          ...AUDIT_CHAIN_KEY,
          redactionMetadata: {
            workroom_lifecycle: { ...lifecyclePayload, audit_event_id: undefined },
          },
        });
        // Schema-validate the canonical event (with the real chain event id).
        WorkroomLifecycleSchema.parse({ ...lifecyclePayload, audit_event_id: auditOut.eventId });

        await client.query(
          `INSERT INTO govai.workroom_turns
             (id, org_id, workroom_id, turn_number, actor_participant_id, kind,
              occurred_at, audit_event_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 1, $4::uuid, 'state_transition',
                   $5::timestamptz, $6::uuid)`,
          [
            randomUUID(),
            identity.org_id,
            workroomId,
            participantId,
            occurredAt.toISOString(),
            auditOut.eventId,
          ],
        );

        await client.query('COMMIT');

        reply.code(201);
        return {
          workroom: serializeWorkroom(workroomRow),
          policy_profile: {
            id: policyProfileId,
            governance_mode: governanceMode,
            default_provider_surface: providerSurface,
            max_risk_without_approval: maxRisk,
          },
          first_participant: {
            id: participantId,
            kind: 'human',
            role: 'human_owner',
            user_id: identity.user_id,
            status: 'active',
          },
          governance_mode: governanceMode,
          audit_event_id: auditOut.eventId,
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        req.log.error(
          { err_name: err instanceof Error ? err.name : 'unknown', org_id: identity.org_id },
          'workroom create failed',
        );
        reply.code(500);
        return { error: 'internal_error' };
      }
    } finally {
      client.release();
    }
  });

  // ==========================================================================
  // GET /v1/workrooms/:id — fetch one workroom (RLS-scoped)
  // ==========================================================================
  app.get<{ Params: { id: string } }>('/v1/workrooms/:id', async (req, reply) => {
    const workroomId = req.params.id;
    if (typeof workroomId !== 'string' || !UUID_RE.test(workroomId)) {
      reply.code(400);
      return { error: 'invalid_workroom_id' };
    }

    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;

    const client = await app.govai.pool.connect();
    try {
      await client.query('BEGIN');
      try {
        await setLocalAppOrgId(client, identity.org_id);
        const r = await client.query<
          WorkroomRow & {
            pp_default_provider_surface: string;
            pp_max_risk_without_approval: string;
            pp_name: string;
          }
        >(
          `SELECT w.id, w.org_id, w.workspace_id, w.name, w.purpose, w.status,
                  w.governance_mode, w.policy_profile_id, w.created_by_user_id,
                  w.retention_class, w.metadata, w.created_at, w.updated_at,
                  w.closed_at, w.archived_at,
                  p.name AS pp_name,
                  p.default_provider_surface AS pp_default_provider_surface,
                  p.max_risk_without_approval AS pp_max_risk_without_approval
             FROM govai.workrooms w
             JOIN govai.workroom_policy_profiles p ON p.id = w.policy_profile_id
            WHERE w.id = $1::uuid`,
          [workroomId],
        );
        await client.query('COMMIT');

        const row = r.rows[0];
        // Cross-tenant rows are invisible under RLS → 404, never a data leak.
        if (!row) {
          reply.code(404);
          return { error: 'workroom_not_found' };
        }
        return {
          workroom: serializeWorkroom(row),
          policy_profile: {
            id: row.policy_profile_id,
            name: row.pp_name,
            governance_mode: row.governance_mode,
            default_provider_surface: row.pp_default_provider_surface,
            max_risk_without_approval: row.pp_max_risk_without_approval,
          },
          governance_mode: row.governance_mode,
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        req.log.error(
          { err_name: err instanceof Error ? err.name : 'unknown', org_id: identity.org_id },
          'workroom get failed',
        );
        reply.code(500);
        return { error: 'internal_error' };
      }
    } finally {
      client.release();
    }
  });

  // ==========================================================================
  // GET /v1/workrooms?status=... — list workrooms for the caller's org
  // ==========================================================================
  app.get('/v1/workrooms', async (req, reply) => {
    const parsed = ListQuery.safeParse(req.query);
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

        const conditions: string[] = [];
        const params: unknown[] = [];
        if (parsed.data.status) {
          params.push(parsed.data.status);
          conditions.push(`status = $${params.length}`);
        }
        if (parsed.data.workspace_id) {
          params.push(parsed.data.workspace_id);
          conditions.push(`workspace_id = $${params.length}::uuid`);
        }
        params.push(parsed.data.limit);
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const r = await client.query<WorkroomRow>(
          `SELECT id, org_id, workspace_id, name, purpose, status, governance_mode,
                  policy_profile_id, created_by_user_id, retention_class, metadata,
                  created_at, updated_at, closed_at, archived_at
             FROM govai.workrooms
             ${where}
            ORDER BY created_at DESC
            LIMIT $${params.length}`,
          params,
        );
        await client.query('COMMIT');

        return { data: r.rows.map(serializeWorkroom) };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        req.log.error(
          { err_name: err instanceof Error ? err.name : 'unknown', org_id: identity.org_id },
          'workroom list failed',
        );
        reply.code(500);
        return { error: 'internal_error' };
      }
    } finally {
      client.release();
    }
  });

  // ==========================================================================
  // POST /v1/workrooms/:id/participants — add a participant
  // ==========================================================================
  app.post<{ Params: { id: string } }>('/v1/workrooms/:id/participants', async (req, reply) => {
    const workroomId = req.params.id;
    if (typeof workroomId !== 'string' || !UUID_RE.test(workroomId)) {
      reply.code(400);
      return { error: 'invalid_workroom_id' };
    }

    const parsed = ParticipantBody.safeParse(req.body);
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
    const participantId = randomUUID();

    const client = await app.govai.pool.connect();
    try {
      await client.query('BEGIN');
      try {
        await setLocalAppOrgId(client, identity.org_id);

        const workroomRes = await client.query<{ governance_mode: string }>(
          'SELECT governance_mode FROM govai.workrooms WHERE id = $1::uuid',
          [workroomId],
        );
        const workroom = workroomRes.rows[0];
        if (!workroom) {
          await client.query('ROLLBACK').catch(() => undefined);
          reply.code(404);
          return { error: 'workroom_not_found' };
        }

        // Authorization: the caller must be an active human_owner participant
        // of this workroom, OR hold the admin role (explicit admin bootstrap
        // path). An arbitrary developer key cannot add participants.
        const ownerRes = await client.query<{ id: string }>(
          `SELECT id FROM govai.workroom_participants
            WHERE workroom_id = $1::uuid AND kind = 'human' AND role = 'human_owner'
              AND user_id = $2::uuid AND status = 'active'
            LIMIT 1`,
          [workroomId, identity.user_id],
        );
        const ownerParticipantId = ownerRes.rows[0]?.id ?? null;
        const isAdmin = hasAnyRole(identity.roles, ['admin']);
        if (!ownerParticipantId && !isAdmin) {
          await client.query('ROLLBACK').catch(() => undefined);
          reply.code(403);
          return {
            error: 'forbidden',
            message: 'only an active human_owner participant or an admin key may add participants',
          };
        }

        // Agent participants must reference an existing, enabled agent_profile
        // in the caller's org (RLS scopes the lookup to the tenant).
        if (body.kind === 'agent') {
          const profileRes = await client.query<{ is_disabled: boolean }>(
            'SELECT is_disabled FROM govai.agent_profiles WHERE id = $1::uuid',
            [body.agent_profile_id],
          );
          const profile = profileRes.rows[0];
          if (!profile) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(404);
            return { error: 'agent_profile_not_found' };
          }
          if (profile.is_disabled) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(400);
            return { error: 'agent_profile_disabled' };
          }
        }

        const permissionScope = body.permission_scope ?? {};
        try {
          await client.query(
            `INSERT INTO govai.workroom_participants
               (id, org_id, workroom_id, kind, role, user_id, agent_profile_id,
                permission_scope, added_by_participant_id, status)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::uuid, $7::uuid,
                     $8::jsonb, $9::uuid, 'active')`,
            [
              participantId,
              identity.org_id,
              workroomId,
              body.kind,
              body.role,
              body.kind === 'human' ? body.user_id : null,
              body.kind === 'agent' ? body.agent_profile_id : null,
              JSON.stringify(permissionScope),
              ownerParticipantId,
            ],
          );
        } catch (insErr) {
          // Partial-unique active-participant index → duplicate active member.
          if ((insErr as { code?: string }).code === '23505') {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(409);
            return { error: 'participant_already_active' };
          }
          throw insErr;
        }

        const occurredAt = new Date();
        const participantPayload = {
          event_type: 'workroom.participant' as const,
          schema_version: 1 as const,
          tenant_context: {
            org_id: identity.org_id,
            user_id: identity.user_id,
            tier: identity.tier,
            operational_mode: identity.operational_mode,
          },
          workroom_id: workroomId,
          workroom_governance_mode: workroom.governance_mode as 'governance_active' | 'audit_only',
          participant_id: participantId,
          participant_kind: body.kind,
          participant_role: body.role,
          transition: 'added' as const,
          actor_user_id: identity.user_id,
          occurred_at: occurredAt.toISOString(),
          audit_event_id: randomUUID(),
          chain_category: 'admin' as const,
        };
        const auditOut = await auditAppend(client, app.govai.kms, {
          orgId: identity.org_id,
          chainId: chainIdFor(identity.org_id, 'admin'),
          eventType: 'workroom.participant',
          eventVersion: '1',
          subjectType: 'workroom_participant',
          subjectId: participantId,
          occurredAt,
          payloadHash: sha256(Buffer.from(JSON.stringify(participantPayload), 'utf8')),
          ...AUDIT_CHAIN_KEY,
          redactionMetadata: {
            workroom_participant: { ...participantPayload, audit_event_id: undefined },
          },
        });
        WorkroomParticipantSchema.parse({
          ...participantPayload,
          audit_event_id: auditOut.eventId,
        });

        const turnNumber = await nextTurnNumber(client, workroomId);
        await client.query(
          `INSERT INTO govai.workroom_turns
             (id, org_id, workroom_id, turn_number, actor_participant_id, kind,
              occurred_at, audit_event_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::uuid, 'participant_change',
                   $6::timestamptz, $7::uuid)`,
          [
            randomUUID(),
            identity.org_id,
            workroomId,
            turnNumber,
            ownerParticipantId,
            occurredAt.toISOString(),
            auditOut.eventId,
          ],
        );

        await client.query('COMMIT');

        reply.code(201);
        return {
          participant: {
            id: participantId,
            workroom_id: workroomId,
            kind: body.kind,
            role: body.role,
            user_id: body.kind === 'human' ? body.user_id : null,
            agent_profile_id: body.kind === 'agent' ? body.agent_profile_id : null,
            status: 'active',
          },
          audit_event_id: auditOut.eventId,
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        req.log.error(
          { err_name: err instanceof Error ? err.name : 'unknown', org_id: identity.org_id },
          'workroom add participant failed',
        );
        reply.code(500);
        return { error: 'internal_error' };
      }
    } finally {
      client.release();
    }
  });

  // ==========================================================================
  // DELETE /v1/workrooms/:id/participants/:participantId — remove a participant
  // ==========================================================================
  app.delete<{ Params: { id: string; participantId: string } }>(
    '/v1/workrooms/:id/participants/:participantId',
    async (req, reply) => {
      const workroomId = req.params.id;
      const participantId = req.params.participantId;
      if (
        typeof workroomId !== 'string' ||
        !UUID_RE.test(workroomId) ||
        typeof participantId !== 'string' ||
        !UUID_RE.test(participantId)
      ) {
        reply.code(400);
        return { error: 'invalid_participant_id' };
      }

      const identity = await authenticate(app, req, reply);
      if (!identity) return reply;

      const client = await app.govai.pool.connect();
      try {
        await client.query('BEGIN');
        try {
          await setLocalAppOrgId(client, identity.org_id);

          const workroomRes = await client.query<{ governance_mode: string }>(
            'SELECT governance_mode FROM govai.workrooms WHERE id = $1::uuid',
            [workroomId],
          );
          const workroom = workroomRes.rows[0];
          if (!workroom) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(404);
            return { error: 'workroom_not_found' };
          }

          // Removal is restricted to an active human_owner participant. There
          // is no admin override for removal in Phase 1.
          const ownerRes = await client.query<{ id: string }>(
            `SELECT id FROM govai.workroom_participants
              WHERE workroom_id = $1::uuid AND kind = 'human' AND role = 'human_owner'
                AND user_id = $2::uuid AND status = 'active'
              LIMIT 1`,
            [workroomId, identity.user_id],
          );
          const ownerParticipantId = ownerRes.rows[0]?.id ?? null;
          if (!ownerParticipantId) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(403);
            return {
              error: 'forbidden',
              message: 'only an active human_owner participant may remove participants',
            };
          }

          const targetRes = await client.query<{
            kind: string;
            role: string;
            status: string;
          }>(
            `SELECT kind, role, status FROM govai.workroom_participants
              WHERE id = $1::uuid AND workroom_id = $2::uuid`,
            [participantId, workroomId],
          );
          const target = targetRes.rows[0];
          // Cross-tenant rows are invisible under RLS → 404, never a leak.
          if (!target) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(404);
            return { error: 'participant_not_found' };
          }
          if (target.status === 'removed') {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(409);
            return { error: 'participant_already_removed' };
          }

          await client.query(
            `UPDATE govai.workroom_participants
                SET status = 'removed', removed_at = now()
              WHERE id = $1::uuid AND workroom_id = $2::uuid`,
            [participantId, workroomId],
          );

          const occurredAt = new Date();
          const participantPayload = {
            event_type: 'workroom.participant' as const,
            schema_version: 1 as const,
            tenant_context: {
              org_id: identity.org_id,
              user_id: identity.user_id,
              tier: identity.tier,
              operational_mode: identity.operational_mode,
            },
            workroom_id: workroomId,
            workroom_governance_mode: workroom.governance_mode as
              | 'governance_active'
              | 'audit_only',
            participant_id: participantId,
            participant_kind: target.kind as 'human' | 'agent',
            participant_role: target.role as z.infer<typeof WorkroomParticipantRole>,
            transition: 'removed' as const,
            actor_user_id: identity.user_id,
            occurred_at: occurredAt.toISOString(),
            audit_event_id: randomUUID(),
            chain_category: 'admin' as const,
          };
          const auditOut = await auditAppend(client, app.govai.kms, {
            orgId: identity.org_id,
            chainId: chainIdFor(identity.org_id, 'admin'),
            eventType: 'workroom.participant',
            eventVersion: '1',
            subjectType: 'workroom_participant',
            subjectId: participantId,
            occurredAt,
            payloadHash: sha256(Buffer.from(JSON.stringify(participantPayload), 'utf8')),
            ...AUDIT_CHAIN_KEY,
            redactionMetadata: {
              workroom_participant: { ...participantPayload, audit_event_id: undefined },
            },
          });
          WorkroomParticipantSchema.parse({
            ...participantPayload,
            audit_event_id: auditOut.eventId,
          });

          const turnNumber = await nextTurnNumber(client, workroomId);
          await client.query(
            `INSERT INTO govai.workroom_turns
               (id, org_id, workroom_id, turn_number, actor_participant_id, kind,
                occurred_at, audit_event_id)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::uuid, 'participant_change',
                     $6::timestamptz, $7::uuid)`,
            [
              randomUUID(),
              identity.org_id,
              workroomId,
              turnNumber,
              ownerParticipantId,
              occurredAt.toISOString(),
              auditOut.eventId,
            ],
          );

          await client.query('COMMIT');

          reply.code(204);
          reply.send();
          return reply;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          req.log.error(
            { err_name: err instanceof Error ? err.name : 'unknown', org_id: identity.org_id },
            'workroom remove participant failed',
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
