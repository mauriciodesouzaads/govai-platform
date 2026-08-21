// Register Fastify routes for /passthrough/anthropic/* under a parent app.
// Decisão 4: capability_canonical_level (registry value) ≠ capability_level (operational mode).
// Audit emit always sets BOTH for provider-namespaced capabilities.
//
// Foundation V1 M1 (OD-1=A) — Native/Audited contract of this route:
//   gate order  auth → path registry → method → beta floor → tool floor → credential → forward
//   - tenant AUTH runs first, so an unauthenticated caller learns nothing about
//     which provider paths GovAI registers (§14.1); an authenticated caller gets
//     404 capability_not_registered for an unknown path and 405 method_not_allowed
//     (+ truthful Allow) for a registered path with an unmapped method (§14.2) —
//     never an internal 500 for a caller mismatch (a REAL registry inconsistency
//     on a mapped method still fails loud as 500 capability_registry_missing).
//   - the ONLY Native semantic denies are the explicit computer-use high-risk
//     floor (hard_denied beta / provider-hosted computer-use tool). Every such
//     deny is EXPLICIT (403 + machine-readable body), keeps its specialized
//     diagnostic event AND is durably evidenced by a valid blocked
//     `passthrough.invoked` v4 (enforcement_decision='blocked',
//     body_forward_mode='blocked', status 403, provider NOT called) — FB-4.
//   - unknown / unresolved beta tokens and non-computer tools are forwarded and
//     observed (bounded hashed markers in `risk_escalation_reasons`).

import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { BetaTokenPolicyEntry, Capability, ResolvedProviderCredential } from '@govai/core-types';
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
import { SHA256_EMPTY } from '../passthrough/evidence-constants.js';
import { armAbortOnClose, pumpStreamWithTerminalEmit } from '@govai/provider-stream-http';
import {
  buildPassthroughInvoked,
  buildPassthroughBetaDenied,
  buildToolValidationBlocked,
  type TenantContext,
} from '../passthrough/audit-emit.js';
import { STRIP_INBOUND_BROWSER_HOP } from '../outbound-header-policy.js';

