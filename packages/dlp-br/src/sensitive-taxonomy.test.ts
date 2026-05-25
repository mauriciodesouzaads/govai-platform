import { describe, it, expect } from 'vitest';
import {
  NO_REVIEW_FLAGS,
  SD1_IMPLEMENTED_CATEGORIES,
  SD1_IMPLEMENTED_CATEGORY_SET,
  SD1_RECOMMENDED_ACTION_IS_ADVISORY,
  SD1_TAXONOMY_ONLY_CATEGORIES,
  SD2A_FOUNDATIONAL_DETECTED_CATEGORIES,
  SD2A_FOUNDATIONAL_DETECTED_CATEGORY_SET,
  SENSITIVE_DATA_CATEGORIES,
  SENSITIVE_DATA_CATEGORY_SET,
  SENSITIVE_DATA_RECOMMENDED_ACTIONS,
  SENSITIVE_DATA_RECOMMENDED_ACTION_SET,
  isSensitiveDataCategory,
} from './sensitive-taxonomy.js';

describe('sensitive-taxonomy / categories', () => {
  it('covers every category listed in SD1 docs', () => {
    // Anchor the SD1 taxonomy list — additions must be deliberate.
    expect(SENSITIVE_DATA_CATEGORIES.length).toBeGreaterThanOrEqual(22);
    for (const c of SENSITIVE_DATA_CATEGORIES) {
      expect(c).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('SD1 implemented categories are the four detector-backed slots only', () => {
    expect([...SD1_IMPLEMENTED_CATEGORIES].sort()).toEqual(
      [
        'authentication_credentials',
        'court_case_identifier',
        'model_provider_credentials',
        'secrets_api_keys',
      ].sort(),
    );
    for (const c of SD1_IMPLEMENTED_CATEGORIES) {
      expect(SD1_IMPLEMENTED_CATEGORY_SET.has(c)).toBe(true);
      expect(SENSITIVE_DATA_CATEGORY_SET.has(c)).toBe(true);
    }
  });

  it('taxonomy-only categories include every category SD1 does not implement', () => {
    for (const c of SD1_TAXONOMY_ONLY_CATEGORIES) {
      expect(SD1_IMPLEMENTED_CATEGORY_SET.has(c)).toBe(false);
      expect(SENSITIVE_DATA_CATEGORY_SET.has(c)).toBe(true);
    }
    // Spot-check explicit gaps SD1 must not pretend to implement.
    expect(SD1_TAXONOMY_ONLY_CATEGORIES).toEqual(
      expect.arrayContaining([
        'sensitive_personal_data',
        'health_data',
        'judicial_secrecy_signal',
        'attorney_client_privilege_signal',
        'professional_secrecy_signal',
        'prompt_injection_exfiltration_indicator',
      ]),
    );
  });

  it('isSensitiveDataCategory accepts known tokens and rejects unknowns', () => {
    expect(isSensitiveDataCategory('personal_data')).toBe(true);
    expect(isSensitiveDataCategory('secrets_api_keys')).toBe(true);
    expect(isSensitiveDataCategory('not_a_category')).toBe(false);
    expect(isSensitiveDataCategory('')).toBe(false);
  });

  it('SD2A foundational-detected categories are exactly financial_data + health_data', () => {
    expect([...SD2A_FOUNDATIONAL_DETECTED_CATEGORIES].sort()).toEqual(
      ['financial_data', 'health_data'],
    );
    for (const c of SD2A_FOUNDATIONAL_DETECTED_CATEGORIES) {
      expect(SD2A_FOUNDATIONAL_DETECTED_CATEGORY_SET.has(c)).toBe(true);
      expect(SENSITIVE_DATA_CATEGORY_SET.has(c)).toBe(true);
      // SD2A categories were not implemented in SD1.
      expect(SD1_IMPLEMENTED_CATEGORY_SET.has(c)).toBe(false);
    }
  });
});

describe('sensitive-taxonomy / recommended actions', () => {
  it('SD1 advisory invariant is true', () => {
    expect(SD1_RECOMMENDED_ACTION_IS_ADVISORY).toBe(true);
  });

  it('canonical action list matches the SD1 prompt', () => {
    expect([...SENSITIVE_DATA_RECOMMENDED_ACTIONS]).toEqual([
      'observe',
      'warn',
      'review',
      'approve_required',
      'deny',
    ]);
    for (const a of SENSITIVE_DATA_RECOMMENDED_ACTIONS) {
      expect(SENSITIVE_DATA_RECOMMENDED_ACTION_SET.has(a)).toBe(true);
    }
  });

  it('NO_REVIEW_FLAGS sets every flag to false', () => {
    expect(NO_REVIEW_FLAGS).toEqual({
      professional_review_recommended: false,
      dpo_review_recommended: false,
      legal_review_recommended: false,
      security_review_recommended: false,
      sector_specialist_review_recommended: false,
    });
  });
});
