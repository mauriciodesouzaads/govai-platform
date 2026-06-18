// Governed-native handler for `openai.chat.completions.create` / `.stream`.
// Surface-aware tool classifier for chat_completions (only `function` allowed).

import { createHash, randomUUID } from 'node:crypto';
import type { Capability } from '@govai/core-types';
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
  OPENAI_CHAT_COMPLETIONS_CREATE,
  OPENAI_CHAT_COMPLETIONS_STREAM,
} from '../capabilities/index.js';
import { OPENAI_BETA_POLICY_VERSION } from '../beta-policy.js';
import { classifyOpenAITools } from '../passthrough/tool-classifier-hook.js';
import { forwardRaw } from '../passthrough/forward.js';
import { forwardStream } from '../passthrough/stream-forward.js';
import { KNOWN_OPENAI_TAXONOMY_VERSION } from '../tool-taxonomy-version.js';
import { extractOpenAIChatCompletionsText } from './extract-text.js';
import type {
  GovernedTenant,
  GovernedHandleDeps,
  GovernedHandleInput,
  GovernedNonStreamResult,
  GovernedStreamResult,
  GovernedBlockedResult,
} from './handle-responses.js';

export type {
  GovernedTenant,
  GovernedHandleDeps,
  GovernedHandleInput,
  GovernedNonStreamResult,
  GovernedStreamResult,
  GovernedBlockedResult,
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
  return isStream ? OPENAI_CHAT_COMPLETIONS_STREAM : OPENAI_CHAT_COMPLETIONS_CREATE;
}

export async function handleOpenAIGovernedChatCompletions(
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
    const result = classifyOpenAITools(parsedBody['tools'] as unknown[], 'chat_completions');
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

  const segments = extractOpenAIChatCompletionsText(parsedBody);
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
      native_endpoint: '/v1/chat/completions',
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
      credential_source: 'tenant_provider_credential',
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

  const providerKey = await deps.resolveProviderKey(
    input.tenant.org_id,
    input.tenant.operational_mode,
  );
  const organization = deps.resolveProviderOrganization
    ? await deps.resolveProviderOrganization(input.tenant.org_id)
    : undefined;
  const outHeaders = buildOutboundHeaders(input.inboundHeaders, providerKey, organization);

  if (input.isStream) {
    const stream = await forwardStream({
      baseUrl: deps.upstreamBaseUrl,
      concretePath: '/v1/chat/completions',
      method: 'POST',
      headers: outHeaders,
      body: input.rawBody,
    });

    const finalize = async () => {
      const final = await stream.finalize();
      const ev = PassthroughInvokedSchema.parse({
        event_type: 'passthrough.invoked',
        schema_version: 4,
        tenant_context: input.tenant,
        provider: 'openai',
        capability_id: capabilityId,
        capability_level: 'policy_governed',
        capability_canonical_level: capability.level,
        native_endpoint: '/v1/chat/completions',
        native_method: 'POST',
        is_stream: true,
        is_multipart: input.isMultipart === true,
        base_risk_class: governance.base_risk_class,
        effective_risk_class: governance.effective_risk_class,
        risk_escalation_reasons: governance.risk_escalation_reasons,
        enforcement_decision: governance.enforcement_decision,
        native_request_hash: stream.native_request_hash,
        stream_final_hash: final.stream_final_hash,
        latency_ms: final.latency_ms,
        status_code: stream.status,
        occurred_at: occurredAt.toISOString(),
        credential_source: 'tenant_provider_credential',
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

  const fwd = await forwardRaw({
    baseUrl: deps.upstreamBaseUrl,
    pathTemplate: '/v1/chat/completions',
    concretePath: '/v1/chat/completions',
    method: 'POST',
    headers: outHeaders,
    body: input.rawBody,
  });

  const ev = PassthroughInvokedSchema.parse({
    event_type: 'passthrough.invoked',
    schema_version: 4,
    tenant_context: input.tenant,
    provider: 'openai',
    capability_id: capabilityId,
    capability_level: 'policy_governed',
    capability_canonical_level: capability.level,
    native_endpoint: '/v1/chat/completions',
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
    credential_source: 'tenant_provider_credential',
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