export type AnthropicPassthroughDeps = {
  /** Upstream base URL (https://api.anthropic.com in production; loopback in tests). */
  upstreamBaseUrl: string;
  /** Resolve credentials per request: returns Anthropic API key for the tenant. */
  resolveProviderKey: (req: FastifyRequest) => Promise<ResolvedProviderCredential>;
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
    // AI-CONSOLE-ORIGIN-RELAY-01: `origin` describes the CLIENT→GovAI hop and is
    // structurally false on this (GovAI→provider) one — see ../outbound-header-policy.ts.
    if (
      HOP_BY_HOP.has(key) ||
      STRIP_INBOUND_AUTH.has(key) ||
      STRIP_INBOUND_BROWSER_HOP.has(key)
    ) {
      continue;
    }
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

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

const ROUTE_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

/**
 * Methods the CURRENT REGISTERED SURFACE supports for a matched path template —
 * truthful by construction from BOTH sources: the resolver must map
 * (method, template) to a capability AND that capability's registry
 * `endpoint_coverage` must declare exactly that (method, path). The resolver's
 * files / vector-store branches are method-agnostic (they resolve for any
 * verb), so the registry declaration is what makes e.g. `PATCH /v1/files/{id}`
 * a 405 instead of an accidental forward (Codex P2 on dee0b40). Method support
 * is NOT widened: the registry is unchanged.
 */
function allowedMethodsFor(pathTemplate: string): string[] {
  return ROUTE_METHODS.filter((m) => {
    const r = resolveAnthropicCapabilityForRequest({ method: m, pathTemplate, isStream: false });
    if (r.capability_id === 'unknown') return false;
    const cap = ANTHROPIC_CAPABILITIES.find((c) => c.id === r.capability_id);
    return (
      cap !== undefined &&
      cap.endpoint_coverage.some((e) => e.method === m && e.path === pathTemplate)
    );
  });
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
      const now = deps.now ?? (() => new Date());

      // Tenant context FIRST (auth happens here; deps decides how) — §14.1: an
      // unauthenticated caller must not learn whether a path is registered.
      let tenant: TenantContext;
      try {
        tenant = await deps.resolveTenant(req);
      } catch (err) {
        reply.code(401);
        return { error: 'auth_error', message: (err as Error).message };
      }

      // Path registry (authenticated callers only).
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
      // §14.2: a registered path with a method the current registered surface
      // does not support is a CALLER contract error (405 + truthful Allow) —
      // never an internal 500 and never an accidental forward. Two caller cases:
      // (a) the resolver maps no capability for (method, path); (b) the resolver
      // maps one (its files / vector-store branches are method-agnostic) but the
      // capability's registry `endpoint_coverage` does not declare that
      // (method, path) pair. Method support is NOT widened here.
      const methodNotAllowed = (): { error: string; message: string; allow: string[] } => {
        const allow = allowedMethodsFor(matched.pathTemplate);
        reply.code(405);
        reply.header('allow', allow.join(', '));
        return {
          error: 'method_not_allowed',
          message: `${req.method} is not supported on ${matched.pathTemplate} by the GovAI passthrough surface`,
          allow,
        };
      };
      if (resolved.capability_id === 'unknown') return methodNotAllowed();
      // A mapped method whose capability id is missing from the registry is a
      // REAL internal inconsistency — fail loudly (§14.3), never mask it as a
      // caller error (checked BEFORE the coverage gate on purpose).
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
      if (
        !capabilityRegistryEntry.endpoint_coverage.some(
          (e) => e.method === req.method.toUpperCase() && e.path === matched.pathTemplate,
        )
      ) {
        return methodNotAllowed();
      }

      const requestBody = bufferifyBody(req.body);
      const isMultipartReq =
        typeof req.headers['content-type'] === 'string' &&
        req.headers['content-type'].toLowerCase().startsWith('multipart/form-data');

      // Tool classifier (only on /v1/messages with body.tools[]) — runs BEFORE
      // the beta floor so a blocked event always carries the classifications.
      let toolClassifications: ReturnType<typeof classifyTools>['classifications'] = [];
      let toolBlock: Extract<ReturnType<typeof classifyTools>, { decision: 'block' }> | null = null;
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
          if (result.decision === 'block') toolBlock = result;
        }
      }

      // Beta header — Native application policy (OD-1=A): forward + observe by
      // default; deny ONLY the explicit hard_denied (computer-use) floor.
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

      // FB-4: durable evidence for a pre-provider Native deny — a valid blocked
      // v4 `passthrough.invoked` (provider NOT called; interpretation: the
      // invocation ATTEMPT was blocked by GovAI before dispatch).
      const emitNativeBlocked = async (blockMarkers: string[]): Promise<void> => {
        const gov = resolveGovernance({
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
            is_stream: isStream,
            is_multipart: isMultipartReq,
            base_risk_class: gov.base_risk_class,
            effective_risk_class: gov.effective_risk_class,
            risk_escalation_reasons: [...gov.risk_escalation_reasons, ...blockMarkers],
            enforcement_decision: 'blocked',
            native_request_hash: sha256Hex(requestBody),
            // A streaming request blocked pre-provider streamed ZERO bytes: the
            // hash over the emitted stream bytes is SHA-256(empty); no
            // stream_outcome is fabricated (no stream ever started).
            ...(isStream ? { stream_final_hash: SHA256_EMPTY } : {}),
            latency_ms: 0,
            occurred_at: now(),
            status_code: 403,
            // The resolver is not called on this path (F1 sentinel, as governed).
            credential_source: 'not_resolved_pre_provider_block',
            allowlist_version: ANTHROPIC_BETA_POLICY_VERSION,
            body_forward_mode: 'blocked',
            // No forwarding happened: no allowlist provenance is claimed.
            beta_allowlist_sources: [],
            detected_tool_classifications: toolClassifications,
          }),
        );
      };

      if (betaResult.decision === 'deny') {
        for (const d of betaResult.denied) {
          await deps.emitAuditEvent(
            buildPassthroughBetaDenied({
              tenant,
              capability_id: resolved.capability_id,
              beta_token: d.beta_token,
              policy_at_resolution: d.policy_at_resolution,
              reason_code: d.reason_code,
            }),
          );
        }
        await emitNativeBlocked(betaResult.observations);
        reply.code(403);
        return {
          error: 'beta_denied',
          denied: betaResult.denied,
        };
      }

      if (toolBlock !== null) {
        for (const b of toolBlock.blocked) {
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
        // Forwarded-but-observed betas on a blocked request are still recorded
        // as observation markers (they never contribute to the block).
        await emitNativeBlocked(betaResult.observations);
        reply.code(403);
        return {
          // M1: the only validation block is the explicit computer-use floor.
          error: 'tool_blocked_until_governance_primitive',
          blocked: toolBlock.blocked,
        };
      }

      // Forward.
      // F1: .apiKey builds headers (memory only); .source flows to credential_source.
      const resolvedCredential = await deps.resolveProviderKey(req);
      const headers = buildOutboundHeaders(req.headers, resolvedCredential.apiKey);
      // M2A F5 — provider-native query fidelity: forward the ORIGINAL request-target
      // minus the GovAI route prefix, PRESERVING the raw query byte-semantics
      // (key order, duplicates, empty values, percent escapes, `+`, encoded
      // delimiters). Routing/capability matching already ignores the query
      // (matchers split on '?'); only the upstream forward needs it. No
      // decoding/re-encoding, no URLSearchParams reconstruction. The Claude CLI
      // marker `?beta=true` is preserved like any other component — real
      // Anthropic accepts `POST /v1/messages?beta=true` (M2A §6 direct probe,
      // HTTP 200), so no consume-marker exception exists.
      const concretePath = req.url.replace(/^\/passthrough\/anthropic/, '');

      if (isStream) {
        // Stream variant.
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
                // Beta observation markers are evidence-only (they never lift
                // the class nor change enforcement) — appended after the
                // governance-derived reasons.
                risk_escalation_reasons: [
                  ...govStream.risk_escalation_reasons,
                  ...betaResult.observations,
                ],
                // Audit-only surface: enforcement is intentionally `observe`.
                enforcement_decision: 'observe',
                native_request_hash: streamRes.native_request_hash,
                stream_final_hash: final.stream_final_hash,
                latency_ms: final.latency_ms,
                occurred_at: occurredAt,
                status_code: streamRes.status,
                credential_source: resolvedCredential.source,
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

      // Mirror response headers (strip hop-by-hop).
      for (const [k, v] of Object.entries(
        filterResponseHeaders(Object.entries(fwd.responseHeaders)),
      )) {
        reply.header(k, v);
      }
      reply.code(fwd.status);

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
          // Beta observation markers are evidence-only (see stream branch).
          risk_escalation_reasons: [
            ...govNonStream.risk_escalation_reasons,
            ...betaResult.observations,
          ],
          // Audit-only surface: enforcement is intentionally `observe`.
          enforcement_decision: 'observe',
          native_request_hash: fwd.native_request_hash,
          native_response_hash: fwd.native_response_hash,
          latency_ms: fwd.latency_ms,
          occurred_at: occurredAt,
          status_code: fwd.status,
          credential_source: resolvedCredential.source,
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
