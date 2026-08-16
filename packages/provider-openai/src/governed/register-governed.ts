// Register Fastify routes for /governed/openai/* — governed-native surface.
// Currently surfaces responses + chat.completions (create + stream).

import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  handleOpenAIGovernedResponses,
  type GovernedHandleDeps,
  type GovernedTenant,
} from './handle-responses.js';
import { handleOpenAIGovernedChatCompletions } from './handle-chat-completions.js';
import { armAbortOnClose, pumpStreamWithTerminalEmit } from '@govai/provider-stream-http';

export type OpenAIGovernedDeps = GovernedHandleDeps & {
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
    /* c8 ignore next -- FastifyRequest header types are string|string[]|undefined; after Array.isArray, undefined is filtered by typeof, making the else-false branch structurally unreachable */
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

async function pumpResult(
  req: FastifyRequest,
  reply: import('fastify').FastifyReply,
  result:
    | Awaited<ReturnType<typeof handleOpenAIGovernedResponses>>
    | Awaited<ReturnType<typeof handleOpenAIGovernedChatCompletions>>,
  controller: AbortController,
): Promise<unknown | undefined> {
  if (result.kind === 'blocked') {
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
    // EP-008C: drain + emit the terminal event on EVERY termination path via the shared
    // helper (covers both /v1/responses and /v1/chat/completions). finalize (build+emit)
    // runs in the helper's drain `finally` — the handler's async chain → request-identity
    // ALS in scope (§1.3); on('close') only aborts. The pre-existing finalize try/catch+log
    // is preserved inside finalizeAndEmit and now also fires on the drain-throw path.
    await pumpStreamWithTerminalEmit({
      reader: result.body.getReader(),
      reply,
      controller,
      finalizeAndEmit: async (outcome) => {
        try {
          await result.finalize(outcome);
        } catch (err) {
          req.log.error({ err }, 'governed-openai stream finalize failed');
        }
      },
    });
    return undefined;
  }
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
}

export async function registerOpenAIGoverned(
  app: FastifyInstance,
  deps: OpenAIGovernedDeps,
): Promise<void> {
  // Fastify ships a built-in EXACT-string `application/json` parser that
  // getParser() resolves BEFORE the RegExp list — so without removing it here
  // the buffer parser below is shadowed, the handler receives a PARSED object,
  // `bufferifyBody` re-serializes it (whitespace / number / escape
  // normalization: not the client's bytes), `native_request_hash` attests the
  // re-serialization, and malformed JSON is 400'd by Fastify before governance
  // ever sees it. M1 (§13 / H1 fidelity): remove it in THIS encapsulated plugin
  // scope, exactly as the passthrough routes do, so the governed surface holds
  // the ORIGINAL bytes; other plugins keep the default parser.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    /^application\/json/,
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  app.post('/governed/openai/v1/responses', async (req, reply) => {
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
    // EP-008C: AbortController threaded to the upstream stream fetch + the terminal-emit helper.
    const ac = new AbortController();
    // EP-008C P2: arm the client-disconnect → abort hook BEFORE the governed-handler await
    // (which opens forwardStream internally), so a disconnect during it cancels the orphaned
    // upstream. EP-008C P2#2: kept LIVE across the pumpResult handoff (close is one-shot);
    // detached only AFTER pumpResult returns (finally below).
    const detachEarly = armAbortOnClose(reply, ac);
    let result: Awaited<ReturnType<typeof handleOpenAIGovernedResponses>>;
    try {
      result = await handleOpenAIGovernedResponses(
        { tenant, rawBody, inboundHeaders, isStream, signal: ac.signal },
        deps,
      );
    } catch (err) {
      detachEarly();
      // EP-008C §(3) Option C: a PRE-HEADER termination — no result/finalize, zero bytes,
      // no terminal. The early hook already aborted the orphaned upstream on disconnect.
      if (ac.signal.aborted) {
        // Client gone pre-header — take over the (dead) reply so Fastify does not attempt a
        // response on the closed socket; nothing to send, no terminal (§(3) C).
        reply.hijack();
        return;
      }
      throw err;
    }
    // EP-008C P2#2: keep the early hook live across the pumpResult handoff; detach only
    // after pumpResult (and its internal pump) returns — `return await` so the finally runs last.
    try {
      return await pumpResult(req, reply, result, ac);
    } finally {
      detachEarly();
    }
  });

  app.post('/governed/openai/v1/chat/completions', async (req, reply) => {
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
    // EP-008C: AbortController threaded to the upstream stream fetch + the terminal-emit helper.
    const ac = new AbortController();
    // EP-008C P2: arm the client-disconnect → abort hook BEFORE the governed-handler await
    // (which opens forwardStream internally), so a disconnect during it cancels the orphaned
    // upstream. EP-008C P2#2: kept LIVE across the pumpResult handoff (close is one-shot);
    // detached only AFTER pumpResult returns (finally below).
    const detachEarly = armAbortOnClose(reply, ac);
    let result: Awaited<ReturnType<typeof handleOpenAIGovernedChatCompletions>>;
    try {
      result = await handleOpenAIGovernedChatCompletions(
        { tenant, rawBody, inboundHeaders, isStream, signal: ac.signal },
        deps,
      );
    } catch (err) {
      detachEarly();
      // EP-008C §(3) Option C: a PRE-HEADER termination — no result/finalize, zero bytes,
      // no terminal. The early hook already aborted the orphaned upstream on disconnect.
      if (ac.signal.aborted) {
        // Client gone pre-header — take over the (dead) reply so Fastify does not attempt a
        // response on the closed socket; nothing to send, no terminal (§(3) C).
        reply.hijack();
        return;
      }
      throw err;
    }
    // EP-008C P2#2: keep the early hook live across the pumpResult handoff; detach only
    // after pumpResult (and its internal pump) returns — `return await` so the finally runs last.
    try {
      return await pumpResult(req, reply, result, ac);
    } finally {
      detachEarly();
    }
  });
}
