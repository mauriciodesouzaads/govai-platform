// Register Fastify routes for /passthrough/openai/* under a parent app.
// Decisão 4: capability_canonical_level (registry value) ≠ capability_level (operational mode).
// HAE-003: purpose=assistants pre-sunset emits passthrough.invoked v3 with the
// 3-field deprecation marker; post-sunset returns 403 + structured body and
// intentionally does NOT emit a passthrough.invoked or tool.validation_blocked
// event — Issue [PR3/pre-sunset] tracks final audit semantics for that case.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { BetaTokenPolicyEntry, Capability, ResolvedProviderCredential } from '@govai/core-types';
import { resolveGovernance } from '@govai/core-governance';
import { OPENAI_BETA_POLICY, OPENAI_BETA_POLICY_VERSION } from '../beta-policy.js';
import {
  OPENAI_CAPABILITIES,
  matchOpenAIPath,
  resolveOpenAICapabilityForRequest,
} from '../capabilities/index.js';
import { handleOpenAIBetaHeader } from '../passthrough/beta-header-handler.js';
import { classifyOpenAITools } from '../passthrough/tool-classifier-hook.js';
import { forwardRaw } from '../passthrough/forward.js';
import { forwardStream } from '../passthrough/stream-forward.js';
import { armAbortOnClose, pumpStreamWithTerminalEmit } from '@govai/provider-stream-http';
import {
  buildPassthroughInvoked,
  buildPassthroughBetaDenied,
  buildToolValidationBlocked,
  type TenantContext,
} from '../passthrough/audit-emit.js';
import {
  extractMultipartPurpose,
  validateFilesPurpose,
  OPENAI_ASSISTANTS_SUNSET_AT,
  OPENAI_ASSISTANTS_MIGRATION_TARGET,
} from '../passthrough/files-purpose-validator.js';

export type OpenAIPassthroughDeps = {
  /** Upstream base URL (https://api.openai.com in production; loopback in tests). */
  upstreamBaseUrl: string;
  /** Resolve credentials per request: returns OpenAI API key for the tenant. */
  resolveProviderKey: (req: FastifyRequest) => Promise<ResolvedProviderCredential>;
  /** Optional OpenAI organization id per request. */
  resolveProviderOrganization?: (req: FastifyRequest) => Promise<string | undefined>;
  /** Resolve tenant context per request. */
  resolveTenant: (req: FastifyRequest) => Promise<TenantContext>;
  /** Active org_beta_overrides loader (org_id, provider) → array of {beta_token, id}. */
  activeOverridesLoader: (
    org_id: string,
    provider: string,
  ) => Promise<Array<{ beta_token: string; id: string }>>;
  /** Optional override of the policy table (used by tests; production uses OPENAI_BETA_POLICY). */
  policyTable?: ReadonlyArray<BetaTokenPolicyEntry>;
  /** Audit sink — caller decides where events go (DB chain, queue, in-memory list...). */
  emitAuditEvent: (event: unknown) => Promise<void> | void;
  /** Optional clock for purpose=assistants sunset branching (default: new Date()). */
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
  organization?: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(inbound)) {
    const key = k.toLowerCase();
    if (HOP_BY_HOP.has(key) || STRIP_INBOUND_AUTH.has(key)) continue;
    if (Array.isArray(v)) out[k] = v.join(', ');
    else if (typeof v === 'string') out[k] = v;
  }
  out['authorization'] = `Bearer ${providerKey}`;
  if (organization) out['openai-organization'] = organization;
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

