// OpenAI capability registry — Matrix v2 §17, §18 + patches v2.0.1 P1, v2.0.2.
// 11 supported endpoint capabilities + 2 supported tool capabilities = 13 total.
// Endpoint coverage entries sum to 20 (Matrix v2.0.2 §2 line 113).
// `level` is the canonical registry value (Decisão 4 / HAE-002): when exercised
// via /passthrough/openai/* the operational mode is `passthrough_audited`,
// distinct from the canonical `level` declared here.

import type { Capability } from '@govai/core-types';

const ALL_TIERS = ['starter', 'business', 'enterprise', 'regulated'] as const;

// ─── Responses (policy_governed canonical, exercised via passthrough_audited) ───

export const OPENAI_RESPONSES_CREATE: Capability = {
  id: 'openai.responses.create',
  provider: 'openai',
  status: 'supported',
  level: 'policy_governed',
  base_risk_class: 'A',
  tier_availability: [...ALL_TIERS],
  enforcement_default: 'enforce',
  endpoint_coverage: [
    { method: 'POST', path: '/v1/responses', streams: false, multipart: false },
  ],
  beta_dependencies: [],
};

export const OPENAI_RESPONSES_STREAM: Capability = {
  id: 'openai.responses.stream',
  provider: 'openai',
  status: 'supported',
  level: 'policy_governed',
  base_risk_class: 'A',
  tier_availability: [...ALL_TIERS],
  enforcement_default: 'enforce',
  endpoint_coverage: [
    { method: 'POST', path: '/v1/responses', streams: true, multipart: false },
  ],
  beta_dependencies: [],
};

// ─── Chat Completions (policy_governed canonical) ───

export const OPENAI_CHAT_COMPLETIONS_CREATE: Capability = {
  id: 'openai.chat.completions.create',
  provider: 'openai',
  status: 'supported',
  level: 'policy_governed',
  base_risk_class: 'A',
  tier_availability: [...ALL_TIERS],
  enforcement_default: 'enforce',
  endpoint_coverage: [
    { method: 'POST', path: '/v1/chat/completions', streams: false, multipart: false },
  ],
  beta_dependencies: [],
};

export const OPENAI_CHAT_COMPLETIONS_STREAM: Capability = {
  id: 'openai.chat.completions.stream',
  provider: 'openai',
  status: 'supported',
  level: 'policy_governed',
  base_risk_class: 'A',
  tier_availability: [...ALL_TIERS],
  enforcement_default: 'enforce',
  endpoint_coverage: [
    { method: 'POST', path: '/v1/chat/completions', streams: true, multipart: false },
  ],
  beta_dependencies: [],
};

// ─── Models (passthrough_audited; GET only — DELETE is separate sub-capability) ───

