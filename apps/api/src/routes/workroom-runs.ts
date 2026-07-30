// /v1/workrooms/{id}/runs — Workroom Phase 3: Workroom-owned runs (issue #53).
//
// The parent edge from a Workroom to the canonical run primitive
// (architecture: docs/architecture/workroom-governance-room.md, umbrella #33).
//
// Scope (Phase 3):
//   - POST /v1/workrooms/{id}/runs
//   - GET  /v1/workrooms/{id}/runs
//
// A Workroom-owned run reuses the existing run orchestrator (`executeGovernedRun`
// / `executePassthroughRun`) with an optional `WorkroomRunContext`. The
// orchestrator persists the Workroom-linkage columns on `govai.runs` and
// creates exactly one `workroom_turns` row (`kind='run_event'`) anchored to the
// run's real terminal audit event — all in the same run transaction. `/v1/runs`
// remains the canonical execution primitive; standalone runs are unchanged.
//
// Mode matrix: a `governance_active` Workroom defaults runs to `governed` and
// rejects a `passthrough` override (approvals are Phase 4); an `audit_only`
// Workroom defaults to `passthrough` and admits `governed` as a stricter
// upgrade. `shadow` is out of scope for Workroom-owned runs. The chosen
// relation is reported as a single `mode_relation` field.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { hasAnyRole } from '@govai/core-identity';
import { authenticateApiKey, AuthError, type AuthIdentity } from '../pipeline/auth.js';
import { MissingProviderKeyError } from '../pipeline/provider-credentials.js';
import {
  executeGovernedRun,
  executePassthroughRun,
  validateApprovalForRun,
  CapabilityNotSupportedError,
  CapabilityNotRegisteredError,
  WorkroomRunContextInvalidError,
  WorkroomApprovalInvalidError,
  type RunRequest,
  type WorkroomRunContext,
  type ApprovalConsumptionContext,
  type ApprovalRowForValidation,
  type IntendedPassthroughAction,
  type WorkroomApprovalInvalidCode,
} from '../pipeline/run-orchestrator.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RunStatus = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'denied',
  'outcome_unknown',
  'awaiting_approval',
]);

