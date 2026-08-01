// Durable dispatch state machine (EP-P03A-A / F3) — the single home for every
// SQL transition of protocol v1: claim, known finalization, honest unknown,
// late reconciliation, pre-claim failure and the recovery transitions. Both
// the governed and the passthrough executors, and the recovery worker, call
// through here — no SQL duplication across paths.
//
// Transaction discipline: every exported function acquires its own client,
// runs ONE short transaction (BEGIN … COMMIT) under the tenant context, and
// releases the client. Nothing here is ever called while a provider fetch is
// in flight on the same client, and nothing here performs network I/O other
// than PostgreSQL.

import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { auditAppend, canonicalize, sha256 } from '@govai/core-audit';
import type { Kms } from '@govai/core-identity';
import { setLocalAppOrgId } from '@govai/core-tenant';
import {
  chainIdFor,
  RunDispatchPreparedSchema,
  RunDispatchClaimedSchema,
  RunOutcomeUnknownSchema,
  RunOutcomeReconciledSchema,
  type DispatchErrorClass,
  type ForwardObservation,
  type PassthroughInvoked,
  type RunDispatchPrepared,
} from '@govai/core-events';
import { AUDIT_CHAIN_KEY } from './audit-keys.js';

// =============================================================================
// Shared context + errors
// =============================================================================

/** The minimum context every event append / turn write needs. The recovery
 *  transitions build this from the run row itself (capability is not persisted
 *  on `govai.runs`, so recovery cannot construct a full RunDispatchContext). */
export type DispatchEventContext = {
  orgId: string;
  runId: string;
  chainId: string;
  /** Present iff the run is Workroom-owned (drives the run_event turn). */
  workroom?: { workroomId: string; participantId: string } | null;
};

export type RunDispatchContext = DispatchEventContext & {
  actorUserId: string;
  mode: 'governed' | 'passthrough';
  provider: 'anthropic' | 'openai';
  capabilityId: string;
  model: string;
  policyDecisionId?: string;
};

/** A second finalization for the same token carried a DIVERGENT known result.
 *  Never silently accepted (§29 T17). */
export class DispatchOutcomeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DispatchOutcomeConflictError';
  }
}

/** The caller's token does not own this run's dispatch. Defensive: the partial
 *  unique index makes a second token per run unreachable in practice. */
export class DispatchTokenMismatchError extends Error {
  constructor(runId: string) {
    super(`dispatch token does not own run ${runId}`);
    this.name = 'DispatchTokenMismatchError';
  }
}

/**
 * The durable local dispatch gate could not be established (§12/§17): either
 * the boundary CAS matched zero rows (closed reason) or the boundary
 * transaction itself failed (`commit_error` + the error NAME only — never raw
 * PostgreSQL/KMS text). Thrown by the orchestrator's `beforeDispatch` callback
 * so the provider forward is structurally impossible past a failed gate.
 */
export class DispatchBoundaryGateError extends Error {
  constructor(
    public readonly runId: string,
    public readonly reason: BoundaryCommitFailureReason | 'commit_error',
    public readonly causeName?: string,
  ) {
    super(`dispatch boundary gate not established for run ${runId} (${reason})`);
    this.name = 'DispatchBoundaryGateError';
  }
}

export type KnownOutcome =
  | {
      kind: 'http';
      statusCode: number;
      nativeEndpoint: string;
      nativeRequestHashHex: string;
      nativeResponseHashHex: string;
      latencyMs: number;
      providerRequestId: string | null;
      usageJson: Record<string, unknown>;
      capturedV4?: PassthroughInvoked | null;
      /** Governed runs: merged DLP finding count from TX-A, preserved on the
       *  terminal run.completed evidence (pre-F3 `finding_count` parity).
       *  Absent for passthrough (no DLP scan on that path). */
      dlpFindingCount?: number | null;
    }
  | { kind: 'blocked'; reason: string; capturedV4?: PassthroughInvoked | null }
  | { kind: 'local_error'; message: string };

// =============================================================================
// Internals
// =============================================================================

async function withTenantTx<T>(
  pool: Pool,
  orgId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await setLocalAppOrgId(client, orgId);
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  } finally {
    client.release();
  }
}

/** Append a dispatch lifecycle event: deterministic payload hash over the
 *  canonicalized (sorted-keys) typed event; the typed event itself is the
 *  redaction metadata (safe fields only, by schema construction). */
async function appendLifecycleEvent(
  client: PoolClient,
  kms: Kms,
  ctx: DispatchEventContext,
  event:
    | RunDispatchPrepared
    | ReturnType<typeof RunDispatchClaimedSchema.parse>
    | ReturnType<typeof RunOutcomeUnknownSchema.parse>
    | ReturnType<typeof RunOutcomeReconciledSchema.parse>,
): Promise<string> {
  const r = await auditAppend(client, kms, {
    orgId: ctx.orgId,
    chainId: ctx.chainId,
    eventType: event.event_type,
    eventVersion: '1',
    subjectType: 'run',
    subjectId: ctx.runId,
    occurredAt: new Date(event.occurred_at),
    payloadHash: sha256(Buffer.from(canonicalize(event), 'utf8')),
    ...AUDIT_CHAIN_KEY,
    redactionMetadata: event as unknown as Record<string, unknown>,
  });
  return r.eventId;
}

/** Persist a captured governed v4 event (§20/§21) — identical envelope to the
 *  previous in-transaction captureAudit, now inside TX-B / reconciliation. */
async function persistCapturedV4(
  client: PoolClient,
  kms: Kms,
  ctx: DispatchEventContext,
  event: PassthroughInvoked,
): Promise<string> {
  const json = JSON.stringify(event);
  const r = await auditAppend(client, kms, {
    orgId: ctx.orgId,
    chainId: ctx.chainId,
    eventType: 'passthrough.invoked',
    eventVersion: '4',
    subjectType: 'run',
    subjectId: ctx.runId,
    occurredAt: new Date(),
    payloadHash: sha256(Buffer.from(json, 'utf8')),
    ...AUDIT_CHAIN_KEY,
    redactionMetadata: {
      passthrough_invoked_v4: event as unknown as Record<string, unknown>,
    },
  });
  return r.eventId;
}

