// /v1/runs orchestrator — UX shortcut over the governed-native surface.
//
// EP-P03A-A (F3): durable provider dispatch OUTSIDE run database transactions.
// The pre-F3 flow held one PoolClient and one open transaction across the
// provider network call (and, for passthrough, the approval row lock). The
// flow is now phased:
//
//   authenticate (short-lived client, released)
//   → read-only preflight (own client, released; preserves error ordering)
//   → provider credential lookup (its OWN short transaction, committed +
//     released) → KMS envelope decrypt OUTSIDE any DB transaction
//   → TX-A: short durable preparation (run row + request hash + policy +
//     approval consumption + run.dispatch_prepared v1), committed
//   → deterministic pre-claim validation (known failure ⇒ queued→failed CAS)
//   → exclusive claim: CAS queued→running with a fresh dispatch_token
//     (run.dispatch_claimed v1) — ONLY the CAS winner may call the provider
//   → durable dispatch boundary (REV4): a second short CAS transaction commits
//     dispatch_boundary_committed_at IMMEDIATELY before the local fetch
//     invocation (awaited inside the forwarder via beforeDispatch, after a
//     governed block has been ruled out). Fail closed: no committed boundary
//     ⇒ no provider I/O, ever. The boundary is a durable LOCAL gate — never
//     proof of provider receipt or execution.
//   → provider I/O with ZERO database clients held, bounded by AbortSignal
//   → TX-B: new connection/transaction persisting the known result, or an
//     honest `outcome_unknown` when nothing is provable (§22), with late
//     reconciliation when a known result arrives after recovery marked the
//     run unknown (§26).
//
// Guarantee: AT-MOST-ONCE provider call per run (never exactly-once; never
// cross-request idempotency — that is P0.3-C). No automatic retry, ever.
//
// The canonical governed pipeline still lives in handle*Governed* from
// @govai/provider-anthropic / @govai/provider-openai; its emitAuditEvent
// callback is now an in-memory typed capture (§20) persisted in TX-B, and its
// resolveProviderKey callback returns the credential already resolved in
// memory before TX-A (§12.4) — no DB, no pool, no KMS inside the handler.

import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { auditAppend, sha256 } from '@govai/core-audit';
import { AUDIT_CHAIN_KEY } from './audit-keys.js';
import type { Kms } from '@govai/core-identity';
import { setLocalAppOrgId } from '@govai/core-tenant';
import {
  chainIdFor,
  PassthroughInvokedSchema,
  type PassthroughInvoked,
} from '@govai/core-events';
import type { GovAIEnv } from '@govai/config';
import type { ResolvedProviderCredential } from '@govai/core-types';
import { detectAllBaseline, mergeFindingSpans } from '@govai/dlp-br';
import {
  handleAnthropicGovernedMessages,
  forwardRaw as forwardRawAnthropic,
  rewritePassthroughHeaders as rewriteAnthropicPassthroughHeaders,
  type AnthropicGovernedTenant,
  type AnthropicDlpScanFn,
} from '@govai/provider-anthropic';
import {
  handleOpenAIGovernedResponses,
  handleOpenAIGovernedChatCompletions,
  forwardRaw as forwardRawOpenai,
  rewritePassthroughHeaders as rewriteOpenaiPassthroughHeaders,
  type OpenAIGovernedTenant,
  type OpenAIDlpScanFn,
} from '@govai/provider-openai';

import { authenticateApiKey, AuthError, type AuthIdentity } from './auth.js';
import {
  assertCapabilityExecutable,
  isLoopbackUrl,
  loadOrgOverrides,
  resolveCapability,
  CapabilityNotSupportedError,
  CapabilityNotRegisteredError,
} from './capability-resolution.js';
import {
  resolveAnthropicProviderKey,
  resolveOpenAIProviderKey,
} from './provider-credentials.js';
import { dlpPreScan, redactFindings, type MergedDlpFinding } from './dlp.js';
import {
  buildStandaloneRunIntent,
  buildWorkroomRunIntent,
  reserveRunIdempotency,
  resolveCommittedKeyedRequest,
  runIntentHash,
  RunIdempotencyLoserSignal,
  type RunIdempotencyExecution,
  type RunIdempotentReplay,
  type RunRouteScope,
} from './run-idempotency.js';
import { decidePolicy, persistPolicyDecision, type PipelinePolicyDecision } from './policy.js';
import { runDispatchConfigFromEnv, type RunDispatchConfig } from './run-dispatch-config.js';
import {
  appendDispatchPreparedEvent,
  claimDispatch,
  commitDispatchBoundary,
  DispatchBoundaryGateError,
  failBoundaryNotEstablished,
  failPreclaim,
  finalizeKnownOutcome,
  markOutcomeUnknown,
  type KnownOutcome,
  type RunDispatchContext,
} from './run-dispatch-state.js';

export type SupportedCapabilityId =
  | 'anthropic.messages.create'
  | 'openai.responses.create'
  | 'openai.chat.completions.create';

export type RunRequest = {
  workspace_id: string;
  capability: string;
  model: string;
  input: string;
  /**
   * Execution mode for the run. Omitted / 'governed' → the enforcement-active
   * governed path (executeGovernedRun). 'passthrough' → the observe-only
   * provider-native forward path (executePassthroughRun). 'shadow' is admitted
   * by the DB enum but has no `/v1/runs` execution path and is rejected by the
   * route.
   */
  mode?: 'governed' | 'passthrough' | 'shadow';
  metadata?: Record<string, unknown>;
};

export type RunResponse = {
  run_id: string;
  audit_chain_id: string;
  /** Absent on `outcome_unknown` (the lifecycle event id is not part of the
   *  minimal §23.1 contract) and on a lost claim answered from current state. */
  audit_event_id?: string;
  policy_decision?: { kind: string; reasons: string[] };
  output?: unknown;
  status: 'completed' | 'denied' | 'failed' | 'outcome_unknown';
  provider_invocation_id?: string;
  /** Hex of the canonical passthrough.invoked v4 event the governed handler emitted. */
  passthrough_invoked_event_id?: string;
  /** Always false for protocol v1 (§23): a repeat may re-execute the action. */
  retry_safe?: boolean;
  error_class?: string;
};

export type OrchestratorDeps = {
  pool: Pool;
  kms: Kms;
  env: GovAIEnv;
  policyCommitSha: string;
};

/**
 * Optional Workroom context threaded into a run executor (Workroom Phase 3,
 * issue #53). When present, the run is a Workroom-owned run: the orchestrator
 * persists the Workroom-linkage columns on `govai.runs` and guarantees exactly
 * one `workroom_turns` row of kind `run_event` for the run's terminal (or
 * honest-unknown) lifecycle event — enforced by the 0029 partial unique index.
 * When absent, standalone `/v1/runs` behavior is unchanged.
 */
export type WorkroomRunContext = {
  workroom_id: string;
  workroom_task_id?: string | null;
  created_by_participant_id: string;
  workroom_governance_mode: 'governance_active' | 'audit_only';
  approval_policy_id?: string | null;
};

/**
 * Append one `run_event` Workroom turn anchored to a real audit event, inside
 * the caller's transaction. Guarded: at most one turn per run (payload_ref),
 * with the 0029 partial unique index as backstop. The advisory xact lock
 * serializes per-workroom turn numbering.
 */
async function insertRunEventTurn(
  client: PoolClient,
  input: { orgId: string; workroomContext: WorkroomRunContext; runId: string; auditEventId: string },
): Promise<void> {
  const { orgId, workroomContext, runId, auditEventId } = input;
  await client.query("SELECT pg_advisory_xact_lock(hashtext('workroom_turn:' || $1)::bigint)", [
    workroomContext.workroom_id,
  ]);
  const exists = await client.query(
    `SELECT 1 FROM govai.workroom_turns
      WHERE kind = 'run_event' AND payload_ref = $1::uuid LIMIT 1`,
    [runId],
  );
  if (exists.rows.length > 0) return;
  const r = await client.query<{ next: string }>(
    'SELECT COALESCE(MAX(turn_number), 0) + 1 AS next FROM govai.workroom_turns WHERE workroom_id = $1',
    [workroomContext.workroom_id],
  );
  await client.query(
    `INSERT INTO govai.workroom_turns
       (id, org_id, workroom_id, turn_number, actor_participant_id, kind, audit_event_id, payload_ref)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::uuid, 'run_event', $6::uuid, $7::uuid)`,
    [
      randomUUID(),
      orgId,
      workroomContext.workroom_id,
      Number(r.rows[0]?.next ?? 1),
      workroomContext.created_by_participant_id,
      auditEventId,
      runId,
    ],
  );
}

/**
 * Raised when a WorkroomRunContext that passed the route preflight is no longer
 * valid at run write time (TOCTOU): the participant was removed, or a linked
 * task is gone / cross-workroom / cross-org. The route maps `code` to 403/404.
 */
export class WorkroomRunContextInvalidError extends Error {
  constructor(
    public readonly code: 'workroom_participant_not_active' | 'workroom_task_not_found',
  ) {
    super(code);
    this.name = 'WorkroomRunContextInvalidError';
  }
}

/**
 * Re-validate a WorkroomRunContext inside a transaction, before any Workroom
 * column or `workroom_turns` row is written. Runs in the read-only preflight
 * (fast clean 4xx) AND authoritatively inside TX-A.
 */