const CreateRunBody = z.object({
  capability: z.string().min(1).max(200),
  model: z.string().min(1),
  input: z.string().min(1).max(50_000),
  mode: z.enum(['governed', 'passthrough', 'shadow']).optional(),
  workroom_task_id: z.string().uuid().optional(),
  // Workroom Phase 4: authorizes a `governance_active` passthrough override.
  // Consulted only on that path; ignored for governed / audit_only runs.
  approval_request_id: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// Keyset pagination is deterministic: the cursor is the (created_at, id) of the
// last returned row. Both cursor fields are required together — a created_at
// alone is non-deterministic when rows share a timestamp.
const ListRunsQuery = z
  .object({
    status: RunStatus.optional(),
    mode: z.enum(['governed', 'passthrough', 'shadow']).optional(),
    workroom_task_id: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before_created_at: z.string().datetime().optional(),
    before_id: z.string().uuid().optional(),
  })
  .refine((d) => (d.before_created_at === undefined) === (d.before_id === undefined), {
    message: 'before_created_at and before_id must be provided together',
    path: ['before_id'],
  });

type GovernanceMode = 'governance_active' | 'audit_only';
type ModeRelation =
  | 'defaulted'
  | 'explicit'
  | 'upgrade'
  | 'override_denied'
  | 'override_approved';

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

async function getWorkroom(
  client: PoolClient,
  workroomId: string,
): Promise<{ id: string; governance_mode: GovernanceMode; workspace_id: string } | null> {
  const r = await client.query<{
    id: string;
    governance_mode: GovernanceMode;
    workspace_id: string;
  }>('SELECT id, governance_mode, workspace_id FROM govai.workrooms WHERE id = $1::uuid', [
    workroomId,
  ]);
  return r.rows[0] ?? null;
}

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

/**
 * Apply the Phase 3 mode matrix, extended by Phase 4. Returns the resolved run
 * mode + the single `mode_relation` annotation, or a rejection.
 *
 * Phase 4 changes ONE cell: a `passthrough` override in a `governance_active`
 * Workroom. Without an `approval_request_id` the Phase 3 rejection
 * (`override_denied`) still stands; with one it resolves to `override_approved`
 * and the caller validates + consumes the approval. Every other cell —
 * defaulted / explicit / upgrade / shadow rejection — is unchanged.
 */
function resolveRunMode(
  governanceMode: GovernanceMode,
  requestedMode: 'governed' | 'passthrough' | 'shadow' | undefined,
  hasApprovalRequestId: boolean,
):
  | { ok: true; mode: 'governed' | 'passthrough'; mode_relation: 'defaulted' | 'explicit' | 'upgrade' }
  | { ok: true; mode: 'passthrough'; mode_relation: 'override_approved' }
  | { ok: false; error: string; mode_relation: 'override_denied' } {
  if (requestedMode === 'shadow') {
    return {
      ok: false,
      error: 'workroom_run_shadow_mode_out_of_scope',
      mode_relation: 'override_denied',
    };
  }
  if (governanceMode === 'governance_active') {
    if (requestedMode === undefined) return { ok: true, mode: 'governed', mode_relation: 'defaulted' };
    if (requestedMode === 'governed') return { ok: true, mode: 'governed', mode_relation: 'explicit' };
    // requestedMode === 'passthrough' — a mode override. Phase 4: admitted only
    // when an approval is presented; without one the Phase 3 rejection stands.
    if (!hasApprovalRequestId) {
      return {
        ok: false,
        error: 'workroom_run_mode_override_requires_approval',
        mode_relation: 'override_denied',
      };
    }
    return { ok: true, mode: 'passthrough', mode_relation: 'override_approved' };
  }
  // audit_only
  if (requestedMode === undefined) return { ok: true, mode: 'passthrough', mode_relation: 'defaulted' };
  if (requestedMode === 'passthrough') {
    return { ok: true, mode: 'passthrough', mode_relation: 'explicit' };
  }
  // requestedMode === 'governed' — a stricter execution choice, always allowed.
  return { ok: true, mode: 'governed', mode_relation: 'upgrade' };
}

/**
 * Preliminary approval validation, in its own read transaction — a fast clean
 * 4xx before the orchestrator is invoked. The orchestrator re-validates the
 * same row under a `FOR UPDATE` lock (TOCTOU) and is the authoritative gate;
 * this preflight never mutates anything.
 */
async function preflightApproval(
  app: FastifyInstance,
  orgId: string,
  approvalRequestId: string,
  workroomId: string,
  action: IntendedPassthroughAction,
): Promise<{ ok: true } | { ok: false; code: WorkroomApprovalInvalidCode }> {
  const client = await app.govai.pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await setLocalAppOrgId(client, orgId);
      const r = await client.query<ApprovalRowForValidation>(
        `SELECT status, subject_kind, workroom_id, consumed_at, expires_at, intended_action_hash
           FROM govai.workroom_approval_requests
          WHERE id = $1::uuid AND org_id = $2::uuid`,
        [approvalRequestId, orgId],
      );
      await client.query('COMMIT');
      return validateApprovalForRun(r.rows[0] ?? null, { workroomId, action });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  } finally {
    client.release();
  }
}

export async function workroomRunsRoute(app: FastifyInstance): Promise<void> {
  // ==========================================================================
  // POST /v1/workrooms/:id/runs — create a Workroom-owned run
  // ==========================================================================
  app.post<{ Params: { id: string } }>('/v1/workrooms/:id/runs', async (req, reply) => {
    const workroomId = req.params.id;
    if (typeof workroomId !== 'string' || !UUID_RE.test(workroomId)) {
      reply.code(400);
      return { error: 'invalid_workroom_id' };
    }
    const parsed = CreateRunBody.safeParse(req.body);
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

    // Validation reads (workroom, participant, task) under the tenant context.
    // The run + turn write happens atomically inside the orchestrator's own
    // transaction; these reads only gate admission.
    let workroom: { id: string; governance_mode: GovernanceMode; workspace_id: string };
    let participantId: string;
    {
      const client = await app.govai.pool.connect();
      try {
        await client.query('BEGIN');
        try {
          await setLocalAppOrgId(client, identity.org_id);
          const w = await getWorkroom(client, workroomId);
          if (!w) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(404);
            return { error: 'workroom_not_found' };
          }
          const pid = await getActiveParticipant(client, workroomId, identity.user_id);
          if (!pid) {
            await client.query('ROLLBACK').catch(() => undefined);
            reply.code(403);
            return {
              error: 'forbidden',
              message: 'caller must be an active participant of the workroom',
            };
          }
          if (body.workroom_task_id) {
            const t = await client.query<{ id: string }>(
              'SELECT id FROM govai.workroom_tasks WHERE id = $1::uuid AND workroom_id = $2::uuid',
              [body.workroom_task_id, workroomId],
            );
            if (!t.rows[0]) {
              await client.query('ROLLBACK').catch(() => undefined);
              reply.code(404);
              return { error: 'workroom_task_not_found' };
            }
          }
          await client.query('COMMIT');
          workroom = w;
          participantId = pid;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw err;
        }
      } finally {
        client.release();
      }
    }

    // Phase 3 mode matrix (Phase 4-extended). Rejected overrides return before
    // any run/turn is created — no `govai.runs` row, no `workroom_turns` row.
    const modeDecision = resolveRunMode(
      workroom.governance_mode,
      body.mode,
      body.approval_request_id !== undefined,
    );
    if (!modeDecision.ok) {
      reply.code(403);
      return {
        error: modeDecision.error,
        mode_relation: modeDecision.mode_relation satisfies ModeRelation,
        workroom_id: workroomId,
        workroom_governance_mode: workroom.governance_mode,
      };
    }

    // Workroom Phase 4: an `override_approved` decision must present a valid
    // approval. The preflight gives a fast clean 4xx; the orchestrator then
    // re-validates under a row lock and consumes the approval atomically with
    // the run. An invalid approval here means no run row and no turn.
    let approvalContext: ApprovalConsumptionContext | undefined;
    if (modeDecision.mode_relation === 'override_approved') {
      const approvalRequestId = body.approval_request_id!;
      const preflight = await preflightApproval(app, identity.org_id, approvalRequestId, workroomId, {
        mode: 'passthrough',
        capability: body.capability,
        model: body.model,
        input: body.input,
        workspace_id: workroom.workspace_id,
      });
      if (!preflight.ok) {
        reply.code(preflight.code === 'workroom_approval_not_found' ? 404 : 403);
        return {
          error: preflight.code,
          mode_relation: 'override_denied' satisfies ModeRelation,
          workroom_id: workroomId,
          workroom_governance_mode: workroom.governance_mode,
        };
      }
      approvalContext = { approval_request_id: approvalRequestId };
    }

    const runRequest: RunRequest = {
      workspace_id: workroom.workspace_id,
      capability: body.capability,
      model: body.model,
      input: body.input,
      mode: modeDecision.mode,
      ...(body.metadata ? { metadata: body.metadata } : {}),
    };
    const workroomContext: WorkroomRunContext = {
      workroom_id: workroomId,
      workroom_task_id: body.workroom_task_id ?? null,
      created_by_participant_id: participantId,
      workroom_governance_mode: workroom.governance_mode,
      approval_policy_id: null,
    };
    const deps = {
      pool: app.govai.pool,
      kms: app.govai.kms,
      env: app.govai.env,
      policyCommitSha: app.govai.policyCommitSha,
    };
    const apiKey = extractApiKey(req);

    try {
      const result =
        modeDecision.mode === 'governed'
          ? await executeGovernedRun(deps, apiKey, runRequest, workroomContext)
          : await executePassthroughRun(deps, apiKey, runRequest, workroomContext, approvalContext);

      // Read back the run_event turn the orchestrator created in the run
      // transaction — exactly one exists per Workroom-owned run.
      let turnId: string;
      let turnNumber: number;
      {
        const client = await app.govai.pool.connect();
        try {
          await client.query('BEGIN');
          await setLocalAppOrgId(client, identity.org_id);
          const t = await client.query<{ id: string; turn_number: string }>(
            `SELECT id, turn_number FROM govai.workroom_turns
              WHERE workroom_id = $1::uuid AND kind = 'run_event' AND payload_ref = $2::uuid`,
            [workroomId, result.run_id],
          );
          await client.query('COMMIT');
          if (t.rows.length !== 1) {
            // Atomicity invariant: a committed Workroom-owned run always has
            // exactly one run_event turn.
            throw new Error(
              `workroom-owned run ${result.run_id} has ${t.rows.length} run_event turns`,
            );
          }
          turnId = t.rows[0]!.id;
          turnNumber = Number(t.rows[0]!.turn_number);
        } finally {
          client.release();
        }
      }

      reply.code(201);
      return {
        run_id: result.run_id,
        status: result.status,
        mode: modeDecision.mode,
        mode_relation: modeDecision.mode_relation satisfies ModeRelation,
        workroom_id: workroomId,
        workroom_task_id: body.workroom_task_id ?? null,
        created_by_participant_id: participantId,
        workroom_governance_mode: workroom.governance_mode,
        workroom_turn_id: turnId,
        turn_number: turnNumber,
        // F3: absent on outcome_unknown (minimal contract) — the turn anchors
        // the run.outcome_unknown lifecycle event in that case.
        ...(result.audit_event_id ? { audit_event_id: result.audit_event_id } : {}),
        audit_chain_id: result.audit_chain_id,
        ...(result.status === 'outcome_unknown'
          ? { retry_safe: false, error_class: 'dispatch_outcome_unknown' }
          : {}),
        ...(approvalContext
          ? { approval_request_id: approvalContext.approval_request_id }
          : {}),
        ...('policy_decision' in result ? { policy_decision: result.policy_decision } : {}),
        ...(result.provider_invocation_id
          ? { provider_invocation_id: result.provider_invocation_id }
          : {}),
        ...('output' in result && result.output !== undefined ? { output: result.output } : {}),
      };
    } catch (err) {
      if (err instanceof AuthError) {
        reply.code(err.status);
        return { error: 'auth_error', message: err.message };
      }
      if (err instanceof CapabilityNotSupportedError) {
        reply.code(403);
        return { error: 'capability_not_supported', capability: err.capabilityId };
      }
      if (err instanceof CapabilityNotRegisteredError) {
        reply.code(404);
        return { error: 'capability_not_registered', capability: err.capabilityId };
      }
      // TOCTOU: the Workroom context went stale between preflight and the run
      // write transaction. No run row and no turn were committed.
      if (err instanceof WorkroomRunContextInvalidError) {
        reply.code(err.code === 'workroom_task_not_found' ? 404 : 403);
        return { error: err.code };
      }
      // TOCTOU: the authorizing approval changed (consumed / revoked / expired)
      // between the route preflight and the run write transaction. ROLLBACK
      // committed no run row and no turn, and the approval was not consumed.
      if (err instanceof WorkroomApprovalInvalidError) {
        reply.code(err.code === 'workroom_approval_not_found' ? 404 : 403);
        return {
          error: err.code,
          mode_relation: 'override_denied' satisfies ModeRelation,
          workroom_id: workroomId,
          workroom_governance_mode: workroom.governance_mode,
        };
      }
      // F3: the credential resolves BEFORE TX-A, so a missing/undecryptable
      // credential is a clean pre-run 502 — no run row, no turn, no provider call.
      if (err instanceof MissingProviderKeyError) {
        reply.code(502);
        return {
          error: 'provider_credential_unresolvable',
          provider: err.provider,
          reason: err.reason,
        };
      }
      req.log.error(
        { err_name: err instanceof Error ? err.name : 'unknown', org_id: identity.org_id },
        'workroom-owned run creation failed',
      );
      reply.code(500);
      return { error: 'internal_error' };
    }
  });

  // ==========================================================================
  // GET /v1/workrooms/:id/runs — list Workroom-owned runs
  // ==========================================================================
  app.get<{ Params: { id: string } }>('/v1/workrooms/:id/runs', async (req, reply) => {
    const workroomId = req.params.id;
    if (typeof workroomId !== 'string' || !UUID_RE.test(workroomId)) {
      reply.code(400);
      return { error: 'invalid_workroom_id' };
    }
    const parsed = ListRunsQuery.safeParse(req.query);
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
        let where = 'r.workroom_id = $1::uuid';
        if (parsed.data.status) {
          params.push(parsed.data.status);
          where += ` AND r.status = $${params.length}`;
        }
        if (parsed.data.mode) {
          params.push(parsed.data.mode);
          where += ` AND r.mode = $${params.length}`;
        }
        if (parsed.data.workroom_task_id) {
          params.push(parsed.data.workroom_task_id);
          where += ` AND r.workroom_task_id = $${params.length}::uuid`;
        }
        // Deterministic keyset cursor: (created_at, id) tiebreaker so rows that
        // share a created_at remain reachable and never duplicate across pages.
        if (parsed.data.before_created_at && parsed.data.before_id) {
          params.push(parsed.data.before_created_at);
          const tsIdx = params.length;
          params.push(parsed.data.before_id);
          const idIdx = params.length;
          where +=
            ` AND (r.created_at < $${tsIdx}::timestamptz` +
            ` OR (r.created_at = $${tsIdx}::timestamptz AND r.id < $${idIdx}::uuid))`;
        }
        params.push(parsed.data.limit);
        const r = await client.query<{
          id: string;
          status: string;
          mode: string;
          risk_level: string;
          workspace_id: string;
          assistant_id: string | null;
          provider: string;
          model: string;
          workroom_id: string;
          workroom_task_id: string | null;
          created_by_participant_id: string | null;
          workroom_governance_mode: string | null;
          created_at: Date;
          completed_at: Date | null;
          workroom_turn_id: string | null;
          turn_number: string | null;
          audit_event_id: string | null;
        }>(
          `SELECT r.id, r.status, r.mode, r.risk_level, r.workspace_id, r.assistant_id,
                  r.provider, r.model, r.workroom_id, r.workroom_task_id,
                  r.created_by_participant_id, r.workroom_governance_mode,
                  r.created_at, r.completed_at,
                  wt.id AS workroom_turn_id, wt.turn_number, wt.audit_event_id
             FROM govai.runs r
             LEFT JOIN govai.workroom_turns wt
               ON wt.payload_ref = r.id AND wt.kind = 'run_event'
              AND wt.workroom_id = r.workroom_id
            WHERE ${where}
            ORDER BY r.created_at DESC, r.id DESC
            LIMIT $${params.length}`,
          params,
        );
        await client.query('COMMIT');

        const runs = r.rows.map((row) => ({
          run_id: row.id,
          status: row.status,
          mode: row.mode,
          risk_level: row.risk_level,
          workspace_id: row.workspace_id,
          assistant_id: row.assistant_id,
          provider: row.provider,
          model: row.model,
          workroom_id: row.workroom_id,
          workroom_task_id: row.workroom_task_id,
          created_by_participant_id: row.created_by_participant_id,
          workroom_governance_mode: row.workroom_governance_mode,
          workroom_turn_id: row.workroom_turn_id,
          turn_number: row.turn_number === null ? null : Number(row.turn_number),
          audit_event_id: row.audit_event_id,
          created_at: row.created_at.toISOString(),
          completed_at: row.completed_at ? row.completed_at.toISOString() : null,
        }));
        // More rows likely remain when the page is full; the cursor is the
        // (created_at, id) of the last returned row.
        const lastRun = runs.length === parsed.data.limit ? runs[runs.length - 1]! : null;
        const nextCursor = lastRun
          ? { before_created_at: lastRun.created_at, before_id: lastRun.run_id }
          : null;

        return {
          workroom_id: workroomId,
          workroom_governance_mode: workroom.governance_mode,
          runs,
          next_cursor: nextCursor,
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        req.log.error(
          { err_name: err instanceof Error ? err.name : 'unknown', org_id: identity.org_id },
          'workroom run list failed',
        );
        reply.code(500);
        return { error: 'internal_error' };
      }
    } finally {
      client.release();
    }
  });
}
