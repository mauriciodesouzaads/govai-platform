// Register Fastify routes for /governed/anthropic/* — governed-native surface.
// Currently surfaces messages.create / messages.stream. The architecture extends
// without refactor: add more `app.all` matchers per capability.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  handleAnthropicGovernedMessages,
  type GovernedHandleDeps,
  type GovernedTenant,
} from './handle-messages.js';
import { armAbortOnClose, pumpStreamWithTerminalEmit } from '@govai/provider-stream-http';

export type AnthropicGovernedDeps = GovernedHandleDeps & {
  /** Resolve the tenant + tier + operational_mode from the request (DB-backed). */
  resolveTenant: (req: FastifyRequest) => Promise<GovernedTenant>;
};

const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'content-length',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'te',
  'trailer',
]);

function inboundHeadersFromReq(req: FastifyRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) out[k] = v.join(', ');
    /* c8 ignore next -- FastifyRequest header types are string|string[]|undefined; undefined is filtered by typeof check, making the else-false branch structurally unreachable */
    else if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function bufferifyBody(body: unknown): Buffer {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  return Buffer.from(JSON.stringify(body), 'utf8');
}

// Detect a streaming request by reading ONLY the top-level `stream` field —
// aligned with the Native/H1 semantics (M1 §13). We JSON.parse a COPY of the
// raw Buffer purely for read-only inspection; never a substring/regex match
// (which false-positives on a nested `"stream": true` inside message content)
// and never the Accept header. A parse failure means the body is not JSON we
// can inspect: it is NOT a new GovAI rejection — the request proceeds as
// non-streaming (the provider owns body validity). The original bytes are
// never mutated or re-serialized.
function isStreamRequest(body: unknown): boolean {
  if (Buffer.isBuffer(body)) {
    try {
      const parsed: unknown = JSON.parse(body.toString('utf8'));
      return (
        typeof parsed === 'object' &&
        parsed !== null &&
        (parsed as { stream?: unknown }).stream === true
      );
    } catch {
      return false;
    }
  }
  if (body && typeof body === 'object') {
    return (body as { stream?: unknown }).stream === true;
  }
  return false;
}

