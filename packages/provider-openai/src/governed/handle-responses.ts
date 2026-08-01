// Governed-native handler for `openai.responses.create` / `.stream`.
// Same pattern as Anthropic handle-messages: real governance, no simulations.

import { createHash, randomUUID } from 'node:crypto';
import type { Capability, OperationalMode, ResolvedProviderCredential } from '@govai/core-types';
import {
  resolveGovernance,
  type DlpFindingLite,
  type ToolClassificationLite,
} from '@govai/core-governance';
import {
  PassthroughInvokedSchema,
  type PassthroughInvoked,
} from '@govai/core-events';
import {
  OPENAI_RESPONSES_CREATE,
  OPENAI_RESPONSES_STREAM,
} from '../capabilities/index.js';
import { OPENAI_BETA_POLICY_VERSION } from '../beta-policy.js';
import { classifyOpenAITools } from '../passthrough/tool-classifier-hook.js';
import { forwardRaw } from '../passthrough/forward.js';
import { forwardStream } from '../passthrough/stream-forward.js';
import type { StreamOutcome } from '@govai/provider-stream-http';
import { KNOWN_OPENAI_TAXONOMY_VERSION } from '../tool-taxonomy-version.js';
import { extractOpenAIResponsesText } from './extract-text.js';

export type GovernedTenant = {
  org_id: string;
  user_id?: string;
  tenant_id?: string;
  tier: 'starter' | 'business' | 'enterprise' | 'regulated';
  operational_mode: 'production' | 'pilot' | 'dev' | 'test';
};

export type DlpScanFn = (text: string) => Promise<{
  findings: ReadonlyArray<DlpFindingLite & { detector: string }>;
}>;

export type GovernedHandleDeps = {
  upstreamBaseUrl: string;
  /**
   * Returns the OpenAI API key for this tenant. The caller passes the
   * operational mode already resolved at auth time so the resolver does NOT
   * need to re-query `govai.org_tier_lookup` (issue #25).
   */
  resolveProviderKey: (
    orgId: string,
    operationalMode: OperationalMode,
  ) => Promise<ResolvedProviderCredential>;
  resolveProviderOrganization?: (orgId: string) => Promise<string | undefined>;
  dlpScan: DlpScanFn;
  emitAuditEvent: (event: PassthroughInvoked) => Promise<void> | void;
  now?: () => Date;
  /**
   * F3/F1: set by callers that resolve the credential EAGERLY (before the
   * handler runs). On a governed block the evidence then records the source
   * that WAS resolved; lazy callers omit this and keep the honest sentinel.
   */
  preResolvedCredentialSource?: ResolvedProviderCredential['source'];
};

export type GovernedNonStreamResult = {
  kind: 'non_stream';
  status_code: number;
  response_headers: Record<string, string>;
  response_body_raw: Buffer;
  native_request_hash_hex: string;
  native_response_hash_hex: string;
  provider_request_id: string | null;
  latency_ms: number;
  audit_event: PassthroughInvoked;
  governance: {
    base_risk_class: string;
    effective_risk_class: string;
    risk_escalation_reasons: string[];
    enforcement_decision: string;
  };
};

export type GovernedStreamResult = {
  kind: 'stream';
  status_code: number;
  response_headers: Record<string, string>;
  body: ReadableStream<Uint8Array>;
  native_request_hash_hex: string;
  provider_request_id: string | null;
  finalize: (outcome: StreamOutcome) => Promise<{
    stream_final_hash_hex: string;
    bytes_streamed: number;
    latency_ms: number;
    audit_event: PassthroughInvoked;
  }>;
  governance: {
    base_risk_class: string;
    effective_risk_class: string;
    risk_escalation_reasons: string[];
    enforcement_decision: string;
  };
};

export type GovernedBlockedResult = {
  kind: 'blocked';
  status_code: 403;
  reason: string;
  audit_event: PassthroughInvoked;
  governance: {
    base_risk_class: string;
    effective_risk_class: string;
    risk_escalation_reasons: string[];
    enforcement_decision: string;
  };
};

