// P0.3-C (EP-P03C) — cross-request governed run execution idempotency.
//
// Same tenant + same X-GovAI-Run-Idempotency-Key + same canonical semantic
// execution intent ⇒ ONE durable logical run, at most one LOCAL provider
// forward for that intent, and every matching replay reuses the durable run.
// Same key + a DIFFERENT canonical intent ⇒ HTTP 409 `idempotency_key_conflict`
// with zero second committed run / provider dispatch / approval consumption.
//
// This is NOT provider-side idempotency: the guarantee is that GovAI will not
// intentionally launch a second local provider execution for a matching
// tenant-scoped keyed execution intent. Provider receipt/execution stay
// at-most-once per run (F3), never exactly-once.
//
// Deliberately SEPARATE from the AuditBridge `X-GovAI-Idempotency-Key`
// (direct-route evidence-capture identity, `request-identity.ts`): this module
// is the execution-idempotency ingress for `/v1/runs` and
// `/v1/workrooms/:id/runs` only, and never touches `requestIdentityAls`.
//
// Correspondence identity is the canonical `govai.run_execution_intent.v1`
// projection — NOT `provider_invocations.native_request_hash`, which encodes
// only the provider-native (post-DLP/redaction) body and cannot distinguish
// the full GovAI logical intent (actor, metadata, Workroom task, approval
// provenance, original pre-redaction input).

import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { chainIdFor } from '@govai/core-events';

export const RUN_IDEMPOTENCY_HEADER = 'x-govai-run-idempotency-key';
export const RUN_INTENT_CONTRACT = 'govai.run_execution_intent.v1';
export const RUN_INTENT_HASH_VERSION = 1;
const MAX_RUN_IDEMPOTENCY_KEY_LEN = 256;

export type RunRouteScope = 'standalone' | 'workroom';

/** Malformed `X-GovAI-Run-Idempotency-Key` — the route maps this to HTTP 400
 *  `invalid_run_idempotency_key`. Message never contains the key value. */
export class InvalidRunIdempotencyKeyError extends Error {
  readonly code = 'invalid_run_idempotency_key';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRunIdempotencyKeyError';
  }
}

/** The key is committed to a DIFFERENT canonical execution intent — the route
 *  maps this to HTTP 409 with a static body. Never carries the key, any hash,
 *  the stored request or another actor's details. */
export class RunIdempotencyConflictError extends Error {
  readonly code = 'idempotency_key_conflict';
  constructor() {
    super('idempotency key is already bound to a different execution intent');
    this.name = 'RunIdempotencyConflictError';
  }
}

/** Internal control-flow signal: this transaction LOST the TX-A idempotency
 *  reservation to a concurrent contender. The orchestrator rolls the candidate
 *  transaction back and answers from the committed binding (replay or 409).
 *  Never route-visible. */
export class RunIdempotencyLoserSignal extends Error {
  constructor() {
    super('run idempotency reservation lost');
    this.name = 'RunIdempotencyLoserSignal';
  }
}

/** True if `s` contains any ASCII control character (C0 range or DEL). */
function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Parse + normalize the OPTIONAL execution-idempotency header. Returns null
 * when absent; the sha256 (32 raw bytes) of the trimmed UTF-8 key when valid;
 * throws InvalidRunIdempotencyKeyError when malformed or ambiguous. The raw
 * key is never persisted, logged or forwarded — only this hash exists beyond
 * the parse.
 *
 * `rawHeaders` is `req.raw.rawHeaders` (flat name/value pairs): Node joins
 * repeated regular headers with ', ' before they reach `req.headers`, so the
 * raw list is the only reliable way to detect an ambiguous multi-valued send
 * without falsely rejecting a single value that happens to contain a comma.
 */
