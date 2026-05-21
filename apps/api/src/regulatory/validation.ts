// Regulatory Core PR-R1 — input validation (issue #59, umbrella #33).
//
// Zod schemas + shared enums for the regulatory source registry and control
// catalog. Pure shape/format validation lives here; business rules (date
// ordering, parent visibility/ownership, monotonic version numbering) live in
// service.ts. The DB CHECK constraints in migration 0016 are the backstop —
// these enums are kept in exact lockstep with that migration.

import { z } from 'zod';

// A source_key / control_key is an uppercase, hyphen-delimited token, e.g.
// BR-LGPD-13709-2018, ISO-IEC-42001, GOVAI-REG-SRC-001. 2–100 chars, must start
// and end with an alphanumeric.
export const KEY_RE = /^[A-Z0-9][A-Z0-9-]{0,98}[A-Z0-9]$/;

const KeyField = z
  .string()
  .min(2)
  .max(100)
  .regex(KEY_RE, 'key must be uppercase alphanumeric with hyphens (e.g. BR-LGPD-13709-2018)');

// YYYY-MM-DD that must also be a real calendar date. The regex pins the shape;
// the refine rejects impossible months/days (e.g. 2026-99-99) and non-canonical
// rollovers (e.g. 2026-02-30, which Date would otherwise roll to 2026-03-02)
// before they reach the SQL `date` cast and turn into a 500. Stays a string so
// the service/DB API shape is unchanged.
const DateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date')
  .refine((s) => {
    const parts = s.split('-');
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'must be a valid calendar date (YYYY-MM-DD)');
const HttpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), { message: 'url must use http or https' })
  .refine((u) => u.length <= 2048, { message: 'url too long' });

export const SourceQuality = z.enum([
  'PRIMARY_REGULATORY_SOURCE',
  'PRIMARY_OFFICIAL_SOURCE',
  'PRIMARY_VENDOR_DOC',
  'ANALYST_REPORT',
  'NEWS_SOURCE',
  'SECONDARY_BLOG',
  'INTERNAL_ARCHITECTURE_ANALYSIS',
  'SOURCE_VERIFICATION_REQUIRED',
]);

export const VerificationStatus = z.enum([
  'CONFIRMED_PRIMARY_SOURCE',
  'PARTIAL_PRIMARY_SOURCE',
  'SECONDARY_SOURCE',
  'INTERNAL_ANALYSIS',
  'NEEDS_SOURCE_VERIFICATION',
]);

export const LegalStatus = z.enum([
  'ACTIVE',
  'AMENDED',
  'REVOKED',
  'BILL',
  'DRAFT',
  'REFERENCE_ONLY',
  'UNKNOWN',
]);

export const ReviewFrequency = z.enum([
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'AD_HOC',
  'EMERGENCY',
]);

export const ChangeType = z.enum([
  'CLARIFICATION',
  'EXPANSION',
  'RESTRICTION',
  'RESCISSION',
  'DEFERRAL',
  'CONSOLIDATION',
  'UNKNOWN',
]);

export const RelationshipType = z.enum([
  'AMENDS',
  'AMENDED_BY',
  'REVOKES',
  'REVOKED_BY',
  'SUPERSEDES',
  'SUPERSEDED_BY',
  'CITES',
  'CITED_BY',
  'IMPLEMENTS',
  'RELATED',
]);

export const CapabilityType = z.enum([
  'IMPLEMENTED_FOUNDATIONAL_CONTROL',
  'REQUIRED_NATIVE_CAPABILITY',
  'NATIVE_ENHANCEMENT_REQUIRED',
  'CONNECTOR_ENRICHMENT',
  'EXTERNAL_SERVICE_REQUIRED',
  'CUSTOMER_PROCESS_REQUIRED',
  'PROFESSIONAL_REVIEW_REQUIRED',
  'SOURCE_VERIFICATION_REQUIRED',
]);

export const ImplementationState = z.enum([
  'NOT_STARTED',
  'IMPLEMENTED_FOUNDATIONAL_CONTROL',
  'PARTIAL_PRIMITIVE_EXISTS',
  'TARGET_CAPABILITY_REQUIRED',
  'CONNECTOR_REQUIRED',
  'EXTERNAL_VALIDATION_REQUIRED',
  'CUSTOMER_PROCESS_REQUIRED',
  'PROFESSIONAL_REVIEW_REQUIRED',
  'SOURCE_VERIFICATION_REQUIRED',
]);

