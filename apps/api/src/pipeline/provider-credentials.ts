// Provider credential resolution for governed-native + passthrough routes.
//
// Production / non-loopback: the env-supplied real key is required. Throws if
// missing. NEVER falls back to a hermetic placeholder in production.
//
// Hermetic test env (NODE_ENV='test' AND loopback baseUrl): if the env-supplied
// key exists it is used; otherwise a deterministic hermetic placeholder is
// returned so the test fixture (provider-protocol-server) can accept any
// non-empty key without leaking secrets into the test suite.

import type { GovAIEnv } from '@govai/config';
import { isLoopbackUrl } from './capability-resolution.js';

export class MissingProviderKeyError extends Error {
  constructor(provider: 'anthropic' | 'openai') {
    super(
      `${provider.toUpperCase()}_API_KEY is required at runtime for non-loopback or non-test deployments; ` +
        `set the env variable or restrict the deployment to NODE_ENV=test with a loopback GOVAI_PROVIDER_BASE_URL`,
    );
    this.name = 'MissingProviderKeyError';
  }
}

const HERMETIC_ANTHROPIC = 'sk-ant-test-hermetic';
const HERMETIC_OPENAI = 'sk-openai-test-hermetic';

function isHermetic(env: GovAIEnv): boolean {
  if (env.NODE_ENV !== 'test') return false;
  const baseUrl = env.GOVAI_PROVIDER_BASE_URL ?? '';
  return isLoopbackUrl(baseUrl);
}

export function resolveAnthropicProviderKey(env: GovAIEnv): string {
  const real = env.ANTHROPIC_API_KEY;
  if (real && real.length > 0) return real;
  if (isHermetic(env)) return HERMETIC_ANTHROPIC;
  throw new MissingProviderKeyError('anthropic');
}

export function resolveOpenAIProviderKey(env: GovAIEnv): string {
  const real = env.OPENAI_API_KEY;
  if (real && real.length > 0) return real;
  if (isHermetic(env)) return HERMETIC_OPENAI;
  throw new MissingProviderKeyError('openai');
}
