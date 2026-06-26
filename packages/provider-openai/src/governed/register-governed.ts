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

function isStreamRequest(body: unknown, headers: Record<string, string>): boolean {
  if (Buffer.isBuffer(body)) {
    const sniff = body.toString('utf8');
    if (/"stream"\s*:\s*true/.test(sniff)) return true;
  } else if (body && typeof body === 'object') {
    if ((body as { stream?: boolean }).stream === true) return true;
  }
  const accept = headers['accept'];
  return typeof accept === 'string' && accept.includes('text/event-stream');
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
    reply.code(403);
    return {
      error: 'governed_blocked',
      reason: result.reason,
      governance: result.governance,
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
    respHeaders['x-govai-enforcement-decision'] = result.governance.enforcement_decision;
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
  reply.header('x-govai-enforcement-decision', result.governance.enforcement_decision);
  reply.code(result.status_code);
  reply.send(result.response_body_raw);
  return reply;
}

export async function registerOpenAIGoverned(
  app: FastifyInstance,
  deps: OpenAIGovernedDeps,
): Promise<void> {
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
    const isStream = isStreamRequest(req.body, inboundHeaders);
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
    const isStream = isStreamRequest(req.body, inboundHeaders);
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