export const BuildDecision = z.enum([
  'BUILD_NATIVE_CORE',
  'BUILD_NATIVE_ENHANCED',
  'CONNECTOR_ENRICHMENT',
  'EXTERNAL_SERVICE_REQUIRED',
  'CUSTOMER_PROCESS_REQUIRED',
  'PROFESSIONAL_REVIEW_REQUIRED',
  'OBSERVE',
  'DO_NOT_BUILD',
]);

export const AutomationLevel = z.enum([
  'MANUAL',
  'ASSISTED',
  'AUTOMATED',
  'EXTERNAL',
  'NOT_APPLICABLE',
]);

export const LinkType = z.enum([
  'LEGAL_DRIVER',
  'FRAMEWORK_DRIVER',
  'SECTOR_DRIVER',
  'EVIDENCE_DRIVER',
  'REFERENCE_ONLY',
]);

export const FrameworkKey = z.enum([
  'LGPD',
  'ANPD',
  'CNJ_615',
  'MARCO_CIVIL',
  'OAB',
  'FINANCIAL_SECTOR_BR',
  'HEALTH_SECTOR_BR',
  'ISO_42001',
  'ISO_27001',
  'ISO_27701',
  'ISO_23894',
  'NIST_AI_RMF',
  'NIST_AI_600_1',
  'EU_AI_ACT',
  'GDPR',
  'PL_2338_READINESS',
]);

export const MappingStatus = z.enum([
  'COVERED',
  'PARTIAL',
  'GAP',
  'NEEDS_SOURCE_VERIFICATION',
  'READINESS_ONLY',
  'NOT_APPLICABLE',
]);

