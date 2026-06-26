// Register Fastify routes for /passthrough/anthropic/* under a parent app.
// Decisão 4: capability_canonical_level (registry value) ≠ capability_level (operational mode).
// Audit emit always sets BOTH for provider-namespaced capabilities.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { BetaTokenPolicyEntry, Capability } from '@govai/core-types';
import { resolveGovernance } from '@govai/core-governance';
import {
  ANTHROPIC_BETA_POLICY,
  ANTHROPIC_BETA_POLICY_VERSION,
} from '../beta-policy.js';
import {
  ANTHROPIC_CAPABILITIES,
  matchAnthropicPath,
  resolveAnthropicCapabilityForRequest,
} from '../capabilities/index.js';
import { handleAnthropicBetaHeader } from '../passthrough/beta-header-handler.js';
import { classifyTools } from '../passthrough/tool-classifier-hook.js';
import { forwardRaw } from '../passthrough/forward.js';
import { forwardStream } from '../passthrough/stream-forward.js';
import { armAbortOnClose, pumpStreamWithTerminalEmit } from '@govai/provider-stream-http';
import {
  buildPassthroughInvoked,
  buildPassthroughBetaDenied,
  buildToolValidationBlocked,
  type TenantContext,
} from '../passthrough/audit-emit.js';

export type AnthropicPassthroughDeps = {
  /** Upstream base URL (https://api.anthropic.com in production; loopback in tests). */
  upstreamBaseUrl: string;
  /** Resolve credentials per request: returns Anthropic API key for the tenant. */
  resolveProviderKey: (req: FastifyRequest) => Promise<string>;
  /** Resolve tenant context per request. */
  resolveTenant: (req: FastifyRequest) => Promise<TenantContext>;
  /** Active org_beta_overrides loader (org_id, provider) → array of {beta_token, id}. */
  activeOverridesLoader: (
    org_id: string,
    provider: string,
  ) => Promise<Array<{ beta_token: string; id: string }>>;
  /** Optional override of the policy table (used by tests; production uses ANTHROPIC_BETA_POLICY). */
  policyTable?: ReadonlyArray<BetaTokenPolicyEntry>;
  /** Audit sink — caller decides where events go (DB chain, queue, in-memory list...). */
  emitAuditEvent: (event: unknown) => Promise<void> | void;
  /** Injectable producer clock for `occurred_at` (tests inject a stable clock so
   *  an idempotent replay holds occurred_at equal; production omits it → real
   *  `new Date()`). Matches the governed handlers' pattern. */
  now?: () => Date;
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

const STRIP_INBOUND_AUTH = new Set([
  'authorization',
  'x-api-key',
  'x-govai-api-key',
  // EP-005: the consumed AuditBridge idempotency key is never forwarded upstream.
  'x-govai-idempotency-key',
]);

function buildOutboundHeaders(
  inbound: FastifyRequest['headers'],
  providerKey: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(inbound)) {
    const key = k.toLowerCase();
    if (HOP_BY_HOP.has(key) || STRIP_INBOUND_AUTH.has(key)) continue;
    if (Array.isArray(v)) out[k] = v.join(', ');
    else if (typeof v === 'string') out[k] = v;
  }
  out['x-api-key'] = providerKey;
  if (!('anthropic-version' in out)) {
    out['anthropic-version'] = '2023-06-01';
  }
  return out;
}

/**
 * Filter upstream response headers, dropping hop-by-hop headers (per the
 * HOP_BY_HOP policy above) and preserving all others. Pure: it decides which
 * headers pass, independently of how each call-site applies them
 * (`reply.raw.writeHead` for streaming, `reply.header` for non-streaming).
 * Extracted from the inline response loops so the policy can be unit-tested
 * before Node/Fastify response normalization — which owns connection /
 * keep-alive / transfer-encoding / content-length on the outgoing socket and
 * would otherwise mask their removal from a downstream HTTP assertion. Does not
 * mutate its input.
 */
export function filterResponseHeaders(
  headers: Iterable<[string, string]>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of headers) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

function bufferifyBody(body: unknown): Buffer {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  return Buffer.from(JSON.stringify(body), 'utf8');
}