/**
 * At-most-one `run_event` turn per run (§27.2): existence check under the
 * per-workroom advisory xact lock, with the 0029 partial unique index as the
 * declarative backstop. A conflicting INSERT is NOT swallowed — every writer
 * goes through this guard, so an escaping unique violation would mean
 * divergent content and must surface.
 */
export async function ensureRunEventTurn(
  client: PoolClient,
  input: {
    orgId: string;
    workroomId: string;
    participantId: string;
    runId: string;
    auditEventId: string;
  },
): Promise<boolean> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('workroom_turn:' || $1)::bigint)", [
    input.workroomId,
  ]);
  const exists = await client.query(
    `SELECT 1 FROM govai.workroom_turns
      WHERE kind = 'run_event' AND payload_ref = $1::uuid
      LIMIT 1`,
    [input.runId],
  );
  if (exists.rows.length > 0) return false;
  const r = await client.query<{ next: string }>(
    'SELECT COALESCE(MAX(turn_number), 0) + 1 AS next FROM govai.workroom_turns WHERE workroom_id = $1',
    [input.workroomId],
  );
  await client.query(
    `INSERT INTO govai.workroom_turns
       (id, org_id, workroom_id, turn_number, actor_participant_id, kind, audit_event_id, payload_ref)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::uuid, 'run_event', $6::uuid, $7::uuid)`,
    [
      randomUUID(),
      input.orgId,
      input.workroomId,
      Number(r.rows[0]?.next ?? 1),
      input.participantId,
      input.auditEventId,
      input.runId,
    ],
  );
  return true;
}

async function maybeEnsureTurn(
  client: PoolClient,
  ctx: DispatchEventContext,
  auditEventId: string,
): Promise<void> {
  if (!ctx.workroom) return;
  await ensureRunEventTurn(client, {
    orgId: ctx.orgId,
    workroomId: ctx.workroom.workroomId,
    participantId: ctx.workroom.participantId,
    runId: ctx.runId,
    auditEventId,
  });
}

type InvocationInsert = {
  nativeEndpoint: string;
  nativeRequestHash: Buffer;
  nativeResponseHash: Buffer | null;
  statusCode: number | null;
  latencyMs: number | null;
  providerRequestId: string | null;
  errorClass: string | null;
  usageJson: Record<string, unknown>;
  dispatchToken: string;
};

