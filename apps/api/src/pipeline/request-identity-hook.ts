// AuditBridge ingress identity hook (SPEC-01 §2; ADR-028 §1–§3). Registers ONE
// `onRequest` hook scoped to the four direct-provider route prefixes. For each
// such request it builds the per-request AuditBridge identity (reading
// `X-GovAI-Idempotency-Key`), enters it into the AsyncLocalStorage store so the
// wired dispatcher reads the SAME identity for this request (never regenerated),
// and echoes `X-GovAI-Request-Id`. A malformed idempotency header is the ONE
// strict path: HTTP 400 `invalid_idempotency_key`. Every non-direct route
// (health, /v1/runs, admin, workrooms, …) is a no-op.

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
  app.addHook('onRequest', async (req, reply) => {
    if (!isDirectRoute(req.url)) return;

    const raw = req.headers['x-govai-idempotency-key'];
    const header = typeof raw === 'string' ? raw : undefined;

    let identity: AuditBridgeRequestIdentity;
    try {
      identity = buildRequestIdentity(header);
    } catch (err) {
      if (err instanceof InvalidIdempotencyKeyError) {
        // The one strict (request-failing) behavior in the identity path.
        return reply.code(400).send({ error: err.code, message: err.message });
      }
      throw err;
    }

    // AR-2: AsyncLocalStorage is the PRIMARY propagation channel. `enterWith` sets
    // the store for the remainder of THIS request's async context, so the wired
    // dispatcher (invoked inside the handler's `emitAuditEvent`) reads the same
    // identity. The `WeakMap<FastifyRequest>` precedent already used by the
    // passthrough routes is the pre-approved fallback if a streaming case loses
    // the async context deterministically (recorded in the PR description).
    requestIdentityAls.enterWith(identity);
    reply.header('X-GovAI-Request-Id', identity.govaiRequestId);
  });
}