async function assertWorkroomRunContextStillValid(
  client: PoolClient,
  identity: AuthIdentity,
  workroomContext: WorkroomRunContext,
): Promise<void> {
  const participant = await client.query(
    `SELECT 1 FROM govai.workroom_participants
      WHERE id = $1::uuid AND org_id = $2::uuid AND workroom_id = $3::uuid AND status = 'active'
      LIMIT 1`,
    [workroomContext.created_by_participant_id, identity.org_id, workroomContext.workroom_id],
  );
  if (participant.rows.length === 0) {
    throw new WorkroomRunContextInvalidError('workroom_participant_not_active');
  }
  if (workroomContext.workroom_task_id) {
    const task = await client.query(
      `SELECT 1 FROM govai.workroom_tasks
        WHERE id = $1::uuid AND org_id = $2::uuid AND workroom_id = $3::uuid
        LIMIT 1`,
      [workroomContext.workroom_task_id, identity.org_id, workroomContext.workroom_id],
    );
    if (task.rows.length === 0) {
      throw new WorkroomRunContextInvalidError('workroom_task_not_found');
    }
  }
}

// =============================================================================
// Workroom Phase 4 (issue #57) — passthrough-override approval enforcement.
//
// A passthrough run requested inside a `governance_active` Workroom is a mode
// override. It is admitted only when a human-approved, unconsumed,
// parameter-matched `workroom_approval_requests` row authorizes it. The grant is
// bound to the exact run parameters via a canonical sha256; the approval is
// one-time-use, consumed atomically with the DURABLE PREPARATION of the run
// (TX-A). F3 consequence (owner-adjudicated): if TX-A commits and the provider
// is never called, the approval REMAINS consumed — a new execution requires a
// new authorization. Authorization is at-most-once, never replayed.
// =============================================================================

/** The provider-semantic parameters an approval is bound to. */
export type IntendedPassthroughAction = {
  mode: 'passthrough';
  capability: string;
  model: string;
  input: string;
  workspace_id: string;
};

/**
 * Deterministic JSON serialization: object keys sorted recursively, array order
 * preserved. Independent of JavaScript object insertion order, so the same
 * semantic value always yields the same string (and thus the same hash).
 */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/**
 * Canonical string for an intended passthrough action. Only the parameters that
 * affect provider-native execution are included; `approval_request_id` and
 * non-semantic metadata are intentionally excluded so a grant binds to the
 * action, not to the request that carried it.
 */
export function canonicalizeIntendedAction(action: IntendedPassthroughAction): string {
  return stableStringify({
    capability: action.capability,
    input: action.input,
    mode: action.mode,
    model: action.model,
    workspace_id: action.workspace_id,
  });
}

/** sha256 of the canonical intended action — the binding hash stored on a request. */
export function intendedActionHash(action: IntendedPassthroughAction): Buffer {
  return Buffer.from(sha256(Buffer.from(canonicalizeIntendedAction(action), 'utf8')));
}

export type WorkroomApprovalInvalidCode =
  | 'workroom_approval_not_found'
  | 'workroom_approval_wrong_workroom'
  | 'workroom_approval_subject_mismatch'
  | 'workroom_approval_already_consumed'
  | 'workroom_approval_revoked'
  | 'workroom_approval_denied'
  | 'workroom_approval_expired'
  | 'workroom_approval_not_granted';

/**
 * Raised when an `approval_request_id` supplied to authorize a passthrough
 * override is not in a state that can authorize the run. Thrown inside TX-A,
 * so it triggers ROLLBACK — no run row, no turn, and the approval is left
 * unconsumed. The route maps `code` to 404 (not_found) / 403.
 */
export class WorkroomApprovalInvalidError extends Error {
  constructor(public readonly code: WorkroomApprovalInvalidCode) {
    super(code);
    this.name = 'WorkroomApprovalInvalidError';
  }
}

/** A `workroom_approval_requests` row — the subset needed to authorize a run. */
export type ApprovalRowForValidation = {
  status: string;
  subject_kind: string;
  workroom_id: string;
  consumed_at: Date | null;
  expires_at: Date | null;
  intended_action_hash: Buffer;
};

/**
 * Pure validation: can this approval row authorize this passthrough run? The
 * single source of truth shared by the route preflight (fast clean 4xx) and the
 * orchestrator's transaction-local revalidation (the authoritative check under
 * a row lock). Read-time expiry is applied here — a granted approval past its
 * `expires_at` is not honorable; no background sweeper is involved.
 */
export function validateApprovalForRun(
  row: ApprovalRowForValidation | null,
  expected: { workroomId: string; action: IntendedPassthroughAction },
): { ok: true } | { ok: false; code: WorkroomApprovalInvalidCode } {
  if (!row) return { ok: false, code: 'workroom_approval_not_found' };
  if (row.workroom_id !== expected.workroomId) {
    return { ok: false, code: 'workroom_approval_wrong_workroom' };
  }
  if (row.subject_kind !== 'passthrough_run') {
    return { ok: false, code: 'workroom_approval_subject_mismatch' };
  }
  if (row.consumed_at !== null) {
    return { ok: false, code: 'workroom_approval_already_consumed' };
  }
  if (row.status === 'revoked') return { ok: false, code: 'workroom_approval_revoked' };
  if (row.status === 'denied') return { ok: false, code: 'workroom_approval_denied' };
  if (row.status === 'expired') return { ok: false, code: 'workroom_approval_expired' };
  if (row.status !== 'granted') return { ok: false, code: 'workroom_approval_not_granted' };
  if (row.expires_at !== null && row.expires_at.getTime() <= Date.now()) {
    return { ok: false, code: 'workroom_approval_expired' };
  }
  if (!row.intended_action_hash.equals(intendedActionHash(expected.action))) {
    return { ok: false, code: 'workroom_approval_subject_mismatch' };
  }
  return { ok: true };
}

/** Context threaded into a passthrough run to consume an authorizing approval. */
export type ApprovalConsumptionContext = {
  approval_request_id: string;
};

const APPROVAL_ROW_SQL = `SELECT status, subject_kind, workroom_id, consumed_at, expires_at, intended_action_hash
       FROM govai.workroom_approval_requests
      WHERE id = $1::uuid AND org_id = $2::uuid`;

/**
 * Re-validate the authorizing approval inside TX-A, under a `FOR UPDATE` row
 * lock. The lock serializes concurrent consumption and NEVER survives TX-A's
 * commit — it can no longer cross claim, provider I/O, timeout or TX-B (F3).
 */
async function assertApprovalConsumable(
  client: PoolClient,
  identity: AuthIdentity,
  input: { workroomContext: WorkroomRunContext; approvalRequestId: string; body: RunRequest },
): Promise<void> {
  const r = await client.query<ApprovalRowForValidation>(`${APPROVAL_ROW_SQL}
      FOR UPDATE`, [input.approvalRequestId, identity.org_id]);
  const v = validateApprovalForRun(r.rows[0] ?? null, {
    workroomId: input.workroomContext.workroom_id,
    action: {
      mode: 'passthrough',
      capability: input.body.capability,
      model: input.body.model,
      input: input.body.input,
      workspace_id: input.body.workspace_id,
    },
  });
  if (!v.ok) throw new WorkroomApprovalInvalidError(v.code);
}

/**
 * Consume the authorizing approval — one-time-use, bound to the durably
 * prepared run. Runs inside TX-A after the run row exists. The `consumed_at IS
 * NULL` guard plus the `FOR UPDATE` lock taken by assertApprovalConsumable make
 * consumption exactly-once.
 */
async function consumeApproval(
  client: PoolClient,
  input: { approvalRequestId: string; runId: string },
): Promise<void> {
  const r = await client.query(
    `UPDATE govai.workroom_approval_requests
        SET consumed_run_id = $2::uuid, consumed_at = now()
      WHERE id = $1::uuid AND consumed_at IS NULL`,
    [input.approvalRequestId, input.runId],
  );
  if (r.rowCount !== 1) {
    throw new WorkroomApprovalInvalidError('workroom_approval_already_consumed');
  }
}

/**
 * Resolve the upstream provider base URL. Mirrors the fallback behavior of the
 * direct governed routes: an explicit GOVAI_PROVIDER_BASE_URL wins (hermetic
 * loopback tests, operator-pinned proxy); otherwise the canonical production
 * URL. Never returns an empty string (issue #31).
 */
function providerUpstreamBaseUrl(env: GovAIEnv, provider: 'anthropic' | 'openai'): string {
  if (env.GOVAI_PROVIDER_BASE_URL && env.GOVAI_PROVIDER_BASE_URL.length > 0) {
    return env.GOVAI_PROVIDER_BASE_URL;
  }
  return provider === 'anthropic'
    ? 'https://api.anthropic.com'
    : 'https://api.openai.com';
}

function buildAnthropicMessagesBody(model: string, inputText: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: inputText }],
    }),
    'utf8',
  );
}

function buildOpenAIResponsesBody(model: string, inputText: string): Buffer {
  return Buffer.from(JSON.stringify({ model, input: inputText }), 'utf8');
}

function buildOpenAIChatCompletionsBody(model: string, inputText: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      model,
      messages: [{ role: 'user', content: inputText }],
    }),
    'utf8',
  );
}

function buildAnthropicTenant(identity: AuthIdentity): AnthropicGovernedTenant {
  return {
    org_id: identity.org_id,
    user_id: identity.user_id,
    tier: identity.tier,
    operational_mode: identity.operational_mode,
  };
}
function buildOpenAITenant(identity: AuthIdentity): OpenAIGovernedTenant {
  return {
    org_id: identity.org_id,
    user_id: identity.user_id,
    tier: identity.tier,
    operational_mode: identity.operational_mode,
  };
}

// FIXUP3 (Mudança B): 1 linha em govai.dlp_findings por SPAN fundido, chamada
// UMA vez logo após persistPolicyDecision — dentro da MESMA transação — para
// que os TRÊS caminhos (deny/redact/allow) persistam a evidência por span.
async function persistMergedDlpFindings(
  client: PoolClient,
  orgId: string,
  runId: string,
  findings: ReadonlyArray<MergedDlpFinding>,
): Promise<void> {
  // `detector_id` é o rótulo vencedor do span; `action` é a ação EFETIVA
  // (máximo sobre os detectores-membro — preserva um deny/redact configurado
  // num detector que perdeu o rótulo).
  for (const f of findings) {
    await client.query(
      `INSERT INTO govai.dlp_findings (id, run_id, org_id, detector_id, detector_kind, count, action)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, 'baseline', 1, $5::text)`,
      [randomUUID(), runId, orgId, f.detector, f.action],
    );
  }
}

