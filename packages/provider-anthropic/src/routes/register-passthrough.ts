// Register Fastify routes for /passthrough/anthropic/* under a parent app.
// Decisão 4: capability_canonical_level (registry value) ≠ capability_level (operational mode).
// Audit emit always sets BOTH for provider-namespaced capabilities.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { BetaTokenPolicyEntry } from '@govai/core-types';
import {
  ANTHROPIC_BETA_POLICY,
  ANTHROPIC_BETA_POLICY_VERSION,
} from '../beta-policy.js';
import { matchAnthropicPath, resolveAnthropicCapabilityForRequest } from '../capabilities/index.js';
import { handleAnthropicBetaHeader } from '../passthrough/beta-header-handler.js';
import { classifyTools } from '../passthrough/tool-classifier-hook.js';
import { forwardRaw } from '../passthrough/forward.js';
import { forwardStream } from '../passthrough/stream-forward.js';
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

function bufferifyBody(body: unknown): Buffer {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  return Buffer.from(JSON.stringify(body), 'utf8');
}

export async function registerAnthropicPassthrough(
  app: FastifyInstance,
  deps: AnthropicPassthroughDeps,
): Promise<void> {
  // We register raw body parser to preserve bytes for forward + hash.
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
        matched.pathTemplate === '/v1/messages' &&
        ((req.body as { stream?: boolean } | null)?.stream === true ||
          // Body may be a Buffer at this point — peek minimally.
          (Buffer.isBuffer(req.body) && /"stream"\s*:\s*true/.test(req.body.toString('utf8'))));

      const resolved = resolveAnthropicCapabilityForRequest({
        method: req.method,
        pathTemplate: matched.pathTemplate,
        isStream,
      });

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
        const streamRes = await forwardStream({
          baseUrl: deps.upstreamBaseUrl,
          concretePath,
          method: 'POST',
          headers,
          body: requestBody,
        });
        // Forward response headers.
        for (const [k, v] of Object.entries(streamRes.responseHeaders)) {
          if (HOP_BY_HOP.has(k.toLowerCase())) continue;
          reply.header(k, v);
        }
        reply.code(streamRes.status);
        // Pump the stream.
        const reader = streamRes.body.getReader();
        const nodeStream = (async function* () {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) yield Buffer.from(value);
          }
        })();
        // Use Fastify reply with async iterable via reply.raw write.
        reply.hijack();
        for await (const chunk of nodeStream) {
          reply.raw.write(chunk);
        }
        reply.raw.end();

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
            base_risk_class: 'A',
            effective_risk_class: 'A',
            enforcement_decision: 'observe',
            native_request_hash: streamRes.native_request_hash,
            stream_final_hash: final.stream_final_hash,
            latency_ms: final.latency_ms,
            status_code: streamRes.status,
            credential_source: 'tenant_provider_credential',
            allowlist_version: ANTHROPIC_BETA_POLICY_VERSION,
            ...(streamRes.provider_request_id
              ? { provider_request_id: streamRes.provider_request_id }
              : {}),
            body_forward_mode: 'raw',
            beta_allowlist_sources: betaResult.sources,
            detected_tool_classifications: toolClassifications,
          }),
        );
        return;
      }

      // Non-stream raw forward.
      const fwd = await forwardRaw({
        baseUrl: deps.upstreamBaseUrl,
        pathTemplate: matched.pathTemplate,
        concretePath,
        method: req.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        headers,
        body: requestBody,
      });

      // Mirror response headers (strip hop-by-hop).
      for (const [k, v] of Object.entries(fwd.responseHeaders)) {
        if (HOP_BY_HOP.has(k.toLowerCase())) continue;
        reply.header(k, v);
      }
      reply.code(fwd.status);

      await deps.emitAuditEvent(
        buildPassthroughInvoked({
          tenant,
          capability_id: resolved.capability_id,
          capability_level: 'passthrough_audited',
          capability_canonical_level: resolved.canonical_level,
          native_endpoint: matched.pathTemplate,
          native_method: req.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
          is_stream: false,
          is_multipart:
            typeof req.headers['content-type'] === 'string' &&
            req.headers['content-type'].toLowerCase().startsWith('multipart/form-data'),
          base_risk_class: 'A',
          effective_risk_class: 'A',
          enforcement_decision: 'observe',
          native_request_hash: fwd.native_request_hash,
          native_response_hash: fwd.native_response_hash,
          latency_ms: fwd.latency_ms,
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
