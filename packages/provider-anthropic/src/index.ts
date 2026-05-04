import Anthropic from '@anthropic-ai/sdk';
import type { UsageSource } from '@govai/core-events';

export type AnthropicAuth = { apiKey: string };

export type NormalizedAnthropicUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

export type AnthropicErrorClass =
  | 'auth'
  | 'rate_limit'
  | 'invalid_request'
  | 'overloaded'
  | 'server_error'
  | 'unknown';

export class AnthropicProvider {
  readonly client: Anthropic;
  constructor(auth: AnthropicAuth) {
    this.client = new Anthropic({ apiKey: auth.apiKey });
  }

  async messagesCreate(input: Parameters<Anthropic['messages']['create']>[0]) {
    const response = await this.client.messages.create(input);
    return response;
  }

  /**
   * Streaming. Caller deve drenar todos os eventos. Retorna o stream nativo.
   */
  messagesStream(input: Parameters<Anthropic['messages']['stream']>[0]) {
    return this.client.messages.stream(input);
  }
}

export function extractAnthropicUsage(response: {
  usage?: { input_tokens?: number; output_tokens?: number };
}): { normalized: NormalizedAnthropicUsage; source: UsageSource } | null {
  const u = response.usage;
  if (!u || typeof u.input_tokens !== 'number' || typeof u.output_tokens !== 'number') {
    return null;
  }
  return {
    normalized: {
      input_tokens: u.input_tokens,
      output_tokens: u.output_tokens,
      total_tokens: u.input_tokens + u.output_tokens,
    },
    source: 'provider_direct',
  };
}

export function classifyAnthropicError(err: unknown): AnthropicErrorClass {
  if (typeof err !== 'object' || err === null) return 'unknown';
  const e = err as { status?: number; type?: string };
  if (e.status === 401 || e.status === 403) return 'auth';
  if (e.status === 429) return 'rate_limit';
  if (e.status === 400 || e.status === 422) return 'invalid_request';
  if (e.status === 529) return 'overloaded';
  if (typeof e.status === 'number' && e.status >= 500) return 'server_error';
  return 'unknown';
}

/**
 * Allowlist hardcoded de `anthropic-beta` headers permitidos por capability.
 * Baseline: vazia. Cliente pedindo beta não-listado → 403.
 */
export const ANTHROPIC_BETA_ALLOWLIST: ReadonlyArray<string> = Object.freeze([]);

export function rewritePassthroughHeaders(
  inboundHeaders: Record<string, string | string[] | undefined>,
  providerKey: string,
  options: { allowedBetas?: ReadonlyArray<string> } = {},
): { outbound: Record<string, string>; deniedBetas: string[] } {
  const out: Record<string, string> = {};
  // Strip auth from client.
  for (const [k, v] of Object.entries(inboundHeaders)) {
    const key = k.toLowerCase();
    if (key === 'authorization' || key === 'x-api-key' || key === 'x-govai-api-key') continue;
    if (key === 'host' || key === 'connection' || key === 'content-length') continue;
    if (Array.isArray(v)) out[k] = v.join(', ');
    else if (v !== undefined) out[k] = v;
  }
  // Apply provider auth.
  out['x-api-key'] = providerKey;
  if (!('anthropic-version' in out)) {
    out['anthropic-version'] = '2023-06-01';
  }
  // Beta header allowlist enforcement.
  const deniedBetas: string[] = [];
  const beta = inboundHeaders['anthropic-beta'];
  if (beta) {
    const incoming = (Array.isArray(beta) ? beta.join(',') : beta).split(',').map((s) => s.trim());
    const allowed = options.allowedBetas ?? ANTHROPIC_BETA_ALLOWLIST;
    const filtered: string[] = [];
    for (const b of incoming) {
      if (allowed.includes(b)) filtered.push(b);
      else deniedBetas.push(b);
    }
    if (deniedBetas.length > 0) {
      // Caller decides: no passthrough route, this should yield 403 + audit `passthrough.beta_denied`.
      delete out['anthropic-beta'];
    } else {
      out['anthropic-beta'] = filtered.join(',');
    }
  }
  return { outbound: out, deniedBetas };
}
