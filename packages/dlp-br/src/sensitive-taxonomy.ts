// Sensitive Data OS — typed taxonomy foundation (PR-SD1).
//
// Stable, accent-free, lowercase-snake_case tokens for sensitive/protected data
// categories that GovAI's native Sensitive Data OS must reason about. SD1
// INTRODUCES the typed vocabulary; it does NOT claim a working detector for
// every category. Categories with `_signal` suffix are deliberately marked as
// signals, not legal classifications — SD1 does not implement final
// segredo-de-justiça, attorney-client, or professional-secrecy classifiers.
//
// In SD1, only `secrets_api_keys`, `authentication_credentials`,
// `model_provider_credentials`, and `court_case_identifier` have a deterministic
// detector implementation. The remaining categories exist as typed tokens so
// that future SD2/SD3/SD4/SD5 slices and connector-ingested classifications can
// normalize their evidence into the same vocabulary without churn.
//
// This module contains NO regex execution and NO IO; it only defines the typed
// vocabulary, the enum constants, and reverse lookups. It is safe to import
// from any layer.

export const SENSITIVE_DATA_CATEGORIES = [
  // Core LGPD / personal data.
  'personal_data',
  'sensitive_personal_data',
  'children_adolescents_data',
  'health_data',
  'biometric_data',
  'genetic_data',
  'financial_data',
  'criminal_penal_data',
  'employment_labor_data',

  // Security / credential surface.
  'authentication_credentials',
  'secrets_api_keys',
  'model_provider_credentials',

  // Judiciary / legal. The `_signal` suffix marks SD1's deliberate distinction
  // between formatted-identifier detection (court_case_identifier) and the
  // final legal classifications GovAI does NOT implement here.
  'court_case_identifier',
  'judicial_secrecy_signal',
  'attorney_client_privilege_signal',
  'professional_secrecy_signal',

  // Business / public-sector.
  'trade_secret',
  'confidential_business_data',
  'public_sector_restricted_data',
  'public_procurement_sensitive_data',
  'regulatory_investigation_content',
  'whistleblower_content',

  // AI security.
  'prompt_injection_exfiltration_indicator',
] as const;
export type SensitiveDataCategory = (typeof SENSITIVE_DATA_CATEGORIES)[number];

export const SENSITIVE_DATA_CATEGORY_SET: ReadonlySet<SensitiveDataCategory> = new Set(
  SENSITIVE_DATA_CATEGORIES,
);

export function isSensitiveDataCategory(value: string): value is SensitiveDataCategory {
  return SENSITIVE_DATA_CATEGORY_SET.has(value as SensitiveDataCategory);
}

/**
 * Categories that DO have a deterministic native detector in SD1. Used in
 * tests + docs to keep the "taxonomy introduced" vs "detector implemented"
 * boundary explicit.
 */
export const SD1_IMPLEMENTED_CATEGORIES: ReadonlyArray<SensitiveDataCategory> = [
  'authentication_credentials',
  'secrets_api_keys',
  'model_provider_credentials',
  'court_case_identifier',
] as const;

export const SD1_IMPLEMENTED_CATEGORY_SET: ReadonlySet<SensitiveDataCategory> = new Set(
  SD1_IMPLEMENTED_CATEGORIES,
);

/**
 * Categories that exist in the SD1 vocabulary but do NOT have a native
 * detector here. These are placeholders for SD2/SD3/SD4/SD5 and for
 * connector-ingested classifications.
 */
export const SD1_TAXONOMY_ONLY_CATEGORIES: ReadonlyArray<SensitiveDataCategory> =
  SENSITIVE_DATA_CATEGORIES.filter((c) => !SD1_IMPLEMENTED_CATEGORY_SET.has(c));

// ---------------------------------------------------------------------------
// Confidence + recommended-action vocabularies.
// ---------------------------------------------------------------------------

export type SensitiveDataConfidenceBand = 'high' | 'medium' | 'low';

/**
 * Advisory action recommendations attached to a rich finding. SD1 contract:
 * `recommended_action` is metadata only. It does NOT alter
 * `DlpScanResult.highestAction`, does NOT influence `decidePolicy`, and does
 * NOT cause runtime blocking. Existing baseline DLP detect/redact/deny remains
 * the sole enforcement input. Later SD/RT slices will define when (if ever)
 * these values escalate into real enforcement.
 */
export const SENSITIVE_DATA_RECOMMENDED_ACTIONS = [
  'observe',
  'warn',
  'review',
  'approve_required',
  'deny',
] as const;
export type SensitiveDataRecommendedAction =
  (typeof SENSITIVE_DATA_RECOMMENDED_ACTIONS)[number];

export const SENSITIVE_DATA_RECOMMENDED_ACTION_SET: ReadonlySet<SensitiveDataRecommendedAction> =
  new Set(SENSITIVE_DATA_RECOMMENDED_ACTIONS);

/**
 * Strict invariant exported for compile-time and runtime callers: SD1 declares
 * `recommended_action` as advisory metadata. Any future code attempting to
 * route this value into enforcement must update SD1 docs first.
 */
export const SD1_RECOMMENDED_ACTION_IS_ADVISORY = true as const;

// ---------------------------------------------------------------------------
// Review-flag taxonomy: which professional review surface a finding suggests.
// SD1 only sets these as boolean hints on findings; routing those hints into
// real assignment is later-SD work.
// ---------------------------------------------------------------------------

export type SensitiveDataReviewFlags = {
  professional_review_recommended: boolean;
  dpo_review_recommended: boolean;
  legal_review_recommended: boolean;
  security_review_recommended: boolean;
  sector_specialist_review_recommended: boolean;
};

export const NO_REVIEW_FLAGS: SensitiveDataReviewFlags = {
  professional_review_recommended: false,
  dpo_review_recommended: false,
  legal_review_recommended: false,
  security_review_recommended: false,
  sector_specialist_review_recommended: false,
};
