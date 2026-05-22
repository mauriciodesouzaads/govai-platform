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
// Provider Registry (PR-R3)
// ---------------------------------------------------------------------------

export const ProviderType = z.enum([
  'MODEL_PROVIDER',
  'CLOUD_PROVIDER',
  'AI_PLATFORM',
  'VECTOR_DATABASE',
  'DATA_PROCESSOR',
  'EVALUATION_TOOL',
  'MONITORING_TOOL',
  'SECURITY_TOOL',
  'WORKFLOW_TOOL',
  'OTHER',
]);

export const ProviderStatus = z.enum([
  'PROPOSED',
  'UNDER_REVIEW',
  'APPROVED',
  'APPROVED_WITH_CONDITIONS',
  'SUSPENDED',
  'RETIRED',
  'REJECTED',
]);

export const DeploymentModel = z.enum([
  'SAAS',
  'API',
  'CLOUD_MARKETPLACE',
  'CUSTOMER_CLOUD',
  'ON_PREMISE',
  'HYBRID',
  'OTHER',
]);

export const DataProcessingRole = z.enum([
  'CONTROLLER',
  'PROCESSOR',
  'SUBPROCESSOR',
  'JOINT_CONTROLLER',
  'NOT_APPLICABLE',
  'TO_BE_DETERMINED',
]);

export const DpaStatus = z.enum([
  'NOT_STARTED',
  'REQUESTED',
  'UNDER_REVIEW',
  'APPROVED',
  'APPROVED_WITH_CONDITIONS',
  'REJECTED',
  'NOT_APPLICABLE',
]);

export const SecurityReviewStatus = z.enum([
  'NOT_STARTED',
  'UNDER_REVIEW',
  'APPROVED',
  'APPROVED_WITH_CONDITIONS',
  'REJECTED',
  'EXPIRED',
]);

export const SubprocessorsReviewStatus = z.enum([
  'NOT_STARTED',
  'UNDER_REVIEW',
  'APPROVED',
  'APPROVED_WITH_CONDITIONS',
  'REJECTED',
  'NOT_APPLICABLE',
]);

export const AiTermsReviewStatus = z.enum([
  'NOT_STARTED',
  'UNDER_REVIEW',
  'APPROVED',
  'APPROVED_WITH_CONDITIONS',
  'REJECTED',
  'NOT_APPLICABLE',
]);

const EmailField = z.string().email().max(320);
const CountryField = z.string().min(1).max(120);