export function parseRunIdempotencyKey(
  headerValue: string | string[] | undefined,
  rawHeaders: ReadonlyArray<string>,
): Buffer | null {
  let occurrences = 0;
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    if (rawHeaders[i]!.toLowerCase() === RUN_IDEMPOTENCY_HEADER) occurrences += 1;
  }
  if (occurrences > 1 || Array.isArray(headerValue)) {
    throw new InvalidRunIdempotencyKeyError(
      'X-GovAI-Run-Idempotency-Key must be supplied at most once',
    );
  }
  if (headerValue === undefined) return null;
  const normalized = headerValue.trim();
  if (normalized.length === 0) {
    throw new InvalidRunIdempotencyKeyError(
      'X-GovAI-Run-Idempotency-Key must not be empty after trim',
    );
  }
  if (normalized.length > MAX_RUN_IDEMPOTENCY_KEY_LEN) {
    throw new InvalidRunIdempotencyKeyError(
      `X-GovAI-Run-Idempotency-Key must be at most ${MAX_RUN_IDEMPOTENCY_KEY_LEN} characters`,
    );
  }
  if (hasControlChars(normalized)) {
    throw new InvalidRunIdempotencyKeyError(
      'X-GovAI-Run-Idempotency-Key must not contain control characters',
    );
  }
  return createHash('sha256').update(normalized, 'utf8').digest();
}

// =============================================================================
// RunExecutionIntentV1 — the canonical semantic execution-intent projection.
// =============================================================================

export type StandaloneRunExecutionIntentV1 = {
  contract: typeof RUN_INTENT_CONTRACT;
  route_scope: 'standalone';
  actor_user_id: string;
  workspace_id: string;
  capability: string;
  model: string;
  input: string;
  resolved_mode: 'governed' | 'passthrough';
  metadata: Record<string, unknown>;
};

export type WorkroomRunExecutionIntentV1 = {
  contract: typeof RUN_INTENT_CONTRACT;
  route_scope: 'workroom';
  actor_user_id: string;
  created_by_participant_id: string;
  workroom_id: string;
  workroom_task_id: string | null;
  workroom_governance_mode: 'governance_active' | 'audit_only';
  workspace_id: string;
  capability: string;
  model: string;
  input: string;
  resolved_mode: 'governed' | 'passthrough';
  metadata: Record<string, unknown>;
  /** The approval_request_id when that approval IS the authorization mechanism
   *  for the run (`override_approved`); canonical null otherwise. Binds replay
   *  to authorization provenance: same action under a different approval — or
   *  with the approval omitted after the original consumed one — conflicts. */
  effective_approval_request_id: string | null;
};

export type RunExecutionIntentV1 =
  | StandaloneRunExecutionIntentV1
  | WorkroomRunExecutionIntentV1;

/**
 * Deterministic canonical JSON: object keys recursively sorted, array order
 * preserved, `undefined` serialized as null, UTF-8, independent of JavaScript
 * insertion order. VERSION-FROZEN for `govai.run_execution_intent.v1` —
 * changing this changes every committed request_canonical_hash. Local to run
 * idempotency on purpose: never reuse evidence/core-audit canonicalization.
 */
export function stableCanonicalJson(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableCanonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableCanonicalJson(obj[k])}`)
    .join(',')}}`;
}

/** request_canonical_hash = SHA256(UTF8(stableCanonicalJson(intent))). */
export function runIntentHash(intent: RunExecutionIntentV1): Buffer {
  return createHash('sha256').update(stableCanonicalJson(intent), 'utf8').digest();
}

/** Build the standalone-route intent. Omitted metadata normalizes to {}. */
export function buildStandaloneRunIntent(input: {
  actorUserId: string;
  workspaceId: string;
  capability: string;
  model: string;
  input: string;
  resolvedMode: 'governed' | 'passthrough';
  metadata: Record<string, unknown> | undefined;
}): StandaloneRunExecutionIntentV1 {
  return {
    contract: RUN_INTENT_CONTRACT,
    route_scope: 'standalone',
    actor_user_id: input.actorUserId,
    workspace_id: input.workspaceId,
    capability: input.capability,
    model: input.model,
    input: input.input,
    resolved_mode: input.resolvedMode,
    metadata: input.metadata ?? {},
  };
}