// Detect a streaming request by reading ONLY the top-level `stream` field.
//
// The body is the client's raw Buffer (provider-native passthrough does not
// pre-parse it). We JSON.parse a copy purely for read-only inspection and read
// the top-level `stream` — never a substring/regex match, which could
// false-positive on a nested `"stream": true` (e.g. inside message content).
// A parse failure means the body is not JSON we can inspect: per the
// provider-native passthrough decision we DO NOT reject it — it is forwarded
// byte-for-byte to the provider — and we simply treat it as non-streaming.
// The original Buffer is never mutated or reassigned; parsing produces a
// separate object.
function isStreamBody(body: unknown): boolean {
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
    return (body as { stream?: boolean }).stream === true;
  }
  return false;
}

export async function registerAnthropicPassthrough(
  app: FastifyInstance,
  deps: AnthropicPassthroughDeps,
): Promise<void> {
  // We register a raw body parser to preserve bytes for forward + hash.
  // Fastify's built-in EXACT-string `application/json` parser is resolved by
  // getParser() before the RegExp list, so it would shadow the buffer parser
  // below and hand the route a parsed object — defeating byte-for-byte
  // preservation and making `native_request_hash` attest a re-serialized body
  // instead of the client's original bytes. Remove it in THIS (encapsulated)
  // plugin scope so the regex buffer parser receives the untouched bytes for
  // both `application/json` and `application/json; charset=utf-8`. Other
  // plugins keep the default parser.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    /^application\/json/,
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );
  app.addContentTypeParser(
    /^multipart\/form-data/,
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  app.all<{ Params: { '*': string } }>(
    '/passthrough/anthropic/*',
    async (req, reply) => {
      const policyTable = deps.policyTable ?? ANTHROPIC_BETA_POLICY;

      // Path match.
      const matched = matchAnthropicPath(req.url);
      if (!matched) {
        reply.code(404);
        return {
          error: 'capability_not_registered',
          message: 'Path is not a registered Anthropic passthrough endpoint',
        };
      }

      const isStream =
        matched.pathTemplate === '/v1/messages' && isStreamBody(req.body);

      const resolved = resolveAnthropicCapabilityForRequest({
        method: req.method,
        pathTemplate: matched.pathTemplate,
        isStream,
      });
      // `matchAnthropicPath` already returned 404 above if the path was unknown,
      // so resolveAnthropicCapabilityForRequest MUST return a registered id here.
      // Fail loudly instead of falling back to a fake default risk/enforcement.
      const capabilityRegistryEntry: Capability | undefined = ANTHROPIC_CAPABILITIES.find(
        (c) => c.id === resolved.capability_id,
      );
      if (!capabilityRegistryEntry) {
        reply.code(500);
        return {
          error: 'capability_registry_missing',
          message: `path matched but capability ${resolved.capability_id} not in registry`,
        };
      }

      // Tenant context (auth happens here; deps decides how).
      let tenant: TenantContext;
      try {
        tenant = await deps.resolveTenant(req);
      } catch (err) {
        reply.code(401);
        return { error: 'auth_error', message: (err as Error).message };
      }

      // Beta header gate.
      const betaResult = await handleAnthropicBetaHeader({
        org_id: tenant.org_id,
        header_value: typeof req.headers['anthropic-beta'] === 'string'
          ? (req.headers['anthropic-beta'] as string)
          : Array.isArray(req.headers['anthropic-beta'])
            ? (req.headers['anthropic-beta'] as string[]).join(',')
            : undefined,
        policy_table: policyTable,
        active_overrides_loader: deps.activeOverridesLoader,
      });
      if (betaResult.decision === 'deny') {
        for (const d of betaResult.denied) {
          await deps.emitAuditEvent(
            buildPassthroughBetaDenied({
              tenant,
              capability_id: resolved.capability_id,
              beta_token: d.beta_token,
              policy_at_resolution: d.policy_at_resolution as
                | 'global_allowlist'
                | 'org_override_allowed'
                | 'hard_denied'
                | 'verification_required'
                | 'denied_until_decision'
                | 'removed_as_no_longer_needed'
                | 'unknown',
              reason_code: d.reason_code,
            }),
          );
        }
        reply.code(403);
        return {
          error: 'beta_denied',
          denied: betaResult.denied,
        };
      }

      // Tool classifier (only on /v1/messages with body.tools[]).
      let toolClassifications: ReturnType<typeof classifyTools>['classifications'] = [];
      if (matched.pathTemplate === '/v1/messages') {
        let parsedBody: { tools?: unknown[] } | null = null;
        if (Buffer.isBuffer(req.body)) {
          try {
            parsedBody = JSON.parse(req.body.toString('utf8')) as { tools?: unknown[] };
          } catch {
            parsedBody = null;
          }
        } else if (typeof req.body === 'object' && req.body !== null) {
          parsedBody = req.body as { tools?: unknown[] };
        }
        const tools = parsedBody?.tools;
        if (Array.isArray(tools) && tools.length > 0) {
          const result = classifyTools(tools);
          toolClassifications = result.classifications;
          if (result.decision === 'block') {
            for (const b of result.blocked) {
              await deps.emitAuditEvent(
                buildToolValidationBlocked({
                  tenant,
                  capability_id: resolved.capability_id,
                  tool_index: b.tool_index,
                  tool_type: b.tool_type,
                  tool_type_observed: b.tool_type_observed,
                  classification: b.classification,
                  reason: b.reason,
                  reason_detail: b.reason_detail,
                }),
              );
            }
            reply.code(403);
            return {
              error:
                result.blocked[0]?.reason === 'capability_blocked_via_token' ||
                result.blocked[0]?.reason === 'hard_denied_beta'
                  ? 'tool_blocked_until_governance_primitive'
                  : result.blocked[0]?.reason === 'capability_planned'
                    ? 'tool_pending_capability_promotion'
                    : 'tool_type_unknown',
              blocked: result.blocked,
            };
          }
        }
      }

      // Forward.
      const providerKey = await deps.resolveProviderKey(req);
      const headers = buildOutboundHeaders(req.headers, providerKey);
      const concretePath = req.url
        .replace(/^\/passthrough\/anthropic/, '')
        .replace(/\?.*$/, '');
      const requestBody = bufferifyBody(req.body);

      if (isStream) {
        // Stream variant.
        const occurredAt = (deps.now ?? (() => new Date()))();
        // EP-008C: pass an AbortController so a client disconnect aborts upstream.
        const ac = new AbortController();
        // EP-008C P2: arm the client-disconnect → abort hook BEFORE the upstream-headers
        // await, so a disconnect DURING forwardStream cancels the orphaned upstream fetch.
        // Detached below before the pump installs its own drain-phase listener.
        const detachEarly = armAbortOnClose(reply, ac);
        let streamRes: Awaited<ReturnType<typeof forwardStream>>;
        try {
          streamRes = await forwardStream({
            baseUrl: deps.upstreamBaseUrl,
            concretePath,
            method: 'POST',
            headers,
            body: requestBody,
            signal: ac.signal,
          });
        } catch (err) {
          detachEarly();
          // EP-008C §(3) Option C: a PRE-HEADER termination — the stream never returned
          // upstream headers, so zero bytes were delivered and there is NO partial content
          // to attest. Emit NO terminal. If the client disconnected, the early hook already
          // aborted the orphaned upstream; complete quietly (reply not yet hijacked).
          // Otherwise (upstream failed before headers) preserve the prior behavior.
          if (ac.signal.aborted) {
            // Client gone pre-header — take over the (dead) reply so Fastify does not attempt
            // a response on the closed socket; nothing to send, no terminal (§(3) C).
            reply.hijack();
            return;
          }
          throw err;
        }
        detachEarly();
        // Hijack first, then flush upstream status + headers via writeHead
        // before any raw.write — otherwise the implicit writeHead on first
        // chunk drops everything set via reply.header() (e.g. Content-Type:
        // text/event-stream). Matches the governed pattern in
        // packages/provider-anthropic/src/governed/register-governed.ts.
        reply.hijack();
        const respHeaders = filterResponseHeaders(
          Object.entries(streamRes.responseHeaders),
        );
        reply.raw.writeHead(streamRes.status, respHeaders);
        // Passthrough is the explicit AUDIT-ONLY surface: the route forwards
        // byte-perfect and never enforces, so `enforcement_decision='observe'`
        // is the truthful semantic of this code path — NOT a fallback default.
        // base_risk_class / effective_risk_class / risk_escalation_reasons are
        // still computed honestly so the audit event reflects what governance
        // would say if this same request were sent through /governed/* —
        // observers can compare and tell which tenants would be enforced upon.
        const govStream = resolveGovernance({
          capability: capabilityRegistryEntry,
          tenant_tier: tenant.tier,
          operational_mode: tenant.operational_mode,
          tool_classifications: toolClassifications.map((c) => ({
            tool_index: c.tool_index,
            classification: c.classification,
            contributed_risk_class: c.contributed_risk_class,
          })),
          dlp_findings: [],
        });
        // EP-008C: drain + emit the terminal PassthroughInvoked on EVERY termination
        // path (clean / upstream_error / client_disconnect) via the shared helper. The
        // emit runs in the helper's drain `finally` — the handler's async chain — so
        // request-identity ALS is in scope (§1.3); on('close') only aborts. Observe-only.
        await pumpStreamWithTerminalEmit({
          reader: streamRes.body.getReader(),
          reply,
          controller: ac,
          finalizeAndEmit: async (outcome) => {
            const final = await streamRes.finalize();
            await deps.emitAuditEvent(
              buildPassthroughInvoked({
                tenant,
                capability_id: resolved.capability_id,
                capability_level: 'passthrough_audited',
                capability_canonical_level: resolved.canonical_level,
                native_endpoint: matched.pathTemplate,
                native_method: 'POST',
                is_stream: true,
                is_multipart: false,
                base_risk_class: govStream.base_risk_class,
                effective_risk_class: govStream.effective_risk_class,
                risk_escalation_reasons: govStream.risk_escalation_reasons,
                // Audit-only surface: enforcement is intentionally `observe`.
                enforcement_decision: 'observe',
                native_request_hash: streamRes.native_request_hash,
                stream_final_hash: final.stream_final_hash,
                latency_ms: final.latency_ms,
                occurred_at: occurredAt,
                status_code: streamRes.status,
                credential_source: 'tenant_provider_credential',
                allowlist_version: ANTHROPIC_BETA_POLICY_VERSION,
                ...(streamRes.provider_request_id
                  ? { provider_request_id: streamRes.provider_request_id }
                  : {}),
                body_forward_mode: 'raw',
                beta_allowlist_sources: betaResult.sources,
                detected_tool_classifications: toolClassifications,
                stream_outcome: outcome,
              }),
            );
          },
        });
        return;
      }

      // Non-stream raw forward.
      const occurredAt = (deps.now ?? (() => new Date()))();
      const fwd = await forwardRaw({
        baseUrl: deps.upstreamBaseUrl,
        pathTemplate: matched.pathTemplate,
        concretePath,
        method: req.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        headers,
        body: requestBody,
      });

      // Mirror response headers (strip hop-by-hop).
      for (const [k, v] of Object.entries(
        filterResponseHeaders(Object.entries(fwd.responseHeaders)),
      )) {
        reply.header(k, v);
      }
      reply.code(fwd.status);

      const isMultipartReq =
        typeof req.headers['content-type'] === 'string' &&
        req.headers['content-type'].toLowerCase().startsWith('multipart/form-data');
      const govNonStream = resolveGovernance({
        capability: capabilityRegistryEntry,
        tenant_tier: tenant.tier,
        operational_mode: tenant.operational_mode,
        tool_classifications: toolClassifications.map((c) => ({
          tool_index: c.tool_index,
          classification: c.classification,
          contributed_risk_class: c.contributed_risk_class,
        })),
        dlp_findings: [],
        is_multipart: isMultipartReq,
      });
      await deps.emitAuditEvent(
        buildPassthroughInvoked({
          tenant,
          capability_id: resolved.capability_id,
          capability_level: 'passthrough_audited',
          capability_canonical_level: resolved.canonical_level,
          native_endpoint: matched.pathTemplate,
          native_method: req.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
          is_stream: false,
          is_multipart: isMultipartReq,
          base_risk_class: govNonStream.base_risk_class,
          effective_risk_class: govNonStream.effective_risk_class,
          risk_escalation_reasons: govNonStream.risk_escalation_reasons,
          // Audit-only surface: enforcement is intentionally `observe`.
          enforcement_decision: 'observe',
          native_request_hash: fwd.native_request_hash,
          native_response_hash: fwd.native_response_hash,
          latency_ms: fwd.latency_ms,
          occurred_at: occurredAt,
          status_code: fwd.status,
          credential_source: 'tenant_provider_credential',
          allowlist_version: ANTHROPIC_BETA_POLICY_VERSION,
          ...(fwd.provider_request_id ? { provider_request_id: fwd.provider_request_id } : {}),
          body_forward_mode: 'raw',
          beta_allowlist_sources: betaResult.sources,
          detected_tool_classifications: toolClassifications,
        }),
      );

      reply.send(fwd.responseBody);
      return reply;
    },
  );
}

// Re-export for convenience used by `apps/api/src/routes/passthrough-anthropic.ts`.
export type { FastifyInstance, FastifyRequest, FastifyReply };