export const CreateProviderBody = z.object({
  provider_key: KeyField,
  name: z.string().min(1).max(500),
  description: LongText.default(''),
  provider_type: ProviderType,
  provider_status: ProviderStatus,
  deployment_model: DeploymentModel,
  data_processing_role: DataProcessingRole,
  primary_jurisdiction: z.string().min(1).max(64).default('BR'),
  headquarters_country: CountryField.optional(),
  website_url: HttpUrl.optional(),
  contact_name: OwnerField.optional(),
  contact_email: EmailField.optional(),
  dpa_status: DpaStatus,
  security_review_status: SecurityReviewStatus,
  subprocessors_review_status: SubprocessorsReviewStatus,
  ai_terms_review_status: AiTermsReviewStatus,
  last_reviewed_at: z.string().datetime().optional(),
  next_review_at: z.string().datetime().optional(),
  review_frequency: ReviewFrequency.default('AD_HOC'),
  regulatory_source_id: z.string().uuid().optional(),
  control_id: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateProviderInput = z.infer<typeof CreateProviderBody>;

// PATCH: every field optional; at least one must be present. provider_key and
// org_id are immutable and intentionally absent.
export const UpdateProviderBody = z
  .object({
    name: z.string().min(1).max(500).optional(),
    description: LongText.optional(),
    provider_type: ProviderType.optional(),
    provider_status: ProviderStatus.optional(),
    deployment_model: DeploymentModel.optional(),
    data_processing_role: DataProcessingRole.optional(),
    primary_jurisdiction: z.string().min(1).max(64).optional(),
    headquarters_country: CountryField.nullable().optional(),
    website_url: HttpUrl.nullable().optional(),
    contact_name: OwnerField.nullable().optional(),
    contact_email: EmailField.nullable().optional(),
    dpa_status: DpaStatus.optional(),
    security_review_status: SecurityReviewStatus.optional(),
    subprocessors_review_status: SubprocessorsReviewStatus.optional(),
    ai_terms_review_status: AiTermsReviewStatus.optional(),
    last_reviewed_at: z.string().datetime().nullable().optional(),
    next_review_at: z.string().datetime().nullable().optional(),
    review_frequency: ReviewFrequency.optional(),
    regulatory_source_id: z.string().uuid().nullable().optional(),
    control_id: z.string().uuid().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'at least one field is required' });
export type UpdateProviderInput = z.infer<typeof UpdateProviderBody>;

// ---------------------------------------------------------------------------
// Model Registry (PR-R4)
// ---------------------------------------------------------------------------

export const ModelType = z.enum([
  'FOUNDATION_MODEL',
  'FINE_TUNED_MODEL',
  'EMBEDDING_MODEL',
  'CLASSIFIER',
  'RERANKER',
  'RULE_BASED_MODEL',
  'ENSEMBLE',
  'THIRD_PARTY_MODEL',
  'OTHER',
]);

export const ModelStatus = z.enum([
  'PROPOSED',
  'UNDER_EVALUATION',
  'APPROVED',
  'APPROVED_WITH_CONDITIONS',
  'ACTIVE',
  'SUSPENDED',
  'RETIRED',
  'REJECTED',
]);

export const ModelVersionStatus = z.enum([
  'DRAFT',
  'UNDER_EVALUATION',
  'APPROVED',
  'ACTIVE',
  'DEPRECATED',
  'RETIRED',
  'REJECTED',
]);

export const ModelLinkStatus = z.enum(['PROPOSED', 'ACTIVE', 'SUSPENDED', 'RETIRED']);

export const ModelUsageRole = z.enum([
  'PRIMARY_MODEL',
  'FALLBACK_MODEL',
  'EMBEDDING_MODEL',
  'RERANKING_MODEL',
  'CLASSIFICATION_MODEL',
  'SAFETY_MODEL',
  'EVALUATION_MODEL',
  'OTHER',
]);

// Artifact/data URIs are provenance metadata only (may be s3://, gs://, hf://,
// internal registry URIs, …), so this is a bounded string rather than an http URL.
const ProvenanceUri = z.string().min(1).max(2048);
const SummaryText = z.string().max(8000);

export const CreateModelBody = z.object({
  model_key: KeyField,
  name: z.string().min(1).max(500),
  description: LongText.default(''),
  model_type: ModelType,
  model_status: ModelStatus,
  provider_id: z.string().uuid(),
  primary_ai_system_id: z.string().uuid().optional(),
  primary_jurisdiction: z.string().min(1).max(64).default('BR'),
  business_owner: OwnerField.optional(),
  technical_owner: OwnerField.optional(),
  legal_owner: OwnerField.optional(),
  dpo_owner: OwnerField.optional(),
  intended_use: SummaryText.default(''),
  prohibited_uses: SummaryText.default(''),
  training_data_summary: SummaryText.default(''),
  evaluation_summary: SummaryText.default(''),
  human_oversight_summary: SummaryText.default(''),
  last_reviewed_at: z.string().datetime().optional(),
  next_review_at: z.string().datetime().optional(),
  review_frequency: ReviewFrequency.default('AD_HOC'),
  regulatory_source_id: z.string().uuid().optional(),
  control_id: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateModelInput = z.infer<typeof CreateModelBody>;

// PATCH: every field optional; ≥1 required. model_key and org_id are immutable.
export const UpdateModelBody = z
  .object({
    name: z.string().min(1).max(500).optional(),
    description: LongText.optional(),
    model_type: ModelType.optional(),
    model_status: ModelStatus.optional(),
    provider_id: z.string().uuid().optional(),
    primary_ai_system_id: z.string().uuid().nullable().optional(),
    primary_jurisdiction: z.string().min(1).max(64).optional(),
    business_owner: OwnerField.nullable().optional(),
    technical_owner: OwnerField.nullable().optional(),
    legal_owner: OwnerField.nullable().optional(),
    dpo_owner: OwnerField.nullable().optional(),
    intended_use: SummaryText.optional(),
    prohibited_uses: SummaryText.optional(),
    training_data_summary: SummaryText.optional(),
    evaluation_summary: SummaryText.optional(),
    human_oversight_summary: SummaryText.optional(),
    last_reviewed_at: z.string().datetime().nullable().optional(),
    next_review_at: z.string().datetime().nullable().optional(),
    review_frequency: ReviewFrequency.optional(),
    regulatory_source_id: z.string().uuid().nullable().optional(),
    control_id: z.string().uuid().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'at least one field is required' });
export type UpdateModelInput = z.infer<typeof UpdateModelBody>;

export const CreateModelVersionBody = z.object({
  version_key: KeyField,
  version_label: z.string().min(1).max(200),
  version_status: ModelVersionStatus,
  provider_model_name: z.string().min(1).max(300).optional(),
  provider_model_version: z.string().min(1).max(200).optional(),
  artifact_uri: ProvenanceUri.optional(),
  artifact_hash: HashField.optional(),
  training_data_hash: HashField.optional(),
  evaluation_dataset_hash: HashField.optional(),
  evaluation_score_summary: SummaryText.default(''),
  release_notes: SummaryText.default(''),
  approval_reference: z.string().min(1).max(500).optional(),
  approved_at: z.string().datetime().optional(),
  approved_by_user_id: z.string().uuid().optional(),
  retired_at: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateModelVersionInput = z.infer<typeof CreateModelVersionBody>;

// PATCH: version_key, model_id, and org_id are immutable.
export const UpdateModelVersionBody = z
  .object({
    version_label: z.string().min(1).max(200).optional(),
    version_status: ModelVersionStatus.optional(),
    provider_model_name: z.string().min(1).max(300).nullable().optional(),
    provider_model_version: z.string().min(1).max(200).nullable().optional(),
    artifact_uri: ProvenanceUri.nullable().optional(),
    artifact_hash: HashField.nullable().optional(),
    training_data_hash: HashField.nullable().optional(),
    evaluation_dataset_hash: HashField.nullable().optional(),
    evaluation_score_summary: SummaryText.optional(),
    release_notes: SummaryText.optional(),
    approval_reference: z.string().min(1).max(500).nullable().optional(),
    approved_at: z.string().datetime().nullable().optional(),
    approved_by_user_id: z.string().uuid().nullable().optional(),
    retired_at: z.string().datetime().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'at least one field is required' });
export type UpdateModelVersionInput = z.infer<typeof UpdateModelVersionBody>;

export const CreateAiSystemModelLinkBody = z.object({
  ai_system_id: z.string().uuid(),
  model_id: z.string().uuid(),
  model_version_id: z.string().uuid(),
  link_status: ModelLinkStatus,
  usage_role: ModelUsageRole,
  deployment_environment: DeploymentEnvironment,
  effective_from: z.string().datetime().optional(),
  effective_to: z.string().datetime().optional(),
  rationale: SummaryText.default(''),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateAiSystemModelLinkInput = z.infer<typeof CreateAiSystemModelLinkBody>;

// PATCH: the binding identity (ai_system_id, model_id, model_version_id,
// usage_role, deployment_environment) is immutable; only posture/timing fields move.
export const UpdateAiSystemModelLinkBody = z
  .object({
    link_status: ModelLinkStatus.optional(),
    effective_from: z.string().datetime().nullable().optional(),
    effective_to: z.string().datetime().nullable().optional(),
    rationale: SummaryText.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'at least one field is required' });
export type UpdateAiSystemModelLinkInput = z.infer<typeof UpdateAiSystemModelLinkBody>;

// ---------------------------------------------------------------------------
// Agent Registry (PR-R5)
// ---------------------------------------------------------------------------

export const AgentType = z.enum([
  'LLM_AGENT',
  'WORKFLOW_AGENT',
  'TOOL_USING_AGENT',
  'RETRIEVAL_AGENT',
  'ORCHESTRATOR_AGENT',
  'MONITORING_AGENT',
  'EVALUATION_AGENT',
  'HUMAN_ASSISTED_AGENT',
  'OTHER',
]);

export const AgentStatus = z.enum([
  'PROPOSED',
  'UNDER_EVALUATION',
  'APPROVED',
  'APPROVED_WITH_CONDITIONS',
  'ACTIVE',
  'SUSPENDED',
  'RETIRED',
  'REJECTED',
]);

export const AutonomyLevel = z.enum([
  'HUMAN_ASSISTED',
  'HUMAN_APPROVAL_REQUIRED',
  'SUPERVISED_AUTONOMOUS',
  'AUTONOMOUS_WITH_GUARDRAILS',
  'AUDIT_ONLY',
]);

export const ExecutionBoundary = z.enum([
  'GOVAI_WORKROOM',
  'PROVIDER_NATIVE',
  'CUSTOMER_ENVIRONMENT',
  'THIRD_PARTY_RUNTIME',
  'SANDBOXED_TOOL_RUNTIME',
  'NOT_DEPLOYED',
  'OTHER',
]);

export const HumanOversightMode = z.enum([
  'HUMAN_IN_LOOP',
  'HUMAN_ON_LOOP',
  'HUMAN_REVIEW_REQUIRED',
  'ESCALATION_ONLY',
  'NOT_APPLICABLE',
]);

export const AgentVersionStatus = z.enum([
  'DRAFT',
  'UNDER_EVALUATION',
  'APPROVED',
  'ACTIVE',
  'DEPRECATED',
  'RETIRED',
  'REJECTED',
]);

export const CapabilityCategory = z.enum([
  'READ_ONLY',
  'WRITE_ACTION',
  'EXTERNAL_SIDE_EFFECT',
  'DATA_ACCESS',
  'FILESYSTEM',
  'NETWORK',
  'CODE_EXECUTION',
  'BROWSER',
  'COMMUNICATION',
  'ADMINISTRATIVE',
  'EVALUATION',
  'MONITORING',
  'OTHER',
]);

export const CapabilityStatus = z.enum([
  'PROPOSED',
  'UNDER_REVIEW',
  'APPROVED',
  'APPROVED_WITH_CONDITIONS',
  'SUSPENDED',
  'RETIRED',
  'REJECTED',
]);

export const RiskPosture = z.enum(['LOW', 'MODERATE', 'HIGH', 'PROHIBITED', 'UNKNOWN']);

// Query-string boolean: accepts only the literal "true"/"false" tokens.
const QueryBool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const CreateAgentBody = z
  .object({
    agent_key: KeyField,
    name: z.string().min(1).max(500),
    description: LongText.default(''),
    agent_type: AgentType,
    agent_status: AgentStatus,
    autonomy_level: AutonomyLevel,
    execution_boundary: ExecutionBoundary,
    human_oversight_mode: HumanOversightMode,
    provider_id: z.string().uuid().optional(),
    primary_ai_system_id: z.string().uuid().optional(),
    primary_model_id: z.string().uuid().optional(),
    primary_model_version_id: z.string().uuid().optional(),
    primary_jurisdiction: z.string().min(1).max(64).default('BR'),
    business_owner: OwnerField.optional(),
    technical_owner: OwnerField.optional(),
    legal_owner: OwnerField.optional(),
    dpo_owner: OwnerField.optional(),
    intended_purpose: SummaryText.default(''),
    prohibited_uses: SummaryText.default(''),
    capability_summary: SummaryText.default(''),
    tool_access_summary: SummaryText.default(''),
    data_access_summary: SummaryText.default(''),
    human_oversight_summary: SummaryText.default(''),
    last_reviewed_at: z.string().datetime().optional(),
    next_review_at: z.string().datetime().optional(),
    review_frequency: ReviewFrequency.default('AD_HOC'),
    regulatory_source_id: z.string().uuid().optional(),
    control_id: z.string().uuid().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  // A primary model version is meaningless without its model.
  .refine((d) => !(d.primary_model_version_id !== undefined && d.primary_model_id === undefined), {
    message: 'primary_model_version_id requires primary_model_id',
    path: ['primary_model_id'],
  });
export type CreateAgentInput = z.infer<typeof CreateAgentBody>;

// PATCH: every field optional; ≥1 required. agent_key and org_id are immutable.
// The version-requires-model rule depends on the merged (existing + patch) state
// and is enforced in the service layer and by the DB CHECK; here we only catch
// the in-body contradiction of setting a version while clearing the model.
export const UpdateAgentBody = z
  .object({
    name: z.string().min(1).max(500).optional(),
    description: LongText.optional(),
    agent_type: AgentType.optional(),
    agent_status: AgentStatus.optional(),
    autonomy_level: AutonomyLevel.optional(),
    execution_boundary: ExecutionBoundary.optional(),
    human_oversight_mode: HumanOversightMode.optional(),
    provider_id: z.string().uuid().nullable().optional(),
    primary_ai_system_id: z.string().uuid().nullable().optional(),
    primary_model_id: z.string().uuid().nullable().optional(),
    primary_model_version_id: z.string().uuid().nullable().optional(),
    primary_jurisdiction: z.string().min(1).max(64).optional(),
    business_owner: OwnerField.nullable().optional(),
    technical_owner: OwnerField.nullable().optional(),
    legal_owner: OwnerField.nullable().optional(),
    dpo_owner: OwnerField.nullable().optional(),
    intended_purpose: SummaryText.optional(),
    prohibited_uses: SummaryText.optional(),
    capability_summary: SummaryText.optional(),
    tool_access_summary: SummaryText.optional(),
    data_access_summary: SummaryText.optional(),
    human_oversight_summary: SummaryText.optional(),
    last_reviewed_at: z.string().datetime().nullable().optional(),
    next_review_at: z.string().datetime().nullable().optional(),
    review_frequency: ReviewFrequency.optional(),
    regulatory_source_id: z.string().uuid().nullable().optional(),
    control_id: z.string().uuid().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'at least one field is required' })
  // Setting a version while explicitly clearing the model in the same patch.
  .refine((d) => !(typeof d.primary_model_version_id === 'string' && d.primary_model_id === null), {
    message: 'primary_model_version_id requires primary_model_id',
    path: ['primary_model_id'],
  });
export type UpdateAgentInput = z.infer<typeof UpdateAgentBody>;

export const CreateAgentVersionBody = z.object({
  version_key: KeyField,
  version_label: z.string().min(1).max(200),
  version_status: AgentVersionStatus,
  configuration_hash: HashField.optional(),
  prompt_policy_hash: HashField.optional(),
  tool_manifest_hash: HashField.optional(),
  sandbox_policy_hash: HashField.optional(),
  capability_manifest_hash: HashField.optional(),
  evaluation_score_summary: SummaryText.default(''),
  release_notes: SummaryText.default(''),
  approval_reference: z.string().min(1).max(500).optional(),
  approved_at: z.string().datetime().optional(),
  approved_by_user_id: z.string().uuid().optional(),
  retired_at: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateAgentVersionInput = z.infer<typeof CreateAgentVersionBody>;

export const UpdateAgentVersionBody = z
  .object({
    version_label: z.string().min(1).max(200).optional(),
    version_status: AgentVersionStatus.optional(),
    configuration_hash: HashField.nullable().optional(),
    prompt_policy_hash: HashField.nullable().optional(),
    tool_manifest_hash: HashField.nullable().optional(),
    sandbox_policy_hash: HashField.nullable().optional(),
    capability_manifest_hash: HashField.nullable().optional(),
    evaluation_score_summary: SummaryText.optional(),
    release_notes: SummaryText.optional(),
    approval_reference: z.string().min(1).max(500).nullable().optional(),
    approved_at: z.string().datetime().nullable().optional(),
    approved_by_user_id: z.string().uuid().nullable().optional(),
    retired_at: z.string().datetime().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'at least one field is required' });
export type UpdateAgentVersionInput = z.infer<typeof UpdateAgentVersionBody>;

export const CreateAgentCapabilityBindingBody = z.object({
  agent_id: z.string().uuid(),
  agent_version_id: z.string().uuid().optional(),
  capability_key: KeyField,
  capability_name: z.string().min(1).max(500),
  capability_category: CapabilityCategory,
  capability_status: CapabilityStatus,
  risk_posture: RiskPosture,
  hard_deny_floor_expected: z.boolean().default(true),
  approval_required: z.boolean().default(false),
  evidence_required: z.boolean().default(true),
  scope_summary: SummaryText.default(''),
  restriction_summary: SummaryText.default(''),
  rationale: SummaryText.default(''),
  regulatory_source_id: z.string().uuid().optional(),
  control_id: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateAgentCapabilityBindingInput = z.infer<typeof CreateAgentCapabilityBindingBody>;

// PATCH: the binding identity (agent_id, agent_version_id, capability_key) is
// immutable; only posture/evidence/description fields move.
export const UpdateAgentCapabilityBindingBody = z
  .object({
    capability_name: z.string().min(1).max(500).optional(),
    capability_category: CapabilityCategory.optional(),
    capability_status: CapabilityStatus.optional(),
    risk_posture: RiskPosture.optional(),
    hard_deny_floor_expected: z.boolean().optional(),
    approval_required: z.boolean().optional(),
    evidence_required: z.boolean().optional(),
    scope_summary: SummaryText.optional(),
    restriction_summary: SummaryText.optional(),
    rationale: SummaryText.optional(),
    regulatory_source_id: z.string().uuid().nullable().optional(),
    control_id: z.string().uuid().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'at least one field is required' });
export type UpdateAgentCapabilityBindingInput = z.infer<typeof UpdateAgentCapabilityBindingBody>;

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

export const ListProvidersQuery = z
  .object({
    ...Cursor,
    provider_type: ProviderType.optional(),
    provider_status: ProviderStatus.optional(),
    deployment_model: DeploymentModel.optional(),
    data_processing_role: DataProcessingRole.optional(),
    primary_jurisdiction: z.string().min(1).max(64).optional(),
    security_review_status: SecurityReviewStatus.optional(),
    dpa_status: DpaStatus.optional(),
    q: z.string().min(1).max(200).optional(),
  })
  .refine(cursorPaired, {
    message: 'before_created_at and before_id must be provided together',
    path: ['before_id'],
  });

export const ListModelsQuery = z
  .object({
    ...Cursor,
    model_type: ModelType.optional(),
    model_status: ModelStatus.optional(),
    provider_id: z.string().uuid().optional(),
    primary_ai_system_id: z.string().uuid().optional(),
    primary_jurisdiction: z.string().min(1).max(64).optional(),
    q: z.string().min(1).max(200).optional(),
  })
  .refine(cursorPaired, {
    message: 'before_created_at and before_id must be provided together',
    path: ['before_id'],
  });

export const ListModelVersionsQuery = z
  .object({
    ...Cursor,
    version_status: ModelVersionStatus.optional(),
    q: z.string().min(1).max(200).optional(),
  })
  .refine(cursorPaired, {
    message: 'before_created_at and before_id must be provided together',
    path: ['before_id'],
  });

export const ListAiSystemModelLinksQuery = z
  .object({
    ...Cursor,
    ai_system_id: z.string().uuid().optional(),
    model_id: z.string().uuid().optional(),
    model_version_id: z.string().uuid().optional(),
    link_status: ModelLinkStatus.optional(),
    usage_role: ModelUsageRole.optional(),
    deployment_environment: DeploymentEnvironment.optional(),
  })
  .refine(cursorPaired, {
    message: 'before_created_at and before_id must be provided together',
    path: ['before_id'],
  });

export const ListAgentsQuery = z
  .object({
    ...Cursor,
    agent_type: AgentType.optional(),
    agent_status: AgentStatus.optional(),
    autonomy_level: AutonomyLevel.optional(),
    execution_boundary: ExecutionBoundary.optional(),
    provider_id: z.string().uuid().optional(),
    primary_ai_system_id: z.string().uuid().optional(),
    primary_model_id: z.string().uuid().optional(),
    primary_jurisdiction: z.string().min(1).max(64).optional(),
    q: z.string().min(1).max(200).optional(),
  })
  .refine(cursorPaired, {
    message: 'before_created_at and before_id must be provided together',
    path: ['before_id'],
  });

export const ListAgentVersionsQuery = z
  .object({
    ...Cursor,
    version_status: AgentVersionStatus.optional(),
    q: z.string().min(1).max(200).optional(),
  })
  .refine(cursorPaired, {
    message: 'before_created_at and before_id must be provided together',
    path: ['before_id'],
  });

export const ListAgentCapabilityBindingsQuery = z
  .object({
    ...Cursor,
    agent_id: z.string().uuid().optional(),
    agent_version_id: z.string().uuid().optional(),
    capability_category: CapabilityCategory.optional(),
    capability_status: CapabilityStatus.optional(),
    risk_posture: RiskPosture.optional(),
    hard_deny_floor_expected: QueryBool.optional(),
    approval_required: QueryBool.optional(),
    evidence_required: QueryBool.optional(),
    q: z.string().min(1).max(200).optional(),
  })
  .refine(cursorPaired, {
    message: 'before_created_at and before_id must be provided together',
    path: ['before_id'],
  });