/** Insert the (run, token) invocation row or reuse the existing one (§26). */
async function insertOrReuseInvocation(
  client: PoolClient,
  ctx: RunDispatchContext,
  inv: InvocationInsert,
): Promise<{ id: string; inserted: boolean }> {
  const id = randomUUID();
  const r = await client.query(
    `INSERT INTO govai.provider_invocations (
       id, run_id, org_id, provider, native_endpoint, native_method,
       native_request_hash, native_response_hash, streaming, usage_json,
       latency_ms, status_code, provider_request_id, error_class, dispatch_token
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, 'POST',
       $6::bytea, $7::bytea, false, $8::jsonb,
       $9::integer, $10::integer, $11::text, $12::text, $13::uuid
     )
     ON CONFLICT (run_id, dispatch_token) WHERE dispatch_token IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      id,
      ctx.runId,
      ctx.orgId,
      ctx.provider,
      inv.nativeEndpoint,
      inv.nativeRequestHash,
      inv.nativeResponseHash,
      JSON.stringify(inv.usageJson),
      inv.latencyMs,
      inv.statusCode,
      inv.providerRequestId,
      inv.errorClass,
      inv.dispatchToken,
    ],
  );
  if (r.rows.length === 1) return { id, inserted: true };
  const existing = await client.query<{
    id: string;
    native_endpoint: string;
    native_request_hash: Buffer;
  }>(
    `SELECT id, native_endpoint, native_request_hash FROM govai.provider_invocations
      WHERE run_id = $1::uuid AND dispatch_token = $2::uuid`,
    [ctx.runId, inv.dispatchToken],
  );
  if (existing.rows.length !== 1) {
    throw new DispatchOutcomeConflictError(
      `invocation upsert for run ${ctx.runId} conflicted but no (run, token) row is visible`,
    );
  }
  // The reused row is IMMUTABLE evidence: the caller's outcome must carry the
  // SAME request identity the trace recorded, or the reconciled/terminal
  // events would cite a request the invocation row contradicts.
  const row = existing.rows[0]!;
  if (
    row.native_endpoint !== inv.nativeEndpoint ||
    !row.native_request_hash.equals(inv.nativeRequestHash)
  ) {
    throw new DispatchOutcomeConflictError(
      `run ${ctx.runId}: (run, token) invocation reuse carries a divergent request identity`,
    );
  }
  return { id: row.id, inserted: false };
}

async function appendTerminalRunEvent(
  client: PoolClient,
  kms: Kms,
  ctx: DispatchEventContext,
  input: {
    eventType: 'run.completed' | 'run.failed' | 'run.denied';
    payloadHash: Uint8Array;
    redactionMetadata: Record<string, unknown>;
  },
): Promise<string> {
  const r = await auditAppend(client, kms, {
    orgId: ctx.orgId,
    chainId: ctx.chainId,
    eventType: input.eventType,
    eventVersion: '1',
    subjectType: 'run',
    subjectId: ctx.runId,
    occurredAt: new Date(),
    payloadHash: input.payloadHash,
    ...AUDIT_CHAIN_KEY,
    redactionMetadata: input.redactionMetadata,
  });
  return r.eventId;
}

// =============================================================================
// Prepared event (emitted inside TX-A by the orchestrator, which owns that
// transaction — the ONLY function here that takes a client instead of a pool).
// =============================================================================

export async function appendDispatchPreparedEvent(
  client: PoolClient,
  kms: Kms,
  ctx: RunDispatchContext,
  input: {
    nativeRequestHashHex: string;
    approvalRequestId?: string;
    occurredAt: Date;
  },
): Promise<string> {
  const event = RunDispatchPreparedSchema.parse({
    event_type: 'run.dispatch_prepared',
    schema_version: 1,
    org_id: ctx.orgId,
    run_id: ctx.runId,
    mode: ctx.mode,
    provider: ctx.provider,
    capability_id: ctx.capabilityId,
    model: ctx.model,
    native_request_hash: input.nativeRequestHashHex,
    ...(input.approvalRequestId ? { approval_request_id: input.approvalRequestId } : {}),
    ...(ctx.workroom ? { workroom_id: ctx.workroom.workroomId } : {}),
    occurred_at: input.occurredAt.toISOString(),
    chain_category: 'run',
  });
  return appendLifecycleEvent(client, kms, ctx, event);
}

// =============================================================================
// Claim (§17) — exclusive dispatch ownership via CAS queued → running
// =============================================================================

export type ClaimResult =
  | { claimed: true; token: string; claimedAt: Date; deadlineAt: Date }
  | { claimed: false; status: string | null };

export async function claimDispatch(
  pool: Pool,
  kms: Kms,
  ctx: RunDispatchContext,
  input: { timeoutMs: number },
): Promise<ClaimResult> {
  const token = randomUUID();
  return withTenantTx(pool, ctx.orgId, async (client) => {
    const r = await client.query<{ dispatch_claimed_at: Date; dispatch_deadline_at: Date }>(
      `UPDATE govai.runs
          SET status = 'running',
              dispatch_token = $2::uuid,
              dispatch_claimed_at = now(),
              started_at = now(),
              dispatch_timeout_ms = $3::integer,
              dispatch_deadline_at = now() + make_interval(secs => $3::integer / 1000.0)
        WHERE id = $1::uuid
          AND status = 'queued'
          AND dispatch_protocol_version = 1
          AND dispatch_token IS NULL
        RETURNING dispatch_claimed_at, dispatch_deadline_at`,
      [ctx.runId, token, input.timeoutMs],
    );
    if (r.rowCount !== 1) {
      const state = await client.query<{ status: string }>(
        'SELECT status FROM govai.runs WHERE id = $1::uuid',
        [ctx.runId],
      );
      return { claimed: false, status: state.rows[0]?.status ?? null };
    }
    const row = r.rows[0]!;
    const event = RunDispatchClaimedSchema.parse({
      event_type: 'run.dispatch_claimed',
      schema_version: 1,
      org_id: ctx.orgId,
      run_id: ctx.runId,
      dispatch_token: token,
      dispatch_timeout_ms: input.timeoutMs,
      dispatch_claimed_at: row.dispatch_claimed_at.toISOString(),
      dispatch_deadline_at: row.dispatch_deadline_at.toISOString(),
      occurred_at: row.dispatch_claimed_at.toISOString(),
      chain_category: 'run',
    });
    await appendLifecycleEvent(client, kms, ctx, event);
    return {
      claimed: true,
      token,
      claimedAt: row.dispatch_claimed_at,
      deadlineAt: row.dispatch_deadline_at,
    };
  });
}

// =============================================================================
// Durable dispatch boundary (REV4 §11) — the final mandatory local gate.
//
// The boundary CAS commits `dispatch_boundary_committed_at` on DATABASE time
// for exactly one (run, token) pair, only while the claim is live. Its exact
// meaning: the protocol durably crossed the final mandatory local gate after
// which a provider invocation could begin. It proves NOTHING about fetch,
// the network, or the provider. A zero-row CAS is a CLOSED result — the
// caller must never forward past it (fail closed, §2.3).
// =============================================================================

export type BoundaryCommitFailureReason =
  | 'wrong_token'
  | 'not_running'
  | 'deadline_expired'
  | 'boundary_already_committed'
  | 'run_missing';

export type BoundaryCommitResult =
  | { committed: true; committedAt: Date }
  | { committed: false; reason: BoundaryCommitFailureReason };

export async function commitDispatchBoundary(
  pool: Pool,
  ctx: { orgId: string; runId: string },
  input: { token: string },
): Promise<BoundaryCommitResult> {
  return withTenantTx(pool, ctx.orgId, async (client) => {
    const r = await client.query<{ dispatch_boundary_committed_at: Date }>(
      `UPDATE govai.runs
          SET dispatch_boundary_committed_at = now()
        WHERE id = $1::uuid
          AND dispatch_token = $2::uuid
          AND status = 'running'
          AND dispatch_boundary_committed_at IS NULL
          AND dispatch_deadline_at > now()
        RETURNING dispatch_boundary_committed_at`,
      [ctx.runId, input.token],
    );
    if (r.rowCount === 1) {
      return { committed: true, committedAt: r.rows[0]!.dispatch_boundary_committed_at };
    }
    // Closed diagnosis of the zero-row CAS. Read-only; regardless of the
    // reason the caller's contract is identical: PROVIDER_FORWARD=NO. A
    // second call NEVER re-authorizes a forward (boundary_already_committed
    // is a failure, not a reusable success).
    const state = await client.query<{
      status: string;
      dispatch_token: string | null;
      dispatch_boundary_committed_at: Date | null;
      deadline_live: boolean | null;
    }>(
      `SELECT status, dispatch_token, dispatch_boundary_committed_at,
              (dispatch_deadline_at > now()) AS deadline_live
         FROM govai.runs WHERE id = $1::uuid`,
      [ctx.runId],
    );
    const row = state.rows[0];
    if (!row) return { committed: false, reason: 'run_missing' };
    if (row.dispatch_token !== input.token) return { committed: false, reason: 'wrong_token' };
    if (row.dispatch_boundary_committed_at !== null) {
      return { committed: false, reason: 'boundary_already_committed' };
    }
    if (row.status !== 'running') return { committed: false, reason: 'not_running' };
    return { committed: false, reason: 'deadline_expired' };
  });
}

/**
 * §17 — the boundary gate failed (zero-row CAS or boundary-transaction error):
 * persist the KNOWN failure `dispatch_boundary_persist_failed`. The CAS below
 * requires the boundary to still be NULL under the caller's token, so a race
 * with recovery (or a late boundary success in another process — impossible
 * for one request, defensive anyway) makes this a clean no-transition; the
 * caller then answers from the durable state instead. Provider call count is
 * zero by construction.
 */
export async function failBoundaryNotEstablished(
  pool: Pool,
  kms: Kms,
  ctx: RunDispatchContext,
  input: { token: string },
): Promise<{ transitioned: boolean; status: string | null; auditEventId: string | null }> {
  return withTenantTx(pool, ctx.orgId, async (client) => {
    const r = await client.query(
      `UPDATE govai.runs
          SET status = 'failed', completed_at = now(),
              dispatch_error_class = 'dispatch_boundary_persist_failed'
        WHERE id = $1::uuid
          AND dispatch_token = $2::uuid
          AND status = 'running'
          AND dispatch_boundary_committed_at IS NULL`,
      [ctx.runId, input.token],
    );
    if (r.rowCount !== 1) {
      const state = await client.query<{ status: string }>(
        'SELECT status FROM govai.runs WHERE id = $1::uuid',
        [ctx.runId],
      );
      return { transitioned: false, status: state.rows[0]?.status ?? null, auditEventId: null };
    }
    const auditEventId = await appendTerminalRunEvent(client, kms, ctx, {
      eventType: 'run.failed',
      payloadHash: sha256(Buffer.from(`dispatch_boundary_persist_failed:${ctx.runId}`)),
      redactionMetadata: {
        actor_user_id: ctx.actorUserId,
        run_mode: ctx.mode,
        error_class: 'dispatch_boundary_persist_failed',
        provider_call_count: 0,
      },
    });
    await maybeEnsureTurn(client, ctx, auditEventId);
    return { transitioned: true, status: 'failed', auditEventId };
  });
}

// =============================================================================
// Pre-claim known failure (§16) — queued → failed, provider provably not called
// =============================================================================

export async function failPreclaim(
  pool: Pool,
  kms: Kms,
  ctx: RunDispatchContext,
  input: { errorClass: Extract<DispatchErrorClass, 'dispatch_preclaim_failed'>; message: string },
): Promise<boolean> {
  return withTenantTx(pool, ctx.orgId, async (client) => {
    const r = await client.query(
      `UPDATE govai.runs
          SET status = 'failed', completed_at = now(), dispatch_error_class = $2::text
        WHERE id = $1::uuid
          AND status = 'queued'
          AND dispatch_protocol_version = 1
          AND dispatch_token IS NULL`,
      [ctx.runId, input.errorClass],
    );
    if (r.rowCount !== 1) return false;
    const eventId = await appendTerminalRunEvent(client, kms, ctx, {
      eventType: 'run.failed',
      payloadHash: sha256(Buffer.from(`${input.errorClass}:${input.message}`)),
      redactionMetadata: {
        actor_user_id: ctx.actorUserId,
        run_mode: ctx.mode,
        error_class: input.errorClass,
        error_message: input.message.slice(0, 200),
        provider_call_count: 0,
      },
    });
    await maybeEnsureTurn(client, ctx, eventId);
    return true;
  });
}

// =============================================================================
// Honest unknown (§22) — running → outcome_unknown with the same token
// =============================================================================

export async function markOutcomeUnknown(
  pool: Pool,
  kms: Kms,
  ctx: RunDispatchContext,
  input: {
    token: string;
    errorClass: Extract<DispatchErrorClass, 'provider_timeout' | 'provider_io_unknown'>;
    /** Closed process observation (§14): the live executor passes
     *  'observed_local_forward_invocation' only when its in-memory marker ran
     *  immediately before `fetch`. Never a provider-side claim. */
    forwardObservation: ForwardObservation;
    /** Present when the process knows it invoked the forwarder (§22). */
    invocation?: { nativeEndpoint: string; nativeRequestHash: Buffer } | null;
  },
): Promise<{
  transitioned: boolean;
  status: string | null;
  eventId: string | null;
  invocationId: string | null;
}> {
  return withTenantTx(pool, ctx.orgId, async (client) => {
    // The boundary guard makes the state matrix's outcome_unknown arm hold by
    // construction: an unknown is only reachable PAST the durable gate. A
    // boundary-null row (unreachable live — the gate precedes the fetch)
    // falls through to the honest no-transition read below.
    const r = await client.query<{
      outcome_unknown_at: Date;
      dispatch_boundary_committed_at: Date;
    }>(
      `UPDATE govai.runs
          SET status = 'outcome_unknown',
              outcome_unknown_at = now(),
              dispatch_error_class = $3::text
        WHERE id = $1::uuid
          AND dispatch_token = $2::uuid
          AND status = 'running'
          AND dispatch_boundary_committed_at IS NOT NULL
        RETURNING outcome_unknown_at, dispatch_boundary_committed_at`,
      [ctx.runId, input.token, input.errorClass],
    );
    const ensureInvocation = async (): Promise<string | null> => {
      if (!input.invocation || input.forwardObservation !== 'observed_local_forward_invocation') {
        return null;
      }
      const inv = await insertOrReuseInvocation(client, ctx, {
        nativeEndpoint: input.invocation.nativeEndpoint,
        nativeRequestHash: input.invocation.nativeRequestHash,
        nativeResponseHash: null,
        statusCode: null,
        latencyMs: null,
        providerRequestId: null,
        errorClass: 'dispatch_outcome_unknown',
        usageJson: { source: 'dispatch_outcome_unknown' },
        dispatchToken: input.token,
      });
      return inv.id;
    };
    if (r.rowCount !== 1) {
      // The recovery worker may have marked the claim stale first. The unknown
      // state and its lifecycle event already exist — only make sure the
      // invocation trace is present; never emit a second run.outcome_unknown.
      const state = await client.query<{ status: string; dispatch_token: string | null }>(
        'SELECT status, dispatch_token FROM govai.runs WHERE id = $1::uuid',
        [ctx.runId],
      );
      const row = state.rows[0] ?? null;
      let invocationId: string | null = null;
      if (row && row.dispatch_token === input.token && row.status === 'outcome_unknown') {
        invocationId = await ensureInvocation();
      }
      return { transitioned: false, status: row?.status ?? null, eventId: null, invocationId };
    }
    const invocationId = await ensureInvocation();
    const event = RunOutcomeUnknownSchema.parse({
      event_type: 'run.outcome_unknown',
      schema_version: 1,
      org_id: ctx.orgId,
      run_id: ctx.runId,
      dispatch_token: input.token,
      dispatch_error_class: input.errorClass,
      forward_observation: input.forwardObservation,
      dispatch_boundary_committed_at:
        r.rows[0]!.dispatch_boundary_committed_at.toISOString(),
      outcome_unknown_at: r.rows[0]!.outcome_unknown_at.toISOString(),
      occurred_at: r.rows[0]!.outcome_unknown_at.toISOString(),
      chain_category: 'run',
    });
    const eventId = await appendLifecycleEvent(client, kms, ctx, event);
    await maybeEnsureTurn(client, ctx, eventId);
    return { transitioned: true, status: 'outcome_unknown', eventId, invocationId };
  });
}

// =============================================================================
// TX-B — known result (§21) + late reconciliation (§26)
// =============================================================================

export type FinalizeResult = {
  finalStatus: 'completed' | 'failed' | 'denied';
  invocationId: string | null;
  auditEventId: string;
  v4EventId?: string;
  reconciled: boolean;
  /** True when this call found the run already terminal for the same token
   *  with a matching result — an idempotent duplicate finalization. */
  duplicate: boolean;
};

type TerminalEventMeta = {
  status_code?: number;
  error_status?: number;
  native_response_hash?: string;
  governed_block_reason?: string;
  error_class?: string;
  error_message?: string;
};

/** The persisted terminal lifecycle event's safe metadata — the authoritative
 *  record every duplicate finalization is verified against (fail closed when
 *  absent). Exactly one terminal event exists per terminal run. */
async function readTerminalEventMeta(
  client: PoolClient,
  runId: string,
): Promise<TerminalEventMeta | null> {
  const ev = await client.query<{ redaction_metadata: TerminalEventMeta | null }>(
    `SELECT redaction_metadata FROM govai.audit_events
      WHERE subject_type = 'run' AND subject_id = $1::uuid
        AND event_type IN ('run.completed', 'run.failed', 'run.denied')
      ORDER BY sequence_number DESC
      LIMIT 1`,
    [runId],
  );
  return ev.rows[0]?.redaction_metadata ?? null;
}

export async function finalizeKnownOutcome(
  pool: Pool,
  kms: Kms,
  ctx: RunDispatchContext,
  input: { token: string; outcome: KnownOutcome },
): Promise<FinalizeResult> {
  return withTenantTx(pool, ctx.orgId, async (client) => {
    const state = await client.query<{
      status: string;
      dispatch_token: string | null;
      outcome_unknown_at: Date | null;
      dispatch_boundary_committed_at: Date | null;
    }>(
      `SELECT status, dispatch_token, outcome_unknown_at, dispatch_boundary_committed_at
         FROM govai.runs
        WHERE id = $1::uuid
        FOR UPDATE`,
      [ctx.runId],
    );
    const row = state.rows[0];
    if (!row) throw new DispatchTokenMismatchError(ctx.runId);
    if (row.dispatch_token !== input.token) throw new DispatchTokenMismatchError(ctx.runId);

    const { outcome } = input;
    const httpOk =
      outcome.kind === 'http' && outcome.statusCode >= 200 && outcome.statusCode < 300;
    const terminal: 'completed' | 'failed' | 'denied' =
      outcome.kind === 'http' ? (httpOk ? 'completed' : 'failed')
      : outcome.kind === 'blocked' ? 'denied'
      : 'failed';

    // Idempotent duplicate finalization (§26 / T17): the run is already
    // terminal under the same token. Verify the persisted result matches the
    // known result being offered; a divergent result is NEVER silently accepted.
    if (row.status === 'completed' || row.status === 'failed' || row.status === 'denied') {
      if (row.status !== terminal) {
        throw new DispatchOutcomeConflictError(
          `run ${ctx.runId} already terminal as ${row.status}; refusing divergent ${terminal}`,
        );
      }
      let invocationId: string | null = null;
      if (outcome.kind === 'http') {
        const existing = await client.query<{
          id: string;
          status_code: number | null;
          native_response_hash: Buffer | null;
          native_endpoint: string;
          native_request_hash: Buffer;
        }>(
          `SELECT id, status_code, native_response_hash, native_endpoint, native_request_hash
             FROM govai.provider_invocations
            WHERE run_id = $1::uuid AND dispatch_token = $2::uuid`,
          [ctx.runId, input.token],
        );
        const inv = existing.rows[0];
        if (!inv) {
          throw new DispatchOutcomeConflictError(
            `run ${ctx.runId} is terminal but has no invocation for its token`,
          );
        }
        // Request identity first: endpoint + request hash are NOT NULL on every
        // invocation row (trace or full), so a terminal duplicate carrying a
        // different request is always detectable — this fast path must not
        // bypass the identity check insertOrReuseInvocation applies on reuse.
        if (
          inv.native_endpoint !== outcome.nativeEndpoint ||
          inv.native_request_hash.toString('hex') !== outcome.nativeRequestHashHex
        ) {
          throw new DispatchOutcomeConflictError(
            `run ${ctx.runId}: duplicate finalization carries a divergent request identity`,
          );
        }
        // A NULL persisted status_code/response_hash records the earlier UNKNOWN
        // trace (the append-only evidence row is reused by reconciliation and
        // never mutated — govai_app holds no UPDATE privilege on it, by design).
        // NULL is therefore NOT a wildcard: the authoritative known result of a
        // reconciled run lives on its terminal lifecycle event, and the duplicate
        // must be verified against THAT. If nothing can verify the offered
        // result, the duplicate is REFUSED (fail closed) — a divergent second
        // result is never silently accepted (§29 T17).
        let knownStatus: number | null = inv.status_code;
        let knownHash: string | null = inv.native_response_hash?.toString('hex') ?? null;
        if (knownStatus === null || knownHash === null) {
          const meta = await readTerminalEventMeta(client, ctx.runId);
          knownStatus = knownStatus ?? meta?.status_code ?? meta?.error_status ?? null;
          knownHash = knownHash ?? meta?.native_response_hash ?? null;
        }
        if (knownStatus === null || knownHash === null) {
          throw new DispatchOutcomeConflictError(
            `run ${ctx.runId}: terminal provider result cannot be verified against the duplicate finalization`,
          );
        }
        if (knownStatus !== outcome.statusCode || knownHash !== outcome.nativeResponseHashHex) {
          throw new DispatchOutcomeConflictError(
            `run ${ctx.runId}: duplicate finalization carries a divergent provider result`,
          );
        }
        invocationId = inv.id;
      } else if (outcome.kind === 'blocked') {
        // Non-HTTP duplicates are validated too — terminal-status equality
        // alone is NOT equivalence. A denied run's persisted block reason must
        // match the offered one exactly; unverifiable ⇒ refused (fail closed).
        const meta = await readTerminalEventMeta(client, ctx.runId);
        if (meta?.governed_block_reason === undefined) {
          throw new DispatchOutcomeConflictError(
            `run ${ctx.runId}: terminal block reason cannot be verified against the duplicate finalization`,
          );
        }
        if (meta.governed_block_reason !== outcome.reason) {
          throw new DispatchOutcomeConflictError(
            `run ${ctx.runId}: duplicate blocked finalization carries a divergent reason`,
          );
        }
      } else {
        // local_error duplicate: the persisted failure must BE a pre-forward
        // local error with the same (truncated) message — an HTTP provider
        // failure or any other failure class is contradictory evidence.
        const meta = await readTerminalEventMeta(client, ctx.runId);
        if (
          meta?.error_class !== 'dispatch_pre_forward_failed' ||
          meta.error_message !== outcome.message.slice(0, 200)
        ) {
          throw new DispatchOutcomeConflictError(
            `run ${ctx.runId}: duplicate local-error finalization does not match the persisted terminal result`,
          );
        }
      }
      return {
        finalStatus: row.status,
        invocationId,
        auditEventId: '',
        reconciled: false,
        duplicate: true,
      };
    }

    if (row.status !== 'running' && row.status !== 'outcome_unknown') {
      throw new DispatchOutcomeConflictError(
        `run ${ctx.runId} in status ${row.status} cannot accept a known outcome`,
      );
    }
    const reconciling = row.status === 'outcome_unknown';

    // 1. Invocation row — only when a provider call actually happened.
    let invocationId: string | null = null;
    if (outcome.kind === 'http') {
      const inv = await insertOrReuseInvocation(client, ctx, {
        nativeEndpoint: outcome.nativeEndpoint,
        nativeRequestHash: Buffer.from(outcome.nativeRequestHashHex, 'hex'),
        nativeResponseHash: Buffer.from(outcome.nativeResponseHashHex, 'hex'),
        statusCode: outcome.statusCode,
        latencyMs: outcome.latencyMs,
        providerRequestId: outcome.providerRequestId,
        errorClass: httpOk ? null : 'provider_error',
        usageJson: outcome.usageJson,
        dispatchToken: input.token,
      });
      invocationId = inv.id;
    }

    // 2. Captured governed v4 (§20) — persisted here, never during the fetch.
    let v4EventId: string | undefined;
    if ((outcome.kind === 'http' || outcome.kind === 'blocked') && outcome.capturedV4) {
      v4EventId = await persistCapturedV4(client, kms, ctx, outcome.capturedV4);
    }

    // 3. Run row transition (outcome_unknown_at is PRESERVED on reconciliation).
    await client.query(
      `UPDATE govai.runs
          SET status = $2::text,
              completed_at = now(),
              dispatch_error_class = CASE
                WHEN $3::text IS NOT NULL THEN $3::text
                ELSE dispatch_error_class
              END
        WHERE id = $1::uuid`,
      [ctx.runId, terminal, outcome.kind === 'local_error' ? 'dispatch_pre_forward_failed' : null],
    );

    // 4. Reconciliation event (§26) — before the terminal event, on the same
    // chain. Emitted ONLY for a known PROVIDER result (http): its mandated
    // fields (provider_invocation_id + real hashes) exist only there. A known
    // local pre-forward error or a governed block reaching an unknown run still
    // finalizes honestly below, but fabricating invocation ids/hashes to force
    // a reconciliation record would be dishonest evidence.
    const emitsReconciled =
      reconciling && outcome.kind === 'http' && invocationId !== null;
    if (emitsReconciled && outcome.kind === 'http') {
      const reconciled = RunOutcomeReconciledSchema.parse({
        event_type: 'run.outcome_reconciled',
        schema_version: 1,
        org_id: ctx.orgId,
        run_id: ctx.runId,
        previous_status: 'outcome_unknown',
        final_status: terminal === 'completed' ? 'completed' : 'failed',
        dispatch_token: input.token,
        provider_invocation_id: invocationId,
        native_request_hash: outcome.nativeRequestHashHex,
        native_response_hash: outcome.nativeResponseHashHex,
        occurred_at: new Date().toISOString(),
        chain_category: 'run',
      });
      await appendLifecycleEvent(client, kms, ctx, reconciled);
    }

    // 5. Terminal lifecycle event — mirrors the pre-F3 shapes. §15: when the
    // durable boundary was crossed, the terminal evidence is cryptographically
    // bound to it — the boundary timestamp enters BOTH the payload hash and
    // the safe metadata. Safe protocol metadata only; never a receipt claim.
    const boundaryBinding =
      row.dispatch_boundary_committed_at !== null
        ? {
            dispatch_boundary_committed_at:
              row.dispatch_boundary_committed_at.toISOString(),
          }
        : {};
    let auditEventId: string;
    if (outcome.kind === 'http' && httpOk) {
      // Pre-F3 parity: the completed event carries the governed run's merged
      // DLP finding count in BOTH the payload hash and the metadata.
      const findingCount =
        outcome.dlpFindingCount !== undefined && outcome.dlpFindingCount !== null
          ? { finding_count: outcome.dlpFindingCount }
          : {};
      auditEventId = await appendTerminalRunEvent(client, kms, ctx, {
        eventType: 'run.completed',
        payloadHash: sha256(
          Buffer.from(
            JSON.stringify({
              run_id: ctx.runId,
              provider_invocation_id: invocationId,
              policy_decision_id: ctx.policyDecisionId ?? null,
              provider_request_id: outcome.providerRequestId,
              status_code: outcome.statusCode,
              native_request_hash: outcome.nativeRequestHashHex,
              native_response_hash: outcome.nativeResponseHashHex,
              ...findingCount,
              ...boundaryBinding,
            }),
          ),
        ),
        redactionMetadata: {
          actor_user_id: ctx.actorUserId,
          run_mode: ctx.mode,
          ...(ctx.mode === 'passthrough' ? { enforcement: 'observe' } : {}),
          provider: ctx.provider,
          capability: ctx.capabilityId,
          ...(ctx.policyDecisionId ? { policy_decision_id: ctx.policyDecisionId } : {}),
          provider_invocation_id: invocationId,
          status_code: outcome.statusCode,
          native_request_hash: outcome.nativeRequestHashHex,
          native_response_hash: outcome.nativeResponseHashHex,
          ...(outcome.providerRequestId ? { provider_request_id: outcome.providerRequestId } : {}),
          ...findingCount,
          ...boundaryBinding,
        },
      });
    } else if (outcome.kind === 'http') {
      auditEventId = await appendTerminalRunEvent(client, kms, ctx, {
        eventType: 'run.failed',
        payloadHash: sha256(
          Buffer.from(
            JSON.stringify({
              run_id: ctx.runId,
              error_status: outcome.statusCode,
              error_class: 'provider_error',
              native_request_hash: outcome.nativeRequestHashHex,
              native_response_hash: outcome.nativeResponseHashHex,
              ...boundaryBinding,
            }),
          ),
        ),
        redactionMetadata: {
          actor_user_id: ctx.actorUserId,
          run_mode: ctx.mode,
          ...(ctx.mode === 'passthrough' ? { enforcement: 'observe' } : {}),
          provider: ctx.provider,
          capability: ctx.capabilityId,
          ...(ctx.policyDecisionId ? { policy_decision_id: ctx.policyDecisionId } : {}),
          provider_invocation_id: invocationId,
          error_status: outcome.statusCode,
          error_class: 'provider_error',
          native_request_hash: outcome.nativeRequestHashHex,
          native_response_hash: outcome.nativeResponseHashHex,
          ...boundaryBinding,
        },
      });
    } else if (outcome.kind === 'blocked') {
      auditEventId = await appendTerminalRunEvent(client, kms, ctx, {
        eventType: 'run.denied',
        payloadHash: sha256(Buffer.from(`governed_blocked:${outcome.reason}`)),
        redactionMetadata: {
          actor_user_id: ctx.actorUserId,
          run_mode: ctx.mode,
          ...(ctx.policyDecisionId ? { policy_decision_id: ctx.policyDecisionId } : {}),
          governed_block_reason: outcome.reason,
          provider_call_count: 0,
        },
      });
    } else {
      auditEventId = await appendTerminalRunEvent(client, kms, ctx, {
        eventType: 'run.failed',
        payloadHash: sha256(
          Buffer.from(
            JSON.stringify({
              run_id: ctx.runId,
              error_class: 'dispatch_pre_forward_failed',
              error_message: outcome.message.slice(0, 200),
              ...boundaryBinding,
            }),
          ),
        ),
        redactionMetadata: {
          actor_user_id: ctx.actorUserId,
          run_mode: ctx.mode,
          ...(ctx.policyDecisionId ? { policy_decision_id: ctx.policyDecisionId } : {}),
          error_class: 'dispatch_pre_forward_failed',
          error_message: outcome.message.slice(0, 200),
          provider_call_count: 0,
          ...boundaryBinding,
        },
      });
    }

    await maybeEnsureTurn(client, ctx, auditEventId);
    return {
      finalStatus: terminal,
      invocationId,
      auditEventId,
      ...(v4EventId ? { v4EventId } : {}),
      reconciled: emitsReconciled,
      duplicate: false,
    };
  });
}

// =============================================================================
// Recovery transitions (§25) — SKIP LOCKED re-validation under per-org RLS.
//
// The discovery function (govai.run_dispatch_recovery_candidates) is advisory
// only; the authoritative staleness re-check happens HERE, on database time,
// under FOR UPDATE SKIP LOCKED — the multi-replica disjointness primitive.
// Recovery NEVER calls a provider and NEVER generates a dispatch token.
// =============================================================================

type RecoveredRunRow = {
  actor_user_id: string;
  mode: string;
  dispatch_token: string | null;
  dispatch_boundary_committed_at: Date | null;
  workroom_id: string | null;
  created_by_participant_id: string | null;
};

function recoveryEventCtx(orgId: string, runId: string, run: RecoveredRunRow): DispatchEventContext {
  return {
    orgId,
    runId,
    chainId: chainIdFor(orgId, 'run'),
    workroom:
      run.workroom_id && run.created_by_participant_id
        ? { workroomId: run.workroom_id, participantId: run.created_by_participant_id }
        : null,
  };
}

/** §25.2 — v1 queued, never claimed, older than the prepared grace: the
 *  provider was provably never called → known failed `dispatch_never_claimed`. */
export async function recoverQueuedStale(
  pool: Pool,
  kms: Kms,
  input: { orgId: string; runId: string; preparedGraceMs: number },
): Promise<boolean> {
  return withTenantTx(pool, input.orgId, async (client) => {
    const r = await client.query<RecoveredRunRow>(
      `SELECT actor_user_id, mode, dispatch_token, dispatch_boundary_committed_at,
              workroom_id, created_by_participant_id
         FROM govai.runs
        WHERE id = $1::uuid
          AND dispatch_protocol_version = 1
          AND status = 'queued'
          AND dispatch_token IS NULL
          AND dispatch_prepared_at < now() - make_interval(secs => $2::integer / 1000.0)
        FOR UPDATE SKIP LOCKED`,
      [input.runId, input.preparedGraceMs],
    );
    const run = r.rows[0];
    if (!run) return false;
    await client.query(
      `UPDATE govai.runs
          SET status = 'failed', completed_at = now(), dispatch_error_class = 'dispatch_never_claimed'
        WHERE id = $1::uuid`,
      [input.runId],
    );
    const ctx = recoveryEventCtx(input.orgId, input.runId, run);
    const eventId = await appendTerminalRunEvent(client, kms, ctx, {
      eventType: 'run.failed',
      payloadHash: sha256(Buffer.from(`dispatch_never_claimed:${input.runId}`)),
      redactionMetadata: {
        actor_user_id: run.actor_user_id,
        run_mode: run.mode,
        error_class: 'dispatch_never_claimed',
        provider_call_count: 0,
        recovered_by: 'run_dispatch_recovery',
      },
    });
    await maybeEnsureTurn(client, ctx, eventId);
    return true;
  });
}

/** The two honest resolutions of a stale running claim (§18): the durable
 *  boundary decides which one is provable. */
export type RunningStaleRecovery = 'not_recovered' | 'failed_never_started' | 'outcome_unknown';

/** §25.3/§18 — v1 running past deadline + grace. The branch is decided
 *  ATOMICALLY under the same per-run lock and tenant context:
 *    boundary ABSENT  → the mandatory durable gate was never committed, so
 *                       provider invocation was structurally impossible →
 *                       KNOWN failed `dispatch_never_started` (zero calls).
 *    boundary PRESENT → the gate was crossed but recovery did not observe the
 *                       original process — nothing past the gate is provable →
 *                       honest `outcome_unknown` with `stale_dispatch_claim`,
 *                       forward_observation='not_observed'.
 *  Recovery still NEVER calls a provider and NEVER generates a token. */
export async function recoverRunningStale(
  pool: Pool,
  kms: Kms,
  input: { orgId: string; runId: string; recoveryGraceMs: number },
): Promise<RunningStaleRecovery> {
  return withTenantTx(pool, input.orgId, async (client) => {
    const r = await client.query<RecoveredRunRow>(
      `SELECT actor_user_id, mode, dispatch_token, dispatch_boundary_committed_at,
              workroom_id, created_by_participant_id
         FROM govai.runs
        WHERE id = $1::uuid
          AND dispatch_protocol_version = 1
          AND status = 'running'
          AND dispatch_deadline_at + make_interval(secs => $2::integer / 1000.0) < now()
        FOR UPDATE SKIP LOCKED`,
      [input.runId, input.recoveryGraceMs],
    );
    const run = r.rows[0];
    if (!run || !run.dispatch_token) return 'not_recovered';
    const ctx = recoveryEventCtx(input.orgId, input.runId, run);

    if (run.dispatch_boundary_committed_at === null) {
      // §18.1 — boundary absent: a claim existed but the mandatory durable
      // gate never committed; under the structural protocol the provider was
      // provably not called. KNOWN failure, never an unknown, no invocation.
      await client.query(
        `UPDATE govai.runs
            SET status = 'failed', completed_at = now(),
                dispatch_error_class = 'dispatch_never_started'
          WHERE id = $1::uuid`,
        [input.runId],
      );
      const eventId = await appendTerminalRunEvent(client, kms, ctx, {
        eventType: 'run.failed',
        payloadHash: sha256(Buffer.from(`dispatch_never_started:${input.runId}`)),
        redactionMetadata: {
          actor_user_id: run.actor_user_id,
          run_mode: run.mode,
          error_class: 'dispatch_never_started',
          provider_call_count: 0,
          recovered_by: 'run_dispatch_recovery',
        },
      });
      await maybeEnsureTurn(client, ctx, eventId);
      return 'failed_never_started';
    }

    // §18.2 — boundary present: honest unknown, conservative by design.
    const upd = await client.query<{ outcome_unknown_at: Date }>(
      `UPDATE govai.runs
          SET status = 'outcome_unknown',
              outcome_unknown_at = now(),
              dispatch_error_class = 'stale_dispatch_claim'
        WHERE id = $1::uuid
        RETURNING outcome_unknown_at`,
      [input.runId],
    );
    const event = RunOutcomeUnknownSchema.parse({
      event_type: 'run.outcome_unknown',
      schema_version: 1,
      org_id: input.orgId,
      run_id: input.runId,
      dispatch_token: run.dispatch_token,
      dispatch_error_class: 'stale_dispatch_claim',
      forward_observation: 'not_observed',
      dispatch_boundary_committed_at: run.dispatch_boundary_committed_at.toISOString(),
      outcome_unknown_at: upd.rows[0]!.outcome_unknown_at.toISOString(),
      occurred_at: upd.rows[0]!.outcome_unknown_at.toISOString(),
      chain_category: 'run',
    });
    const eventId = await appendLifecycleEvent(client, kms, ctx, event);
    await maybeEnsureTurn(client, ctx, eventId);
    return 'outcome_unknown';
  });
}
