// AuditBridge ingress identity hook (SPEC-01 §2; ADR-028 §1–§3). Registers ONE
// `onRequest` hook scoped to the four direct-provider route prefixes. For each
// such request it builds the per-request AuditBridge identity (reading
// `X-GovAI-Idempotency-Key`), runs the remainder of the request lifecycle inside
// a request-owned `AsyncLocalStorage.run()` scope so the wired dispatcher reads
// the SAME identity for this request (never regenerated), and echoes
// `X-GovAI-Request-Id`. A malformed idempotency header is the ONE strict path:
// HTTP 400 `invalid_idempotency_key`. Every non-direct route (health, /v1/runs,
// admin, workrooms, …) is a no-op.

import type { FastifyInstance } from 'fastify';
import {
  buildRequestIdentity,
  requestIdentityAls,
  InvalidIdempotencyKeyError,
  type AuditBridgeRequestIdentity,
} from './request-identity.js';

// The four direct-provider route prefixes the AuditBridge is wired into. The hook
// is intentionally NOT global — it acts only on these prefixes.
const DIRECT_ROUTE_PREFIXES = [
  '/governed/openai',
  '/governed/anthropic',
  '/passthrough/openai',
  '/passthrough/anthropic',
] as const;

function isDirectRoute(url: string): boolean {
  const path = url.split('?', 1)[0] ?? url;
  return DIRECT_ROUTE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

export function registerRequestIdentityHook(app: FastifyInstance): void {
  // Callback-style hook ON PURPOSE (P0-PRE-F4): the request-owned ALS boundary
  // needs Fastify's `done()` continuation invoked synchronously INSIDE
  // `requestIdentityAls.run()`, so every asynchronous resource the subsequent
  // lifecycle creates (route handler, upstream forward, the stream pump's drain
  // `finally` where the delayed terminal emit reads `getStore()`) is created
  // within — and therefore inherits — this request's scope. The previous
  // `enterWith()` transitioned the ambient context with no callback-owned exit
  // boundary; `run()` restores the prior context when the callback returns, so
  // no store can outlive the lifecycle that owns it.
  app.addHook('onRequest', (req, reply, done) => {
    if (!isDirectRoute(req.url)) {
      // Non-direct routes (health, /v1/runs, admin, workrooms, …) stay entirely
      // outside the identity scope: no header validation, no identity, no ALS
      // store, no X-GovAI-Request-Id echo — just continue the lifecycle.
      done();
      return;
    }

    const raw = req.headers['x-govai-idempotency-key'];
    const header = typeof raw === 'string' ? raw : undefined;

    let identity: AuditBridgeRequestIdentity;
    try {
      identity = buildRequestIdentity(header);
    } catch (err) {
      if (err instanceof InvalidIdempotencyKeyError) {
        // The one strict (request-failing) behavior in the identity path. The
        // early 400 ENDS this request at the reply: `done()` is deliberately
        // NOT called after `reply.send()` from an onRequest hook — the route
        // handler must not run for a request whose identity header is invalid.
        reply.code(400).send({ error: err.code, message: err.message });
        return;
      }
      // Unexpected failure → Fastify's error lifecycle. Never swallowed, never
      // downgraded to a best-effort capture drop, never a 400 for a
      // programming error.
      done(err as Error);
      return;
    }

    // EP-005: the idempotency key has now been consumed into the AuditBridge
    // identity — remove it from the request so it is NEVER forwarded to the
    // upstream provider by an outbound-header builder. Central safety net for the
    // four direct routes; each builder's STRIP_INBOUND_AUTH is the defense-in-depth
    // that also covers the /v1/runs entry into the shared governed builder.
    delete req.headers['x-govai-idempotency-key'];
    reply.header('X-GovAI-Request-Id', identity.govaiRequestId);

    // AR-2: AsyncLocalStorage is the PRIMARY propagation channel. `done()` runs
    // synchronously inside `run()`, so the continuation Fastify drives from here
    // — and every async resource it creates — reads this request's identity via
    // `getStore()`. When the `run()` callback returns, the caller's prior
    // ambient context is restored; asynchronous resources created by the
    // continuation retain the request-owned store for their own lifecycle. This
    // explicit ownership boundary replaces the unbounded ambient transition from
    // `enterWith()` (the F4 hardening; falsification found no observable
    // cross-request contamination at the base).
    // The `WeakMap<FastifyRequest>` precedent already used by the passthrough
    // routes remains the pre-approved fallback if a streaming case ever loses
    // the async context deterministically.
    requestIdentityAls.run(identity, () => {
      done();
    });
  });
}
