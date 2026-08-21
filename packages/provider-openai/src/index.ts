import OpenAI from 'openai';
import { STRIP_INBOUND_BROWSER_HOP } from './outbound-header-policy.js';
import type { UsageSource } from '@govai/core-events';

export type OpenAIAuth = { apiKey: string; organization?: string };

export type NormalizedOpenAIUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

export type OpenAIErrorClass =
  | 'auth'
  | 'rate_limit'
  | 'invalid_request'
  | 'overloaded'
  | 'server_error'
  | 'unknown';

export class OpenAIProvider {
  readonly client: OpenAI;
  constructor(auth: OpenAIAuth) {
    this.client = new OpenAI({ apiKey: auth.apiKey, organization: auth.organization });
  }

  async chatCompletionsCreate(input: Parameters<OpenAI['chat']['completions']['create']>[0]) {
    return this.client.chat.completions.create(input);
  }

  async responsesCreate(input: Parameters<OpenAI['responses']['create']>[0]) {
    return this.client.responses.create(input);
  }
}

type UsageInput =
  | { input_tokens?: number; output_tokens?: number; total_tokens?: number }
  | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };

export function extractOpenAIUsage(response: { usage?: UsageInput | null }): {
  normalized: NormalizedOpenAIUsage;
  source: UsageSource;
} | null {
  const u = response.usage;
  if (!u) return null;
  // Responses API
  if ('input_tokens' in u && typeof u.input_tokens === 'number') {
    const inT = u.input_tokens ?? 0;
    const outT = (u as { output_tokens?: number }).output_tokens ?? 0;
    return {
      normalized: { input_tokens: inT, output_tokens: outT, total_tokens: inT + outT },
      source: 'provider_direct',
    };
  }
  // Chat Completions
  if ('prompt_tokens' in u && typeof u.prompt_tokens === 'number') {
    const inT = u.prompt_tokens ?? 0;
    const outT = (u as { completion_tokens?: number }).completion_tokens ?? 0;
    return {
      normalized: { input_tokens: inT, output_tokens: outT, total_tokens: inT + outT },
      source: 'provider_direct',
    };
  }
  return null;
}

export function classifyOpenAIError(err: unknown): OpenAIErrorClass {
  if (typeof err !== 'object' || err === null) return 'unknown';
  const e = err as { status?: number };
  if (e.status === 401 || e.status === 403) return 'auth';
  if (e.status === 429) return 'rate_limit';
  if (e.status === 400 || e.status === 422) return 'invalid_request';
  if (e.status === 503) return 'overloaded';
  if (typeof e.status === 'number' && e.status >= 500) return 'server_error';
  return 'unknown';
}

export function rewritePassthroughHeaders(
  inboundHeaders: Record<string, string | string[] | undefined>,
  providerKey: string,
  organization?: string,
): { outbound: Record<string, string> } {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(inboundHeaders)) {
    const key = k.toLowerCase();
    if (key === 'authorization' || key === 'x-govai-api-key') continue;
    if (key === 'host' || key === 'connection' || key === 'content-length') continue;
    // AI-CONSOLE-ORIGIN-RELAY-01, class-wide: a header describing the CLIENT→GovAI
    // hop is structurally false on this (GovAI→provider) one. This legacy entry
    // point is fed SYNTHESIZED headers today (protocol-v1 run dispatch builds them
    // from scratch — apps/api buildDeterministicPlan), so nothing observable
    // changes; it holds the same policy so no future caller can reintroduce the
    // relay through it. See ./outbound-header-policy.ts.
    if (STRIP_INBOUND_BROWSER_HOP.has(key)) continue;
    if (Array.isArray(v)) out[k] = v.join(', ');
    else if (v !== undefined) out[k] = v;
  }
  out['authorization'] = `Bearer ${providerKey}`;
  if (organization) out['openai-organization'] = organization;
  return { outbound: out };
}

// =============================================================================
// PR2 Batch C — Native Provider Substrate exports.
// (PR0 inline code above preserved for backwards compat.)
// =============================================================================
export {
  OPENAI_BETA_POLICY,
  OPENAI_BETA_POLICY_VERSION,
} from './beta-policy.js';
export {
  classifyOpenAITool,
  decideOpenAITool,
  type OpenAIToolClassification,
  type OpenAIToolDecision,
  type OpenAISurface,
} from './tool-classifier.js';
export { KNOWN_OPENAI_TAXONOMY_VERSION } from './tool-taxonomy-version.js';
export {
  OPENAI_CAPABILITIES,
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
  resolveOpenAICapabilityForRequest,
  matchOpenAIPath,
} from './capabilities/index.js';
export {
  buildPassthroughInvoked,
  buildPassthroughBetaDenied,
  buildToolValidationBlocked,
  type TenantContext,
  type BuildPassthroughInvokedInput,
  type BuildPassthroughBetaDeniedInput,
  type BuildToolValidationBlockedInput,
} from './passthrough/audit-emit.js';
export {
  handleOpenAIBetaHeader,
  type BetaHandlerInput,
  type BetaHandlerResult,
} from './passthrough/beta-header-handler.js';
export {
  classifyOpenAITools,
  type ToolHookResult,
} from './passthrough/tool-classifier-hook.js';
export { forwardRaw, type ForwardInput, type ForwardResult } from './passthrough/forward.js';
export {
  forwardStream,
  type StreamForwardInput,
  type StreamForwardResult,
} from './passthrough/stream-forward.js';
export {
  registerOpenAIPassthrough,
  type OpenAIPassthroughDeps,
} from './routes/register-passthrough.js';

// =============================================================================
// PR2 Batch G — Macro Architecture Realignment: governed-native OpenAI.
// =============================================================================
export {
  handleOpenAIGovernedResponses,
  type GovernedHandleDeps as OpenAIGovernedHandleDeps,
  type GovernedHandleInput as OpenAIGovernedHandleInput,
  type GovernedTenant as OpenAIGovernedTenant,
  type GovernedNonStreamResult as OpenAIGovernedNonStreamResult,
  type GovernedStreamResult as OpenAIGovernedStreamResult,
  type GovernedBlockedResult as OpenAIGovernedBlockedResult,
  type DlpScanFn as OpenAIDlpScanFn,
} from './governed/handle-responses.js';
export { handleOpenAIGovernedChatCompletions } from './governed/handle-chat-completions.js';
export {
  registerOpenAIGoverned,
  type OpenAIGovernedDeps,
} from './governed/register-governed.js';
export {
  extractOpenAIResponsesText,
  extractOpenAIChatCompletionsText,
} from './governed/extract-text.js';
