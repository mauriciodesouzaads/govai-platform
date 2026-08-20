import { describe, expect, it } from 'vitest';
import {
  parseBlockTrigger,
  parseEnforcementApplied,
  parseEnforcementDecision,
  readGovernanceFacts,
  readProviderRequestId,
  readRetryAfterSeconds,
} from './receipt.js';
import { anthropicMessagesAdapter } from '../providers/anthropic-messages.js';
import { openaiResponsesAdapter } from '../providers/openai-responses.js';
import { ENFORCEMENT_DECISIONS } from '../../../lib/honesty.js';

const headers = (init: Record<string, string>): Headers => new Headers(init);

describe('★ the provider request id comes from the provider’s own header, or nowhere', () => {
  it('prefers OpenAI’s canonical header over the compatibility fallback', () => {
    expect(
      readProviderRequestId(
        headers({ 'openai-request-id': 'req_canonical', 'x-request-id': 'req_fallback' }),
        openaiResponsesAdapter,
      ),
    ).toBe('req_canonical');
  });

  it('prefers Anthropic’s real header over both fallbacks', () => {
    expect(
      readProviderRequestId(
        headers({
          'request-id': 'req_real',
          'anthropic-request-id': 'req_compat',
          'x-request-id': 'req_other',
        }),
        anthropicMessagesAdapter,
      ),
    ).toBe('req_real');
  });

  it('falls back only when the canonical header is absent', () => {
    expect(
      readProviderRequestId(headers({ 'x-request-id': 'req_fallback' }), openaiResponsesAdapter),
    ).toBe('req_fallback');
  });

  it('returns null rather than an empty id when no header was sent', () => {
    expect(readProviderRequestId(headers({}), openaiResponsesAdapter)).toBeNull();
    expect(readProviderRequestId(headers({ 'x-request-id': '   ' }), openaiResponsesAdapter)).toBeNull();
  });

  it('does not apply one provider’s precedence list to the other', () => {
    // Anthropic's `request-id` must not be read for an OpenAI response.
    expect(
      readProviderRequestId(headers({ 'request-id': 'anthropic-shaped' }), openaiResponsesAdapter),
    ).toBeNull();
  });
});

describe('★ governance is read ONLY from the governed route', () => {
  const GOVERNED = headers({
    'x-govai-capability-level': 'policy_governed',
    'x-govai-effective-risk-class': 'C',
    'x-govai-enforcement-decision': 'ask',
    'x-govai-enforcement-applied': 'forwarded',
  });

  it('returns null for the native surface even if headers somehow appeared', () => {
    // The native/audited route resolves no per-request decision and sets none of these. Reading
    // them there would let implementation knowledge become a rendered response fact.
    expect(readGovernanceFacts('native_audited', GOVERNED, null)).toBeNull();
  });

  it('reads all four headers verbatim on the governed route', () => {
    expect(readGovernanceFacts('governed', GOVERNED, null)).toEqual({
      capabilityLevel: 'policy_governed',
      effectiveRiskClass: 'C',
      decisionRaw: 'ask',
      decision: 'ask',
      appliedRaw: 'forwarded',
      applied: 'forwarded',
      blockTrigger: null,
    });
  });

  it('returns null when a governed response carried none of them', () => {
    expect(readGovernanceFacts('governed', headers({}), null)).toBeNull();
  });

  it('keeps an unrecognised decision as a RAW value with no narrowed meaning', () => {
    // A future backend enum member must show up as an unknown value, never as silence and
    // never as a recognised label.
    const facts = readGovernanceFacts(
      'governed',
      headers({ 'x-govai-enforcement-decision': 'quarantine_required' }),
      null,
    );
    expect(facts?.decisionRaw).toBe('quarantine_required');
    expect(facts?.decision).toBeNull();
  });

  it('keeps an unrecognised applied value as raw only', () => {
    const facts = readGovernanceFacts(
      'governed',
      headers({ 'x-govai-enforcement-applied': 'partially_applied' }),
      null,
    );
    expect(facts?.appliedRaw).toBe('partially_applied');
    expect(facts?.applied).toBeNull();
  });

  it('reads block_trigger from a 403 body', () => {
    const facts = readGovernanceFacts(
      'governed',
      headers({ 'x-govai-enforcement-decision': 'blocked', 'x-govai-enforcement-applied': 'blocked' }),
      { error: 'governed_blocked', block_trigger: 'tool_validation' },
    );
    expect(facts?.blockTrigger).toBe('tool_validation');
  });
});

describe('the normative vocabulary is the only accepted decision set', () => {
  it('accepts exactly the six decisions the runtime can produce', () => {
    for (const decision of ENFORCEMENT_DECISIONS) {
      expect(parseEnforcementDecision(decision)).toBe(decision);
    }
  });

  it('rejects anything else, including near-misses', () => {
    for (const raw of [null, '', '  ', 'Blocked', 'BLOCKED', 'allow', 'deny', 'observe ']) {
      // `'observe '` has trailing whitespace, which trim() handles; the rest must be null.
      const parsed = parseEnforcementDecision(raw);
      if (raw === 'observe ') expect(parsed).toBe('observe');
      else expect(parsed, String(raw)).toBeNull();
    }
  });

  it('narrows applied to exactly forwarded or blocked', () => {
    expect(parseEnforcementApplied('forwarded')).toBe('forwarded');
    expect(parseEnforcementApplied('blocked')).toBe('blocked');
    for (const raw of [null, '', 'FORWARDED', 'allowed', 'applied']) {
      expect(parseEnforcementApplied(raw), String(raw)).toBeNull();
    }
  });

  it('narrows block_trigger to the two values the route can send', () => {
    expect(parseBlockTrigger({ block_trigger: 'tool_validation' })).toBe('tool_validation');
    expect(parseBlockTrigger({ block_trigger: 'governance_enforcement' })).toBe(
      'governance_enforcement',
    );
    for (const body of [null, undefined, 'a string', {}, { block_trigger: 'other' }]) {
      expect(parseBlockTrigger(body)).toBeNull();
    }
  });
});

describe('Retry-After', () => {
  it('reads delta-seconds', () => {
    expect(readRetryAfterSeconds(headers({ 'retry-after': '42' }))).toBe(42);
  });

  it('reads an HTTP date as a non-negative number of seconds', () => {
    const future = new Date(Date.now() + 30_000).toUTCString();
    const seconds = readRetryAfterSeconds(headers({ 'retry-after': future }));
    expect(seconds).not.toBeNull();
    expect(seconds).toBeGreaterThanOrEqual(0);
    expect(seconds).toBeLessThanOrEqual(31);
  });

  it('returns null for an absent or unusable value rather than guessing', () => {
    expect(readRetryAfterSeconds(headers({}))).toBeNull();
    expect(readRetryAfterSeconds(headers({ 'retry-after': 'soon' }))).toBeNull();
  });

  it('never returns a negative wait for a date in the past', () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    expect(readRetryAfterSeconds(headers({ 'retry-after': past }))).toBe(0);
  });
});