const inMemoryDlpScan: AnthropicDlpScanFn & OpenAIDlpScanFn = async (text) => {
  // The orchestrator already pre-scans (DB-aware) over the input string, so by
  // the time the body reaches the handler it is either redacted (no findings)
  // or accepted (findings emit a `dlp_decisions` audit entry but enforcement
  // already approved). The handler's own scan stays no-DB on this code path.
  //
  // F6: spans fundidos, não matches brutos — um CPF nu (casa cpf+phone_br)
  // conta como UM achado de classe forte; `findings_count`/`finding_classes`
  // do evento derivam daqui. A escalação de risco é invariante (a classe mais
  // forte do span é preservada; o máximo decide).
  const findings = mergeFindingSpans(detectAllBaseline(text));
  return {
    findings: findings.map((f) => ({
      detector: f.detector,
      signal_class: f.signal_class,
    })),
  };
};

// =============================================================================
// F3 shared building blocks
// =============================================================================

/** Map an executable capability to its provider, or throw the same
 *  CapabilityNotSupportedError shape the pre-F3 plan builder threw. */
function providerForCapability(capability: string): 'anthropic' | 'openai' {
  switch (capability) {
    case 'anthropic.messages.create':
      return 'anthropic';
    case 'openai.responses.create':
    case 'openai.chat.completions.create':
      return 'openai';
    default:
      throw new CapabilityNotSupportedError(capability, 'planned');
  }
}

/** §12.1 — authenticate on a short-lived client that is released before any
 *  preflight, credential, KMS or TX-A work. */
async function authenticateShortLived(pool: Pool, apiKey: string): Promise<AuthIdentity> {
  const client = await pool.connect();
  try {
    return await authenticateApiKey(client, apiKey);
  } finally {
    client.release();
  }
}

/** §12.2 — short tenant-safe read-only preflight preserving error ordering.
 *  Takes NO row locks; TX-A re-validates everything authoritatively. */
async function runPreflight(
  deps: OrchestratorDeps,
  identity: AuthIdentity,
  body: RunRequest,
  workroomContext?: WorkroomRunContext,
  approval?: ApprovalConsumptionContext,
): Promise<void> {
  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await setLocalAppOrgId(client, identity.org_id);
      if (workroomContext) {
        await assertWorkroomRunContextStillValid(client, identity, workroomContext);
      }
      if (approval && workroomContext) {
        const r = await client.query<ApprovalRowForValidation>(APPROVAL_ROW_SQL, [
          approval.approval_request_id,
          identity.org_id,
        ]);
        const v = validateApprovalForRun(r.rows[0] ?? null, {
          workroomId: workroomContext.workroom_id,
          action: {
            mode: 'passthrough',
            capability: body.capability,
            model: body.model,
            input: body.input,
            workspace_id: body.workspace_id,
          },
        });
        if (!v.ok) throw new WorkroomApprovalInvalidError(v.code);
      }
      const overrides = await loadOrgOverrides(client, body.capability);
      const resolved = resolveCapability(body.capability, overrides);
      assertCapabilityExecutable(resolved, deps.env);
      providerForCapability(body.capability);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  } finally {
    client.release();
  }
}

/** §12.3 — resolve the provider credential fully BEFORE TX-A. The lookup uses
 *  its own short committed transaction (inside the resolver) and the KMS
 *  decrypt happens outside any DB transaction. */
async function resolveCredentialForProvider(
  deps: OrchestratorDeps,
  identity: AuthIdentity,
  provider: 'anthropic' | 'openai',
): Promise<ResolvedProviderCredential> {
  return provider === 'anthropic'
    ? resolveAnthropicProviderKey(
        { env: deps.env, pool: deps.pool, kms: deps.kms },
        { orgId: identity.org_id, operationalMode: identity.operational_mode },
      )
    : resolveOpenAIProviderKey(
        { env: deps.env, pool: deps.pool, kms: deps.kms },
        { orgId: identity.org_id, operationalMode: identity.operational_mode },
      );
}

/** §20 — typed in-memory capture of the governed v4 event. No client, no
 *  query, no KMS, no outbox, no auditAppend; at most one event; validated. */
export function createGovernedV4Capture(): {
  capture: (event: PassthroughInvoked) => void;
  captured: () => PassthroughInvoked | null;
} {
  let captured: PassthroughInvoked | null = null;
  return {
    capture: (event: PassthroughInvoked): void => {
      const parsed = PassthroughInvokedSchema.parse(event);
      if (captured !== null) {
        throw new Error('governed v4 capture: duplicate event for a single dispatch');
      }
      captured = parsed;
    },
    captured: () => captured,
  };
}

/** §22 — classify a post-forward-start failure. Only OUR AbortSignal aborts
 *  the fetch, so an abort name maps to the dispatch timeout. */
function unknownErrorClass(err: unknown): 'provider_timeout' | 'provider_io_unknown' {
  const name = err instanceof Error ? err.name : '';
  return name === 'TimeoutError' || name === 'AbortError' ? 'provider_timeout' : 'provider_io_unknown';
}

/**
 * REV4 §16 — the database-backed durable gate, constructed ONLY for the
 * protocol-v1 forward paths (direct-provider routes never receive it). Closes
 * over the pool, run context and claim token; commits the boundary in its own
 * short tenant transaction (client released before returning) at the latest
 * practical local point before `fetch` — inside the forwarder, after a
 * governed block has been ruled out. ANY non-success (zero-row CAS or a
 * boundary-transaction error) surfaces as DispatchBoundaryGateError, making a
 * provider forward past a failed gate structurally impossible (fail closed).
 */
function makeBoundaryGate(
  deps: OrchestratorDeps,
  ctx: RunDispatchContext,
  token: string,
): () => Promise<void> {
  return async (): Promise<void> => {
    let result: Awaited<ReturnType<typeof commitDispatchBoundary>>;
    try {
      result = await commitDispatchBoundary(deps.pool, ctx, { token });
    } catch (err) {
      // Error NAME only — never raw PostgreSQL text into the closed error.
      throw new DispatchBoundaryGateError(
        ctx.runId,
        'commit_error',
        err instanceof Error ? err.name : 'unknown',
      );
    }
    if (!result.committed) {
      throw new DispatchBoundaryGateError(ctx.runId, result.reason);
    }
  };
}

/**
 * Post-claim terminal persistence (TX-B / honest-unknown marking) failed —
 * e.g. PostgreSQL or audit signing temporarily unavailable AFTER the provider
 * may already have executed the action. The run row stays durably 'running'
 * (recovery will mark it unknown on database time); the caller must NOT see a
 * bare 500 that invites repeating the request — a repeat would execute the
 * provider action again under a NEW run id. The route maps this to a 500-class
 * body that still carries the durable run id, retry_safe=false and a Location
 * to poll.
 */
export class DispatchPersistenceError extends Error {
  constructor(
    public readonly runId: string,
    public readonly chainId: string,
    public readonly causeName: string,
  ) {
    super(`dispatch terminal persistence failed for run ${runId}`);
    this.name = 'DispatchPersistenceError';
  }
}

/** Wrap a post-TX-A protocol write (claim, pre-claim failure, boundary
 *  failure, terminal/unknown persistence) so an infrastructure failure —
 *  including a COMMIT whose acknowledgement is lost while the write stands
 *  server-side — surfaces as DispatchPersistenceError carrying the DURABLE
 *  run id instead of a bare 500 (Codex P2 on 502b8b3: the claim CAS had the
 *  same ambiguous-outcome exposure as TX-B; a durable run exists from TX-A
 *  on, so the caller must always receive the run-aware polling contract). */
async function persistTerminal<T>(ctx: RunDispatchContext, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new DispatchPersistenceError(
      ctx.runId,
      ctx.chainId,
      err instanceof Error ? err.name : 'unknown',
    );
  }
}

/** Defensive deterministic cap (§16): the route already bounds `input` at 50k
 *  chars, so a native body beyond this is a construction bug, not user data. */
const MAX_NATIVE_BODY_BYTES = 5_000_000;

/**
 * Remaining forward budget anchored to the DURABLE claim deadline WITHOUT
 * ever differencing two clocks (Codex P2 on 633e10b): the database sets
 * `dispatch_deadline_at = db_now + timeout` at claim COMMIT, so the time
 * already spent against that deadline is measured as a MONOTONIC same-clock
 * local delta — performance.now() elapsed since just before the claim call
 * (Codex P2 on 3774a79: the wall clock can step backward under NTP/VM
 * corrections and would restore consumed budget; the monotonic clock cannot).
 * The delta over-counts by the pre-commit half of the claim round trip,
 * which is strictly CONSERVATIVE: the AbortSignal can only fire at or before
 * the database deadline, never live past it. The boundary CAS additionally
 * re-checks `dispatch_deadline_at > now()` on DATABASE time at the last
 * local point before the fetch. Non-positive ⇒ refuse to forward (known
 * local pre-forward failure).
 */
function remainingDispatchBudgetMs(configuredMs: number, elapsedSinceBeforeClaimMs: number): number {
  // Floor to an integer: AbortSignal.timeout requires one, and rounding DOWN
  // is the conservative direction (the budget never exceeds true remaining).
  return Math.min(configuredMs, Math.floor(configuredMs - elapsedSinceBeforeClaimMs));
}

type DeterministicPlan = {
  upstreamBaseUrl: string;
  nativeEndpoint: string;
  inboundHeaders: Record<string, string>;
};

