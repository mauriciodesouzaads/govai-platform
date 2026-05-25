import { describe, it, expect } from 'vitest';
import {
  compareSourceQuality,
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
