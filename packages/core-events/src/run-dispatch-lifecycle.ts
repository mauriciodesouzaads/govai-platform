// Run dispatch lifecycle event schemas v1 — EP-P03A-A (F3): durable provider
// dispatch outside run database transactions.
//
// Four events cover the durable-dispatch protocol:
//
//   run.dispatch_prepared  — TX-A committed: the run + native request hash are
//                            durable, policy/authorization passed, the approval
//                            (when applicable) is consumed, and the dispatch MAY
//                            be claimed. Proves NOTHING about any network call.
//   run.dispatch_claimed   — exactly one executor won the queued→running CAS and
//                            holds exclusive local dispatch ownership. Does NOT
//                            mean the provider received anything.
//   run.outcome_unknown    — the system cannot prove whether the provider
//                            executed the action (timeout, transport error after
//                            forward start, stale claim). Not a failure; not an
//                            authorization to retry.
//   run.outcome_reconciled — a known result arrived for a run previously marked
//                            outcome_unknown and was persisted idempotently.
//
// All four route onto the existing `run` ChainCategory; no new audit chain.
// Payloads carry ONLY safe metadata — no user payload, no credentials, no raw
// error messages. `dispatch_error_class` is a CLOSED enum of safe codes.

import { z } from 'zod';

/** Closed set of safe dispatch error codes persisted on `govai.runs`. */
export const DispatchErrorClass = z.enum([
  // Deterministic validation after TX-A failed before any claim (§16).
  'dispatch_preclaim_failed',
  // Recovery: a prepared run was never claimed — provider provably not called.
  'dispatch_never_claimed',
  // Recovery: a claimed run whose durable dispatch boundary was never
  // committed exceeded its deadline + grace. Under the structural protocol the
  // boundary MUST commit before any provider I/O, so the provider was
  // provably not called — a KNOWN failure, not an unknown.
  'dispatch_never_started',
  // Recovery: a claimed run that HAD committed its durable boundary exceeded
  // its deadline + grace with no terminal state — nothing past the boundary
  // is provable.
  'stale_dispatch_claim',
  // Known local error after claim but provably before the forward started.
  'dispatch_pre_forward_failed',
  // The durable local dispatch gate could not be established (zero-row
  // boundary CAS or a boundary-transaction failure); provider invocation was
  // prohibited — a KNOWN failure with zero provider calls.
  'dispatch_boundary_persist_failed',
  // The dispatch timeout (AbortSignal) fired after the forward started.
  'provider_timeout',
  // Any other transport-layer failure after the forward started (DNS, TLS,
  // connection reset, fetch rejection, response interruption).
  'provider_io_unknown',
]);
export type DispatchErrorClass = z.infer<typeof DispatchErrorClass>;

const HEX_64 = /^[0-9a-f]{64}$/;

export const RunDispatchPreparedSchema = z.object({
  event_type: z.literal('run.dispatch_prepared'),
  schema_version: z.literal(1),

  org_id: z.string().uuid(),
  run_id: z.string().uuid(),
  mode: z.enum(['governed', 'passthrough']),
  provider: z.enum(['anthropic', 'openai']),
  capability_id: z.string().min(1),
  model: z.string().min(1),
  /** sha256 hex of the exact native request body that MAY be dispatched. */
  native_request_hash: z.string().regex(HEX_64),
  /** Present iff the run consumed a Workroom passthrough-override approval. */
  approval_request_id: z.string().uuid().optional(),
  workroom_id: z.string().uuid().optional(),
  occurred_at: z.string().datetime(),

  chain_category: z.literal('run'),
});
export type RunDispatchPrepared = z.infer<typeof RunDispatchPreparedSchema>;

export const RunDispatchClaimedSchema = z.object({
  event_type: z.literal('run.dispatch_claimed'),
  schema_version: z.literal(1),

  org_id: z.string().uuid(),
  run_id: z.string().uuid(),
  /** The single claim token; unique per run for the life of the protocol. */
  dispatch_token: z.string().uuid(),
  dispatch_timeout_ms: z.number().int().min(1000).max(900_000),
  dispatch_claimed_at: z.string().datetime(),
  dispatch_deadline_at: z.string().datetime(),
  occurred_at: z.string().datetime(),

  chain_category: z.literal('run'),
});
export type RunDispatchClaimed = z.infer<typeof RunDispatchClaimedSchema>;

/**
 * Closed process-observation semantics for `run.outcome_unknown` — a boolean
 * cannot distinguish "observed no invocation" from "not observed because the
 * original process crashed", so the observation is a semantic enum:
 *
 *   observed_local_forward_invocation — the local process reached the point at
 *     which it invoked `fetch`. NOT provider receipt, NOT provider execution.
 *   not_observed — the component producing the event (e.g. the recovery
 *     worker) did not observe the original process invoke the local
 *     forwarding boundary. It does NOT mean the provider was not called.
 */
export const ForwardObservation = z.enum([
  'observed_local_forward_invocation',
  'not_observed',
]);
export type ForwardObservation = z.infer<typeof ForwardObservation>;

export const RunOutcomeUnknownSchema = z.object({
  event_type: z.literal('run.outcome_unknown'),
  schema_version: z.literal(1),

  org_id: z.string().uuid(),
  run_id: z.string().uuid(),
  dispatch_token: z.string().uuid(),
  dispatch_error_class: DispatchErrorClass,
  /** Process observation of the local forward invocation — see
   *  ForwardObservation. Never a provider-side fact. */
  forward_observation: ForwardObservation,
  /** The durable local dispatch boundary commit (database time). Every
   *  outcome_unknown is post-boundary by construction: a boundary-null stale
   *  claim recovers to the KNOWN failure `dispatch_never_started` instead. */
  dispatch_boundary_committed_at: z.string().datetime(),
  outcome_unknown_at: z.string().datetime(),
  occurred_at: z.string().datetime(),

  chain_category: z.literal('run'),
});
export type RunOutcomeUnknown = z.infer<typeof RunOutcomeUnknownSchema>;

export const RunOutcomeReconciledSchema = z.object({
  event_type: z.literal('run.outcome_reconciled'),
  schema_version: z.literal(1),

  org_id: z.string().uuid(),
  run_id: z.string().uuid(),
  previous_status: z.literal('outcome_unknown'),
  final_status: z.enum(['completed', 'failed']),
  dispatch_token: z.string().uuid(),
  provider_invocation_id: z.string().uuid(),
  native_request_hash: z.string().regex(HEX_64),
  /** Present when the known result carries a response body hash. */
  native_response_hash: z.string().regex(HEX_64).optional(),
  occurred_at: z.string().datetime(),

  chain_category: z.literal('run'),
});
export type RunOutcomeReconciled = z.infer<typeof RunOutcomeReconciledSchema>;

export type RunDispatchLifecycleEvent =
  | RunDispatchPrepared
  | RunDispatchClaimed
  | RunOutcomeUnknown
  | RunOutcomeReconciled;
