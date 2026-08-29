// Conversation control plane — HTTP (EP-AI-CONVERSATION-CONTINUITY-V1 P0-B; spec §13).
//
//   POST   /v1/ai/conversations               create conversation + its root branch (atomic)
//   GET    /v1/ai/conversations               owner-scoped keyset page (<= 50)
//   GET    /v1/ai/conversations/:id           owner-visible control-plane projection
//   PATCH  /v1/ai/conversations/:id           the two guarded fields: title, archived
//   POST   /v1/ai/conversations/:id/branches  fork (idempotent under client_fork_id)
//   POST   /v1/ai/conversations/:id/turns     DURABLE SEND (P0-C, §8) — idempotent under
//                                             client_turn_id; commits BEFORE any provider work
//   GET    /v1/ai/conversations/:id/turns     hydrate a branch's turns (keyset, <= 50)
//   GET    /v1/ai/conversations/:id/turns/:turnId   hydrate one turn
//
// ★ STILL NO OTHER CONVERSATION ROUTE EXISTS — and none is STUBBED. Stream re-attach, retry,
// stop and delete are P0-D/P0-E/P0-F surfaces; registering a placeholder for them would
// advertise a capability the server cannot perform. An unimplemented future endpoint stays
// nonexistent, so a client discovers the truth from a 404 rather than from a misleading 501.
//
// ★ SEND IS NOT A PROVIDER CALL. `POST .../turns` RESERVES a turn durably and returns. The
// provider execution belongs to the detached conversation worker
// (`apps/api/src/conversation-worker/main.ts`), which discovers the committed reservation. The
// HTTP connection that created the send may vanish immediately; execution is unaffected, and a
// later `GET .../turns/:turnId` hydrates whatever the server has durably persisted.
//
// ★ AUTH-READ-CACHE-01. Every response Fastify produces for a route of this plugin carries
// `Cache-Control: no-store`, installed by the encapsulated `onRequest` hook below. The `/v1/me`
// precedent (`me.ts:48-62`) and the reason it exists: `x-govai-api-key` is an ordinary header no
// cache treats as special, so to a caching proxy a conversation GET is a plain GET whose body
// happens to be one owner's private history; keyed on the URL alone it could be replayed to the
// next caller. This route class must not grow the authenticated-read cache exposure — it must
// arrive already closed.
//   That includes the classes terminated BEFORE the route handler, the app-level rate limiter's
// 429 among them. Fastify composes a route's `onRequest` chain as CONTEXT hooks first and
// ROUTE-level hooks after (`fastify/lib/route.js:393-394` —
// `this[kHooks][hook].concat(opts[hook] || [])`), and `@fastify/rate-limit@10` installs no
// app-level hook at all: its `onRoute` hook pushes the limiter into each route's OWN
// `routeOptions.onRequest` (`@fastify/rate-limit/index.js:142-157` and `201-211`). So this
// plugin's context hook runs first and a throttled 429 leaves with the header. Nothing
// registered ahead of it can answer a conversation request either — helmet only sets headers,
// and the AuditBridge identity hook is prefix-scoped to the four direct-provider routes
// (`pipeline/request-identity-hook.ts:21-31`).
//   Proven, never assumed — `ai-conversation-control-plane.test.ts` C6 (the ten handler-produced
// classes), C6b (a REAL 429 on both GET surfaces, driven on a second app built on the
// `NODE_ENV !== 'test'` limit branch, since the hermetic stack raises the limit to 1,000,000 so
// the suite is not throttled) and C6c (a 500 raised before the route handler). Those tests are
// what keeps this true if the limiter ever changes where it installs itself.
//   Recorded scope, not hidden: the guarantee is over the five routes REGISTERED here. A URL
// matching none of them (a P0-C path) is answered from the ROOT not-found context, and a CORS
// preflight is answered by `@fastify/cors` at the root; neither is a conversation response and
// neither carries tenant data. AUTH-READ-CACHE-01 stays OPEN as a CLASS for the other
// authenticated reads — C6b asserts a throttled `/v1/capabilities` is still UNCHANGED.
//
// ★ OWNER AUTHORIZATION. `(org_id, owner_user_id)` comes from the `AuthIdentity` that
// `authenticateApiKey` resolved for THIS request, and from nowhere else. No body, query
// parameter or header can influence it, and no worker-discovery path is reachable from here.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateApiKey, AuthError, type AuthIdentity } from '../pipeline/auth.js';
import {
  CreateConversationBody,
  CreateForkBody,
  ListConversationsQuery,
  PatchConversationBody,
} from '../ai-conversations/contracts.js';
import { ListTurnsQuery, SendTurnBody } from '../ai-conversations/turn-contracts.js';
import {
  BranchNotFoundError,
  ConversationNotFoundError,
  ConversationSurfaceUnsupportedError,
  ForkIdempotencyConflictError,
  ForkPinStateError,
  ForkReplacementConfigRequiredError,
  ForkSourceNotFoundError,
  SendIdempotencyConflictError,
  SendIdempotencyLoserSignal,
  TurnNotFoundError,
} from '../ai-conversations/errors.js';
import {
  NativeRequestTooLargeError,
  getTurn,
  listTurns,
  sendTurn,
} from '../ai-conversations/turn-service.js';
import {
  InvalidCursorError,
  createConversation,
  createFork,
  getConversation,
  listConversations,
  patchConversation,
  type ConversationServiceDeps,
  type OwnerScope,
} from '../ai-conversations/service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `X-GovAI-...`-namespaced marker for an idempotent fork replay, following the
 *  `x-govai-run-idempotent-replay` convention of `routes/runs.ts:126`. */