export async function registerOpenAIPassthrough(
  app: FastifyInstance,
  deps: OpenAIPassthroughDeps,
): Promise<void> {
  // Fastify ships a built-in EXACT-string `application/json` parser. Its
  // getParser() resolves exact/media-type matches BEFORE the RegExp list, so
  // that default would shadow the buffer parser below and hand the route a
  // parsed object — defeating byte-for-byte preservation and making
  // `native_request_hash` attest a re-serialized body instead of the client's
  // original bytes. Remove it in THIS (encapsulated) plugin scope so the regex
  // buffer parser receives the untouched bytes for both `application/json` and
  // `application/json; charset=utf-8`. Other plugins keep the default parser.
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
    '/passthrough/openai/*',
    async (req, reply) => {
      const policyTable = deps.policyTable ?? OPENAI_BETA_POLICY;
      const now = deps.now ?? (() => new Date());

      // Path match.
      const matched = matchOpenAIPath(req.url);
      if (!matched) {
        reply.code(404);
        return {
          error: 'capability_not_registered',
          message: 'Path is not a registered OpenAI passthrough endpoint',
        };
      }

      const isStream =
        (matched.pathTemplate === '/v1/responses' ||
          matched.pathTemplate === '/v1/chat/completions') &&
        isStreamBody(req.body);

      const resolved = resolveOpenAICapabilityForRequest({
        method: req.method,
        pathTemplate: matched.pathTemplate,
        isStream,
      });
      const capabilityRegistryEntry: Capability | undefined = OPENAI_CAPABILITIES.find(
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
      const betaHeaderRaw =
        req.headers['openai-beta'] ??
        (req.headers as Record<string, unknown>)['OpenAI-Beta'];
      const betaResult = await handleOpenAIBetaHeader({
        org_id: tenant.org_id,
        header_value:
          typeof betaHeaderRaw === 'string'
            ? betaHeaderRaw
            : Array.isArray(betaHeaderRaw)
              ? (betaHeaderRaw as string[]).join(',')
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

      // Tool classifier (only on /v1/responses or /v1/chat/completions with body.tools[]).
      let toolClassifications: ReturnType<typeof classifyOpenAITools>['classifications'] = [];
      const isToolCarryingPath =
        matched.pathTemplate === '/v1/responses' ||
        matched.pathTemplate === '/v1/chat/completions';
      if (isToolCarryingPath) {
        const surface =
          matched.pathTemplate === '/v1/responses' ? 'responses' : 'chat_completions';
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
          const result = classifyOpenAITools(tools, surface);
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

      // Files purpose policy (Matrix §18.8.1 / HAE-003).
      // Pre-sunset: allow + warning header + audit flags.
      // Post-sunset: 403 structured. NO improvised audit event (Issue [PR3/pre-sunset]).
      let purposeWarning: { sunset_at: string; migration_target: string } | null = null;
      const isFilesUpload =
        matched.pathTemplate === '/v1/files' && req.method.toUpperCase() === 'POST';
      if (isFilesUpload) {
        const ct =
          typeof req.headers['content-type'] === 'string'
            ? (req.headers['content-type'] as string)
            : '';
        let purpose: string | undefined;
        if (ct.toLowerCase().startsWith('multipart/form-data') && Buffer.isBuffer(req.body)) {
          purpose = extractMultipartPurpose(req.body);
        } else if (Buffer.isBuffer(req.body)) {
          try {
            const j = JSON.parse(req.body.toString('utf8')) as { purpose?: unknown };
            if (typeof j.purpose === 'string') purpose = j.purpose;
          } catch {
            // ignore
          }
        } else if (typeof req.body === 'object' && req.body !== null) {
          // Fallback when body was parsed by a non-buffer parser earlier in the chain.
          const j = req.body as { purpose?: unknown };
          if (typeof j.purpose === 'string') purpose = j.purpose;
        }
        const validation = validateFilesPurpose(purpose, now());
        if (validation.kind === 'block_post_sunset') {
          reply.code(403);
          reply.header('content-type', 'application/json');
          return {
            error: validation.error_code,
            reason: validation.reason,
            sunset_at: validation.sunset_at,
            migration_target: validation.migration_target,
          };
        }
        if (validation.kind === 'allow_with_warning') {
          purposeWarning = {
            sunset_at: validation.sunset_at,
            migration_target: validation.migration_target,
          };
          reply.header(
            'x-govai-deprecation-warning',
            validation.warning_header_value,
          );
        }
      }

      // Forward.
      // F1: .apiKey builds headers (memory only); .source flows to credential_source.
      const resolvedCredential = await deps.resolveProviderKey(req);
      const organization = deps.resolveProviderOrganization
        ? await deps.resolveProviderOrganization(req)
        : undefined;
      const headers = buildOutboundHeaders(req.headers, resolvedCredential.apiKey, organization);
      const concretePath = req.url
        .replace(/^\/passthrough\/openai/, '')
        .replace(/\?.*$/, '');
      const requestBody = bufferifyBody(req.body);

      if (isStream) {
        const occurredAt = now();
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
        // EP-008C P2#2: keep the early close→abort hook LIVE across the handoff to the pump
        // (close is one-shot; detaching before the pump arms its own listener would drop a
        // disconnect that fires in the gap). Detach only AFTER the pump returns (finally below).
        // Hijack first, then flush upstream status + headers via writeHead
        // before any raw.write — otherwise the implicit writeHead on first
        // chunk drops everything set via reply.header() (e.g. Content-Type:
        // text/event-stream). Matches the governed pattern in
        // packages/provider-openai/src/governed/register-governed.ts.
        reply.hijack();
        const respHeaders = filterResponseHeaders(
          Object.entries(streamRes.responseHeaders),
        );
        reply.raw.writeHead(streamRes.status, respHeaders);
        // Passthrough is the explicit AUDIT-ONLY surface (see Anthropic
        // register-passthrough.ts comment): risk fields are computed honestly,
        // enforcement_decision is intentionally `observe`.
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
        // path via the shared helper. The emit runs in the helper's drain `finally` —
        // the handler's async chain — so request-identity ALS is in scope (§1.3);
        // on('close') only aborts. Observe-only.
        const pumpPromise = pumpStreamWithTerminalEmit({
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
                credential_source: resolvedCredential.source,
                allowlist_version: OPENAI_BETA_POLICY_VERSION,
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
        try {
          await pumpPromise;
        } finally {
          detachEarly();
        }
        return;
      }

      // Non-stream raw forward.
      const occurredAt = now();
      const fwd = await forwardRaw({
        baseUrl: deps.upstreamBaseUrl,
        pathTemplate: matched.pathTemplate,
        concretePath,
        method: req.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        headers,
        body: requestBody,
      });

      for (const [k, v] of Object.entries(
        filterResponseHeaders(Object.entries(fwd.responseHeaders)),
      )) {
        reply.header(k, v);
      }
      reply.code(fwd.status);

      const isMultipartReq =
        typeof req.headers['content-type'] === 'string' &&
        (req.headers['content-type'] as string)
          .toLowerCase()
          .startsWith('multipart/form-data');
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
          credential_source: resolvedCredential.source,
          allowlist_version: OPENAI_BETA_POLICY_VERSION,
          ...(fwd.provider_request_id ? { provider_request_id: fwd.provider_request_id } : {}),
          body_forward_mode: 'raw',
          beta_allowlist_sources: betaResult.sources,
          detected_tool_classifications: toolClassifications,
          ...(purposeWarning
            ? {
                purpose_deprecated: true,
                purpose_deprecation_sunset_at: purposeWarning.sunset_at,
                purpose_deprecation_migration_target: purposeWarning.migration_target,
              }
            : {}),
        }),
      );

      reply.send(fwd.responseBody);
      return reply;
    },
  );
}

// Re-export for convenience used by `apps/api/src/routes/passthrough-openai.ts`.
export type { FastifyInstance, FastifyRequest, FastifyReply };
export { OPENAI_ASSISTANTS_SUNSET_AT, OPENAI_ASSISTANTS_MIGRATION_TARGET };
