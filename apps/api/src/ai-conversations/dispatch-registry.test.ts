// P0-C dispatch surface registry (EP-AI-CONVERSATION-CONTINUITY-V1 P0-C; spec §12/§23).
//
// The registry's whole job is to FAIL CLOSED. These tests are mostly about what it REFUSES —
// because a registry that silently reroutes an unsupported surface would send a user's content
// to a model or endpoint they never chose.

import { describe, it, expect } from 'vitest';
import {
  ANTHROPIC_MESSAGES_SURFACE,
  OPENAI_RESPONSES_SURFACE,
  isStreamingNativeRequest,
  resolveDispatchPlan,
} from './dispatch-registry.js';
import { CONVERSATION_MODES, CONVERSATION_PROVIDERS } from './contracts.js';

describe('resolveDispatchPlan — what P0-C can execute', () => {
  it('resolves the two supported surfaces, in BOTH conversation modes', () => {
    for (const mode of CONVERSATION_MODES) {
      const a = resolveDispatchPlan({ provider: 'anthropic', surface: ANTHROPIC_MESSAGES_SURFACE, mode });
      expect(a.supported).toBe(true);
      expect(a.supported && a.plan).toMatchObject({
        provider: 'anthropic',
        nativePath: '/v1/messages',
        nonStreamCapabilityId: 'anthropic.messages.create',
        streamCapabilityId: 'anthropic.messages.stream',
        canonicalLevel: 'policy_governed',
        mode,
      });
      const o = resolveDispatchPlan({ provider: 'openai', surface: OPENAI_RESPONSES_SURFACE, mode });
      expect(o.supported).toBe(true);
      expect(o.supported && o.plan).toMatchObject({
        provider: 'openai',
        nativePath: '/v1/responses',
        nonStreamCapabilityId: 'openai.responses.create',
        streamCapabilityId: 'openai.responses.stream',
        canonicalLevel: 'policy_governed',
        mode,
      });
    }
  });

  it('★ the CANONICAL level stays policy_governed even for a passthrough conversation', () => {
    // Decisão 4 / HAE-002: the registry's canonical level is a property of the CAPABILITY; the
    // conversation's mode selects the OPERATING level. Collapsing the two would misreport every
    // passthrough conversation's evidence as a lower-grade capability than it is.
    const p = resolveDispatchPlan({ provider: 'anthropic', surface: ANTHROPIC_MESSAGES_SURFACE, mode: 'passthrough' });
    expect(p.supported && p.plan.canonicalLevel).toBe('policy_governed');
  });

  it('REFUSES codex and claude_code — continuation IS their transport (P0-D)', () => {
    for (const provider of ['codex', 'claude_code'] as const) {
      for (const surface of [ANTHROPIC_MESSAGES_SURFACE, OPENAI_RESPONSES_SURFACE, 'codex_thread', 'x']) {
        const r = resolveDispatchPlan({ provider, surface, mode: 'governed' });
        expect({ provider, surface, r }).toEqual({
          provider,
          surface,
          r: { supported: false, reason: 'provider_requires_p0d_continuation' },
        });
      }
    }
  });

  it('REFUSES every other surface token on a dispatchable provider', () => {
    for (const surface of [
      'anthropic_api', // ← the token the P0-A1/P0-B fixtures use: NOT a P0-C dispatch surface
      'anthropic_files',
      'openai_chat_completions',
      'openai_embeddings',
      'ANTHROPIC_MESSAGES', // case matters: the column is free-form text
      'anthropic_messages ', // trailing space
      '',
    ]) {
      for (const provider of ['anthropic', 'openai'] as const) {
        const r = resolveDispatchPlan({ provider, surface, mode: 'governed' });
        expect({ provider, surface, supported: r.supported }).toEqual({
          provider,
          surface,
          supported: false,
        });
      }
    }
  });

  it('never CROSSES a provider with the other provider’s surface', () => {
    // A cross-matched pair must not resolve to the other provider's endpoint — that would POST a
    // Messages body to /v1/responses.
    expect(resolveDispatchPlan({ provider: 'anthropic', surface: OPENAI_RESPONSES_SURFACE, mode: 'governed' })).toEqual({
      supported: false,
      reason: 'surface_not_supported_in_p0c',
    });
    expect(resolveDispatchPlan({ provider: 'openai', surface: ANTHROPIC_MESSAGES_SURFACE, mode: 'governed' })).toEqual({
      supported: false,
      reason: 'surface_not_supported_in_p0c',
    });
  });

  it('covers every provider 0031’s CHECK admits — no provider falls through undecided', () => {
    for (const provider of CONVERSATION_PROVIDERS) {
      const r = resolveDispatchPlan({ provider, surface: ANTHROPIC_MESSAGES_SURFACE, mode: 'governed' });
      expect(typeof r.supported).toBe('boolean');
    }
  });

  it('does NOT gate on model — a new provider model must not break a working conversation', () => {
    // The model vocabulary is provider-owned and changes without a GovAI release, so it travels
    // inside the native request where the PROVIDER validates it.
    const r = resolveDispatchPlan({ provider: 'anthropic', surface: ANTHROPIC_MESSAGES_SURFACE, mode: 'governed' });
    expect(r.supported).toBe(true);
    expect(Object.keys(r.supported ? r.plan : {})).not.toContain('model');
  });
});

describe('isStreamingNativeRequest — top-level `stream` only', () => {
  it('reads the TOP-LEVEL flag', () => {
    expect(isStreamingNativeRequest({ stream: true })).toBe(true);
    expect(isStreamingNativeRequest({ stream: false })).toBe(false);
    expect(isStreamingNativeRequest({})).toBe(false);
  });

  it('★ does NOT false-positive on a nested "stream": true inside message content', () => {
    // The exact failure a substring/regex match would produce — a user asking a question ABOUT
    // streaming would have their non-stream request drained as a stream.
    expect(
      isStreamingNativeRequest({
        model: 'm',
        messages: [{ role: 'user', content: 'why does {"stream": true} not work?' }],
      }),
    ).toBe(false);
    expect(isStreamingNativeRequest({ nested: { stream: true } })).toBe(false);
  });

  it('treats non-objects and truthy-but-not-true values as non-streaming', () => {
    for (const v of [null, undefined, 'true', 1, [], [{ stream: true }]]) {
      expect({ v, s: isStreamingNativeRequest(v) }).toEqual({ v, s: false });
    }
    expect(isStreamingNativeRequest({ stream: 'true' })).toBe(false);
    expect(isStreamingNativeRequest({ stream: 1 })).toBe(false);
  });
});