export const OPENAI_MODELS: Capability = {
  id: 'openai.models',
  provider: 'openai',
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

export const OPENAI_MODELS_DELETE: Capability = {
  id: 'openai.models.delete',
  provider: 'openai',
  status: 'supported',
  level: 'passthrough_audited',
  base_risk_class: 'C',
  tier_availability: [...ALL_TIERS],
  enforcement_default: 'ask',
  endpoint_coverage: [
    { method: 'DELETE', path: '/v1/models/{model_id}', streams: false, multipart: false },
  ],
  beta_dependencies: [],
};

// ─── Embeddings ───

export const OPENAI_EMBEDDINGS: Capability = {
  id: 'openai.embeddings',
  provider: 'openai',
  status: 'supported',
  level: 'passthrough_audited',
  base_risk_class: 'B',
  tier_availability: [...ALL_TIERS],
  enforcement_default: 'enforce',
  endpoint_coverage: [
    { method: 'POST', path: '/v1/embeddings', streams: false, multipart: false },
  ],
  beta_dependencies: [],
};

// ─── Files (multipart upload + purpose policy) ───

export const OPENAI_FILES: Capability = {
  id: 'openai.files',
  provider: 'openai',
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
  beta_dependencies: [],
};

// ─── Vector Stores (non-destructive) ───

export const OPENAI_VECTOR_STORES: Capability = {
  id: 'openai.vector_stores',
  provider: 'openai',
  status: 'supported',
  level: 'passthrough_audited',
  base_risk_class: 'B',
  tier_availability: [...ALL_TIERS],
  enforcement_default: 'enforce',
  endpoint_coverage: [
    { method: 'POST', path: '/v1/vector_stores', streams: false, multipart: false },
    { method: 'GET', path: '/v1/vector_stores', streams: false, multipart: false },
    { method: 'GET', path: '/v1/vector_stores/{vector_store_id}', streams: false, multipart: false },
    { method: 'POST', path: '/v1/vector_stores/{vector_store_id}/files', streams: false, multipart: false },
    { method: 'GET', path: '/v1/vector_stores/{vector_store_id}/files', streams: false, multipart: false },
  ],
  beta_dependencies: [],
};

// ─── Vector Stores destructive sub-capabilities (Matrix v2.0.1 P1: starter included) ───

export const OPENAI_VECTOR_STORES_DELETE: Capability = {
  id: 'openai.vector_stores.delete',
  provider: 'openai',
  status: 'supported',
  level: 'passthrough_audited',
  base_risk_class: 'C',
  tier_availability: [...ALL_TIERS],
  enforcement_default: 'ask',
  endpoint_coverage: [
    { method: 'DELETE', path: '/v1/vector_stores/{vector_store_id}', streams: false, multipart: false },
  ],
  beta_dependencies: [],
};

export const OPENAI_VECTOR_STORES_FILES_DELETE: Capability = {
  id: 'openai.vector_stores.files.delete',
  provider: 'openai',
  status: 'supported',
  level: 'passthrough_audited',
  base_risk_class: 'C',
  tier_availability: [...ALL_TIERS],
  enforcement_default: 'ask',
  endpoint_coverage: [
    {
      method: 'DELETE',
      path: '/v1/vector_stores/{vector_store_id}/files/{file_id}',
      streams: false,
      multipart: false,
    },
  ],
  beta_dependencies: [],
};

// ─── Tool capabilities (no own endpoint; surfaced via tools[]) ───

export const OPENAI_WEB_SEARCH_TOOL: Capability = {
  id: 'openai.web_search_tool',
  provider: 'openai',
  status: 'supported',
  level: 'passthrough_audited',
  base_risk_class: 'C',
  tier_availability: [...ALL_TIERS],
  enforcement_default: 'enforce',
  endpoint_coverage: [],
  beta_dependencies: [],
};

export const OPENAI_FILE_SEARCH_TOOL: Capability = {
  id: 'openai.file_search_tool',
  provider: 'openai',
  status: 'supported',
  level: 'passthrough_audited',
  base_risk_class: 'B',
  tier_availability: [...ALL_TIERS],
  enforcement_default: 'enforce',
  endpoint_coverage: [],
  beta_dependencies: [],
};

export const OPENAI_CAPABILITIES: ReadonlyArray<Capability> = Object.freeze([
  OPENAI_RESPONSES_CREATE,
  OPENAI_RESPONSES_STREAM,
  OPENAI_CHAT_COMPLETIONS_CREATE,
  OPENAI_CHAT_COMPLETIONS_STREAM,
  OPENAI_MODELS,
  OPENAI_MODELS_DELETE,
  OPENAI_EMBEDDINGS,
  OPENAI_FILES,
  OPENAI_VECTOR_STORES,
  OPENAI_VECTOR_STORES_DELETE,
  OPENAI_VECTOR_STORES_FILES_DELETE,
  OPENAI_WEB_SEARCH_TOOL,
  OPENAI_FILE_SEARCH_TOOL,
]);

/**
 * Map an HTTP request (method + matched path template + stream flag) to the
 * canonical capability_id and registry-canonical level. Used by passthrough
 * audit emit (HAE-002) to populate `capability_canonical_level` distinct
 * from the route's operational mode (`capability_level`).
 */
export function resolveOpenAICapabilityForRequest(input: {
  method: string;
  pathTemplate: string;
  isStream: boolean;
}): { capability_id: string; canonical_level: 'policy_governed' | 'passthrough_audited' } {
  const m = input.method.toUpperCase();
  const p = input.pathTemplate;

  if (m === 'POST' && p === '/v1/responses') {
    return input.isStream
      ? { capability_id: 'openai.responses.stream', canonical_level: 'policy_governed' }
      : { capability_id: 'openai.responses.create', canonical_level: 'policy_governed' };
  }
  if (m === 'POST' && p === '/v1/chat/completions') {
    return input.isStream
      ? { capability_id: 'openai.chat.completions.stream', canonical_level: 'policy_governed' }
      : { capability_id: 'openai.chat.completions.create', canonical_level: 'policy_governed' };
  }
  if (m === 'GET' && (p === '/v1/models' || p === '/v1/models/{model_id}')) {
    return { capability_id: 'openai.models', canonical_level: 'passthrough_audited' };
  }
  if (m === 'DELETE' && p === '/v1/models/{model_id}') {
    return { capability_id: 'openai.models.delete', canonical_level: 'passthrough_audited' };
  }
  if (m === 'POST' && p === '/v1/embeddings') {
    return { capability_id: 'openai.embeddings', canonical_level: 'passthrough_audited' };
  }
  if (
    p === '/v1/files' ||
    p === '/v1/files/{file_id}' ||
    p === '/v1/files/{file_id}/content'
  ) {
    return { capability_id: 'openai.files', canonical_level: 'passthrough_audited' };
  }
  if (m === 'DELETE' && p === '/v1/vector_stores/{vector_store_id}') {
    return {
      capability_id: 'openai.vector_stores.delete',
      canonical_level: 'passthrough_audited',
    };
  }
  if (m === 'DELETE' && p === '/v1/vector_stores/{vector_store_id}/files/{file_id}') {
    return {
      capability_id: 'openai.vector_stores.files.delete',
      canonical_level: 'passthrough_audited',
    };
  }
  if (
    p === '/v1/vector_stores' ||
    p === '/v1/vector_stores/{vector_store_id}' ||
    p === '/v1/vector_stores/{vector_store_id}/files'
  ) {
    return { capability_id: 'openai.vector_stores', canonical_level: 'passthrough_audited' };
  }
  return { capability_id: 'unknown', canonical_level: 'passthrough_audited' };
}

/**
 * Match a raw URL path (with concrete IDs) to one of our supported templates.
 * Returns null when the path is not a supported OpenAI endpoint.
 */
export function matchOpenAIPath(rawPath: string): { pathTemplate: string } | null {
  const noQuery = rawPath.split('?')[0] ?? '';
  const stripped = noQuery.replace(/^\/passthrough\/openai/, '');
  const normalized = stripped.replace(/\/+$/, '') || '/';

  if (normalized === '/v1/responses') return { pathTemplate: '/v1/responses' };
  if (normalized === '/v1/chat/completions') return { pathTemplate: '/v1/chat/completions' };
  if (normalized === '/v1/embeddings') return { pathTemplate: '/v1/embeddings' };
  if (normalized === '/v1/models') return { pathTemplate: '/v1/models' };
  if (/^\/v1\/models\/[^/]+$/.test(normalized)) return { pathTemplate: '/v1/models/{model_id}' };
  if (normalized === '/v1/files') return { pathTemplate: '/v1/files' };
  if (/^\/v1\/files\/[^/]+\/content$/.test(normalized)) {
    return { pathTemplate: '/v1/files/{file_id}/content' };
  }
  if (/^\/v1\/files\/[^/]+$/.test(normalized)) return { pathTemplate: '/v1/files/{file_id}' };
  if (normalized === '/v1/vector_stores') return { pathTemplate: '/v1/vector_stores' };
  if (/^\/v1\/vector_stores\/[^/]+\/files\/[^/]+$/.test(normalized)) {
    return {
      pathTemplate: '/v1/vector_stores/{vector_store_id}/files/{file_id}',
    };
  }
  if (/^\/v1\/vector_stores\/[^/]+\/files$/.test(normalized)) {
    return { pathTemplate: '/v1/vector_stores/{vector_store_id}/files' };
  }
  if (/^\/v1\/vector_stores\/[^/]+$/.test(normalized)) {
    return { pathTemplate: '/v1/vector_stores/{vector_store_id}' };
  }
  return null;
}
