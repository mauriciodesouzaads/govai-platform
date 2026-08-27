// Typed control-plane failures (EP-AI-CONVERSATION-CONTINUITY-V1 P0-B).
//
// The service raises these; the route maps them to HTTP. Keeping the mapping in one table means
// the IDOR contract (§26) is auditable in one place rather than re-derived per handler.
//
// ★ IDOR / DISCLOSURE RULE. `ConversationNotFoundError` is the SINGLE answer for every
// unreachable conversation root — absent, another owner's in the same org, or another org's —
// so a 404 can never be read as "exists but is not yours". The finer-grained codes below are
// only ever raised AFTER the caller has proven ownership of the root, so they disclose the
// caller's own state and nothing else.
//
// ★ No error message, code or field in this file carries conversation content, a title (plain
// or encrypted), a provider identifier, a credential, a hash, or another principal's ids.

/** The conversation root is not reachable by this principal. Also the answer for the two
 *  DELETED lifecycle states: P0-B implements no delete protocol (§19 is a later movement), so a
 *  conversation in `deleted_pending`/`deleted` is not an addressable object on any P0-B
 *  surface — reporting it as anything else would imply a lifecycle this movement cannot drive. */
export class ConversationNotFoundError extends Error {
  readonly code = 'conversation_not_found';
  constructor() {
    super('conversation not found');
    this.name = 'ConversationNotFoundError';
  }
}

/** A fork named a parent branch / turn / attempt that does not exist inside THIS (already
 *  owner-proven) conversation. One code for all three so the response never says WHICH link of
 *  the lineage was wrong. */
export class ForkSourceNotFoundError extends Error {
  readonly code = 'fork_source_not_found';
  constructor() {
    super('fork source lineage not found in this conversation');
    this.name = 'ForkSourceNotFoundError';
  }
}

/** P0A1-C4 — the pinned attempt's durable state is not valid for the declared boundary mode
 *  (§3). The attempt's own state IS returned: it belongs to the caller, and without it the
 *  client cannot tell "wait, it is still running" from "this can never be forked in this mode". */
export class ForkPinStateError extends Error {
  readonly code = 'fork_source_not_forkable';
  constructor(
    readonly boundaryMode: string,
    readonly attemptState: string,
  ) {
    super('the pinned attempt is not in a state this boundary mode may fork');
    this.name = 'ForkPinStateError';
  }
}

/**
 * A `before_attempt_output` fork asked for a provider/surface/model DIFFERENT from the parent
 * branch's. §3: that fork mode MINTS A CHILD TURN carrying a copy of the source turn's
 * IMMUTABLE NATIVE REQUEST CONFIG, and a provider-shaped config does NOT carry over across a
 * switch — the request must supply a replacement native config valid for the target, or the
 * operation is REJECTED as incompatible. It is NEVER silently translated.
 *
 * P0-B offers no way to supply one: the native request body is the durable-send surface
 * (`POST .../turns`), explicitly out of scope for this movement, and no provider-native request
 * validator exists in the tree to prove a supplied config "valid for the target provider".
 * Accepting an unvalidated blob and calling it a valid immutable config would be an overclaim.
 * So this fork shape takes the accepted architecture's own REJECTED branch, and the capability
 * is carried forward to the movement that owns the native request body.
 */
export class ForkReplacementConfigRequiredError extends Error {
  readonly code = 'fork_replacement_config_required';
  constructor() {
    super(
      'a before_attempt_output fork that changes provider/surface/model requires a replacement native request config, which this API surface does not accept',
    );
    this.name = 'ForkReplacementConfigRequiredError';
  }
}

/** The `client_fork_id` is committed to a DIFFERENT canonical fork intent (§13). Static: never
 *  the key, never either hash, never the stored intent. */
export class ForkIdempotencyConflictError extends Error {
  readonly code = 'fork_idempotency_key_conflict';
  constructor() {
    super('client_fork_id is already bound to a different fork intent');
    this.name = 'ForkIdempotencyConflictError';
  }
}

/** Internal control-flow signal: this transaction LOST the fork reservation to a concurrent
 *  contender. The service rolls the candidate transaction back and answers from the COMMITTED
 *  binding (replay or conflict). The `run-idempotency.ts` loser-signal shape; never
 *  route-visible. */
export class ForkIdempotencyLoserSignal extends Error {
  constructor() {
    super('fork idempotency reservation lost');
    this.name = 'ForkIdempotencyLoserSignal';
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// P0-C durable send / hydrate failures.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The named branch does not exist inside THIS (already owner-proven) conversation. Distinct
 *  from `conversation_not_found` because ownership of the root is already established, so this
 *  discloses only the caller's own state. */
export class BranchNotFoundError extends Error {
  readonly code = 'branch_not_found';
  constructor() {
    super('branch not found in this conversation');
    this.name = 'BranchNotFoundError';
  }
}

/** The turn is not reachable inside this (owner-proven) conversation. */
export class TurnNotFoundError extends Error {
  readonly code = 'turn_not_found';
  constructor() {
    super('turn not found in this conversation');
    this.name = 'TurnNotFoundError';
  }
}

/** The `client_turn_id` is committed to a DIFFERENT canonical send intent (§8). Static: never
 *  the key, never either hash, never the stored intent — the `routes/runs.ts:180` discipline. */
export class SendIdempotencyConflictError extends Error {
  readonly code = 'send_idempotency_key_conflict';
  constructor() {
    super('client_turn_id is already bound to a different send intent');
    this.name = 'SendIdempotencyConflictError';
  }
}

/**
 * Internal control-flow signal: this transaction LOST the turn reservation to a concurrent
 * contender. The service rolls the candidate transaction back and answers from the COMMITTED
 * turn (replay or conflict). The `fork-intent` loser-signal shape; never route-visible.
 */
export class SendIdempotencyLoserSignal extends Error {
  constructor() {
    super('send reservation lost');
    this.name = 'SendIdempotencyLoserSignal';
  }
}

/**
 * The branch's durable (provider, surface) is not dispatchable by P0-C (§23's P0-D wall).
 *
 * ★ RAISED AT RESERVATION TIME, ON PURPOSE. A reservation is a promise that the server will
 * execute this turn; making that promise for a surface no executor can drive would leave a
 * permanently queued turn blocking its branch. Failing here means nothing durable is written and
 * the client learns the truth immediately. The executor re-checks the same registry before
 * claiming, so a conversation whose surface stops being supported cannot be dispatched either.
 */
export class ConversationSurfaceUnsupportedError extends Error {
  readonly code = 'conversation_surface_unsupported';
  constructor(
    readonly provider: string,
    readonly surface: string,
    readonly reason: string,
  ) {
    super('this conversation provider/surface cannot be executed by this server yet');
    this.name = 'ConversationSurfaceUnsupportedError';
  }
}
