import { describe, it, expect } from 'vitest';
import {
  compareSourceQuality,
  decideSourcePrecedence,
  isNativeQuality,
  mergeBySourcePrecedence,
  SENSITIVE_DATA_ORIGINS,
  SENSITIVE_DATA_SOURCE_QUALITIES,
  SENSITIVE_DATA_SOURCE_SURFACES,
  type FindingForMerge,
  type SensitiveDataSourceQuality,
} from './sensitive-provenance.js';

describe('sensitive-provenance / vocabulary', () => {
  it('exposes the SD1 origin tokens', () => {
    expect([...SENSITIVE_DATA_ORIGINS]).toEqual([
      'govai_native',
      'connector_ingested',
      'customer_supplied',
      'external_import',
    ]);
  });

  it('surface list includes both native + connector + external entries', () => {
    expect(SENSITIVE_DATA_SOURCE_SURFACES).toEqual(
      expect.arrayContaining([
        'openai_native',
        'anthropic_native',
        'govai_runs',
        'connector_microsoft',
        'connector_aws',
        'connector_google',
        'connector_nvidia_nim',
        'connector_nemo_guardrails',
        'connector_openclaw',
        'manual_upload',
        'api_import',
      ]),
    );
  });

  it('quality ranking is total and orders primary highest', () => {
    expect([...SENSITIVE_DATA_SOURCE_QUALITIES]).toEqual([
      'primary_govai_evidence',
      'provider_generated',
      'customer_attested',
      'normalized_external',
      'unverified_external',
    ]);
    expect(compareSourceQuality('primary_govai_evidence', 'provider_generated')).toBe(1);
    expect(compareSourceQuality('provider_generated', 'primary_govai_evidence')).toBe(-1);
    expect(compareSourceQuality('customer_attested', 'customer_attested')).toBe(0);
    expect(compareSourceQuality('normalized_external', 'unverified_external')).toBe(1);
  });

  it('isNativeQuality is true only for primary_govai_evidence', () => {
    expect(isNativeQuality('primary_govai_evidence')).toBe(true);
    expect(isNativeQuality('provider_generated')).toBe(false);
    expect(isNativeQuality('normalized_external')).toBe(false);
    expect(isNativeQuality('unverified_external')).toBe(false);
  });
});

describe('sensitive-provenance / mergeBySourcePrecedence', () => {
  const make = <T>(
    value: T,
    q: SensitiveDataSourceQuality,
    rank: number,
  ): FindingForMerge<T> => ({ value, source_quality: q, action_rank: rank });

  it('native primary cannot be downgraded by non-native — even when non-native is stricter', () => {
    const native = make('native', 'primary_govai_evidence', 1); // warn-rank
    const external = make('ext', 'unverified_external', 4); // deny-rank
    expect(mergeBySourcePrecedence(native, external).value).toBe('native');
    expect(mergeBySourcePrecedence(external, native).value).toBe('native');
  });

  it('native primary cannot be downgraded by provider_generated', () => {
    const native = make('native', 'primary_govai_evidence', 0);
    const provider = make('provider', 'provider_generated', 3);
    expect(mergeBySourcePrecedence(native, provider).value).toBe('native');
  });

  it('among non-native sources, higher quality wins regardless of strictness', () => {
    const customer = make('cust', 'customer_attested', 0);
    const unverified = make('unv', 'unverified_external', 4);
    expect(mergeBySourcePrecedence(customer, unverified).value).toBe('cust');
  });

  it('quality tie resolves on stricter action', () => {
    const a = make('a', 'normalized_external', 1);
    const b = make('b', 'normalized_external', 3);
    expect(mergeBySourcePrecedence(a, b).value).toBe('b');
    expect(mergeBySourcePrecedence(b, a).value).toBe('b');
  });

  it('full tie keeps the first argument for determinism', () => {
    const a = make('a', 'unverified_external', 2);
    const b = make('b', 'unverified_external', 2);
    expect(mergeBySourcePrecedence(a, b).value).toBe('a');
    expect(mergeBySourcePrecedence(b, a).value).toBe('b');
  });

  it('two native primary findings: stricter wins, conservative on tie', () => {
    const a = make('a', 'primary_govai_evidence', 1);
    const b = make('b', 'primary_govai_evidence', 4);
    expect(mergeBySourcePrecedence(a, b).value).toBe('b');
    const c = make('c', 'primary_govai_evidence', 2);
    const d = make('d', 'primary_govai_evidence', 2);
    expect(mergeBySourcePrecedence(c, d).value).toBe('c');
  });
});