/** §16 — everything deterministic, validated BEFORE the claim so no predictable
 *  exception is discovered after it. Throwing here ⇒ queued→failed CAS. */
function buildDeterministicPlan(
  env: GovAIEnv,
  provider: 'anthropic' | 'openai',
  nativeEndpoint: string,
  nativeRequestBody: Buffer,
  workspaceId: string,
  timeoutMs: number,
): DeterministicPlan {
  const upstreamBaseUrl = providerUpstreamBaseUrl(env, provider);
  // URL validity — both the base and the concrete endpoint URL must parse.
  new URL(upstreamBaseUrl);
  new URL(`${upstreamBaseUrl.replace(/\/$/, '')}${nativeEndpoint}`);
  if (!nativeEndpoint.startsWith('/')) {
    throw new Error(`invalid native endpoint: ${nativeEndpoint}`);
  }
  if (nativeRequestBody.length === 0 || nativeRequestBody.length > MAX_NATIVE_BODY_BYTES) {
    throw new Error(`native request body out of bounds: ${nativeRequestBody.length} bytes`);
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 900_000) {
    throw new Error(`dispatch timeout out of bounds: ${timeoutMs}`);
  }
  const envBaseUrl = env.GOVAI_PROVIDER_BASE_URL ?? '';
  // Hermetic loopback only: forward the test workspace discriminator so tests
  // can inject per-workspace upstream behavior. Never set in real environments.
  const inboundHeaders: Record<string, string> = { 'content-type': 'application/json' };
  if (env.NODE_ENV === 'test' && isLoopbackUrl(envBaseUrl)) {
    inboundHeaders['x-test-workspace-id'] = workspaceId;
  }
  return { upstreamBaseUrl, nativeEndpoint, inboundHeaders };
}

function workroomCtxOf(
  workroomContext?: WorkroomRunContext,
): { workroomId: string; participantId: string } | null {
  return workroomContext
    ? {
        workroomId: workroomContext.workroom_id,
        participantId: workroomContext.created_by_participant_id,
      }
    : null;
}

/** Answer honestly from the current durable state after a lost claim (§17) or
 *  any race with recovery — never generate another token, never re-dispatch. */
async function readRunStateResponse(
  deps: OrchestratorDeps,
  ctx: RunDispatchContext,
  decision?: PipelinePolicyDecision,
): Promise<RunResponse> {
  const client = await deps.pool.connect();
  try {
    let r: { rows: Array<{ status: string; dispatch_error_class: string | null }> };
    await client.query('BEGIN');
    try {
      await setLocalAppOrgId(client, ctx.orgId);
      r = await client.query<{ status: string; dispatch_error_class: string | null }>(
        'SELECT status, dispatch_error_class FROM govai.runs WHERE id = $1::uuid',
        [ctx.runId],
      );
      await client.query('COMMIT');
    } catch (err) {
      // Never hand an open/aborted transaction back to the pool.
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
    const row = r.rows[0];
    const status = row?.status ?? 'failed';
    return {
      run_id: ctx.runId,
      audit_chain_id: ctx.chainId,
      status:
        status === 'outcome_unknown'
          ? 'outcome_unknown'
          : status === 'denied'
            ? 'denied'
            : status === 'completed'
              ? 'completed'
              : 'failed',
      retry_safe: false,
      ...(row?.dispatch_error_class ? { error_class: row.dispatch_error_class } : {}),
      ...(decision ? { policy_decision: { kind: decision.kind, reasons: [...decision.reasons] } } : {}),
    };
  } finally {
    client.release();
  }
}

function buildUsageJson(responseBodyParsed: unknown): Record<string, unknown> {
  return {
    provider_native:
      responseBodyParsed && typeof responseBodyParsed === 'object'
        ? ((responseBodyParsed as { usage?: unknown }).usage ?? null)
        : null,
    normalized: null,
    source: 'provider_direct',
    pricing_table_version: 'v0',
  };
}

function parseResponseBody(raw: Buffer): unknown {
  if (raw.length === 0) return null;
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return { raw: raw.toString('utf8') };
  }
}

// =============================================================================
// P0.3-C — cross-request execution idempotency (shared by both executors)
// =============================================================================

/** The resolved idempotency context for ONE keyed execution: the key hash from
 *  the route plus the canonical intent hash computed here. */
type ResolvedIdempotencyContext = {
  keyHash: Buffer;
  intentHash: Buffer;
  routeScope: RunRouteScope;
};

/** Build + hash the canonical RunExecutionIntentV1 for this execution. Uses
 *  the SAME builders as the Workroom route's committed-replay probe so the
 *  projection cannot drift between the route and the executor. */
function resolveIdempotencyContext(
  idem: RunIdempotencyExecution,
  identity: AuthIdentity,
  body: RunRequest,
  resolvedMode: 'governed' | 'passthrough',
  workroomContext?: WorkroomRunContext,
  approval?: ApprovalConsumptionContext,
): ResolvedIdempotencyContext {
  const intent = workroomContext
    ? buildWorkroomRunIntent({
        actorUserId: identity.user_id,
        createdByParticipantId: workroomContext.created_by_participant_id,
        workroomId: workroomContext.workroom_id,
        workroomTaskId: workroomContext.workroom_task_id ?? null,
        workroomGovernanceMode: workroomContext.workroom_governance_mode,
        workspaceId: body.workspace_id,
        capability: body.capability,
        model: body.model,
        input: body.input,
        resolvedMode,
        metadata: body.metadata,
        effectiveApprovalRequestId: approval?.approval_request_id ?? null,
      })
    : buildStandaloneRunIntent({
        actorUserId: identity.user_id,
        workspaceId: body.workspace_id,
        capability: body.capability,
        model: body.model,
        input: body.input,
        resolvedMode,
        metadata: body.metadata,
      });
  return {
    keyHash: idem.keyHash,
    intentHash: runIntentHash(intent),
    routeScope: workroomContext ? 'workroom' : 'standalone',
  };
}

/** §13/§14 — TX-A reservation, called immediately after the candidate run row
 *  exists and BEFORE any duplicate-sensitive durable work. Loser ⇒
 *  RunIdempotencyLoserSignal: the TX-A catch rolls the whole candidate
 *  transaction back (no committed run / policy / DLP / approval / turn) and
 *  the executor answers from the committed binding. */
async function reserveOrSignalLoser(
  client: PoolClient,
  orgId: string,
  runId: string,
  idem: ResolvedIdempotencyContext,
): Promise<void> {
  const winner = await reserveRunIdempotency(client, {
    orgId,
    keyHash: idem.keyHash,
    intentHash: idem.intentHash,
    routeScope: idem.routeScope,
    runId,
  });
  if (!winner) throw new RunIdempotencyLoserSignal();
}

/** §13.2 — the candidate transaction lost the reservation and was rolled back;
 *  answer from the committed binding: matching intent ⇒ replay, divergent ⇒
 *  RunIdempotencyConflictError (409). A loser implies a COMMITTED binding (the
 *  unique-index arbitration only reports a conflict after the owning
 *  transaction commits — an owner that rolls back lets the contender win
 *  instead), so a missing binding here is an invariant break, never a retry. */
async function answerAsLoser(
  deps: OrchestratorDeps,
  orgId: string,
  idem: ResolvedIdempotencyContext,
): Promise<RunIdempotentReplay> {
  const replay = await resolveCommittedKeyedRequest(
    deps.pool,
    orgId,
    idem.keyHash,
    idem.intentHash,
  );
  if (!replay) {
    throw new Error('run idempotency: reservation lost but no committed binding is visible');
  }
  return replay;
}

// =============================================================================
// Governed execution (F3-phased)
// =============================================================================

type GovernedTxAResult =
  | { kind: 'denied'; response: RunResponse }
  | {
      kind: 'prepared';
      runId: string;
      chainId: string;
      decision: PipelinePolicyDecision;
      dlpFindingCount: number;
      nativeRequestBody: Buffer;
      nativeRequestHash: Buffer;
      nativeRequestHashHex: string;
    };

/** §14.1 — TX-A (governed): short durable preparation. Never crosses a
 *  provider handler, forwarder, fetch, credential lookup, KMS or a nested
 *  pool acquisition. */