export async function registerAnthropicGoverned(
  app: FastifyInstance,
  deps: AnthropicGovernedDeps,
): Promise<void> {
  app.addContentTypeParser(
    /^application\/json/,
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  app.post('/governed/anthropic/v1/messages', async (req, reply) => {
    let tenant: GovernedTenant;
    try {
      tenant = await deps.resolveTenant(req);
    } catch (err) {
      reply.code(401);
      return { error: 'auth_error', message: (err as Error).message };
    }

    const inboundHeaders = inboundHeadersFromReq(req);
    const rawBody = bufferifyBody(req.body);
    const isStream = isStreamRequest(req.body);

    // EP-008C: an AbortController whose signal threads to the upstream stream fetch
    // (client-disconnect propagation) and drives the terminal-emit-on-every-path.
    const ac = new AbortController();
    // EP-008C P2: arm the client-disconnect → abort hook BEFORE the governed-handler await
    // (which opens forwardStream internally), so a disconnect during that await cancels the
    // orphaned upstream fetch. Detached before the stream pump installs its own listener.
    const detachEarly = armAbortOnClose(reply, ac);
    let result: Awaited<ReturnType<typeof handleAnthropicGovernedMessages>>;
    try {
      result = await handleAnthropicGovernedMessages(
        { tenant, rawBody, inboundHeaders, isStream, signal: ac.signal },
        deps,
      );
    } catch (err) {
      detachEarly();
      // EP-008C §(3) Option C: a PRE-HEADER termination — the governed stream never returned
      // upstream headers (its internal forwardStream rejected on abort), so no result/finalize
      // exists and there is NO partial content to attest. Emit NO terminal. If the client
      // disconnected, the early hook already aborted the orphaned upstream; complete quietly.
      // Otherwise preserve the prior behavior (the reject propagates to Fastify's error handler).
      if (ac.signal.aborted) {
        // Client gone pre-header — take over the (dead) reply so Fastify does not attempt a
        // response on the closed socket; nothing to send, no terminal (§(3) C).
        reply.hijack();
        return;
      }
      throw err;
    }

    // EP-008C P2#2: keep the early close→abort hook live until the streaming handoff is done;
    // detach per result kind below (the stream branch detaches AFTER the pump, so the
    // close→abort path stays continuously live across the detach→pump-listener boundary).
    if (result.kind === 'blocked') {
      detachEarly();
      // F2 HTTP honesty (M1, OD-2=A): the recommendation header keeps its
      // meaning (matrix/governance recommendation) and the APPLIED result is
      // stated separately — a tool-floor block can carry decision=observe +
      // applied=blocked, which is exactly the distinction F2 exposes.
      reply.header('x-govai-capability-level', 'policy_governed');
      reply.header('x-govai-effective-risk-class', result.governance.effective_risk_class);
      reply.header('x-govai-enforcement-decision', result.governance.enforcement_decision);
      reply.header('x-govai-enforcement-applied', 'blocked');
      reply.code(403);
      return {
        error: 'governed_blocked',
        reason: result.reason,
        governance: result.governance,
        enforcement_applied: 'blocked',
        block_trigger: result.block_trigger,
      };
    }

    if (result.kind === 'stream') {
      reply.hijack();
      const respHeaders: Record<string, string> = {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      };
      for (const [k, v] of Object.entries(result.response_headers)) {
        if (HOP_BY_HOP.has(k.toLowerCase())) continue;
        respHeaders[k] = v;
      }
      respHeaders['x-govai-capability-level'] = 'policy_governed';
      respHeaders['x-govai-effective-risk-class'] = result.governance.effective_risk_class;
      // Recommendation (matrix label) vs APPLIED (forwarded) — F2 (OD-2=A):
      // ask / enforce / sandbox_required labels are NOT executed today; the
      // truth is exposed additively, never faked.
      respHeaders['x-govai-enforcement-decision'] = result.governance.enforcement_decision;
      respHeaders['x-govai-enforcement-applied'] = 'forwarded';
      reply.raw.writeHead(result.status_code, respHeaders);
      // EP-008C: drain + emit the terminal event on EVERY termination path via the
      // shared helper. result.finalize(outcome) (build+emit) runs in the helper's drain
      // `finally` — the handler's async chain → request-identity ALS in scope (§1.3);
      // on('close') only aborts. The pre-existing finalize try/catch+log is preserved
      // inside finalizeAndEmit and now also fires on the drain-throw path.
      const pumpPromise = pumpStreamWithTerminalEmit({
        reader: result.body.getReader(),
        reply,
        controller: ac,
        finalizeAndEmit: async (outcome) => {
          try {
            await result.finalize(outcome);
          } catch (err) {
            req.log.error({ err }, 'governed-anthropic stream finalize failed');
          }
        },
      });
      try {
        await pumpPromise;
      } finally {
        detachEarly();
      }
      return;
    }

    // non_stream
    detachEarly();
    for (const [k, v] of Object.entries(result.response_headers)) {
      if (HOP_BY_HOP.has(k.toLowerCase())) continue;
      reply.header(k, v);
    }
    reply.header('x-govai-capability-level', 'policy_governed');
    reply.header('x-govai-effective-risk-class', result.governance.effective_risk_class);
    // Recommendation vs APPLIED — see the stream branch (F2, OD-2=A). The
    // provider-native success body is NOT modified.
    reply.header('x-govai-enforcement-decision', result.governance.enforcement_decision);
    reply.header('x-govai-enforcement-applied', 'forwarded');
    reply.code(result.status_code);
    reply.send(result.response_body_raw);
    return reply;
  });
}