// Decision helper: the SD1 doctrine fix. `mergeBySourcePrecedence` is
// selected-only and lossy; `decideSourcePrecedence` returns both the
// authoritative selected finding AND any stricter non-native signal as
// `escalation` metadata, so callers can preserve external review
// recommendations without ever downgrading native evidence.
describe('sensitive-provenance / decideSourcePrecedence', () => {
  const make = <T>(
    value: T,
    q: SensitiveDataSourceQuality,
    rank: number,
  ): FindingForMerge<T> => ({ value, source_quality: q, action_rank: rank });

  it('native primary cannot be downgraded by a non-native lower/equal action', () => {
    const native = make('native', 'primary_govai_evidence', 3); // approve_required
    const external = make('ext', 'unverified_external', 3); // also approve_required
    const d1 = decideSourcePrecedence(native, external);
    expect(d1.selected.value).toBe('native');
    expect(d1.escalation).toBeUndefined();
    expect(d1.reason).toBe('native_primary_selected');

    const lower = make('ext-lower', 'unverified_external', 0); // observe
    const d2 = decideSourcePrecedence(native, lower);
    expect(d2.selected.value).toBe('native');
    expect(d2.escalation).toBeUndefined();
    expect(d2.reason).toBe('native_primary_selected');
  });

  it('non-native stricter signal is preserved as escalation while native primary remains selected', () => {
    const native = make('native', 'primary_govai_evidence', 1); // warn
    const externalStricter = make('ext', 'normalized_external', 3); // approve_required
    const d = decideSourcePrecedence(native, externalStricter);
    expect(d.selected.value).toBe('native');
    expect(d.selected.source_quality).toBe('primary_govai_evidence');
    expect(d.escalation?.value).toBe('ext');
    expect(d.escalation?.source_quality).toBe('normalized_external');
    expect(d.reason).toBe('external_escalation_preserved');
    // Argument order does not change semantics.
    const dRev = decideSourcePrecedence(externalStricter, native);
    expect(dRev.selected.value).toBe('native');
    expect(dRev.escalation?.value).toBe('ext');
    expect(dRev.reason).toBe('external_escalation_preserved');
  });

  it('unverified_external stricter signal does not become selected over primary_govai_evidence; is preserved as escalation', () => {
    const native = make('native', 'primary_govai_evidence', 0); // observe
    const unverifiedStricter = make('unv', 'unverified_external', 4); // deny
    const d = decideSourcePrecedence(native, unverifiedStricter);
    expect(d.selected.value).toBe('native');
    expect(d.selected.source_quality).toBe('primary_govai_evidence');
    expect(d.escalation?.value).toBe('unv');
    expect(d.escalation?.source_quality).toBe('unverified_external');
    expect(d.reason).toBe('external_escalation_preserved');
  });

  it('normalized_external stricter signal is preserved as escalation over primary_govai_evidence', () => {
    const native = make('native', 'primary_govai_evidence', 2); // review
    const normalizedStricter = make('norm', 'normalized_external', 4); // deny
    const d = decideSourcePrecedence(native, normalizedStricter);
    expect(d.selected.value).toBe('native');
    expect(d.escalation?.value).toBe('norm');
    expect(d.escalation?.source_quality).toBe('normalized_external');
    expect(d.reason).toBe('external_escalation_preserved');
  });

  it('among non-native sources, higher quality wins; no escalation field is set', () => {
    const customer = make('cust', 'customer_attested', 0);
    const unverified = make('unv', 'unverified_external', 4);
    const d = decideSourcePrecedence(customer, unverified);
    expect(d.selected.value).toBe('cust');
    expect(d.escalation).toBeUndefined();
    expect(d.reason).toBe('higher_quality_selected');
  });

  it('among non-native sources at equal quality, stricter action wins; no escalation', () => {
    const a = make('a', 'normalized_external', 1);
    const b = make('b', 'normalized_external', 3);
    const d = decideSourcePrecedence(a, b);
    expect(d.selected.value).toBe('b');
    expect(d.escalation).toBeUndefined();
    expect(d.reason).toBe('stricter_action_selected');
  });

  it('two native primary findings: stricter wins, no escalation field is set', () => {
    const a = make('a', 'primary_govai_evidence', 1);
    const b = make('b', 'primary_govai_evidence', 4);
    const d = decideSourcePrecedence(a, b);
    expect(d.selected.value).toBe('b');
    expect(d.escalation).toBeUndefined();
    expect(d.reason).toBe('stricter_action_selected');
  });

  it('full tie keeps the first argument for determinism and reports deterministic_tie', () => {
    const a = make('a', 'unverified_external', 2);
    const b = make('b', 'unverified_external', 2);
    expect(decideSourcePrecedence(a, b).selected.value).toBe('a');
    expect(decideSourcePrecedence(a, b).reason).toBe('deterministic_tie');
    expect(decideSourcePrecedence(b, a).selected.value).toBe('b');
    expect(decideSourcePrecedence(b, a).reason).toBe('deterministic_tie');
  });

  it('selected-only wrapper mergeBySourcePrecedence delegates to the decision helper', () => {
    // Same inputs as the "external_escalation_preserved" case above: the
    // selected-only wrapper must return the native finding (escalation is
    // dropped, as the wrapper API can only return one value).
    const native = make('native', 'primary_govai_evidence', 1);
    const externalStricter = make('ext', 'normalized_external', 3);
    expect(mergeBySourcePrecedence(native, externalStricter).value).toBe('native');
    expect(mergeBySourcePrecedence(externalStricter, native).value).toBe('native');
  });
});