async function governedTxA(
  deps: OrchestratorDeps,
  identity: AuthIdentity,
  body: RunRequest,
  workroomContext?: WorkroomRunContext,
  idem?: ResolvedIdempotencyContext,
): Promise<GovernedTxAResult> {
  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await setLocalAppOrgId(client, identity.org_id);

      if (workroomContext) {
        await assertWorkroomRunContextStillValid(client, identity, workroomContext);
      }
      const overrides = await loadOrgOverrides(client, body.capability);
      const resolved = resolveCapability(body.capability, overrides);
      assertCapabilityExecutable(resolved, deps.env);

      const runId = randomUUID();
      const chainId = chainIdFor(identity.org_id, 'run');

      await client.query(
        `INSERT INTO govai.runs
           (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
            workroom_id, workroom_task_id, created_by_participant_id, approval_policy_id,
            workroom_governance_mode)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::text, 'governed', 'queued',
            $7::jsonb, $8::uuid, $9::uuid, $10::uuid, $11::uuid, $12::text)`,
        [
          runId,
          identity.org_id,
          body.workspace_id,
          identity.user_id,
          body.capability.split('.')[0],
          body.model,
          JSON.stringify(body.metadata ?? {}),
          workroomContext?.workroom_id ?? null,
          workroomContext?.workroom_task_id ?? null,
          workroomContext?.created_by_participant_id ?? null,
          workroomContext?.approval_policy_id ?? null,
          workroomContext?.workroom_governance_mode ?? null,
        ],
      );

      // P0.3-C §14 — the idempotency reservation is established immediately
      // after the candidate run exists and BEFORE any duplicate-sensitive
      // durable work (policy decision, DLP findings, deny evidence). A loser
      // rolls the whole candidate transaction back via the catch below.
      if (idem) {
        await reserveOrSignalLoser(client, identity.org_id, runId, idem);
      }

      const dlp = await dlpPreScan(client, body.input);
      const { decision } = decidePolicy(
        {
          capabilityId: body.capability,
          effectiveLevel: resolved.effectiveFacets[0]?.effectiveLevel ?? 1,
          policyCommitSha: deps.policyCommitSha,
        },
        dlp,
      );
      await persistPolicyDecision(client, identity.org_id, runId, decision);
      // FIXUP3 (Mudança B): persiste os spans fundidos AQUI — antes do branch
      // de deny — para que a run NEGADA também grave a evidência por detector.
      await persistMergedDlpFindings(client, identity.org_id, runId, dlp.findings);

      if (decision.kind === 'deny') {
        // Policy deny commits WITHOUT protocol v1: no dispatch may ever be
        // claimed for this run, and no provider call is possible. The deny
        // event is stamped with the DATABASE transition instant (same
        // single-clock discipline as the v1 terminal events).
        const denyUpd = await client.query<{ completed_at: Date }>(
          `UPDATE govai.runs SET status = 'denied', completed_at = now() WHERE id = $1::uuid
          RETURNING completed_at`,
          [runId],
        );
        const denyAudit = await auditAppend(client, deps.kms, {
          orgId: identity.org_id,
          chainId,
          eventType: 'run.denied',
          eventVersion: '1',
          subjectType: 'run',
          subjectId: runId,
          occurredAt: denyUpd.rows[0]!.completed_at,
          payloadHash: sha256(Buffer.from(JSON.stringify(decision.reasons))),
          ...AUDIT_CHAIN_KEY,
          redactionMetadata: {
            actor_user_id: identity.user_id,
            policy_decision_id: decision.id,
            dlp_finding_count: dlp.findings.length,
          },
        });
        if (workroomContext) {
          await insertRunEventTurn(client, {
            orgId: identity.org_id,
            workroomContext,
            runId,
            auditEventId: denyAudit.eventId,
          });
        }
        await client.query('COMMIT');
        return {
          kind: 'denied',
          response: {
            run_id: runId,
            audit_chain_id: chainId,
            audit_event_id: denyAudit.eventId,
            policy_decision: { kind: decision.kind, reasons: [...decision.reasons] },
            status: 'denied',
          },
        };
      }

      // FIXUP3 (Mudança A): redigir SÓ os spans cuja ação EFETIVA é `redact`.
      const redactionSpans = dlp.findings.filter((f) => f.action === 'redact');
      const effectiveInput =
        redactionSpans.length > 0 ? redactFindings(body.input, redactionSpans) : body.input;

      let nativeRequestBody: Buffer;
      if (body.capability === 'anthropic.messages.create') {
        nativeRequestBody = buildAnthropicMessagesBody(body.model, effectiveInput);
      } else if (body.capability === 'openai.responses.create') {
        nativeRequestBody = buildOpenAIResponsesBody(body.model, effectiveInput);
      } else if (body.capability === 'openai.chat.completions.create') {
        nativeRequestBody = buildOpenAIChatCompletionsBody(body.model, effectiveInput);
      } else {
        throw new CapabilityNotSupportedError(body.capability, 'planned');
      }
      const nativeRequestHash = Buffer.from(sha256(nativeRequestBody));
      const nativeRequestHashHex = nativeRequestHash.toString('hex');

      // Durable preparation: protocol v1, still 'queued' — no claim, no
      // started_at, no token. The provider CANNOT have been called yet. The
      // prepared event's occurred_at is the DATABASE-clock instant RETURNED
      // by this write (Codex P2 on 97fa3e3): a split application clock must
      // never make the bound lifecycle event disagree with the durable row
      // or appear after its database-timed claim.
      const upd = await client.query<{ dispatch_prepared_at: Date }>(
        `UPDATE govai.runs
            SET dispatch_protocol_version = 1, dispatch_prepared_at = now()
          WHERE id = $1::uuid
        RETURNING dispatch_prepared_at`,
        [runId],
      );
      const preparedAt = upd.rows[0]!.dispatch_prepared_at;
      await appendDispatchPreparedEvent(
        client,
        deps.kms,
        {
          orgId: identity.org_id,
          runId,
          chainId,
          actorUserId: identity.user_id,
          mode: 'governed',
          provider: providerForCapability(body.capability),
          capabilityId: body.capability,
          model: body.model,
          workroom: workroomCtxOf(workroomContext),
        },
        { nativeRequestHashHex, occurredAt: preparedAt },
      );

      await client.query('COMMIT');
      return {
        kind: 'prepared',
        runId,
        chainId,
        decision,
        dlpFindingCount: dlp.findings.length,
        nativeRequestBody,
        nativeRequestHash,
        nativeRequestHashHex,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  } finally {
    client.release();
  }
}

