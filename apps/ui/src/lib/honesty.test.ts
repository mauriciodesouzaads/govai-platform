import { describe, expect, it } from 'vitest';
import {
  ENFORCEMENT_DECISIONS,
  coverageTone,
  ec1Tone,
  ec2Tone,
  ec3DropTone,
  ec3SealTone,
  ec4Tone,
  ec6Tone,
  enforcementLabel,
  hasGapList,
  isCoverageInScope,
  type EnforcementDecision,
} from './honesty.js';
import { CATALOGS } from './i18n/catalogs/index.js';
import { LOCALES } from './i18n/locales.js';
import type { DropEstimate } from './contract/evidence.js';

// The most important tests in the product. Each one pins a claim the UI must never make.

describe('enforcementLabel — the normative decision vocabulary', () => {
  const FORWARDED = ENFORCEMENT_DECISIONS.filter((d) => d !== 'blocked');

  it.each(FORWARDED)(
    'a governed %s decision WITHOUT a 403 is labelled as forwarded, in every language',
    (decision) => {
      const verdict = enforcementLabel({ http403: false, decision, surface: 'governed' });
      expect(verdict.messageKey).toBe(`enforcement.${decision}`);
      // Never red: red is reserved for a material effect and nothing was stopped.
      expect(verdict.tone).not.toBe('failure');
      for (const locale of LOCALES) {
        expect(CATALOGS[locale][verdict.messageKey]).toMatch(FORWARDED_TERM[locale]);
      }
    },
  );

  it('resolves a `blocked` decision with no 403 toward the observable fact, never to "blocked"', () => {
    // A recorded decision that contradicts the transport is resolved toward the transport:
    // the request demonstrably reached the provider, so it may not be shown as stopped.
    const verdict = enforcementLabel({ http403: false, decision: 'blocked', surface: 'governed' });
    expect(verdict.messageKey).toBe('enforcement.observe');
    expect(verdict.tone).not.toBe('failure');
  });

  it.each(ENFORCEMENT_DECISIONS)(
    'a 403 is labelled as a block regardless of the recorded decision (%s)',
    (decision) => {
      const verdict = enforcementLabel({ http403: true, decision, surface: 'governed' });
      expect(verdict.messageKey).toBe('enforcement.blocked.matrix');
      expect(verdict.tone).toBe('failure');
    },
  );

  it('names the trigger when the runtime reported one', () => {
    expect(
      enforcementLabel({
        http403: true,
        decision: 'blocked',
        blockTrigger: 'tool_validation',
        surface: 'governed',
      }).messageKey,
    ).toBe('enforcement.blocked.toolValidation');
    expect(
      enforcementLabel({
        http403: true,
        decision: 'blocked',
        blockTrigger: 'governance_enforcement',
        surface: 'governed',
      }).messageKey,
    ).toBe('enforcement.blocked.matrix');
  });

  it.each(ENFORCEMENT_DECISIONS)(
    'the passthrough surface never claims a policy decision (%s)',
    (decision) => {
      const verdict = enforcementLabel({ http403: false, decision, surface: 'passthrough' });
      expect(verdict.messageKey).toBe('enforcement.passthrough');
      expect(verdict.tone).toBe('neutral');
    },
  );

  it('marks `ask` and `sandbox_required` as attention so they are not read as routine', () => {
    // Both are the decisions a reader is most likely to mistake for an applied control.
    for (const decision of ['ask', 'sandbox_required'] as EnforcementDecision[]) {
      expect(enforcementLabel({ http403: false, decision, surface: 'governed' }).tone).toBe(
        'attention',
      );
    }
  });
});

/** The word each locale uses for "forwarded to the provider". */
const FORWARDED_TERM = {
  'pt-BR': /encaminhad/i,
  'en-US': /forward/i,
  es: /reenviad/i,
} as const;