const ShortText = z.string().min(1).max(500);
const LongText = z.string().max(8000);
const HashField = z.string().min(1).max(256);
const RequirementRef = z.string().max(200);

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const CreateSourceBody = z.object({
  source_key: KeyField,
  title: z.string().min(1).max(500),
  jurisdiction: z.string().min(1).max(64).default('BR'),
  authority: z.string().min(1).max(200).optional(),
  instrument_type: z.string().min(1).max(120).optional(),
  source_quality: SourceQuality,
  verification_status: VerificationStatus,
  legal_status: LegalStatus,
  official_url: HttpUrl.optional(),
  publication_date: DateField.optional(),
  effective_date: DateField.optional(),
  last_verified_at: z.string().datetime().optional(),
  next_review_at: z.string().datetime().optional(),
  review_frequency: ReviewFrequency.default('AD_HOC'),
  legal_owner: z.string().min(1).max(200).optional(),
  product_owner: z.string().min(1).max(200).optional(),
  notes: LongText.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateSourceInput = z.infer<typeof CreateSourceBody>;

// PATCH: every field optional; at least one must be present.
export const UpdateSourceBody = z
  .object({
    title: z.string().min(1).max(500).optional(),
    jurisdiction: z.string().min(1).max(64).optional(),
    authority: z.string().min(1).max(200).nullable().optional(),
    instrument_type: z.string().min(1).max(120).nullable().optional(),
    source_quality: SourceQuality.optional(),
    verification_status: VerificationStatus.optional(),
    legal_status: LegalStatus.optional(),
    official_url: HttpUrl.nullable().optional(),
    publication_date: DateField.nullable().optional(),
    effective_date: DateField.nullable().optional(),
    last_verified_at: z.string().datetime().nullable().optional(),
    next_review_at: z.string().datetime().nullable().optional(),
    review_frequency: ReviewFrequency.optional(),
    legal_owner: z.string().min(1).max(200).nullable().optional(),
    product_owner: z.string().min(1).max(200).nullable().optional(),
    notes: LongText.nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'at least one field is required' });
export type UpdateSourceInput = z.infer<typeof UpdateSourceBody>;

export const CreateVersionBody = z.object({
  version_key: z.string().min(1).max(120).optional(),
  source_url: HttpUrl.optional(),
  retrieved_at: z.string().datetime().optional(),
  verified_at: z.string().datetime().optional(),
  content_hash: HashField.optional(),
  diff_hash: HashField.optional(),
  archived_snapshot_hash: HashField.optional(),
  change_type: ChangeType.default('UNKNOWN'),
  summary: LongText.optional(),
  verification_status: VerificationStatus,
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateVersionInput = z.infer<typeof CreateVersionBody>;

export const CreateRelationshipBody = z.object({
  to_source_id: z.string().uuid(),
  relationship_type: RelationshipType,
  notes: LongText.optional(),
});
export type CreateRelationshipInput = z.infer<typeof CreateRelationshipBody>;

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export const CreateControlBody = z.object({
  control_key: KeyField,
  domain: ShortText,
  name: z.string().min(1).max(500),
  description: LongText.default(''),
  capability_type: CapabilityType,
  implementation_state: ImplementationState,
  build_decision: BuildDecision,
  automation_level: AutomationLevel.default('MANUAL'),
  owner_role: z.string().min(1).max(120).optional(),
  review_frequency: ReviewFrequency.default('AD_HOC'),
  evidence_required: z.array(z.string().max(500)).max(100).optional(),
  current_govai_primitive: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateControlInput = z.infer<typeof CreateControlBody>;

export const UpdateControlBody = z
  .object({
    domain: ShortText.optional(),
    name: z.string().min(1).max(500).optional(),
    description: LongText.optional(),
    capability_type: CapabilityType.optional(),
    implementation_state: ImplementationState.optional(),
    build_decision: BuildDecision.optional(),
    automation_level: AutomationLevel.optional(),
    owner_role: z.string().min(1).max(120).nullable().optional(),
    review_frequency: ReviewFrequency.optional(),
    evidence_required: z.array(z.string().max(500)).max(100).optional(),
    current_govai_primitive: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'at least one field is required' });
export type UpdateControlInput = z.infer<typeof UpdateControlBody>;

export const CreateSourceLinkBody = z.object({
  source_id: z.string().uuid(),
  link_type: LinkType,
  requirement_ref: RequirementRef.optional(),
  notes: LongText.optional(),
});
export type CreateSourceLinkInput = z.infer<typeof CreateSourceLinkBody>;

export const CreateFrameworkMappingBody = z.object({
  framework_key: FrameworkKey,
  requirement_ref: RequirementRef.optional(),
  requirement_title: z.string().min(1).max(500).optional(),
  mapping_status: MappingStatus,
  source_id: z.string().uuid().optional(),
  notes: LongText.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateFrameworkMappingInput = z.infer<typeof CreateFrameworkMappingBody>;

// ---------------------------------------------------------------------------
// AI System Registry (PR-R2)
// ---------------------------------------------------------------------------

export const SystemType = z.enum([
  'INTERNAL_PRODUCT',
  'INTERNAL_WORKFLOW',
  'THIRD_PARTY_PRODUCT',
  'THIRD_PARTY_API',
  'AGENTIC_WORKFLOW',
  'DECISION_SUPPORT',
  'DOCUMENT_PROCESSING',
  'MODEL_ENDPOINT',
  'OTHER',
]);

export const LifecycleState = z.enum([
  'PROPOSED',
  'DESIGN',
  'EVALUATION',
  'PILOT',
  'ACTIVE',
  'SUSPENDED',
  'RETIRED',
]);

export const DeploymentEnvironment = z.enum([
  'DEVELOPMENT',
  'STAGING',
  'PRODUCTION',
  'CUSTOMER_MANAGED',
  'THIRD_PARTY_MANAGED',
  'NOT_DEPLOYED',
]);

const OwnerField = z.string().min(1).max(200);
const PurposeText = z.string().max(4000);

export const CreateAiSystemBody = z.object({
  system_key: KeyField,
  name: z.string().min(1).max(500),
  description: LongText.default(''),
  system_type: SystemType,
  lifecycle_state: LifecycleState,
  business_owner: OwnerField.optional(),
  technical_owner: OwnerField.optional(),
  legal_owner: OwnerField.optional(),
  dpo_owner: OwnerField.optional(),
  intended_purpose: PurposeText.default(''),
  primary_jurisdiction: z.string().min(1).max(64).default('BR'),
  deployment_environment: DeploymentEnvironment,
  external_provider_id: z.string().uuid().optional(),
  regulatory_source_id: z.string().uuid().optional(),
  control_id: z.string().uuid().optional(),
  review_frequency: ReviewFrequency.default('AD_HOC'),
  last_reviewed_at: z.string().datetime().optional(),
  next_review_at: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateAiSystemInput = z.infer<typeof CreateAiSystemBody>;

// PATCH: every field optional; at least one must be present. system_key and
// org_id are immutable and intentionally absent.
export const UpdateAiSystemBody = z
  .object({
    name: z.string().min(1).max(500).optional(),
    description: LongText.optional(),
    system_type: SystemType.optional(),
    lifecycle_state: LifecycleState.optional(),
    business_owner: OwnerField.nullable().optional(),
    technical_owner: OwnerField.nullable().optional(),
    legal_owner: OwnerField.nullable().optional(),
    dpo_owner: OwnerField.nullable().optional(),
    intended_purpose: PurposeText.optional(),
    primary_jurisdiction: z.string().min(1).max(64).optional(),
    deployment_environment: DeploymentEnvironment.optional(),
    external_provider_id: z.string().uuid().nullable().optional(),
    regulatory_source_id: z.string().uuid().nullable().optional(),
    control_id: z.string().uuid().nullable().optional(),
    review_frequency: ReviewFrequency.optional(),
    last_reviewed_at: z.string().datetime().nullable().optional(),
    next_review_at: z.string().datetime().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'at least one field is required' });
export type UpdateAiSystemInput = z.infer<typeof UpdateAiSystemBody>;

// ---------------------------------------------------------------------------
// List queries (keyset pagination + filters)
// ---------------------------------------------------------------------------

const Cursor = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before_created_at: z.string().datetime().optional(),
  before_id: z.string().uuid().optional(),
};

const cursorPaired = (d: { before_created_at?: string; before_id?: string }) =>
  (d.before_created_at === undefined) === (d.before_id === undefined);

export const ListSourcesQuery = z
  .object({
    ...Cursor,
    scope: z.enum(['system', 'tenant']).optional(),
    jurisdiction: z.string().min(1).max(64).optional(),
    authority: z.string().min(1).max(200).optional(),
    source_quality: SourceQuality.optional(),
    verification_status: VerificationStatus.optional(),
    legal_status: LegalStatus.optional(),
    q: z.string().min(1).max(200).optional(),
  })
  .refine(cursorPaired, {
    message: 'before_created_at and before_id must be provided together',
    path: ['before_id'],
  });

export const ListControlsQuery = z
  .object({
    ...Cursor,
    scope: z.enum(['system', 'tenant']).optional(),
    domain: z.string().min(1).max(200).optional(),
    capability_type: CapabilityType.optional(),
    implementation_state: ImplementationState.optional(),
    build_decision: BuildDecision.optional(),
    framework_key: FrameworkKey.optional(),
    q: z.string().min(1).max(200).optional(),
  })
  .refine(cursorPaired, {
    message: 'before_created_at and before_id must be provided together',
    path: ['before_id'],
  });

export const ListVersionsQuery = z
  .object({ ...Cursor, change_type: ChangeType.optional() })
  .refine(cursorPaired, {
    message: 'before_created_at and before_id must be provided together',
    path: ['before_id'],
  });

export const ListLinksQuery = z
  .object({ ...Cursor, link_type: LinkType.optional() })
  .refine(cursorPaired, {
    message: 'before_created_at and before_id must be provided together',
    path: ['before_id'],
  });

export const ListMappingsQuery = z
  .object({ ...Cursor, framework_key: FrameworkKey.optional(), mapping_status: MappingStatus.optional() })
  .refine(cursorPaired, {
    message: 'before_created_at and before_id must be provided together',
    path: ['before_id'],
  });

export const ListAiSystemsQuery = z
  .object({
    ...Cursor,
    system_type: SystemType.optional(),
    lifecycle_state: LifecycleState.optional(),
    primary_jurisdiction: z.string().min(1).max(64).optional(),
    deployment_environment: DeploymentEnvironment.optional(),
    q: z.string().min(1).max(200).optional(),
  })
  .refine(cursorPaired, {
    message: 'before_created_at and before_id must be provided together',
    path: ['before_id'],
  });