export function executeGovernedRun(
  deps: OrchestratorDeps,
  apiKey: string,
  body: RunRequest,
  workroomContext?: WorkroomRunContext,
): Promise<RunResponse>;
export function executeGovernedRun(
  deps: OrchestratorDeps,
  apiKey: string,
  body: RunRequest,
  workroomContext: WorkroomRunContext | undefined,
  idem: RunIdempotencyExecution | undefined,
): Promise<RunResponse | RunIdempotentReplay>;
export async function executeGovernedRun(
  deps: OrchestratorDeps,
  apiKey: string,
  body: RunRequest,
  workroomContext?: WorkroomRunContext,
  idem?: RunIdempotencyExecution,
): Promise<RunResponse | RunIdempotentReplay> {
  const config: RunDispatchConfig = runDispatchConfigFromEnv(deps.env);

  // §12.1 — authenticate; client released before anything else.
  const identity = await authenticateShortLived(deps.pool, apiKey);

  // P0.3-C §10 — committed-replay probe BEFORE preflight, credential lookup,
  // KMS decrypt and any new durable work: a matching keyed replay returns the
  // existing durable run; a divergent keyed request is a 409.
  const idemCtx = idem
    ? resolveIdempotencyContext(idem, identity, body, 'governed', workroomContext)
    : undefined;
  if (idemCtx) {
    const replay = await resolveCommittedKeyedRequest(
      deps.pool,
      identity.org_id,
      idemCtx.keyHash,
      idemCtx.intentHash,
    );
    if (replay) return replay;
  }

  // §12.2 — read-only preflight (error ordering: workroom/capability before credential).
  await runPreflight(deps, identity, body, workroomContext);

  // §12.3 — credential lookup (own short TX) + KMS decrypt, all before TX-A.
  const provider = providerForCapability(body.capability);
  const resolvedCredential = await resolveCredentialForProvider(deps, identity, provider);

  // §14.1 — TX-A: durable preparation (or committed policy deny). A lost
  // P0.3-C reservation surfaces here AFTER the candidate rollback.
  let txa: GovernedTxAResult;
  try {
    txa = await governedTxA(deps, identity, body, workroomContext, idemCtx);
  } catch (err) {
    if (err instanceof RunIdempotencyLoserSignal && idemCtx) {
      return answerAsLoser(deps, identity.org_id, idemCtx);
    }
    throw err;
  }
  if (txa.kind === 'denied') return txa.response;

  const ctx: RunDispatchContext = {
    orgId: identity.org_id,
    runId: txa.runId,
    chainId: txa.chainId,
    actorUserId: identity.user_id,
    mode: 'governed',
    provider,
    capabilityId: body.capability,
    model: body.model,
    policyDecisionId: txa.decision.id,
    workroom: workroomCtxOf(workroomContext),
  };
  const nativeEndpoint =
    provider === 'anthropic'
      ? '/v1/messages'
      : body.capability === 'openai.responses.create'
        ? '/v1/responses'
        : '/v1/chat/completions';

  // §16 — deterministic validation BEFORE the claim.
  let plan: DeterministicPlan;
  try {
    plan = buildDeterministicPlan(
      deps.env,
      provider,
      nativeEndpoint,
      txa.nativeRequestBody,
      body.workspace_id,
      config.timeoutMs,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const preclaimed = await persistTerminal(ctx, () =>
      failPreclaim(deps.pool, deps.kms, ctx, {
        errorClass: 'dispatch_preclaim_failed',
        message,
      }),
    );
    if (!preclaimed) {
      // The queued→failed CAS lost (Codex P2 on 7f08ede): e.g. recovery
      // already resolved the run (dispatch_never_claimed) while this process
      // was paused after TX-A. Answer from the durable row — never assert a
      // preclaim failure the audit record contradicts.
      return readRunStateResponse(deps, ctx, txa.decision);
    }
    return {
      run_id: txa.runId,
      audit_chain_id: txa.chainId,
      policy_decision: { kind: txa.decision.kind, reasons: [...txa.decision.reasons] },
      status: 'failed',
      retry_safe: false,
      error_class: 'dispatch_preclaim_failed',
    };
  }

  // §17 — exclusive claim. Only the CAS winner may call the provider. The
  // claim is a post-TX-A protocol write: an ambiguous outcome (e.g. a lost
  // COMMIT acknowledgement with the claim standing server-side) must surface
  // run-aware, never as a bare 500 without the durable run id.
  const claimStartedAtMs = performance.now();
  const claim = await persistTerminal(ctx, () =>
    claimDispatch(deps.pool, deps.kms, ctx, { timeoutMs: config.timeoutMs }),
  );
  if (!claim.claimed) {
    return readRunStateResponse(deps, ctx, txa.decision);
  }

  // The abort budget is anchored to the DURABLE deadline fixed at claim time —
  // a stalled process must not start I/O the protocol already gave up on. The
  // elapsed time is a MONOTONIC same-clock delta (performance.now): a wall
  // clock stepping backward mid-claim must never restore consumed budget.
  const budgetMs = remainingDispatchBudgetMs(
    config.timeoutMs,
    performance.now() - claimStartedAtMs,
  );
  if (budgetMs <= 0) {
    const fin = await persistTerminal(ctx, () =>
      finalizeKnownOutcome(deps.pool, deps.kms, ctx, {
        token: claim.token,
        outcome: {
          kind: 'local_error',
          message: 'dispatch deadline elapsed before the forward started',
        },
      }),
    );
    return {
      run_id: txa.runId,
      audit_chain_id: txa.chainId,
      ...(fin.auditEventId ? { audit_event_id: fin.auditEventId } : {}),
      policy_decision: { kind: txa.decision.kind, reasons: [...txa.decision.reasons] },
      status: 'failed',
      retry_safe: false,
      error_class: 'dispatch_pre_forward_failed',
    };
  }

  // §19/§20 — provider I/O: ZERO database clients held; credential in memory;
  // v4 captured in memory; bounded by the dispatch AbortSignal. The durable
  // boundary gate is awaited INSIDE the forwarder immediately before `fetch`
  // (§12.3 ordering) — its short transaction commits and releases before any
  // network I/O begins, so no client is ever held across the fetch.
  const capture = createGovernedV4Capture();
  let forwardStarted = false;
  // dispatchSignal (NOT `signal`): the protocol-v1 timeout budget. The
  // handler threads it into the non-stream forward; the client-disconnect
  // `signal` channel stays stream-only so a direct-route disconnect can never
  // cancel a non-stream provider call whose evidence would then be lost —
  // THIS caller persists an honest outcome_unknown when the bound fires.
  const dispatchSignal = AbortSignal.timeout(budgetMs);
  const handlerInput = {
    rawBody: txa.nativeRequestBody,
    inboundHeaders: plan.inboundHeaders,
    isStream: false as const,
    dispatchSignal,
    beforeDispatch: makeBoundaryGate(deps, ctx, claim.token),
    // The same deadline on the MONOTONIC clock, rechecked synchronously by
    // the forwarder after the gate await — the abort timer's callback may
    // not have run yet under an event-loop stall (Codex P2 on b80a457).
    monotonicDeadlineMs: claimStartedAtMs + config.timeoutMs,
    onDispatchStart: () => {
      forwardStarted = true;
    },
  };
  // §12.4 — the handler's resolver returns ONLY the credential already
  // resolved in memory: no PostgreSQL, no pool client, no KMS, no network.
  const resolveInMemory = async (): Promise<ResolvedProviderCredential> => resolvedCredential;

  let result:
    | Awaited<ReturnType<typeof handleAnthropicGovernedMessages>>
    | Awaited<ReturnType<typeof handleOpenAIGovernedResponses>>
    | Awaited<ReturnType<typeof handleOpenAIGovernedChatCompletions>>;
  try {
    if (body.capability === 'anthropic.messages.create') {
      result = await handleAnthropicGovernedMessages(
        { ...handlerInput, tenant: buildAnthropicTenant(identity) },
        {
          upstreamBaseUrl: plan.upstreamBaseUrl,
          resolveProviderKey: resolveInMemory,
          dlpScan: inMemoryDlpScan,
          emitAuditEvent: capture.capture,
          preResolvedCredentialSource: resolvedCredential.source,
        },
      );
    } else if (body.capability === 'openai.responses.create') {
      result = await handleOpenAIGovernedResponses(
        { ...handlerInput, tenant: buildOpenAITenant(identity) },
        {
          upstreamBaseUrl: plan.upstreamBaseUrl,
          resolveProviderKey: resolveInMemory,
          dlpScan: inMemoryDlpScan,
          emitAuditEvent: capture.capture,
          preResolvedCredentialSource: resolvedCredential.source,
        },
      );
    } else {
      result = await handleOpenAIGovernedChatCompletions(
        { ...handlerInput, tenant: buildOpenAITenant(identity) },
        {
          upstreamBaseUrl: plan.upstreamBaseUrl,
          resolveProviderKey: resolveInMemory,
          dlpScan: inMemoryDlpScan,
          emitAuditEvent: capture.capture,
          preResolvedCredentialSource: resolvedCredential.source,
        },
      );
    }
  } catch (err) {
    if (err instanceof DispatchBoundaryGateError) {
      // §17 — the durable gate could not be established: the provider was
      // provably not called (the fetch is unreachable past a failed gate).
      // Persist the KNOWN failure; when the run moved concurrently (e.g.
      // recovery already resolved it) answer honestly from durable state.
      const fb = await persistTerminal(ctx, () =>
        failBoundaryNotEstablished(deps.pool, deps.kms, ctx, { token: claim.token }),
      );
      if (!fb.transitioned) {
        // A durably ACTIVE row here means the boundary COMMIT may have
        // succeeded server-side with its acknowledgement lost (the CAS above
        // refuses boundary-bearing rows). A terminal answer would be a false
        // claim — return the run-aware polling contract instead; recovery
        // owns the row from here (boundary present ⇒ honest unknown later).
        if (fb.status === 'running' || fb.status === 'queued' || fb.status === null) {
          throw new DispatchPersistenceError(txa.runId, txa.chainId, 'boundary_gate_unconfirmed');
        }
        return readRunStateResponse(deps, ctx, txa.decision);
      }
      return {
        run_id: txa.runId,
        audit_chain_id: txa.chainId,
        ...(fb.auditEventId ? { audit_event_id: fb.auditEventId } : {}),
        policy_decision: { kind: txa.decision.kind, reasons: [...txa.decision.reasons] },
        status: 'failed',
        retry_safe: false,
        error_class: 'dispatch_boundary_persist_failed',
      };
    }
    if (!forwardStarted) {
      // §21.3 — known local error provably before the forward started
      // (includes §19.2: signal expired AFTER the boundary committed but
      // before fetch — the live process KNOWS no fetch happened).
      const message = err instanceof Error ? err.message : String(err);
      const fin = await persistTerminal(ctx, () =>
        finalizeKnownOutcome(deps.pool, deps.kms, ctx, {
          token: claim.token,
          outcome: { kind: 'local_error', message },
        }),
      );
      return {
        run_id: txa.runId,
        audit_chain_id: txa.chainId,
        ...(fin.auditEventId ? { audit_event_id: fin.auditEventId } : {}),
        policy_decision: { kind: txa.decision.kind, reasons: [...txa.decision.reasons] },
        status: 'failed',
        retry_safe: false,
        error_class: 'dispatch_pre_forward_failed',
      };
    }
    // §22 — honest unknown. NEVER retried, NEVER classified as failed.
    await persistTerminal(ctx, () =>
      markOutcomeUnknown(deps.pool, deps.kms, ctx, {
        token: claim.token,
        errorClass: unknownErrorClass(err),
        forwardObservation: 'observed_local_forward_invocation',
        invocation: { nativeEndpoint, nativeRequestHash: txa.nativeRequestHash },
      }),
    );
    return {
      run_id: txa.runId,
      audit_chain_id: txa.chainId,
      policy_decision: { kind: txa.decision.kind, reasons: [...txa.decision.reasons] },
      status: 'outcome_unknown',
      retry_safe: false,
      error_class: 'dispatch_outcome_unknown',
    };
  }

  if (result.kind === 'blocked') {
    // §21.2 — known governed block before the forward: denied, NO invocation.
    const fin = await persistTerminal(ctx, () =>
      finalizeKnownOutcome(deps.pool, deps.kms, ctx, {
        token: claim.token,
        outcome: { kind: 'blocked', reason: result.reason, capturedV4: capture.captured() },
      }),
    );
    return {
      run_id: txa.runId,
      audit_chain_id: txa.chainId,
      ...(fin.auditEventId ? { audit_event_id: fin.auditEventId } : {}),
      policy_decision: { kind: txa.decision.kind, reasons: [...txa.decision.reasons] },
      status: 'denied',
      retry_safe: false,
      ...(fin.v4EventId ? { passthrough_invoked_event_id: fin.v4EventId } : {}),
    };
  }

  if (result.kind === 'stream') {
    // Unreachable with isStream:false. A fetch DID happen — conservative unknown.
    await persistTerminal(ctx, () =>
      markOutcomeUnknown(deps.pool, deps.kms, ctx, {
        token: claim.token,
        errorClass: 'provider_io_unknown',
        forwardObservation: forwardStarted
          ? 'observed_local_forward_invocation'
          : 'not_observed',
        invocation: { nativeEndpoint, nativeRequestHash: txa.nativeRequestHash },
      }),
    );
    return {
      run_id: txa.runId,
      audit_chain_id: txa.chainId,
      policy_decision: { kind: txa.decision.kind, reasons: [...txa.decision.reasons] },
      status: 'outcome_unknown',
      retry_safe: false,
      error_class: 'dispatch_outcome_unknown',
    };
  }

  // §21.1 — known HTTP result (2xx → completed; non-2xx → failed).
  const responseBodyParsed = parseResponseBody(result.response_body_raw);
  const fin = await persistTerminal(ctx, () =>
    finalizeKnownOutcome(deps.pool, deps.kms, ctx, {
      token: claim.token,
      outcome: {
        kind: 'http',
        statusCode: result.status_code,
        nativeEndpoint: result.audit_event.native_endpoint,
        nativeRequestHashHex: result.native_request_hash_hex,
        nativeResponseHashHex: result.native_response_hash_hex,
        latencyMs: result.latency_ms,
        providerRequestId: result.provider_request_id,
        usageJson: buildUsageJson(responseBodyParsed),
        capturedV4: capture.captured(),
        dlpFindingCount: txa.dlpFindingCount,
      },
    }),
  );
  const ok = fin.finalStatus === 'completed';
  return {
    run_id: txa.runId,
    audit_chain_id: txa.chainId,
    ...(fin.auditEventId ? { audit_event_id: fin.auditEventId } : {}),
    policy_decision: { kind: txa.decision.kind, reasons: [...txa.decision.reasons] },
    status: ok ? 'completed' : 'failed',
    ...(ok ? { output: responseBodyParsed } : {}),
    ...(fin.invocationId ? { provider_invocation_id: fin.invocationId } : {}),
    ...(fin.v4EventId ? { passthrough_invoked_event_id: fin.v4EventId } : {}),
    retry_safe: false,
  };
}

// =============================================================================
// Passthrough execution (F3-phased; issue #54)
// =============================================================================

export type PassthroughRunResponse = {
  run_id: string;
  audit_chain_id: string;
  /** Absent on `outcome_unknown` (minimal §23.1 contract). */
  audit_event_id?: string;
  mode: 'passthrough';
  status: 'completed' | 'failed' | 'outcome_unknown';
  provider_invocation_id?: string;
  native_request_hash: string;
  native_response_hash?: string;
  provider_request_id?: string;
  output?: unknown;
  retry_safe?: boolean;
  error_class?: string;
};

type PassthroughPlan = {
  provider: 'anthropic' | 'openai';
  nativeEndpoint: string;
  body: Buffer;
};

function passthroughPlanFor(capability: string, model: string, input: string): PassthroughPlan {
  switch (capability) {
    case 'anthropic.messages.create':
      return {
        provider: 'anthropic',
        nativeEndpoint: '/v1/messages',
        body: buildAnthropicMessagesBody(model, input),
      };
    case 'openai.responses.create':
      return {
        provider: 'openai',
        nativeEndpoint: '/v1/responses',
        body: buildOpenAIResponsesBody(model, input),
      };
    case 'openai.chat.completions.create':
      return {
        provider: 'openai',
        nativeEndpoint: '/v1/chat/completions',
        body: buildOpenAIChatCompletionsBody(model, input),
      };
    default:
      throw new CapabilityNotSupportedError(capability, 'planned');
  }
}

type PassthroughTxAResult = {
  runId: string;
  chainId: string;
  plan: PassthroughPlan;
  nativeRequestHash: Buffer;
  nativeRequestHashHex: string;
};

/** §14.2 — TX-A (passthrough): approval revalidated under FOR UPDATE and
 *  CONSUMED with the durable preparation; the lock dies at COMMIT. */
async function passthroughTxA(
  deps: OrchestratorDeps,
  identity: AuthIdentity,
  body: RunRequest,
  workroomContext?: WorkroomRunContext,
  approval?: ApprovalConsumptionContext,
  idem?: ResolvedIdempotencyContext,
): Promise<PassthroughTxAResult> {
  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await setLocalAppOrgId(client, identity.org_id);

      if (workroomContext) {
        await assertWorkroomRunContextStillValid(client, identity, workroomContext);
      }
      // P0.3-C §15 — for a KEYED execution the approval row lock moves to
      // AFTER the idempotency reservation below: only the reservation winner
      // may lock/revalidate/consume, so a matching concurrent retry can never
      // lose the race by first observing an already-consumed approval. The
      // unkeyed path keeps the original error ordering unchanged.
      if (!idem && approval && workroomContext) {
        await assertApprovalConsumable(client, identity, {
          workroomContext,
          approvalRequestId: approval.approval_request_id,
          body,
        });
      }
      const overrides = await loadOrgOverrides(client, body.capability);
      const resolved = resolveCapability(body.capability, overrides);
      assertCapabilityExecutable(resolved, deps.env);

      const plan = passthroughPlanFor(body.capability, body.model, body.input);
      const chainId = chainIdFor(identity.org_id, 'run');
      const nativeRequestHash = Buffer.from(sha256(plan.body));
      const nativeRequestHashHex = nativeRequestHash.toString('hex');

      const runId = randomUUID();
      // The prepared event's occurred_at is the DATABASE-clock instant this
      // INSERT records (Codex P2 on 97fa3e3) — same split-clock rationale as
      // the governed TX-A.
      const ins = await client.query<{ dispatch_prepared_at: Date }>(
        `INSERT INTO govai.runs
           (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
            workroom_id, workroom_task_id, created_by_participant_id, approval_policy_id,
            workroom_governance_mode, dispatch_protocol_version, dispatch_prepared_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::text, 'passthrough', 'queued',
            $7::jsonb, $8::uuid, $9::uuid, $10::uuid, $11::uuid, $12::text, 1, now())
        RETURNING dispatch_prepared_at`,
        [
          runId,
          identity.org_id,
          body.workspace_id,
          identity.user_id,
          plan.provider,
          body.model,
          JSON.stringify(body.metadata ?? {}),
          workroomContext?.workroom_id ?? null,
          workroomContext?.workroom_task_id ?? null,
          workroomContext?.created_by_participant_id ?? null,
          workroomContext?.approval_policy_id ?? null,
          workroomContext?.workroom_governance_mode ?? null,
        ],
      );
      const preparedAt = ins.rows[0]!.dispatch_prepared_at;

      // P0.3-C §14/§15 — the idempotency reservation is established
      // immediately after the candidate run row and BEFORE the approval row
      // lock/consumption. A loser rolls the candidate transaction back via the
      // catch below — no committed run, no approval mutation, no turn. Only
      // the winner then locks and revalidates the consumable approval.
      if (idem) {
        await reserveOrSignalLoser(client, identity.org_id, runId, idem);
        if (approval && workroomContext) {
          await assertApprovalConsumable(client, identity, {
            workroomContext,
            approvalRequestId: approval.approval_request_id,
            body,
          });
        }
      }

      // Approval consumption is durable WITH the preparation (owner-adjudicated):
      // TX-A committed but provider never called ⇒ approval remains consumed;
      // a new execution requires a new authorization. No automatic replay.
      if (approval) {
        await consumeApproval(client, {
          approvalRequestId: approval.approval_request_id,
          runId,
        });
      }

      await appendDispatchPreparedEvent(
        client,
        deps.kms,
        {
          orgId: identity.org_id,
          runId,
          chainId,
          actorUserId: identity.user_id,
          mode: 'passthrough',
          provider: plan.provider,
          capabilityId: body.capability,
          model: body.model,
          workroom: workroomCtxOf(workroomContext),
        },
        {
          nativeRequestHashHex,
          ...(approval ? { approvalRequestId: approval.approval_request_id } : {}),
          occurredAt: preparedAt,
        },
      );

      await client.query('COMMIT');
      return { runId, chainId, plan, nativeRequestHash, nativeRequestHashHex };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  } finally {
    client.release();
  }
}