export type GovernedHandleInput = {
  tenant: GovernedTenant;
  rawBody: Buffer;
  inboundHeaders: Record<string, string>;
  isStream: boolean;
  isMultipart?: boolean;
  /** EP-008C: abort signal threaded to the upstream STREAM fetch only
   *  (client-disconnect propagation). NEVER reaches the non-stream forward:
   *  a disconnect must not cancel a non-stream provider call whose evidence
   *  this surface could then no longer emit (Codex P1 on a3d2103) — the
   *  non-stream direct behavior stays evidence-preserving, as before F3. */
  signal?: AbortSignal;
  /** EP-P03A-A (REV4): the protocol-v1 dispatch bound for the NON-stream
   *  forward. Supplied ONLY by the run orchestrator (its AbortSignal.timeout
   *  budget — never a client-disconnect signal): that caller CAN persist an
   *  honest outcome_unknown when the bound fires mid-flight. Direct routes
   *  omit it. */
  dispatchSignal?: AbortSignal;
  /** EP-P03A-A (REV4 §12.1): optional asynchronous durable dispatch gate,
   *  threaded to the NON-stream forward and awaited immediately before its
   *  `fetch` — i.e. only after tool/enforcement validation ruled out a
   *  governed block. Supplied ONLY by protocol-v1 run execution; direct
   *  routes omit it. Fail-closed — see ForwardInput.beforeDispatch. */
  beforeDispatch?: () => Promise<void>;
  /** EP-P03A-A (F3 §19.1): synchronous in-memory marker run immediately
   *  before the non-stream `fetch` — see ForwardInput.onDispatchStart. */
  onDispatchStart?: () => void;
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
  inbound: Record<string, string>,
  providerKey: string,
  organization?: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(inbound)) {
    const key = k.toLowerCase();
    if (HOP_BY_HOP.has(key) || STRIP_INBOUND_AUTH.has(key)) continue;
    out[k] = v;
  }
  out['authorization'] = `Bearer ${providerKey}`;
  if (organization) out['openai-organization'] = organization;
  return out;
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function selectCapability(isStream: boolean): Capability {
  return isStream ? OPENAI_RESPONSES_STREAM : OPENAI_RESPONSES_CREATE;
}

