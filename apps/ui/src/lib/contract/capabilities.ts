// MIRROR of GET /v1/capabilities. Authoritative sources (re-read at main 88191a6f):
//   apps/api/src/routes/capabilities.ts             — the response projection (:45-66)
//   apps/api/src/pipeline/capability-resolution.ts  — effective status/level resolution
//   packages/core-governance/src/capability.ts      — the enums
//   packages/core-governance/src/registry.ts        — the registry this route actually serves
//
// ★ SOURCE ADJUDICATION — a July-plan assertion that does NOT hold at this base:
//   the plan describes this screen as showing "in what level (policy_governed vs
//   passthrough_audited)". This route serves `BASELINE_REGISTRY` from @govai/core-governance,
//   whose facets carry a NUMERIC governance level 0–3 (ADR-004/ADR-005) and an orthogonal
//   evidence_strength. `policy_governed` / `passthrough_audited`, `base_risk_class` and
//   endpoint coverage belong to a DIFFERENT registry (@govai/core-types, in the provider
//   packages) that this route never touches. The UI therefore renders the numeric governance
//   level and MUST NOT label it as a provider-surface level.
//
// ★ Every object schema here is LOOSE (`z.looseObject`). Zod's default object behaviour strips
// unknown keys, so an additive backend field would silently disappear from a query export that
// calls itself "serialized without post-processing" — the export would be a projection while
// claiming to be the response. Strict schemas would fail the opposite way, breaking the UI on
// an additive change the backend is entitled to make. Loose validates what the UI depends on
// and carries everything else through unchanged.

import { z } from 'zod';

/** capability.ts:3 — the worst-effective status also rolls up to the capability. */
export const CAPABILITY_STATUSES = ['supported', 'planned', 'blocked', 'experimental'] as const;
export const CapabilityStatus = z.enum(CAPABILITY_STATUSES);
export type CapabilityStatus = z.infer<typeof CapabilityStatus>;

/** capability.ts:6-12. ADR-005: `external_anchor`, `customer_signed` and `icp_brasil_tsa` are
 *  themselves planned in the baseline — evidence strength is never a certification claim. */
export const EVIDENCE_STRENGTHS = [
  'hmac_internal',
  'dev_signed',
  'external_anchor',
  'customer_signed',
  'icp_brasil_tsa',
] as const;
export const EvidenceStrength = z.enum(EVIDENCE_STRENGTHS);
export type EvidenceStrength = z.infer<typeof EvidenceStrength>;

/** capability.ts:17 — governance level 0..3 (ADR-004/005). 0 is default-deny. */
export const GovernanceLevel = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type GovernanceLevel = z.infer<typeof GovernanceLevel>;

/** capabilities.ts:52-64. `level`/`status` are POST-override (effective); `baseline_status`
 *  is the registry value before the org's downgrade-only override; `override_applied` says
 *  whether an org override row participated at all. */
export const CapabilityFacetView = z.looseObject({
  id: z.string(),
  level: GovernanceLevel,
  status: CapabilityStatus,
  baseline_status: CapabilityStatus,
  evidence_strength: EvidenceStrength.nullable(),
  reason: z.string().nullable(),
  last_live_test_at: z.string().nullable(),
  docs_url: z.string().nullable(),
  override_applied: z.boolean(),
});
export type CapabilityFacetView = z.infer<typeof CapabilityFacetView>;

/** capabilities.ts:47-65. `status` is the worst effective status across facets
 *  (capability-resolution.ts:153-159); `baseline_status` is the registry value. */
export const CapabilityView = z.looseObject({
  id: z.string(),
  provider: z.string(),
  status: CapabilityStatus,
  baseline_status: CapabilityStatus,
  facets: z.array(CapabilityFacetView),
});
export type CapabilityView = z.infer<typeof CapabilityView>;

export const CapabilitiesResponse = z.looseObject({
  org_id: z.string(),
  capabilities: z.array(CapabilityView),
});
export type CapabilitiesResponse = z.infer<typeof CapabilitiesResponse>;

/** One flattened capability×facet row — the shape the dense matrix renders. */
export type CapabilityFacetRow = {
  capability_id: string;
  provider: string;
  capability_status: CapabilityStatus;
  capability_baseline_status: CapabilityStatus;
  facet: CapabilityFacetView;
};

export function flattenCapabilities(res: CapabilitiesResponse): CapabilityFacetRow[] {
  return res.capabilities.flatMap((cap) =>
    cap.facets.map((facet) => ({
      capability_id: cap.id,
      provider: cap.provider,
      capability_status: cap.status,
      capability_baseline_status: cap.baseline_status,
      facet,
    })),
  );
}
