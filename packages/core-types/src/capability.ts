// Canonical capability types — Peça A v2 §6.3.1.
// 'family_alias' is intentionally NOT introduced in PR2 (Matrix §7.3 / Forbidden #5).

export type CapabilityStatus = 'not_exposed' | 'planned' | 'supported' | 'blocked';

export type CapabilityLevel =
  | 'passthrough_audited'
  | 'policy_governed'
  | 'evidence_grade';

export type RiskClass = 'A' | 'B' | 'C' | 'D' | 'E';

export type Tier = 'starter' | 'business' | 'enterprise' | 'regulated';

export type OperationalMode = 'production' | 'pilot' | 'dev' | 'test';

export type EnforcementMode =
  | 'observe'
  | 'warn'
  | 'ask'
  | 'enforce'
  | 'sandbox_required'
  | 'blocked';

export type SideEffect =
  | { audit_detail_level: 'high' }
  | { dlp_pre_scan_required: boolean };

export type Precondition =
  | {
      tenant_capability_acceptance_required: true;
      max_effective_risk_class_allowed_for_acceptance: RiskClass;
    }
  | { approval_workflow_required: boolean }
  | { sandbox_environment_required: boolean };

export interface EnforcementResolution {
  mode: EnforcementMode;
  side_effects?: SideEffect[];
  preconditions?: Precondition[];
}

export interface EndpointCoverage {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  streams: boolean;
  multipart: boolean;
  notes?: string;
}

export interface BetaDependency {
  header_token: string;
  required: 'always' | 'feature_flag';
  allowlist_treatment:
    | 'global_allowlist'
    | 'org_override_allowed'
    | 'hard_denied'
    | 'verification_required'
    | 'denied_until_decision'
    | 'removed_as_no_longer_needed';
  source_doc?: string;
}

export interface CapabilityFacet {
  name: string;
  status: string;
  via?: string;
}

export interface Capability {
  id: string;
  provider: 'anthropic' | 'openai';
  status: CapabilityStatus;
  level: CapabilityLevel;
  base_risk_class: RiskClass;
  tier_availability: Tier[];
  enforcement_default: EnforcementMode | EnforcementResolution;
  endpoint_coverage: EndpointCoverage[];
  beta_dependencies: BetaDependency[];
  facets?: CapabilityFacet[];
  planned_phase?: string;
  blocked_reason?: string;
  last_live_test_at?: string;
}

/** Numeric ordering for RiskClass (A < B < C < D < E). Used by max-rollups. */
export const RISK_ORDER: Readonly<Record<RiskClass, number>> = Object.freeze({
  A: 0,
  B: 1,
  C: 2,
  D: 3,
  E: 4,
});