export async function handleOpenAIGovernedResponses(
  input: GovernedHandleInput,
  deps: GovernedHandleDeps,
): Promise<GovernedNonStreamResult | GovernedStreamResult | GovernedBlockedResult> {
  const capability = selectCapability(input.isStream);
  const capabilityId = capability.id;

  let parsedBody: Record<string, unknown> | null = null;
  try {
    parsedBody = JSON.parse(input.rawBody.toString('utf8')) as Record<string, unknown>;
  } catch {
    parsedBody = null;
  }

  const detectedTools: ToolClassificationLite[] = [];
  let toolBlock: { tool_index: number; reason: string; classification: string } | null = null;
  let toolClassificationsForAudit: PassthroughInvoked['detected_tool_classifications'] = [];
  if (parsedBody && Array.isArray(parsedBody['tools']) && (parsedBody['tools'] as unknown[]).length > 0) {
    const result = classifyOpenAITools(parsedBody['tools'] as unknown[], 'responses');
    toolClassificationsForAudit = result.classifications;
    for (const c of result.classifications) {
      detectedTools.push({
        tool_index: c.tool_index,
        classification: c.classification,
        contributed_risk_class: c.contributed_risk_class,
      });
    }
    if (result.decision === 'block' && result.blocked.length > 0) {
      const first = result.blocked[0]!;
      toolBlock = {
        tool_index: first.tool_index,
        reason: first.reason,
        classification: first.classification,
      };
    }
  }

  const segments = extractOpenAIResponsesText(parsedBody);
  const concatenated = segments.map((s) => s.text).join('\n');
  const dlpFindings: DlpFindingLite[] = [];
  if (concatenated.length > 0) {
    const r = await deps.dlpScan(concatenated);
    for (const f of r.findings) {
      dlpFindings.push({ detector: f.detector, ...(f.signal_class ? { signal_class: f.signal_class } : {}) });
    }
  }
  const dlpDecisions: PassthroughInvoked['dlp_decisions'] =
    dlpFindings.length > 0
      ? [
          {
            phase: 'pre_request',
            findings_count: dlpFindings.length,
            finding_classes: Array.from(new Set(dlpFindings.map((f) => f.detector))),
            action: 'warn',
          },
        ]
      : [];

  const governance = resolveGovernance({
    capability,
    tenant_tier: input.tenant.tier,
    operational_mode: input.tenant.operational_mode,
    tool_classifications: detectedTools,
    dlp_findings: dlpFindings,
    is_multipart: input.isMultipart === true,
  });

  // occurred_at: the invocation start instant (the latency_ms anchor), captured
  // once before any provider call so it is identical across all three audit
  // paths and stable for this event across dispatch retries (ADR-028 / EP-002).
  const occurredAt = (deps.now ?? (() => new Date()))();

  if (toolBlock !== null || governance.enforcement_decision === 'blocked') {
    const reason = toolBlock
      ? `tool_blocked:${toolBlock.classification}:${toolBlock.reason}`
      : `enforcement_blocked:${governance.effective_risk_class}`;
    const ev = PassthroughInvokedSchema.parse({
      event_type: 'passthrough.invoked',
      schema_version: 4,
      tenant_context: input.tenant,
      provider: 'openai',
      capability_id: capabilityId,
      capability_level: 'policy_governed',
      capability_canonical_level: capability.level,
      native_endpoint: '/v1/responses',
      native_method: 'POST',
      is_stream: input.isStream,
      is_multipart: input.isMultipart === true,
      base_risk_class: governance.base_risk_class,
      effective_risk_class: governance.effective_risk_class,
      risk_escalation_reasons: governance.risk_escalation_reasons,
      enforcement_decision: 'blocked',
      native_request_hash: sha256Hex(input.rawBody),
      latency_ms: 0,
      status_code: 403,
      occurred_at: occurredAt.toISOString(),
      // F1: blocked before the provider — no credential was resolved.
      credential_source: deps.preResolvedCredentialSource ?? 'not_resolved_pre_provider_block',
      allowlist_version: OPENAI_BETA_POLICY_VERSION,
      body_forward_mode: 'blocked',
      dlp_decisions: dlpDecisions,
      beta_allowlist_sources: [],
      detected_tool_classifications: toolClassificationsForAudit,
      ...(toolClassificationsForAudit.length > 0
        ? { tools_taxonomy_version: KNOWN_OPENAI_TAXONOMY_VERSION }
        : {}),
      audit_event_id: randomUUID(),
      chain_category: 'run',
    });
    await deps.emitAuditEvent(ev);
    return { kind: 'blocked', status_code: 403, reason, audit_event: ev, governance };
  }

  // F1: destructure directly so the streaming finalizer closes over `source`
  // only — never the credential object or `apiKey`. `apiKey` builds headers
  // (memory only); `source` flows into the emitted events.
  const { apiKey, source } = await deps.resolveProviderKey(
    input.tenant.org_id,
    input.tenant.operational_mode,
  );
  const organization = deps.resolveProviderOrganization
    ? await deps.resolveProviderOrganization(input.tenant.org_id)
    : undefined;
  const outHeaders = buildOutboundHeaders(input.inboundHeaders, apiKey, organization);

  if (input.isStream) {
    const stream = await forwardStream({
      baseUrl: deps.upstreamBaseUrl,
      concretePath: '/v1/responses',
      method: 'POST',
      headers: outHeaders,
      body: input.rawBody,
      signal: input.signal,
    });

    const finalize = async (outcome: StreamOutcome) => {
      const final = await stream.finalize();
      const ev = PassthroughInvokedSchema.parse({
        event_type: 'passthrough.invoked',
        schema_version: 4,
        tenant_context: input.tenant,
        provider: 'openai',
        capability_id: capabilityId,
        capability_level: 'policy_governed',
        capability_canonical_level: capability.level,
        native_endpoint: '/v1/responses',
        native_method: 'POST',
        is_stream: true,
        is_multipart: input.isMultipart === true,
        base_risk_class: governance.base_risk_class,
        effective_risk_class: governance.effective_risk_class,
        risk_escalation_reasons: governance.risk_escalation_reasons,
        enforcement_decision: governance.enforcement_decision,
        native_request_hash: stream.native_request_hash,
        stream_final_hash: final.stream_final_hash,
        stream_outcome: outcome,
        latency_ms: final.latency_ms,
        status_code: stream.status,
        occurred_at: occurredAt.toISOString(),
        credential_source: source,
        allowlist_version: OPENAI_BETA_POLICY_VERSION,
        ...(stream.provider_request_id ? { provider_request_id: stream.provider_request_id } : {}),
        body_forward_mode: 'raw',
        dlp_decisions: dlpDecisions,
        beta_allowlist_sources: [],
        detected_tool_classifications: toolClassificationsForAudit,
        ...(toolClassificationsForAudit.length > 0
          ? { tools_taxonomy_version: KNOWN_OPENAI_TAXONOMY_VERSION }
          : {}),
        audit_event_id: randomUUID(),
        chain_category: 'run',
      });
      await deps.emitAuditEvent(ev);
      return {
        stream_final_hash_hex: final.stream_final_hash,
        bytes_streamed: final.bytes_streamed,
        latency_ms: final.latency_ms,
        audit_event: ev,
      };
    };

    return {
      kind: 'stream',
      status_code: stream.status,
      response_headers: stream.responseHeaders,
      body: stream.body,
      native_request_hash_hex: stream.native_request_hash,
      provider_request_id: stream.provider_request_id,
      finalize,
      governance,
    };
  }

  // Non-stream raw forward. Bounded ONLY by the caller's dispatch signal —
  // never by the client-disconnect signal (evidence preservation, see
  // GovernedHandleInput.signal).
  const fwd = await forwardRaw({
    baseUrl: deps.upstreamBaseUrl,
    pathTemplate: '/v1/responses',
    concretePath: '/v1/responses',
    method: 'POST',
    headers: outHeaders,
    body: input.rawBody,
    signal: input.dispatchSignal,
    beforeDispatch: input.beforeDispatch,
    onDispatchStart: input.onDispatchStart,
  });

  const ev = PassthroughInvokedSchema.parse({
    event_type: 'passthrough.invoked',
    schema_version: 4,
    tenant_context: input.tenant,
    provider: 'openai',
    capability_id: capabilityId,
    capability_level: 'policy_governed',
    capability_canonical_level: capability.level,
    native_endpoint: '/v1/responses',
    native_method: 'POST',
    is_stream: false,
    is_multipart: input.isMultipart === true,
    base_risk_class: governance.base_risk_class,
    effective_risk_class: governance.effective_risk_class,
    risk_escalation_reasons: governance.risk_escalation_reasons,
    enforcement_decision: governance.enforcement_decision,
    native_request_hash: fwd.native_request_hash,
    native_response_hash: fwd.native_response_hash,
    latency_ms: fwd.latency_ms,
    status_code: fwd.status,
    occurred_at: occurredAt.toISOString(),
    credential_source: source,
    allowlist_version: OPENAI_BETA_POLICY_VERSION,
    ...(fwd.provider_request_id ? { provider_request_id: fwd.provider_request_id } : {}),
    body_forward_mode: 'raw',
    dlp_decisions: dlpDecisions,
    beta_allowlist_sources: [],
    detected_tool_classifications: toolClassificationsForAudit,
    ...(toolClassificationsForAudit.length > 0
      ? { tools_taxonomy_version: KNOWN_OPENAI_TAXONOMY_VERSION }
      : {}),
    audit_event_id: randomUUID(),
    chain_category: 'run',
  });
  await deps.emitAuditEvent(ev);

  return {
    kind: 'non_stream',
    status_code: fwd.status,
    response_headers: fwd.responseHeaders,
    response_body_raw: fwd.responseBody,
    native_request_hash_hex: fwd.native_request_hash,
    native_response_hash_hex: fwd.native_response_hash,
    provider_request_id: fwd.provider_request_id,
    latency_ms: fwd.latency_ms,
    audit_event: ev,
    governance,
  };
}