const FORK_REPLAY_HEADER = 'x-govai-ai-fork-idempotent-replay';

/** Same convention for a duplicate SEND (§8: a duplicate is a read, never a second mint). */
const SEND_REPLAY_HEADER = 'x-govai-ai-send-idempotent-replay';

/** Same credential extraction the U1 read surfaces and `/v1/me` use. */
function extractApiKey(req: FastifyRequest): string | undefined {
  return (
    (req.headers['x-govai-api-key'] as string | undefined) ??
    (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice('Bearer '.length)
      : undefined)
  );
}

/** Resolve the caller, or answer 401 and return null. The 401 body is byte-identical to the
 *  existing read surfaces and discloses nothing about org existence, roles, tier or
 *  configuration. */
async function authenticate(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthIdentity | null> {
  const client = await app.govai.pool.connect();
  try {
    return await authenticateApiKey(client, extractApiKey(req) ?? '');
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

const ownerScopeOf = (identity: AuthIdentity): OwnerScope => ({
  orgId: identity.org_id,
  ownerUserId: identity.user_id,
});

/**
 * Map a service failure to its HTTP answer.
 *
 * ★ THE IDOR CONTRACT LIVES HERE (spec §21/§26). `conversation_not_found` is the SINGLE answer
 * for a conversation that is absent, owned by a different user in the same org, or owned by a
 * different org — the three are indistinguishable, so a 404 can never be read as an existence
 * oracle. The finer codes below are reachable only AFTER the caller has proven ownership of the
 * root, so they describe the caller's own state and disclose nothing else. Returns false when
 * the error is not a control-plane failure, so the caller rethrows into the generic 500.
 */
function replyForServiceError(reply: FastifyReply, err: unknown): boolean {
  if (err instanceof ConversationNotFoundError) {
    reply.code(404).send({ error: err.code });
    return true;
  }
  if (err instanceof ForkSourceNotFoundError) {
    reply.code(404).send({ error: err.code });
    return true;
  }
  if (err instanceof ForkPinStateError) {
    reply.code(409).send({
      error: err.code,
      boundary_mode: err.boundaryMode,
      // The caller's OWN attempt state: without it a client cannot distinguish "still running,
      // try later" from "this attempt can never be forked in this mode".
      attempt_state: err.attemptState,
    });
    return true;
  }
  if (err instanceof ForkReplacementConfigRequiredError) {
    reply.code(409).send({ error: err.code, message: err.message });
    return true;
  }
  if (err instanceof ForkIdempotencyConflictError) {
    // Static body: never the key, never either hash, never the stored intent — the
    // `idempotency_key_conflict` discipline of `routes/runs.ts:180`.
    reply.code(409).send({ error: err.code });
    return true;
  }
  if (err instanceof InvalidCursorError) {
    reply.code(400).send({ error: err.code });
    return true;
  }
  // ── P0-C ──────────────────────────────────────────────────────────────────────────────────
  if (err instanceof TurnNotFoundError || err instanceof BranchNotFoundError) {
    // Both are reachable only AFTER the caller proved ownership of the conversation root, so
    // they describe the caller's own state and are not an existence oracle for anyone else's.
    reply.code(404).send({ error: err.code });
    return true;
  }
  if (err instanceof SendIdempotencyConflictError) {
    // Static body: never the key, never either hash, never the stored intent — the
    // `idempotency_key_conflict` discipline of `routes/runs.ts:180`.
    reply.code(409).send({ error: err.code });
    return true;
  }
  if (err instanceof ConversationSurfaceUnsupportedError) {
    // 409, not 400: the REQUEST is well-formed; it is this SERVER that cannot execute this
    // conversation's durable provider/surface yet. The provider and surface are the caller's own
    // durable configuration, so echoing them discloses nothing and is what makes the answer
    // actionable. `reason` is a bounded enum, never free text.
    reply.code(409).send({
      error: err.code,
      provider: err.provider,
      surface: err.surface,
      reason: err.reason,
    });
    return true;
  }
  if (err instanceof NativeRequestTooLargeError) {
    reply.code(413).send({ error: err.code });
    return true;
  }
  if (err instanceof SendIdempotencyLoserSignal) {
    // The contender that beat us to the reservation then rolled back, so NOTHING is committed
    // under this key. Not a replay and not a conflict — a transient loss the client may retry
    // with the SAME key, which is exactly what 409 Conflict + a retryable marker communicates.
    reply.code(409).send({ error: 'send_reservation_contended' });
    return true;
  }
  return false;
}

export async function aiConversationsRoute(app: FastifyInstance): Promise<void> {
  // AUTH-READ-CACHE-01 — see the file header. Encapsulated to this plugin's context, so it
  // covers exactly the conversation surface and nothing else in the app.
  app.addHook('onRequest', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.header('cache-control', 'no-store');
  });

  const deps = (): ConversationServiceDeps => ({ pool: app.govai.pool, kms: app.govai.kms });

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // POST /v1/ai/conversations
  // ──────────────────────────────────────────────────────────────────────────────────────────
  app.post('/v1/ai/conversations', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = CreateConversationBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'invalid_request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;

    try {
      const conversation = await createConversation(deps(), ownerScopeOf(identity), parsed.data);
      reply.code(201);
      reply.header('location', `/v1/ai/conversations/${conversation.id}`);
      return conversation;
    } catch (err) {
      if (replyForServiceError(reply, err)) return reply;
      req.log.error({ err }, 'unhandled error creating an ai conversation');
      reply.code(500);
      return { error: 'internal_error' };
    }
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // GET /v1/ai/conversations
  // ──────────────────────────────────────────────────────────────────────────────────────────
  app.get('/v1/ai/conversations', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = ListConversationsQuery.safeParse(req.query);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'invalid_query',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;

    try {
      return await listConversations(deps(), ownerScopeOf(identity), parsed.data);
    } catch (err) {
      if (replyForServiceError(reply, err)) return reply;
      req.log.error({ err }, 'unhandled error listing ai conversations');
      reply.code(500);
      return { error: 'internal_error' };
    }
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // GET /v1/ai/conversations/:id
  // ──────────────────────────────────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/v1/ai/conversations/:id',
    async (req, reply: FastifyReply) => {
      // A malformed uuid is a SYNTAX judgment, not an existence one, so 400 here is not an
      // oracle — the same shape `workroom-transcript.ts` uses for `invalid_workroom_id`.
      if (!UUID_RE.test(req.params.id)) {
        reply.code(400);
        return { error: 'invalid_conversation_id' };
      }
      const identity = await authenticate(app, req, reply);
      if (!identity) return reply;

      try {
        return await getConversation(deps(), ownerScopeOf(identity), req.params.id);
      } catch (err) {
        if (replyForServiceError(reply, err)) return reply;
        req.log.error({ err }, 'unhandled error reading an ai conversation');
        reply.code(500);
        return { error: 'internal_error' };
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // PATCH /v1/ai/conversations/:id
  // ──────────────────────────────────────────────────────────────────────────────────────────
  app.patch<{ Params: { id: string } }>(
    '/v1/ai/conversations/:id',
    async (req, reply: FastifyReply) => {
      if (!UUID_RE.test(req.params.id)) {
        reply.code(400);
        return { error: 'invalid_conversation_id' };
      }
      const parsed = PatchConversationBody.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return {
          error: 'invalid_request',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        };
      }
      const identity = await authenticate(app, req, reply);
      if (!identity) return reply;

      try {
        return await patchConversation(
          deps(),
          ownerScopeOf(identity),
          req.params.id,
          parsed.data,
        );
      } catch (err) {
        if (replyForServiceError(reply, err)) return reply;
        req.log.error({ err }, 'unhandled error patching an ai conversation');
        reply.code(500);
        return { error: 'internal_error' };
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // POST /v1/ai/conversations/:id/branches — the fork control plane
  //
  // A P0-B fork is a DURABLE CAUSAL/CONTROL-PLANE OBJECT and nothing more. It creates no
  // provider conversation object, chains no previous response, forks no Codex thread or Claude
  // Code session, rotates no provider state and makes no provider call of any kind. Actual
  // provider continuation belongs to P0-D.
  // ──────────────────────────────────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/v1/ai/conversations/:id/branches',
    async (req, reply: FastifyReply) => {
      if (!UUID_RE.test(req.params.id)) {
        reply.code(400);
        return { error: 'invalid_conversation_id' };
      }
      const parsed = CreateForkBody.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return {
          error: 'invalid_request',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        };
      }
      const identity = await authenticate(app, req, reply);
      if (!identity) return reply;

      try {
        const result = await createFork(
          deps(),
          ownerScopeOf(identity),
          req.params.id,
          parsed.data,
        );
        // 200 + replay marker for an already-committed fork; 201 only when this request
        // actually minted the branch. §13: a duplicate is a read, never a second mint.
        reply.code(result.replay ? 200 : 201);
        if (result.replay) reply.header(FORK_REPLAY_HEADER, 'true');
        return result.branch;
      } catch (err) {
        if (replyForServiceError(reply, err)) return reply;
        req.log.error({ err }, 'unhandled error forking an ai conversation branch');
        reply.code(500);
        return { error: 'internal_error' };
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // POST /v1/ai/conversations/:id/turns — THE DURABLE SEND (§8/§9 step 1)
  //
  // ★ WHAT THIS ENDPOINT DOES, AND WHAT IT REFUSES TO DO. It commits the turn, the immutable
  // user input, the immutable native request config and attempt 1 — and then RETURNS. It makes
  // no provider call, resolves no provider credential, mints no claim and starts no worker. The
  // provider execution belongs to the detached conversation worker, which finds this turn by
  // reading COMMITTED rows.
  //
  // ★ THIS IS WHERE THE BROWSER STOPS OWNING EXECUTION. Before P0-C, the connection that sent a
  // message owned the provider call: closing the tab ended it. Now the reservation is the
  // handoff, and the response returning has no bearing on whether the turn executes.
  //
  // 201 when this request minted the reservation; 200 + a replay marker when it is a duplicate
  // of one already committed (§8: "a duplicate is a read, never a verdict" — the body reflects
  // the turn's CURRENT durable state, so a duplicate arriving mid-execution reports that).
  // ──────────────────────────────────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/v1/ai/conversations/:id/turns',
    async (req, reply: FastifyReply) => {
      if (!UUID_RE.test(req.params.id)) {
        reply.code(400);
        return { error: 'invalid_conversation_id' };
      }
      const parsed = SendTurnBody.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return {
          error: 'invalid_request',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        };
      }
      const identity = await authenticate(app, req, reply);
      if (!identity) return reply;

      try {
        const result = await sendTurn(
          deps(),
          ownerScopeOf(identity),
          req.params.id,
          parsed.data,
        );
        reply.code(result.replay ? 200 : 201);
        if (result.replay) reply.header(SEND_REPLAY_HEADER, 'true');
        else {
          reply.header(
            'location',
            `/v1/ai/conversations/${req.params.id}/turns/${result.turn.id}`,
          );
        }
        return result.turn;
      } catch (err) {
        if (replyForServiceError(reply, err)) return reply;
        req.log.error({ err }, 'unhandled error reserving an ai conversation turn');
        reply.code(500);
        return { error: 'internal_error' };
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // GET /v1/ai/conversations/:id/turns — §10's RELOAD contract
  //
  // A fresh, authenticated request — from any process, at any later time, with no relationship
  // to the connection that sent the turn — hydrates the durable user turn, the current attempt
  // state and whatever output has been persisted. That is the whole point of P0-C: browser
  // memory is never the sole owner of a result.
  // ──────────────────────────────────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/v1/ai/conversations/:id/turns',
    async (req, reply: FastifyReply) => {
      if (!UUID_RE.test(req.params.id)) {
        reply.code(400);
        return { error: 'invalid_conversation_id' };
      }
      const parsed = ListTurnsQuery.safeParse(req.query);
      if (!parsed.success) {
        reply.code(400);
        return {
          error: 'invalid_query',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        };
      }
      const identity = await authenticate(app, req, reply);
      if (!identity) return reply;

      try {
        return await listTurns(deps(), ownerScopeOf(identity), req.params.id, parsed.data);
      } catch (err) {
        if (replyForServiceError(reply, err)) return reply;
        req.log.error({ err }, 'unhandled error hydrating ai conversation turns');
        reply.code(500);
        return { error: 'internal_error' };
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // GET /v1/ai/conversations/:id/turns/:turnId — one-turn hydrate
  // ──────────────────────────────────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string; turnId: string } }>(
    '/v1/ai/conversations/:id/turns/:turnId',
    async (req, reply: FastifyReply) => {
      if (!UUID_RE.test(req.params.id)) {
        reply.code(400);
        return { error: 'invalid_conversation_id' };
      }
      if (!UUID_RE.test(req.params.turnId)) {
        reply.code(400);
        return { error: 'invalid_turn_id' };
      }
      const identity = await authenticate(app, req, reply);
      if (!identity) return reply;

      try {
        return await getTurn(deps(), ownerScopeOf(identity), req.params.id, req.params.turnId);
      } catch (err) {
        if (replyForServiceError(reply, err)) return reply;
        req.log.error({ err }, 'unhandled error hydrating an ai conversation turn');
        reply.code(500);
        return { error: 'internal_error' };
      }
    },
  );
}
