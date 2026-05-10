// Anthropic capability registry — Matrix v2 §9 + Peça A v2.1 §B1.
// 5 supported capabilities with endpoint coverage + 1 supported tool capability.
// `level` is the canonical registry value (Decisão 4 / HAE-002): the route
// operating in `passthrough_audited` mode does NOT change this.

import type { Capability } from '@govai/core-types';

const ALL_TIERS = ['starter', 'business', 'enterprise', 'regulated'] as const;

export const ANTHROPIC_MESSAGES_CREATE: Capability = {
  id: 'anthropic.messages.create',
  provider: 'anthropic',
  status: 'supported',
  level: 'policy_governed',
  base_risk_class: 'A',
  tier_availability: [...ALL_TIERS],
  enforcement_default: 'enforce',
  endpoint_coverage: [
    { method: 'POST', path: '/v1/messages', streams: false, multipart: false },
  ],
  beta_dependencies: [],
};

export const ANTHROPIC_MESSAGES_STREAM: Capability = {
  id: 'anthropic.messages.stream',
  provider: 'anthropic',
  status: 'supported',
  level: 'policy_governed',
  base_risk_class: 'A',
  tier_availability: [...ALL_TIERS],
  enforcement_default: 'enforce',
  endpoint_coverage: [
    { method: 'POST', path: '/v1/messages', streams: true, multipart: false },
  ],
  beta_dependencies: [],
};

export const ANTHROPIC_MESSAGES_META: Capability = {
  id: 'anthropic.messages_meta',
  provider: 'anthropic',
  status: 'supported',
  level: 'passthrough_audited',
  base_risk_class: 'A',
  tier_availability: [...ALL_TIERS],
  enforcement_default: 'enforce',
  endpoint_coverage: [
    { method: 'POST', path: '/v1/messages/count_tokens', streams: false, multipart: false },
  ],
  beta_dependencies: [],
};

export const ANTHROPIC_MODELS: Capability = {
  id: 'anthropic.models',
  provider: 'anthropic',
  status: 'supported',
  level: 'passthrough_audited',
  base_risk_class: 'A',
  tier_availability: [...ALL_TIERS],
  enforcement_default: 'enforce',
  endpoint_coverage: [
    { method: 'GET', path: '/v1/models', streams: false, multipart: false },
    { method: 'GET', path: '/v1/models/{model_id}', streams: false, multipart: false },
  ],
  beta_dependencies: [],
};

export const ANTHROPIC_FILES: Capability = {
  id: 'anthropic.files',
  provider: 'anthropic',
  status: 'supported',
  level: 'passthrough_audited',
  base_risk_class: 'B',
  tier_availability: [...ALL_TIERS],
  enforcement_default: 'enforce',
  endpoint_coverage: [
    { method: 'POST', path: '/v1/files', streams: false, multipart: true },
    { method: 'GET', path: '/v1/files', streams: false, multipart: false },
    { method: 'GET', path: '/v1/files/{file_id}', streams: false, multipart: false },
    { method: 'DELETE', path: '/v1/files/{file_id}', streams: false, multipart: false },
    { method: 'GET', path: '/v1/files/{file_id}/content', streams: true, multipart: false },
  ],
  beta_dependencies: [
    {
      header_token: 'files-api-2025-04-14',
      required: 'always',
      allowlist_treatment: 'global_allowlist',
      source_doc: 'https://docs.claude.com/en/docs/build-with-claude/files',
    },
  ],
};

export const ANTHROPIC_WEB_SEARCH_TOOL: Capability = {
  id: 'anthropic.web_search_tool',
  provider: 'anthropic',
  status: 'supported',
  level: 'passthrough_audited',
  base_risk_class: 'C',
  tier_availability: [...ALL_TIERS],
  enforcement_default: 'enforce',
  // Tool capability — no endpoint of its own; surfaced via tools[] in /v1/messages.
  endpoint_coverage: [],
  beta_dependencies: [],
};

export const ANTHROPIC_CAPABILITIES: ReadonlyArray<Capability> = Object.freeze([
  ANTHROPIC_MESSAGES_CREATE,
  ANTHROPIC_MESSAGES_STREAM,
  ANTHROPIC_MESSAGES_META,
  ANTHROPIC_MODELS,
  ANTHROPIC_FILES,
  ANTHROPIC_WEB_SEARCH_TOOL,
]);

/**
 * Map an HTTP request (method + matched path template + stream flag) to the
 * canonical capability_id and registry-canonical level. Used by passthrough
 * audit emit (HAE-002) to populate `capability_canonical_level` distinct
 * from the route's operational mode (`capability_level`).
 */
export function resolveAnthropicCapabilityForRequest(input: {
  method: string;
  pathTemplate: string;
  isStream: boolean;
}): { capability_id: string; canonical_level: 'policy_governed' | 'passthrough_audited' } {
  const m = input.method.toUpperCase();
  const p = input.pathTemplate;
  if (m === 'POST' && p === '/v1/messages') {
    return input.isStream
      ? { capability_id: 'anthropic.messages.stream', canonical_level: 'policy_governed' }
      : { capability_id: 'anthropic.messages.create', canonical_level: 'policy_governed' };
  }
  if (m === 'POST' && p === '/v1/messages/count_tokens') {
    return { capability_id: 'anthropic.messages_meta', canonical_level: 'passthrough_audited' };
  }
  if (m === 'GET' && (p === '/v1/models' || p === '/v1/models/{model_id}')) {
    return { capability_id: 'anthropic.models', canonical_level: 'passthrough_audited' };
  }
  if (
    p === '/v1/files' ||
    p === '/v1/files/{file_id}' ||
    p === '/v1/files/{file_id}/content'
  ) {
    return { capability_id: 'anthropic.files', canonical_level: 'passthrough_audited' };
  }
  // Unknown path — caller decides what to do (typically 404 capability_not_registered).
  return { capability_id: 'unknown', canonical_level: 'passthrough_audited' };
}

/**
 * Match a raw URL path (with concrete IDs) to one of our supported templates.
 * Returns null when the path is not a supported Anthropic endpoint.
 */
export function matchAnthropicPath(rawPath: string): {
  pathTemplate: string;
} | null {
  // Normalize: strip query string + trailing slash + leading /passthrough/anthropic prefix.
  const noQuery = rawPath.split('?')[0] ?? '';
  const stripped = noQuery.replace(/^\/passthrough\/anthropic/, '');
  const normalized = stripped.replace(/\/+$/, '') || '/';

  if (normalized === '/v1/messages') return { pathTemplate: '/v1/messages' };
  if (normalized === '/v1/messages/count_tokens') return { pathTemplate: '/v1/messages/count_tokens' };
  if (normalized === '/v1/models') return { pathTemplate: '/v1/models' };
  if (/^\/v1\/models\/[^/]+$/.test(normalized)) return { pathTemplate: '/v1/models/{model_id}' };
  if (normalized === '/v1/files') return { pathTemplate: '/v1/files' };
  if (/^\/v1\/files\/[^/]+\/content$/.test(normalized)) {
    return { pathTemplate: '/v1/files/{file_id}/content' };
  }
  if (/^\/v1\/files\/[^/]+$/.test(normalized)) return { pathTemplate: '/v1/files/{file_id}' };
  return null;
}