/** Build the Workroom-route intent. The ONE builder shared by the route-level
 *  committed-replay probe and the orchestrator so the projection cannot drift. */
export function buildWorkroomRunIntent(input: {
  actorUserId: string;
  createdByParticipantId: string;
  workroomId: string;
  workroomTaskId: string | null;
  workroomGovernanceMode: 'governance_active' | 'audit_only';
  workspaceId: string;
  capability: string;
  model: string;
  input: string;
  resolvedMode: 'governed' | 'passthrough';
  metadata: Record<string, unknown> | undefined;
  effectiveApprovalRequestId: string | null;
}): WorkroomRunExecutionIntentV1 {
  return {
    contract: RUN_INTENT_CONTRACT,
    route_scope: 'workroom',
    actor_user_id: input.actorUserId,
    created_by_participant_id: input.createdByParticipantId,
    workroom_id: input.workroomId,
    workroom_task_id: input.workroomTaskId,
    workroom_governance_mode: input.workroomGovernanceMode,
    workspace_id: input.workspaceId,
    capability: input.capability,
    model: input.model,
    input: input.input,
    resolved_mode: input.resolvedMode,
    metadata: input.metadata ?? {},
    effective_approval_request_id: input.effectiveApprovalRequestId,
  };
}

// =============================================================================
// Durable binding access — govai.run_idempotency (migration 0030).
// =============================================================================

/** The execution-idempotency context a route threads into an executor when the
 *  header is present. Only the hash crosses this boundary — never the raw key. */
export type RunIdempotencyExecution = {
  keyHash: Buffer;
};

export type RunIdempotencyBinding = {
  runId: string;
  requestCanonicalHash: Buffer;
  routeScope: RunRouteScope;
};

/** Read the COMMITTED binding for (org, key), if any — own short read
 *  transaction under the tenant RLS context. */
export async function findCommittedBinding(
  pool: Pool,
  orgId: string,
  keyHash: Buffer,
): Promise<RunIdempotencyBinding | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await setLocalAppOrgId(client, orgId);
      const r = await client.query<{
        run_id: string;
        request_canonical_hash: Buffer;
        route_scope: string;
      }>(
        `SELECT run_id, request_canonical_hash, route_scope
           FROM govai.run_idempotency
          WHERE org_id = $1::uuid AND idempotency_key_hash = $2::bytea`,
        [orgId, keyHash],
      );
      await client.query('COMMIT');
      const row = r.rows[0];
      return row
        ? {
            runId: row.run_id,
            requestCanonicalHash: row.request_canonical_hash,
            routeScope: row.route_scope as RunRouteScope,
          }
        : null;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  } finally {
    client.release();
  }
}

/**
 * TX-A reservation — the single PostgreSQL concurrency arbiter (§13). Runs
 * inside the caller's open candidate transaction, immediately after the
 * candidate run row exists and BEFORE any duplicate-sensitive durable work.
 * Non-poisoning: `ON CONFLICT DO NOTHING` never aborts the transaction; a
 * blocked contender waits for the owning transaction and, when that owner
 * rolls back, proceeds to become the legitimate winner. Returns true when THIS
 * transaction won the reservation.
 */
export async function reserveRunIdempotency(
  client: PoolClient,
  input: {
    orgId: string;
    keyHash: Buffer;
    intentHash: Buffer;
    routeScope: RunRouteScope;
    runId: string;
  },
): Promise<boolean> {
  const r = await client.query(
    `INSERT INTO govai.run_idempotency
       (org_id, idempotency_key_hash, request_canonical_hash, request_hash_version,
        route_scope, run_id)
     VALUES ($1::uuid, $2::bytea, $3::bytea, $4::smallint, $5::text, $6::uuid)
     ON CONFLICT (org_id, idempotency_key_hash) DO NOTHING
     RETURNING run_id`,
    [
      input.orgId,
      input.keyHash,
      input.intentHash,
      RUN_INTENT_HASH_VERSION,
      input.routeScope,
      input.runId,
    ],
  );
  return r.rows.length === 1;
}