/**
 * Execute a `/v1/runs` request in passthrough mode (observe-only). Same durable
 * dispatch protocol as governed: prepared → claimed → provider I/O outside any
 * transaction → TX-B / honest unknown. No governed enforcement is applied.
 */
export function executePassthroughRun(
  deps: OrchestratorDeps,
  apiKey: string,
  body: RunRequest,
  workroomContext?: WorkroomRunContext,
  approval?: ApprovalConsumptionContext,
): Promise<PassthroughRunResponse>;
export function executePassthroughRun(
  deps: OrchestratorDeps,
  apiKey: string,
  body: RunRequest,
  workroomContext: WorkroomRunContext | undefined,
  approval: ApprovalConsumptionContext | undefined,
  idem: RunIdempotencyExecution | undefined,
): Promise<PassthroughRunResponse | RunIdempotentReplay>;
export async function executePassthroughRun(
  deps: OrchestratorDeps,
  apiKey: string,
  body: RunRequest,
  workroomContext?: WorkroomRunContext,
  approval?: ApprovalConsumptionContext,
  idem?: RunIdempotencyExecution,
): Promise<PassthroughRunResponse | RunIdempotentReplay> {
  const config = runDispatchConfigFromEnv(deps.env);

  // §12.1 — authenticate; client released.
  const identity = await authenticateShortLived(deps.pool, apiKey);

  // P0.3-C §10 — committed-replay probe BEFORE preflight, credential lookup
  // and any new durable work. For a matching Workroom replay this is what
  // makes the already-consumed original approval a non-issue: no new provider
  // action is being authorized, so no approval state is consulted or mutated.
  const idemCtx = idem
    ? resolveIdempotencyContext(idem, identity, body, 'passthrough', workroomContext, approval)
    : undefined;
  if (idemCtx) {
    const replay = await resolveCommittedKeyedRequest(
      deps.pool,
      identity.org_id,
      idemCtx.keyHash,
      idemCtx.intentHash,
    );
    if (replay) return replay;
  }

  // §12.2 — read-only preflight (workroom → approval shape → capability).
  // P0.3-C §15: on a KEYED execution the approval is NOT validated here — a
  // consumability failure read before the reservation winner is known could be
  // the concurrent matching winner's own consumption, and failing on it would
  // deny a legitimate replay. TX-A validates the approval under a row lock
  // after winning the reservation (same error contract, no race window).
  await runPreflight(deps, identity, body, workroomContext, idemCtx ? undefined : approval);

  // §12.3 — credential fully resolved BEFORE TX-A (lookup TX committed, then KMS).
  const provider = providerForCapability(body.capability);
  const resolvedCredential = await resolveCredentialForProvider(deps, identity, provider);

  // §14.2 — TX-A: durable preparation + approval consumption. A lost P0.3-C
  // reservation surfaces here AFTER the candidate rollback.
  let txa: PassthroughTxAResult;
  try {
    txa = await passthroughTxA(deps, identity, body, workroomContext, approval, idemCtx);
  } catch (err) {
    if (err instanceof RunIdempotencyLoserSignal && idemCtx) {
      return answerAsLoser(deps, identity.org_id, idemCtx);
    }
    throw err;
  }

  const ctx: RunDispatchContext = {
    orgId: identity.org_id,
    runId: txa.runId,
    chainId: txa.chainId,
    actorUserId: identity.user_id,
    mode: 'passthrough',
    provider,
    capabilityId: body.capability,
    model: body.model,
    workroom: workroomCtxOf(workroomContext),
  };

  // §16 — deterministic validation before the claim (headers included).
  let plan: DeterministicPlan;
  let outboundHeaders: Record<string, string>;
  try {
    plan = buildDeterministicPlan(
      deps.env,
      provider,
      txa.plan.nativeEndpoint,
      txa.plan.body,
      body.workspace_id,
      config.timeoutMs,
    );
    outboundHeaders =
      provider === 'anthropic'
        ? rewriteAnthropicPassthroughHeaders(plan.inboundHeaders, resolvedCredential.apiKey)
            .outbound
        : rewriteOpenaiPassthroughHeaders(plan.inboundHeaders, resolvedCredential.apiKey).outbound;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const preclaimed = await persistTerminal(ctx, () =>
      failPreclaim(deps.pool, deps.kms, ctx, {
        errorClass: 'dispatch_preclaim_failed',
        message,
      }),
    );
    if (!preclaimed) {
      // CAS lost (Codex P2 on 7f08ede) — answer from the durable row, same
      // honesty contract as the claim-loser path below.
      const state = await readRunStateResponse(deps, ctx);
      return {
        run_id: txa.runId,
        audit_chain_id: txa.chainId,
        mode: 'passthrough',
        status:
          state.status === 'denied' || state.status === 'completed' ? 'failed' : state.status,
        native_request_hash: txa.nativeRequestHashHex,
        retry_safe: false,
        ...(state.error_class ? { error_class: state.error_class } : {}),
      };
    }
    return {
      run_id: txa.runId,
      audit_chain_id: txa.chainId,
      mode: 'passthrough',
      status: 'failed',
      native_request_hash: txa.nativeRequestHashHex,
      retry_safe: false,
      error_class: 'dispatch_preclaim_failed',
    };
  }

  // §17 — exclusive claim (run-aware on ambiguous outcomes, as in governed).
  const claimStartedAtMs = performance.now();
  const claim = await persistTerminal(ctx, () =>
    claimDispatch(deps.pool, deps.kms, ctx, { timeoutMs: config.timeoutMs }),
  );
  if (!claim.claimed) {
    const state = await readRunStateResponse(deps, ctx);
    return {
      run_id: txa.runId,
      audit_chain_id: txa.chainId,
      mode: 'passthrough',
      status: state.status === 'denied' || state.status === 'completed' ? 'failed' : state.status,
      native_request_hash: txa.nativeRequestHashHex,
      retry_safe: false,
      ...(state.error_class ? { error_class: state.error_class } : {}),
    };
  }

  // The abort budget is anchored to the DURABLE deadline fixed at claim time;
  // the elapsed time is a MONOTONIC same-clock delta (performance.now).
  const budgetMs = remainingDispatchBudgetMs(
    config.timeoutMs,
    performance.now() - claimStartedAtMs,
  );
  if (budgetMs <= 0) {
    const fin = await persistTerminal(ctx, () =>
      finalizeKnownOutcome(deps.pool, deps.kms, ctx, {
        token: claim.token,
        outcome: {
          kind: 'local_error',
          message: 'dispatch deadline elapsed before the forward started',
        },
      }),
    );
    return {
      run_id: txa.runId,
      audit_chain_id: txa.chainId,
      ...(fin.auditEventId ? { audit_event_id: fin.auditEventId } : {}),
      mode: 'passthrough',
      status: 'failed',
      native_request_hash: txa.nativeRequestHashHex,
      retry_safe: false,
      error_class: 'dispatch_pre_forward_failed',
    };
  }

  // §19 — raw forward with ZERO database clients held. The durable boundary
  // gate is awaited inside the forwarder immediately before `fetch` (§12.3);
  // its short transaction commits and releases before any network I/O.
  const forwardRaw = provider === 'anthropic' ? forwardRawAnthropic : forwardRawOpenai;
  let forwardStarted = false;
  let fwd: Awaited<ReturnType<typeof forwardRawAnthropic>>;
  try {
    fwd = await forwardRaw({
      baseUrl: plan.upstreamBaseUrl,
      pathTemplate: txa.plan.nativeEndpoint,
      concretePath: txa.plan.nativeEndpoint,
      method: 'POST',
      headers: outboundHeaders,
      body: txa.plan.body,
      signal: AbortSignal.timeout(budgetMs),
      beforeDispatch: makeBoundaryGate(deps, ctx, claim.token),
      // Synchronous post-gate recheck on the monotonic clock (see governed).
      monotonicDeadlineMs: claimStartedAtMs + config.timeoutMs,
      onDispatchStart: () => {
        forwardStarted = true;
      },
    });
  } catch (err) {
    if (err instanceof DispatchBoundaryGateError) {
      // §17 — gate not established: provider provably not called; persist the
      // KNOWN failure or answer from durable state on a concurrent move.
      const fb = await persistTerminal(ctx, () =>
        failBoundaryNotEstablished(deps.pool, deps.kms, ctx, { token: claim.token }),
      );
      if (!fb.transitioned) {
        // Durably active row ⇒ the boundary COMMIT may have succeeded with a
        // lost acknowledgement — never a terminal answer; run-aware polling.
        if (fb.status === 'running' || fb.status === 'queued' || fb.status === null) {
          throw new DispatchPersistenceError(txa.runId, txa.chainId, 'boundary_gate_unconfirmed');
        }
        const state = await readRunStateResponse(deps, ctx);
        return {
          run_id: txa.runId,
          audit_chain_id: txa.chainId,
          mode: 'passthrough',
          status:
            state.status === 'denied' || state.status === 'completed' ? 'failed' : state.status,
          native_request_hash: txa.nativeRequestHashHex,
          retry_safe: false,
          ...(state.error_class ? { error_class: state.error_class } : {}),
        };
      }
      return {
        run_id: txa.runId,
        audit_chain_id: txa.chainId,
        ...(fb.auditEventId ? { audit_event_id: fb.auditEventId } : {}),
        mode: 'passthrough',
        status: 'failed',
        native_request_hash: txa.nativeRequestHashHex,
        retry_safe: false,
        error_class: 'dispatch_boundary_persist_failed',
      };
    }
    if (!forwardStarted) {
      const message = err instanceof Error ? err.message : String(err);
      const fin = await persistTerminal(ctx, () =>
        finalizeKnownOutcome(deps.pool, deps.kms, ctx, {
          token: claim.token,
          outcome: { kind: 'local_error', message },
        }),
      );
      return {
        run_id: txa.runId,
        audit_chain_id: txa.chainId,
        ...(fin.auditEventId ? { audit_event_id: fin.auditEventId } : {}),
        mode: 'passthrough',
        status: 'failed',
        native_request_hash: txa.nativeRequestHashHex,
        retry_safe: false,
        error_class: 'dispatch_pre_forward_failed',
      };
    }
    const unknown = await persistTerminal(ctx, () =>
      markOutcomeUnknown(deps.pool, deps.kms, ctx, {
        token: claim.token,
        errorClass: unknownErrorClass(err),
        forwardObservation: 'observed_local_forward_invocation',
        invocation: {
          nativeEndpoint: txa.plan.nativeEndpoint,
          nativeRequestHash: txa.nativeRequestHash,
        },
      }),
    );
    return {
      run_id: txa.runId,
      audit_chain_id: txa.chainId,
      mode: 'passthrough',
      status: 'outcome_unknown',
      native_request_hash: txa.nativeRequestHashHex,
      ...(unknown.invocationId ? { provider_invocation_id: unknown.invocationId } : {}),
      retry_safe: false,
      error_class: 'dispatch_outcome_unknown',
    };
  }

  // §21.1 — known HTTP result.
  const responseBodyParsed = parseResponseBody(fwd.responseBody);
  const fin = await persistTerminal(ctx, () =>
    finalizeKnownOutcome(deps.pool, deps.kms, ctx, {
      token: claim.token,
      outcome: {
        kind: 'http',
        statusCode: fwd.status,
        nativeEndpoint: txa.plan.nativeEndpoint,
        nativeRequestHashHex: txa.nativeRequestHashHex,
        nativeResponseHashHex: fwd.native_response_hash,
        latencyMs: fwd.latency_ms,
        providerRequestId: fwd.provider_request_id,
        usageJson: buildUsageJson(responseBodyParsed),
      },
    }),
  );
  const ok = fin.finalStatus === 'completed';
  return {
    run_id: txa.runId,
    audit_chain_id: txa.chainId,
    ...(fin.auditEventId ? { audit_event_id: fin.auditEventId } : {}),
    mode: 'passthrough',
    status: ok ? 'completed' : 'failed',
    ...(fin.invocationId ? { provider_invocation_id: fin.invocationId } : {}),
    native_request_hash: txa.nativeRequestHashHex,
    native_response_hash: fwd.native_response_hash,
    ...(fwd.provider_request_id ? { provider_request_id: fwd.provider_request_id } : {}),
    output: responseBodyParsed,
    retry_safe: false,
  };
}

export {
  AuthError,
  CapabilityNotSupportedError,
  CapabilityNotRegisteredError,
};
export type { AuthIdentity, KnownOutcome };

// Internal helpers exported for unit testing only (run-orchestrator.test.ts).
// Not part of the public API; the double-underscore prefix marks them as
// test-only and discourages external consumption.
export { providerUpstreamBaseUrl as __test_providerUpstreamBaseUrl };
export { remainingDispatchBudgetMs as __test_remainingDispatchBudgetMs };