describe('EC-6 — pending is never a pass', () => {
  it('is amber while any chain is pending (the only state this build produces)', () => {
    expect(ec6Tone({ total_chains: 4, verified_ok: 0, pending: 4 })).toBe('attention');
    expect(ec6Tone({ total_chains: 4, verified_ok: 3, pending: 1 })).toBe('attention');
  });

  it('is neutral — NOT green — when no chain is in scope', () => {
    // Zero pending because zero chains exist is an empty population, not a clean bill.
    expect(ec6Tone({ total_chains: 0, verified_ok: 0, pending: 0 })).toBe('neutral');
  });

  it('is never green for any response this build can produce (verified_ok is hardcoded 0)', () => {
    for (const chains of [0, 1, 4, 128]) {
      expect(ec6Tone({ total_chains: chains, verified_ok: 0, pending: chains })).not.toBe('ok');
    }
  });

  it('reserves green for a future verifier that actually verified every chain', () => {
    expect(ec6Tone({ total_chains: 4, verified_ok: 4, pending: 0 })).toBe('ok');
  });

  it('has no gap list, because the API enum does not accept it', () => {
    expect(hasGapList('ec6')).toBe(false);
    expect(hasGapList('ec5')).toBe(false);
    for (const inv of ['ec1', 'ec2', 'ec3seal', 'ec3drop', 'ec4']) {
      expect(hasGapList(inv)).toBe(true);
    }
  });
});

describe('EC-3.drop — an unobserved signal is not a zero', () => {
  const unobserved: DropEstimate = {
    invariant: 'ec3drop',
    label: 'EC-3 — native (drop)',
    drops: 0,
    captures: 0,
    drop_rate: null,
    observed: false,
    bound: 'bound text',
  };

  it('is neutral, never green, when nothing was observed in this process', () => {
    expect(ec3DropTone(unobserved)).toBe('neutral');
    expect(ec3DropTone(unobserved)).not.toBe('ok');
  });

  it('is green only when losses were actually measured and were zero', () => {
    expect(ec3DropTone({ ...unobserved, observed: true, captures: 100, drop_rate: 0 })).toBe('ok');
  });

  it('is a failure when measured losses exist', () => {
    expect(
      ec3DropTone({ ...unobserved, observed: true, drops: 3, captures: 97, drop_rate: 0.03 }),
    ).toBe('failure');
  });
});

describe('coverage_ratio — an empty population is not full coverage', () => {
  it('reports out-of-scope when the total is zero', () => {
    expect(isCoverageInScope({ total: 0 })).toBe(false);
    expect(coverageTone({ covered: 0, total: 0 })).toBe('neutral');
    expect(coverageTone({ covered: 0, total: 0 })).not.toBe('ok');
  });

  it('is green only when every unit in scope is covered', () => {
    expect(coverageTone({ covered: 27, total: 27 })).toBe('ok');
    expect(coverageTone({ covered: 2483, total: 2501 })).toBe('attention');
  });

  it('invents no threshold: 99.9% covered is still not fully covered', () => {
    expect(coverageTone({ covered: 999, total: 1000 })).toBe('attention');
  });
});

describe('per-invariant tones', () => {
  it('EC-1: failure outranks stall, and an empty window is neutral', () => {
    expect(ec1Tone({ total: 10, sealed: 8, failed: 1, stalled_past_slo: 1 })).toBe('failure');
    expect(ec1Tone({ total: 10, sealed: 9, failed: 0, stalled_past_slo: 1 })).toBe('attention');
    expect(ec1Tone({ total: 10, sealed: 10, failed: 0, stalled_past_slo: 0 })).toBe('ok');
    expect(ec1Tone({ total: 0, sealed: 0, failed: 0, stalled_past_slo: 0 })).toBe('neutral');
  });

  it('EC-2: a sequence hole is a material gap', () => {
    expect(ec2Tone({ chains: 12, chains_with_gap: 1 })).toBe('failure');
    expect(ec2Tone({ chains: 12, chains_with_gap: 0 })).toBe('ok');
    expect(ec2Tone({ chains: 0, chains_with_gap: 0 })).toBe('neutral');
  });

  it('EC-3.seal: past-SLO is attention, not yet failure', () => {
    expect(
      ec3SealTone({ native_total: 900, native_sealed: 895, native_unsealed_past_slo: 5 }),
    ).toBe('attention');
    expect(ec3SealTone({ native_total: 900, native_sealed: 900, native_unsealed_past_slo: 0 })).toBe(
      'ok',
    );
    expect(ec3SealTone({ native_total: 0, native_sealed: 0, native_unsealed_past_slo: 0 })).toBe(
      'neutral',
    );
  });

  it('EC-4: the expected value is zero, and an empty window is neutral', () => {
    expect(ec4Tone({ provider_invocations: 40, without_terminal: 1 })).toBe('attention');
    expect(ec4Tone({ provider_invocations: 40, without_terminal: 0 })).toBe('ok');
    expect(ec4Tone({ provider_invocations: 0, without_terminal: 0 })).toBe('neutral');
  });
});