// =============================================================================
// Replay projection + committed-request resolution.
// =============================================================================

/** Safe durable-state projection returned for a matching replay (HTTP 200 +
 *  `X-GovAI-Run-Idempotent-Replay: true` + Location). Mirrors the
 *  GET /v1/runs/:run_id contract: no payloads, no credentials, no raw errors.
 *  `status` is the CURRENT durable status — a replay can honestly observe
 *  queued/running as well as any terminal or unknown state. */
export type RunIdempotentReplay = {
  idempotent_replay: true;
  run_id: string;
  audit_chain_id: string;
  mode: string;
  provider: string;
  model: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  outcome_unknown_at: string | null;
  dispatch_error_class: string | null;
  retry_safe: false;
};

/** Runtime discriminant for the executor result union. */
export function isRunIdempotentReplay(value: unknown): value is RunIdempotentReplay {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { idempotent_replay?: unknown }).idempotent_replay === true
  );
}

/** Read the replay projection of an existing durable run — own short read
 *  transaction, tenant-scoped. */
export async function readRunReplayProjection(
  pool: Pool,
  orgId: string,
  runId: string,
): Promise<RunIdempotentReplay> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await setLocalAppOrgId(client, orgId);
      const r = await client.query<{
        id: string;
        mode: string;
        provider: string;
        model: string;
        status: string;
        created_at: Date;
        started_at: Date | null;
        completed_at: Date | null;
        outcome_unknown_at: Date | null;
        dispatch_error_class: string | null;
      }>(
        `SELECT id, mode, provider, model, status, created_at, started_at,
                completed_at, outcome_unknown_at, dispatch_error_class
           FROM govai.runs
          WHERE id = $1::uuid AND org_id = $2::uuid`,
        [runId, orgId],
      );
      await client.query('COMMIT');
      const row = r.rows[0];
      if (!row) {
        // A binding's run_id is FK-guaranteed; an unreadable row here is an
        // infrastructure invariant break, not a client error.
        throw new Error(`run idempotency binding references unreadable run ${runId}`);
      }
      return {
        idempotent_replay: true,
        run_id: row.id,
        audit_chain_id: chainIdFor(orgId, 'run'),
        mode: row.mode,
        provider: row.provider,
        model: row.model,
        status: row.status,
        created_at: row.created_at.toISOString(),
        started_at: row.started_at?.toISOString() ?? null,
        completed_at: row.completed_at?.toISOString() ?? null,
        outcome_unknown_at: row.outcome_unknown_at?.toISOString() ?? null,
        dispatch_error_class: row.dispatch_error_class,
        retry_safe: false,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  } finally {
    client.release();
  }
}

/**
 * Resolve a keyed request against the COMMITTED binding state (§10/§11/§12):
 * no binding ⇒ null (caller proceeds to a new execution attempt); matching
 * canonical intent ⇒ the replay projection (no new run, no policy/DLP
 * persistence, no approval consumption, no dispatch, no provider call);
 * divergent intent ⇒ RunIdempotencyConflictError (HTTP 409).
 */
export async function resolveCommittedKeyedRequest(
  pool: Pool,
  orgId: string,
  keyHash: Buffer,
  intentHash: Buffer,
): Promise<RunIdempotentReplay | null> {
  const binding = await findCommittedBinding(pool, orgId, keyHash);
  if (!binding) return null;
  if (!binding.requestCanonicalHash.equals(intentHash)) {
    throw new RunIdempotencyConflictError();
  }
  return readRunReplayProjection(pool, orgId, binding.runId);
}
