// /v1/regulatory/* — Regulatory Core PR-R1 (issue #59, umbrella #33).
//
// Native source registry + control catalog HTTP surface. Reads require an
// authenticated tenant identity; mutations require an admin or
// data_protection_officer role. Tenants operate only on their own
// (scope='tenant') rows and may read system (scope='system') rows. Every
// mutation persists real rows and emits a real audit event onto the existing
// `policy` ChainCategory (see ../regulatory/service.ts).
//
// No crawler, scheduler, automated fetch, diff engine, or connector ships here.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { hasAnyRole } from '@govai/core-identity';
import { authenticateApiKey, AuthError, type AuthIdentity } from '../pipeline/auth.js';
import {
  RegulatoryError,
  createSource,
  updateSource,
  getVisibleSource,
  listSources,
  createSourceVersion,
  listSourceVersions,
  createSourceRelationship,
  createControl,
  updateControl,
  getVisibleControl,
  listControls,
  createControlSourceLink,
  listControlSourceLinks,
  createFrameworkMapping,
  listFrameworkMappings,
  createAiSystem,
  getVisibleAiSystem,
  updateAiSystem,
  listAiSystems,
  createProvider,
  getVisibleProvider,
  updateProvider,
  listProviders,
  createModel,
  getVisibleModel,
  updateModel,
  listModels,
  createModelVersion,
  getVisibleModelVersion,
  updateModelVersion,
  listModelVersions,
  createAiSystemModelLink,
  getVisibleAiSystemModelLink,
  updateAiSystemModelLink,
  listAiSystemModelLinks,
  createAgent,
  getVisibleAgent,
  updateAgent,
  listAgents,
  createAgentVersion,
  getVisibleAgentVersion,
  updateAgentVersion,
  listAgentVersions,
  createAgentCapabilityBinding,
  getVisibleAgentCapabilityBinding,
  updateAgentCapabilityBinding,
  listAgentCapabilityBindings,
  createUseCase,
  getVisibleUseCase,
  updateUseCase,
  listUseCases,
  createUseCaseAssetLink,
  getVisibleUseCaseAssetLink,
  updateUseCaseAssetLink,
  listUseCaseAssetLinks,
  createUseCaseReview,
  getVisibleUseCaseReview,
  updateUseCaseReview,
  listUseCaseReviews,
  createRiskMethod,
  getVisibleRiskMethod,
  updateRiskMethod,
  listRiskMethods,
  evaluateRiskClassification,
  createRiskClassification,
  getVisibleRiskClassification,
  updateRiskClassification,
  listRiskClassifications,
  getVisibleRiskClassificationFactor,
  listRiskClassificationFactors,
  createReclassificationTrigger,
  getVisibleReclassificationTrigger,
  updateReclassificationTrigger,
  listReclassificationTriggers,
  createHighRiskReview,
  getVisibleHighRiskReview,
  updateHighRiskReview,
  submitHighRiskReview,
  cancelHighRiskReview,
  listHighRiskReviews,
  createHighRiskReviewEvidence,
  getVisibleHighRiskReviewEvidence,
  updateHighRiskReviewEvidence,
  listHighRiskReviewEvidence,
  createHighRiskReviewAssignment,
  updateHighRiskReviewAssignment,
  listHighRiskReviewAssignments,
  createHighRiskReviewDecision,
  getVisibleHighRiskReviewDecision,
  listHighRiskReviewDecisions,
  type Ctx,
  type Cursor,
  type SourceRow,
  type VersionRow,
  type RelationshipRow,
  type ControlRow,
  type LinkRow,
  type MappingRow,
  type AiSystemRow,
  type ProviderRow,
  type ModelRow,
  type ModelVersionRow,
  type AiSystemModelLinkRow,
  type AgentRow,
  type AgentVersionRow,
  type AgentCapabilityBindingRow,
  type UseCaseRow,
  type UseCaseAssetLinkRow,
  type UseCaseReviewRow,
  type RiskMethodRow,
  type RiskClassificationRow,
  type RiskClassificationFactorRow,
  type ReclassificationTriggerRow,
  type HighRiskReviewRow,
  type HighRiskReviewEvidenceRow,
  type HighRiskReviewAssignmentRow,
  type HighRiskReviewDecisionRow,
} from '../regulatory/service.js';
import {
  CreateSourceBody,
  UpdateSourceBody,
  CreateVersionBody,
  CreateRelationshipBody,
  CreateControlBody,
  UpdateControlBody,
  CreateSourceLinkBody,
  CreateFrameworkMappingBody,
  CreateAiSystemBody,
  UpdateAiSystemBody,
  CreateProviderBody,
  UpdateProviderBody,
  CreateModelBody,
  UpdateModelBody,
  CreateModelVersionBody,
  UpdateModelVersionBody,
  CreateAiSystemModelLinkBody,
  UpdateAiSystemModelLinkBody,
  CreateAgentBody,
  UpdateAgentBody,
  CreateAgentVersionBody,
  UpdateAgentVersionBody,
  CreateAgentCapabilityBindingBody,
  UpdateAgentCapabilityBindingBody,
  CreateUseCaseBody,
  UpdateUseCaseBody,
  CreateUseCaseAssetLinkBody,
  UpdateUseCaseAssetLinkBody,
  CreateUseCaseReviewBody,
  UpdateUseCaseReviewBody,
  ListSourcesQuery,
  ListControlsQuery,
  ListVersionsQuery,
  ListLinksQuery,
  ListMappingsQuery,
  ListAiSystemsQuery,
  ListProvidersQuery,
  ListModelsQuery,
  ListModelVersionsQuery,
  ListAiSystemModelLinksQuery,
  ListAgentsQuery,
  ListAgentVersionsQuery,
  ListAgentCapabilityBindingsQuery,
  ListUseCasesQuery,
  ListUseCaseAssetLinksQuery,
  ListUseCaseReviewsQuery,
  CreateRiskMethodBody,
  UpdateRiskMethodBody,
  ListRiskMethodsQuery,
  EvaluateRiskClassificationBody,
  CreateRiskClassificationBody,
  UpdateRiskClassificationBody,
  ListRiskClassificationsQuery,
  ListRiskClassificationFactorsQuery,
  CreateReclassificationTriggerBody,
  UpdateReclassificationTriggerBody,
  ListReclassificationTriggersQuery,
  CreateHighRiskReviewBody,
  UpdateHighRiskReviewBody,
  SubmitHighRiskReviewBody,
  CancelHighRiskReviewBody,
  CreateHighRiskReviewEvidenceBody,
  UpdateHighRiskReviewEvidenceBody,
  CreateHighRiskReviewAssignmentBody,
  UpdateHighRiskReviewAssignmentBody,
  CreateHighRiskReviewDecisionBody,
  ListHighRiskReviewsQuery,
  ListHighRiskReviewEvidenceQuery,
  ListHighRiskReviewAssignmentsQuery,
  ListHighRiskReviewDecisionsQuery,
} from '../regulatory/validation.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRITE_ROLES = ['admin', 'data_protection_officer'] as const;

function extractApiKey(req: FastifyRequest): string {
  const header = req.headers['x-govai-api-key'];
  if (typeof header === 'string') return header;
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice('Bearer '.length);
  return '';
}

async function authenticate(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthIdentity | null> {
  const apiKey = extractApiKey(req);
  const client = await app.govai.pool.connect();
  try {
    return await authenticateApiKey(client, apiKey);
  } catch (err) {
    if (err instanceof AuthError) {
      reply.code(err.status);
      reply.send({ error: 'auth_error', message: err.message });
      return null;
    }
    throw err;
  } finally {
    client.release();
  }
}

type TenantOutcome<T> = { ok: true; value: T } | { ok: false; status: number; body: unknown };

async function runTenant<T>(
  app: FastifyInstance,
  identity: AuthIdentity,
  fn: (ctx: Ctx) => Promise<T>,
): Promise<TenantOutcome<T>> {
  const client = await app.govai.pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await setLocalAppOrgId(client, identity.org_id);
      const ctx: Ctx = {
        client,
        kms: app.govai.kms,
        actor: { orgId: identity.org_id, userId: identity.user_id },
      };
      const value = await fn(ctx);
      await client.query('COMMIT');
      return { ok: true, value };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (err instanceof RegulatoryError) {
        return {
          ok: false,
          status: err.status,
          body: { error: err.code, ...(err.details ? { details: err.details } : {}) },
        };
      }
      throw err;
    }
  } finally {
    client.release();
  }
}

function zodError(reply: FastifyReply, parsed: { error: { issues: { path: PropertyKey[]; message: string }[] } }) {
  reply.code(400);
  return {
    error: 'invalid_request',
    issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function serializeSource(r: SourceRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    scope: r.scope,
    source_key: r.source_key,
    title: r.title,
    jurisdiction: r.jurisdiction,
    authority: r.authority,
    instrument_type: r.instrument_type,
    source_quality: r.source_quality,
    verification_status: r.verification_status,
    legal_status: r.legal_status,
    official_url: r.official_url,
    publication_date: r.publication_date,
    effective_date: r.effective_date,
    last_verified_at: iso(r.last_verified_at),
    next_review_at: iso(r.next_review_at),
    review_frequency: r.review_frequency,
    legal_owner: r.legal_owner,
    product_owner: r.product_owner,
    notes: r.notes,
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    updated_by_user_id: r.updated_by_user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeVersion(r: VersionRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    source_id: r.source_id,
    version_number: Number(r.version_number),
    version_key: r.version_key,
    source_url: r.source_url,
    retrieved_at: iso(r.retrieved_at),
    verified_at: iso(r.verified_at),
    content_hash: r.content_hash,
    diff_hash: r.diff_hash,
    archived_snapshot_hash: r.archived_snapshot_hash,
    change_type: r.change_type,
    summary: r.summary,
    verification_status: r.verification_status,
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    created_at: r.created_at.toISOString(),
  };
}

function serializeRelationship(r: RelationshipRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    from_source_id: r.from_source_id,
    to_source_id: r.to_source_id,
    relationship_type: r.relationship_type,
    notes: r.notes,
    created_by_user_id: r.created_by_user_id,
    created_at: r.created_at.toISOString(),
  };
}

function serializeControl(r: ControlRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    scope: r.scope,
    control_key: r.control_key,
    domain: r.domain,
    name: r.name,
    description: r.description,
    capability_type: r.capability_type,
    implementation_state: r.implementation_state,
    build_decision: r.build_decision,
    automation_level: r.automation_level,
    owner_role: r.owner_role,
    review_frequency: r.review_frequency,
    evidence_required: r.evidence_required,
    current_govai_primitive: r.current_govai_primitive,
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    updated_by_user_id: r.updated_by_user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeLink(r: LinkRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    control_id: r.control_id,
    source_id: r.source_id,
    link_type: r.link_type,
    requirement_ref: r.requirement_ref,
    notes: r.notes,
    created_by_user_id: r.created_by_user_id,
    created_at: r.created_at.toISOString(),
  };
}

function serializeMapping(r: MappingRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    control_id: r.control_id,
    framework_key: r.framework_key,
    requirement_ref: r.requirement_ref,
    requirement_title: r.requirement_title,
    mapping_status: r.mapping_status,
    source_id: r.source_id,
    notes: r.notes,
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    created_at: r.created_at.toISOString(),
  };
}

function serializeAiSystem(r: AiSystemRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    system_key: r.system_key,
    name: r.name,
    description: r.description,
    system_type: r.system_type,
    lifecycle_state: r.lifecycle_state,
    business_owner: r.business_owner,
    technical_owner: r.technical_owner,
    legal_owner: r.legal_owner,
    dpo_owner: r.dpo_owner,
    intended_purpose: r.intended_purpose,
    primary_jurisdiction: r.primary_jurisdiction,
    deployment_environment: r.deployment_environment,
    external_provider_id: r.external_provider_id,
    regulatory_source_id: r.regulatory_source_id,
    control_id: r.control_id,
    review_frequency: r.review_frequency,
    last_reviewed_at: iso(r.last_reviewed_at),
    next_review_at: iso(r.next_review_at),
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    updated_by_user_id: r.updated_by_user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeProvider(r: ProviderRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    provider_key: r.provider_key,
    name: r.name,
    description: r.description,
    provider_type: r.provider_type,
    provider_status: r.provider_status,
    deployment_model: r.deployment_model,
    data_processing_role: r.data_processing_role,
    primary_jurisdiction: r.primary_jurisdiction,
    headquarters_country: r.headquarters_country,
    website_url: r.website_url,
    contact_name: r.contact_name,
    contact_email: r.contact_email,
    dpa_status: r.dpa_status,
    security_review_status: r.security_review_status,
    subprocessors_review_status: r.subprocessors_review_status,
    ai_terms_review_status: r.ai_terms_review_status,
    last_reviewed_at: iso(r.last_reviewed_at),
    next_review_at: iso(r.next_review_at),
    review_frequency: r.review_frequency,
    regulatory_source_id: r.regulatory_source_id,
    control_id: r.control_id,
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    updated_by_user_id: r.updated_by_user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeModel(r: ModelRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    model_key: r.model_key,
    name: r.name,
    description: r.description,
    model_type: r.model_type,
    model_status: r.model_status,
    provider_id: r.provider_id,
    primary_ai_system_id: r.primary_ai_system_id,
    primary_jurisdiction: r.primary_jurisdiction,
    business_owner: r.business_owner,
    technical_owner: r.technical_owner,
    legal_owner: r.legal_owner,
    dpo_owner: r.dpo_owner,
    intended_use: r.intended_use,
    prohibited_uses: r.prohibited_uses,
    training_data_summary: r.training_data_summary,
    evaluation_summary: r.evaluation_summary,
    human_oversight_summary: r.human_oversight_summary,
    last_reviewed_at: iso(r.last_reviewed_at),
    next_review_at: iso(r.next_review_at),
    review_frequency: r.review_frequency,
    regulatory_source_id: r.regulatory_source_id,
    control_id: r.control_id,
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    updated_by_user_id: r.updated_by_user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeModelVersion(r: ModelVersionRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    model_id: r.model_id,
    version_key: r.version_key,
    version_label: r.version_label,
    version_status: r.version_status,
    provider_model_name: r.provider_model_name,
    provider_model_version: r.provider_model_version,
    artifact_uri: r.artifact_uri,
    artifact_hash: r.artifact_hash,
    training_data_hash: r.training_data_hash,
    evaluation_dataset_hash: r.evaluation_dataset_hash,
    evaluation_score_summary: r.evaluation_score_summary,
    release_notes: r.release_notes,
    approval_reference: r.approval_reference,
    approved_at: iso(r.approved_at),
    approved_by_user_id: r.approved_by_user_id,
    retired_at: iso(r.retired_at),
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    updated_by_user_id: r.updated_by_user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeAiSystemModelLink(r: AiSystemModelLinkRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    ai_system_id: r.ai_system_id,
    model_id: r.model_id,
    model_version_id: r.model_version_id,
    link_status: r.link_status,
    usage_role: r.usage_role,
    deployment_environment: r.deployment_environment,
    effective_from: iso(r.effective_from),
    effective_to: iso(r.effective_to),
    rationale: r.rationale,
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    updated_by_user_id: r.updated_by_user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeAgent(r: AgentRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    agent_key: r.agent_key,
    name: r.name,
    description: r.description,
    agent_type: r.agent_type,
    agent_status: r.agent_status,
    autonomy_level: r.autonomy_level,
    execution_boundary: r.execution_boundary,
    human_oversight_mode: r.human_oversight_mode,
    provider_id: r.provider_id,
    primary_ai_system_id: r.primary_ai_system_id,
    primary_model_id: r.primary_model_id,
    primary_model_version_id: r.primary_model_version_id,
    primary_jurisdiction: r.primary_jurisdiction,
    business_owner: r.business_owner,
    technical_owner: r.technical_owner,
    legal_owner: r.legal_owner,
    dpo_owner: r.dpo_owner,
    intended_purpose: r.intended_purpose,
    prohibited_uses: r.prohibited_uses,
    capability_summary: r.capability_summary,
    tool_access_summary: r.tool_access_summary,
    data_access_summary: r.data_access_summary,
    human_oversight_summary: r.human_oversight_summary,
    last_reviewed_at: iso(r.last_reviewed_at),
    next_review_at: iso(r.next_review_at),
    review_frequency: r.review_frequency,
    regulatory_source_id: r.regulatory_source_id,
    control_id: r.control_id,
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    updated_by_user_id: r.updated_by_user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeAgentVersion(r: AgentVersionRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    agent_id: r.agent_id,
    version_key: r.version_key,
    version_label: r.version_label,
    version_status: r.version_status,
    configuration_hash: r.configuration_hash,
    prompt_policy_hash: r.prompt_policy_hash,
    tool_manifest_hash: r.tool_manifest_hash,
    sandbox_policy_hash: r.sandbox_policy_hash,
    capability_manifest_hash: r.capability_manifest_hash,
    evaluation_score_summary: r.evaluation_score_summary,
    release_notes: r.release_notes,
    approval_reference: r.approval_reference,
    approved_at: iso(r.approved_at),
    approved_by_user_id: r.approved_by_user_id,
    retired_at: iso(r.retired_at),
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    updated_by_user_id: r.updated_by_user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeAgentCapabilityBinding(r: AgentCapabilityBindingRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    agent_id: r.agent_id,
    agent_version_id: r.agent_version_id,
    capability_key: r.capability_key,
    capability_name: r.capability_name,
    capability_category: r.capability_category,
    capability_status: r.capability_status,
    risk_posture: r.risk_posture,
    hard_deny_floor_expected: r.hard_deny_floor_expected,
    approval_required: r.approval_required,
    evidence_required: r.evidence_required,
    scope_summary: r.scope_summary,
    restriction_summary: r.restriction_summary,
    rationale: r.rationale,
    regulatory_source_id: r.regulatory_source_id,
    control_id: r.control_id,
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    updated_by_user_id: r.updated_by_user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeUseCase(r: UseCaseRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    use_case_key: r.use_case_key,
    name: r.name,
    description: r.description,
    use_case_status: r.use_case_status,
    use_case_category: r.use_case_category,
    business_criticality: r.business_criticality,
    deployment_scope: r.deployment_scope,
    primary_jurisdiction: r.primary_jurisdiction,
    business_owner: r.business_owner,
    technical_owner: r.technical_owner,
    legal_owner: r.legal_owner,
    dpo_owner: r.dpo_owner,
    accountable_executive: r.accountable_executive,
    intended_purpose: r.intended_purpose,
    expected_benefits: r.expected_benefits,
    prohibited_uses: r.prohibited_uses,
    restricted_uses: r.restricted_uses,
    target_users: r.target_users,
    affected_subjects: r.affected_subjects,
    data_categories_summary: r.data_categories_summary,
    sensitive_data_summary: r.sensitive_data_summary,
    legal_basis_summary: r.legal_basis_summary,
    regulatory_basis_summary: r.regulatory_basis_summary,
    human_oversight_summary: r.human_oversight_summary,
    review_frequency: r.review_frequency,
    last_reviewed_at: iso(r.last_reviewed_at),
    next_review_at: iso(r.next_review_at),
    primary_ai_system_id: r.primary_ai_system_id,
    regulatory_source_id: r.regulatory_source_id,
    control_id: r.control_id,
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    updated_by_user_id: r.updated_by_user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeUseCaseAssetLink(r: UseCaseAssetLinkRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    use_case_id: r.use_case_id,
    ai_system_id: r.ai_system_id,
    model_id: r.model_id,
    model_version_id: r.model_version_id,
    agent_id: r.agent_id,
    agent_version_id: r.agent_version_id,
    link_status: r.link_status,
    usage_role: r.usage_role,
    deployment_environment: r.deployment_environment,
    effective_from: iso(r.effective_from),
    effective_to: iso(r.effective_to),
    rationale: r.rationale,
    evidence_reference: r.evidence_reference,
    regulatory_source_id: r.regulatory_source_id,
    control_id: r.control_id,
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    updated_by_user_id: r.updated_by_user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeUseCaseReview(r: UseCaseReviewRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    use_case_id: r.use_case_id,
    review_key: r.review_key,
    review_type: r.review_type,
    review_status: r.review_status,
    review_outcome: r.review_outcome,
    reviewer_user_id: r.reviewer_user_id,
    reviewer_name: r.reviewer_name,
    reviewed_at: iso(r.reviewed_at),
    next_review_at: iso(r.next_review_at),
    findings_summary: r.findings_summary,
    decision_summary: r.decision_summary,
    conditions_summary: r.conditions_summary,
    evidence_reference: r.evidence_reference,
    evidence_hash: r.evidence_hash,
    regulatory_source_id: r.regulatory_source_id,
    control_id: r.control_id,
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    updated_by_user_id: r.updated_by_user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeRiskMethod(r: RiskMethodRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    method_key: r.method_key,
    method_version: r.method_version,
    name: r.name,
    method_status: r.method_status,
    framework_profile: r.framework_profile,
    methodology_summary: r.methodology_summary,
    scoring_summary: r.scoring_summary,
    high_risk_criteria_summary: r.high_risk_criteria_summary,
    prohibited_criteria_summary: r.prohibited_criteria_summary,
    mitigation_policy_summary: r.mitigation_policy_summary,
    regulatory_source_id: r.regulatory_source_id,
    control_id: r.control_id,
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    updated_by_user_id: r.updated_by_user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeRiskClassification(r: RiskClassificationRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    classification_key: r.classification_key,
    classification_status: r.classification_status,
    risk_method_id: r.risk_method_id,
    use_case_id: r.use_case_id,
    ai_system_id: r.ai_system_id,
    use_case_asset_link_id: r.use_case_asset_link_id,
    model_id: r.model_id,
    model_version_id: r.model_version_id,
    agent_id: r.agent_id,
    agent_version_id: r.agent_version_id,
    classification_basis: r.classification_basis,
    decision_scope: r.decision_scope,
    inherent_risk_tier: r.inherent_risk_tier,
    residual_risk_tier: r.residual_risk_tier,
    risk_score: r.risk_score,
    residual_risk_score: r.residual_risk_score,
    mitigation_strength: r.mitigation_strength,
    requires_high_risk_review: r.requires_high_risk_review,
    requires_prohibited_use_review: r.requires_prohibited_use_review,
    insufficient_information: r.insufficient_information,
    rationale_summary: r.rationale_summary,
    factor_summary: r.factor_summary,
    evidence_summary: r.evidence_summary,
    mitigation_summary: r.mitigation_summary,
    residual_risk_summary: r.residual_risk_summary,
    recommended_controls_summary: r.recommended_controls_summary,
    review_notes: r.review_notes,
    effective_from: iso(r.effective_from),
    effective_to: iso(r.effective_to),
    supersedes_classification_id: r.supersedes_classification_id,
    regulatory_source_id: r.regulatory_source_id,
    control_id: r.control_id,
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    updated_by_user_id: r.updated_by_user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeRiskClassificationFactor(r: RiskClassificationFactorRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    classification_id: r.classification_id,
    factor_key: r.factor_key,
    factor_category: r.factor_category,
    factor_severity: r.factor_severity,
    factor_value: r.factor_value,
    triggered: r.triggered,
    score_contribution: r.score_contribution,
    rationale: r.rationale,
    evidence_reference: r.evidence_reference,
    regulatory_source_id: r.regulatory_source_id,
    control_id: r.control_id,
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    updated_by_user_id: r.updated_by_user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeReclassificationTrigger(r: ReclassificationTriggerRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    trigger_key: r.trigger_key,
    trigger_status: r.trigger_status,
    trigger_type: r.trigger_type,
    recommended_action: r.recommended_action,
    classification_id: r.classification_id,
    use_case_id: r.use_case_id,
    ai_system_id: r.ai_system_id,
    prior_risk_tier: r.prior_risk_tier,
    trigger_reason: r.trigger_reason,
    evidence_reference: r.evidence_reference,
    detected_at: iso(r.detected_at),
    due_at: iso(r.due_at),
    resolved_at: iso(r.resolved_at),
    regulatory_source_id: r.regulatory_source_id,
    control_id: r.control_id,
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    updated_by_user_id: r.updated_by_user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeHighRiskReview(r: HighRiskReviewRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    review_key: r.review_key,
    review_status: r.review_status,
    risk_classification_id: r.risk_classification_id,
    risk_method_id: r.risk_method_id,
    use_case_id: r.use_case_id,
    ai_system_id: r.ai_system_id,
    use_case_asset_link_id: r.use_case_asset_link_id,
    model_id: r.model_id,
    model_version_id: r.model_version_id,
    agent_id: r.agent_id,
    agent_version_id: r.agent_version_id,
    inherent_risk_tier: r.inherent_risk_tier,
    residual_risk_tier: r.residual_risk_tier,
    risk_score: r.risk_score,
    residual_risk_score: r.residual_risk_score,
    requires_high_risk_review: r.requires_high_risk_review,
    requires_prohibited_use_review: r.requires_prohibited_use_review,
    review_basis: r.review_basis,
    required_approver_count: r.required_approver_count,
    requester_user_id: r.requester_user_id,
    requested_by_participant_id: r.requested_by_participant_id,
    workroom_id: r.workroom_id,
    workroom_approval_request_id: r.workroom_approval_request_id,
    rationale_summary: r.rationale_summary,
    evidence_summary: r.evidence_summary,
    reviewer_guidance: r.reviewer_guidance,
    decision_summary: r.decision_summary,
    cancellation_reason: r.cancellation_reason,
    supersedes_review_id: r.supersedes_review_id,
    superseded_by_review_id: r.superseded_by_review_id,
    due_at: iso(r.due_at),
    submitted_at: iso(r.submitted_at),
    decided_at: iso(r.decided_at),
    cancelled_at: iso(r.cancelled_at),
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    updated_by_user_id: r.updated_by_user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeHighRiskReviewEvidence(r: HighRiskReviewEvidenceRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    high_risk_review_id: r.high_risk_review_id,
    evidence_key: r.evidence_key,
    evidence_type: r.evidence_type,
    evidence_status: r.evidence_status,
    title: r.title,
    summary: r.summary,
    evidence_reference: r.evidence_reference,
    source_uri: r.source_uri,
    source_hash: r.source_hash,
    regulatory_source_id: r.regulatory_source_id,
    control_id: r.control_id,
    metadata: r.metadata,
    created_by_user_id: r.created_by_user_id,
    updated_by_user_id: r.updated_by_user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeHighRiskReviewAssignment(r: HighRiskReviewAssignmentRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    high_risk_review_id: r.high_risk_review_id,
    assignee_user_id: r.assignee_user_id,
    assignee_participant_id: r.assignee_participant_id,
    reviewer_role: r.reviewer_role,
    assignment_status: r.assignment_status,
    assigned_by_user_id: r.assigned_by_user_id,
    assigned_at: r.assigned_at.toISOString(),
    acknowledged_at: iso(r.acknowledged_at),
    completed_at: iso(r.completed_at),
    metadata: r.metadata,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function serializeHighRiskReviewDecision(r: HighRiskReviewDecisionRow): Record<string, unknown> {
  return {
    id: r.id,
    org_id: r.org_id,
    high_risk_review_id: r.high_risk_review_id,
    decision: r.decision,
    decision_rationale: r.decision_rationale,
    decided_by_user_id: r.decided_by_user_id,
    decided_by_participant_id: r.decided_by_participant_id,
    reviewer_role: r.reviewer_role,
    evidence_snapshot_summary: r.evidence_snapshot_summary,
    conditions_summary: r.conditions_summary,
    expiry_at: iso(r.expiry_at),
    decision_audit_event_id: r.decision_audit_event_id,
    metadata: r.metadata,
    created_at: r.created_at.toISOString(),
  };
}

function cursorFromQuery(q: { limit: number; before_created_at?: string; before_id?: string }): Cursor {
  return { limit: q.limit, before_created_at: q.before_created_at, before_id: q.before_id };
}

export async function regulatoryRoute(app: FastifyInstance): Promise<void> {
  const validId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

  const requireWriteRole = (identity: AuthIdentity, reply: FastifyReply): boolean => {
    if (!hasAnyRole(identity.roles, WRITE_ROLES)) {
      reply.code(403);
      reply.send({
        error: 'forbidden',
        message: 'admin or data_protection_officer role required',
      });
      return false;
    }
    return true;
  };

  const onError = (req: FastifyRequest, reply: FastifyReply, err: unknown, op: string): unknown => {
    req.log.error({ err_name: err instanceof Error ? err.name : 'unknown', op }, 'regulatory route failed');
    reply.code(500);
    return { error: 'internal_error' };
  };

  // =========================================================================
  // Sources
  // =========================================================================

  app.get('/v1/regulatory/sources', async (req, reply) => {
    const parsed = ListSourcesQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listSources(
          ctx,
          {
            scope: parsed.data.scope,
            jurisdiction: parsed.data.jurisdiction,
            authority: parsed.data.authority,
            source_quality: parsed.data.source_quality,
            verification_status: parsed.data.verification_status,
            legal_status: parsed.data.legal_status,
            q: parsed.data.q,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { sources: out.value.rows.map(serializeSource), next_cursor: out.value.nextCursor };
    } catch (err) {
      return onError(req, reply, err, 'list_sources');
    }
  });

  app.post('/v1/regulatory/sources', async (req, reply) => {
    const parsed = CreateSourceBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => createSource(ctx, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { source: serializeSource(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_source');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/sources/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_source_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => getVisibleSource(ctx, req.params.id));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'source_not_found' };
      }
      return { source: serializeSource(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_source');
    }
  });

  app.patch<{ Params: { id: string } }>('/v1/regulatory/sources/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_source_id' };
    }
    const parsed = UpdateSourceBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => updateSource(ctx, req.params.id, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { source: serializeSource(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'update_source');
    }
  });

  app.post<{ Params: { id: string } }>('/v1/regulatory/sources/:id/versions', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_source_id' };
    }
    const parsed = CreateVersionBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        createSourceVersion(ctx, req.params.id, parsed.data),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { version: serializeVersion(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_version');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/sources/:id/versions', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_source_id' };
    }
    const parsed = ListVersionsQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listSourceVersions(ctx, req.params.id, { change_type: parsed.data.change_type }, cursorFromQuery(parsed.data)),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { versions: out.value.rows.map(serializeVersion), next_cursor: out.value.nextCursor };
    } catch (err) {
      return onError(req, reply, err, 'list_versions');
    }
  });

  app.post<{ Params: { id: string } }>('/v1/regulatory/sources/:id/relationships', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_source_id' };
    }
    const parsed = CreateRelationshipBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        createSourceRelationship(ctx, req.params.id, parsed.data),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { relationship: serializeRelationship(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_relationship');
    }
  });

  // =========================================================================
  // Controls
  // =========================================================================

  app.get('/v1/regulatory/controls', async (req, reply) => {
    const parsed = ListControlsQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listControls(
          ctx,
          {
            scope: parsed.data.scope,
            domain: parsed.data.domain,
            capability_type: parsed.data.capability_type,
            implementation_state: parsed.data.implementation_state,
            build_decision: parsed.data.build_decision,
            framework_key: parsed.data.framework_key,
            q: parsed.data.q,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { controls: out.value.rows.map(serializeControl), next_cursor: out.value.nextCursor };
    } catch (err) {
      return onError(req, reply, err, 'list_controls');
    }
  });

  app.post('/v1/regulatory/controls', async (req, reply) => {
    const parsed = CreateControlBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => createControl(ctx, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { control: serializeControl(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_control');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/controls/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_control_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => getVisibleControl(ctx, req.params.id));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'control_not_found' };
      }
      return { control: serializeControl(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_control');
    }
  });

  app.patch<{ Params: { id: string } }>('/v1/regulatory/controls/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_control_id' };
    }
    const parsed = UpdateControlBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => updateControl(ctx, req.params.id, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { control: serializeControl(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'update_control');
    }
  });

  app.post<{ Params: { id: string } }>(
    '/v1/regulatory/controls/:id/source-links',
    async (req, reply) => {
      if (!validId(req.params.id)) {
        reply.code(400);
        return { error: 'invalid_control_id' };
      }
      const parsed = CreateSourceLinkBody.safeParse(req.body);
      if (!parsed.success) return zodError(reply, parsed);
      const identity = await authenticate(app, req, reply);
      if (!identity) return reply;
      if (!requireWriteRole(identity, reply)) return reply;
      try {
        const out = await runTenant(app, identity, (ctx) =>
          createControlSourceLink(ctx, req.params.id, parsed.data),
        );
        if (!out.ok) {
          reply.code(out.status);
          return out.body;
        }
        reply.code(201);
        return { source_link: serializeLink(out.value) };
      } catch (err) {
        return onError(req, reply, err, 'create_source_link');
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/v1/regulatory/controls/:id/source-links',
    async (req, reply) => {
      if (!validId(req.params.id)) {
        reply.code(400);
        return { error: 'invalid_control_id' };
      }
      const parsed = ListLinksQuery.safeParse(req.query);
      if (!parsed.success) return zodError(reply, parsed);
      const identity = await authenticate(app, req, reply);
      if (!identity) return reply;
      try {
        const out = await runTenant(app, identity, (ctx) =>
          listControlSourceLinks(ctx, req.params.id, { link_type: parsed.data.link_type }, cursorFromQuery(parsed.data)),
        );
        if (!out.ok) {
          reply.code(out.status);
          return out.body;
        }
        return { source_links: out.value.rows.map(serializeLink), next_cursor: out.value.nextCursor };
      } catch (err) {
        return onError(req, reply, err, 'list_source_links');
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/regulatory/controls/:id/framework-mappings',
    async (req, reply) => {
      if (!validId(req.params.id)) {
        reply.code(400);
        return { error: 'invalid_control_id' };
      }
      const parsed = CreateFrameworkMappingBody.safeParse(req.body);
      if (!parsed.success) return zodError(reply, parsed);
      const identity = await authenticate(app, req, reply);
      if (!identity) return reply;
      if (!requireWriteRole(identity, reply)) return reply;
      try {
        const out = await runTenant(app, identity, (ctx) =>
          createFrameworkMapping(ctx, req.params.id, parsed.data),
        );
        if (!out.ok) {
          reply.code(out.status);
          return out.body;
        }
        reply.code(201);
        return { framework_mapping: serializeMapping(out.value) };
      } catch (err) {
        return onError(req, reply, err, 'create_framework_mapping');
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/v1/regulatory/controls/:id/framework-mappings',
    async (req, reply) => {
      if (!validId(req.params.id)) {
        reply.code(400);
        return { error: 'invalid_control_id' };
      }
      const parsed = ListMappingsQuery.safeParse(req.query);
      if (!parsed.success) return zodError(reply, parsed);
      const identity = await authenticate(app, req, reply);
      if (!identity) return reply;
      try {
        const out = await runTenant(app, identity, (ctx) =>
          listFrameworkMappings(
            ctx,
            req.params.id,
            { framework_key: parsed.data.framework_key, mapping_status: parsed.data.mapping_status },
            cursorFromQuery(parsed.data),
          ),
        );
        if (!out.ok) {
          reply.code(out.status);
          return out.body;
        }
        return {
          framework_mappings: out.value.rows.map(serializeMapping),
          next_cursor: out.value.nextCursor,
        };
      } catch (err) {
        return onError(req, reply, err, 'list_framework_mappings');
      }
    },
  );

  // =========================================================================
  // AI System Registry (PR-R2)
  // =========================================================================

  app.get('/v1/regulatory/ai-systems', async (req, reply) => {
    const parsed = ListAiSystemsQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listAiSystems(
          ctx,
          {
            system_type: parsed.data.system_type,
            lifecycle_state: parsed.data.lifecycle_state,
            primary_jurisdiction: parsed.data.primary_jurisdiction,
            deployment_environment: parsed.data.deployment_environment,
            q: parsed.data.q,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { ai_systems: out.value.rows.map(serializeAiSystem), next_cursor: out.value.nextCursor };
    } catch (err) {
      return onError(req, reply, err, 'list_ai_systems');
    }
  });

  app.post('/v1/regulatory/ai-systems', async (req, reply) => {
    const parsed = CreateAiSystemBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => createAiSystem(ctx, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { ai_system: serializeAiSystem(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_ai_system');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/ai-systems/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_ai_system_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => getVisibleAiSystem(ctx, req.params.id));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'ai_system_not_found' };
      }
      return { ai_system: serializeAiSystem(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_ai_system');
    }
  });

  app.patch<{ Params: { id: string } }>('/v1/regulatory/ai-systems/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_ai_system_id' };
    }
    const parsed = UpdateAiSystemBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => updateAiSystem(ctx, req.params.id, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { ai_system: serializeAiSystem(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'update_ai_system');
    }
  });

  // =========================================================================
  // Provider Registry (PR-R3)
  // =========================================================================

  app.get('/v1/regulatory/providers', async (req, reply) => {
    const parsed = ListProvidersQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listProviders(
          ctx,
          {
            provider_type: parsed.data.provider_type,
            provider_status: parsed.data.provider_status,
            deployment_model: parsed.data.deployment_model,
            data_processing_role: parsed.data.data_processing_role,
            primary_jurisdiction: parsed.data.primary_jurisdiction,
            security_review_status: parsed.data.security_review_status,
            dpa_status: parsed.data.dpa_status,
            q: parsed.data.q,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { providers: out.value.rows.map(serializeProvider), next_cursor: out.value.nextCursor };
    } catch (err) {
      return onError(req, reply, err, 'list_providers');
    }
  });

  app.post('/v1/regulatory/providers', async (req, reply) => {
    const parsed = CreateProviderBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => createProvider(ctx, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { provider: serializeProvider(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_provider');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/providers/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_provider_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => getVisibleProvider(ctx, req.params.id));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'provider_not_found' };
      }
      return { provider: serializeProvider(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_provider');
    }
  });

  app.patch<{ Params: { id: string } }>('/v1/regulatory/providers/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_provider_id' };
    }
    const parsed = UpdateProviderBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => updateProvider(ctx, req.params.id, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { provider: serializeProvider(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'update_provider');
    }
  });

  // =========================================================================
  // Model Registry (PR-R4)
  // =========================================================================

  app.get('/v1/regulatory/models', async (req, reply) => {
    const parsed = ListModelsQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listModels(
          ctx,
          {
            model_type: parsed.data.model_type,
            model_status: parsed.data.model_status,
            provider_id: parsed.data.provider_id,
            primary_ai_system_id: parsed.data.primary_ai_system_id,
            primary_jurisdiction: parsed.data.primary_jurisdiction,
            q: parsed.data.q,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { models: out.value.rows.map(serializeModel), next_cursor: out.value.nextCursor };
    } catch (err) {
      return onError(req, reply, err, 'list_models');
    }
  });

  app.post('/v1/regulatory/models', async (req, reply) => {
    const parsed = CreateModelBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => createModel(ctx, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { model: serializeModel(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_model');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/models/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_model_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => getVisibleModel(ctx, req.params.id));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'model_not_found' };
      }
      return { model: serializeModel(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_model');
    }
  });

  app.patch<{ Params: { id: string } }>('/v1/regulatory/models/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_model_id' };
    }
    const parsed = UpdateModelBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => updateModel(ctx, req.params.id, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { model: serializeModel(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'update_model');
    }
  });

  // --- Model versions ------------------------------------------------------

  app.post<{ Params: { id: string } }>('/v1/regulatory/models/:id/versions', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_model_id' };
    }
    const parsed = CreateModelVersionBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => createModelVersion(ctx, req.params.id, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { model_version: serializeModelVersion(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_model_version');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/models/:id/versions', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_model_id' };
    }
    const parsed = ListModelVersionsQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listModelVersions(
          ctx,
          req.params.id,
          { version_status: parsed.data.version_status, q: parsed.data.q },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { model_versions: out.value.rows.map(serializeModelVersion), next_cursor: out.value.nextCursor };
    } catch (err) {
      return onError(req, reply, err, 'list_model_versions');
    }
  });

  app.get<{ Params: { versionId: string } }>('/v1/regulatory/model-versions/:versionId', async (req, reply) => {
    if (!validId(req.params.versionId)) {
      reply.code(400);
      return { error: 'invalid_model_version_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => getVisibleModelVersion(ctx, req.params.versionId));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'model_version_not_found' };
      }
      return { model_version: serializeModelVersion(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_model_version');
    }
  });

  app.patch<{ Params: { versionId: string } }>('/v1/regulatory/model-versions/:versionId', async (req, reply) => {
    if (!validId(req.params.versionId)) {
      reply.code(400);
      return { error: 'invalid_model_version_id' };
    }
    const parsed = UpdateModelVersionBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => updateModelVersion(ctx, req.params.versionId, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { model_version: serializeModelVersion(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'update_model_version');
    }
  });

  // --- AI system ↔ model version links -------------------------------------

  app.get('/v1/regulatory/ai-system-model-links', async (req, reply) => {
    const parsed = ListAiSystemModelLinksQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listAiSystemModelLinks(
          ctx,
          {
            ai_system_id: parsed.data.ai_system_id,
            model_id: parsed.data.model_id,
            model_version_id: parsed.data.model_version_id,
            link_status: parsed.data.link_status,
            usage_role: parsed.data.usage_role,
            deployment_environment: parsed.data.deployment_environment,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return {
        ai_system_model_links: out.value.rows.map(serializeAiSystemModelLink),
        next_cursor: out.value.nextCursor,
      };
    } catch (err) {
      return onError(req, reply, err, 'list_ai_system_model_links');
    }
  });

  app.post('/v1/regulatory/ai-system-model-links', async (req, reply) => {
    const parsed = CreateAiSystemModelLinkBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => createAiSystemModelLink(ctx, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { ai_system_model_link: serializeAiSystemModelLink(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_ai_system_model_link');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/ai-system-model-links/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_ai_system_model_link_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => getVisibleAiSystemModelLink(ctx, req.params.id));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'ai_system_model_link_not_found' };
      }
      return { ai_system_model_link: serializeAiSystemModelLink(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_ai_system_model_link');
    }
  });

  app.patch<{ Params: { id: string } }>('/v1/regulatory/ai-system-model-links/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_ai_system_model_link_id' };
    }
    const parsed = UpdateAiSystemModelLinkBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => updateAiSystemModelLink(ctx, req.params.id, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { ai_system_model_link: serializeAiSystemModelLink(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'update_ai_system_model_link');
    }
  });

  // =========================================================================
  // Agent Registry (PR-R5)
  // =========================================================================

  app.get('/v1/regulatory/agents', async (req, reply) => {
    const parsed = ListAgentsQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listAgents(
          ctx,
          {
            agent_type: parsed.data.agent_type,
            agent_status: parsed.data.agent_status,
            autonomy_level: parsed.data.autonomy_level,
            execution_boundary: parsed.data.execution_boundary,
            provider_id: parsed.data.provider_id,
            primary_ai_system_id: parsed.data.primary_ai_system_id,
            primary_model_id: parsed.data.primary_model_id,
            primary_jurisdiction: parsed.data.primary_jurisdiction,
            q: parsed.data.q,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { agents: out.value.rows.map(serializeAgent), next_cursor: out.value.nextCursor };
    } catch (err) {
      return onError(req, reply, err, 'list_agents');
    }
  });

  app.post('/v1/regulatory/agents', async (req, reply) => {
    const parsed = CreateAgentBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => createAgent(ctx, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { agent: serializeAgent(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_agent');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/agents/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_agent_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => getVisibleAgent(ctx, req.params.id));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'agent_not_found' };
      }
      return { agent: serializeAgent(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_agent');
    }
  });

  app.patch<{ Params: { id: string } }>('/v1/regulatory/agents/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_agent_id' };
    }
    const parsed = UpdateAgentBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => updateAgent(ctx, req.params.id, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { agent: serializeAgent(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'update_agent');
    }
  });

  // --- Agent versions ------------------------------------------------------

  app.post<{ Params: { id: string } }>('/v1/regulatory/agents/:id/versions', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_agent_id' };
    }
    const parsed = CreateAgentVersionBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => createAgentVersion(ctx, req.params.id, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { agent_version: serializeAgentVersion(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_agent_version');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/agents/:id/versions', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_agent_id' };
    }
    const parsed = ListAgentVersionsQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listAgentVersions(
          ctx,
          req.params.id,
          { version_status: parsed.data.version_status, q: parsed.data.q },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { agent_versions: out.value.rows.map(serializeAgentVersion), next_cursor: out.value.nextCursor };
    } catch (err) {
      return onError(req, reply, err, 'list_agent_versions');
    }
  });

  app.get<{ Params: { versionId: string } }>('/v1/regulatory/agent-versions/:versionId', async (req, reply) => {
    if (!validId(req.params.versionId)) {
      reply.code(400);
      return { error: 'invalid_agent_version_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => getVisibleAgentVersion(ctx, req.params.versionId));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'agent_version_not_found' };
      }
      return { agent_version: serializeAgentVersion(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_agent_version');
    }
  });

  app.patch<{ Params: { versionId: string } }>('/v1/regulatory/agent-versions/:versionId', async (req, reply) => {
    if (!validId(req.params.versionId)) {
      reply.code(400);
      return { error: 'invalid_agent_version_id' };
    }
    const parsed = UpdateAgentVersionBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => updateAgentVersion(ctx, req.params.versionId, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { agent_version: serializeAgentVersion(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'update_agent_version');
    }
  });

  // --- Agent capability bindings -------------------------------------------

  app.get('/v1/regulatory/agent-capability-bindings', async (req, reply) => {
    const parsed = ListAgentCapabilityBindingsQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listAgentCapabilityBindings(
          ctx,
          {
            agent_id: parsed.data.agent_id,
            agent_version_id: parsed.data.agent_version_id,
            capability_category: parsed.data.capability_category,
            capability_status: parsed.data.capability_status,
            risk_posture: parsed.data.risk_posture,
            hard_deny_floor_expected: parsed.data.hard_deny_floor_expected,
            approval_required: parsed.data.approval_required,
            evidence_required: parsed.data.evidence_required,
            q: parsed.data.q,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return {
        agent_capability_bindings: out.value.rows.map(serializeAgentCapabilityBinding),
        next_cursor: out.value.nextCursor,
      };
    } catch (err) {
      return onError(req, reply, err, 'list_agent_capability_bindings');
    }
  });

  app.post('/v1/regulatory/agent-capability-bindings', async (req, reply) => {
    const parsed = CreateAgentCapabilityBindingBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => createAgentCapabilityBinding(ctx, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { agent_capability_binding: serializeAgentCapabilityBinding(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_agent_capability_binding');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/agent-capability-bindings/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_agent_capability_binding_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => getVisibleAgentCapabilityBinding(ctx, req.params.id));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'agent_capability_binding_not_found' };
      }
      return { agent_capability_binding: serializeAgentCapabilityBinding(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_agent_capability_binding');
    }
  });

  app.patch<{ Params: { id: string } }>('/v1/regulatory/agent-capability-bindings/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_agent_capability_binding_id' };
    }
    const parsed = UpdateAgentCapabilityBindingBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        updateAgentCapabilityBinding(ctx, req.params.id, parsed.data),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { agent_capability_binding: serializeAgentCapabilityBinding(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'update_agent_capability_binding');
    }
  });

  // =========================================================================
  // Use-case Registry (PR-R6)
  // =========================================================================

  app.get('/v1/regulatory/use-cases', async (req, reply) => {
    const parsed = ListUseCasesQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listUseCases(
          ctx,
          {
            use_case_status: parsed.data.use_case_status,
            use_case_category: parsed.data.use_case_category,
            business_criticality: parsed.data.business_criticality,
            deployment_scope: parsed.data.deployment_scope,
            primary_jurisdiction: parsed.data.primary_jurisdiction,
            primary_ai_system_id: parsed.data.primary_ai_system_id,
            next_review_before: parsed.data.next_review_before,
            q: parsed.data.q,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { use_cases: out.value.rows.map(serializeUseCase), next_cursor: out.value.nextCursor };
    } catch (err) {
      return onError(req, reply, err, 'list_use_cases');
    }
  });

  app.post('/v1/regulatory/use-cases', async (req, reply) => {
    const parsed = CreateUseCaseBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => createUseCase(ctx, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { use_case: serializeUseCase(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_use_case');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/use-cases/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_use_case_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => getVisibleUseCase(ctx, req.params.id));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'use_case_not_found' };
      }
      return { use_case: serializeUseCase(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_use_case');
    }
  });

  app.patch<{ Params: { id: string } }>('/v1/regulatory/use-cases/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_use_case_id' };
    }
    const parsed = UpdateUseCaseBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => updateUseCase(ctx, req.params.id, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { use_case: serializeUseCase(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'update_use_case');
    }
  });

  // --- Use-case asset links ------------------------------------------------

  app.get('/v1/regulatory/use-case-asset-links', async (req, reply) => {
    const parsed = ListUseCaseAssetLinksQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listUseCaseAssetLinks(
          ctx,
          {
            use_case_id: parsed.data.use_case_id,
            ai_system_id: parsed.data.ai_system_id,
            model_id: parsed.data.model_id,
            model_version_id: parsed.data.model_version_id,
            agent_id: parsed.data.agent_id,
            agent_version_id: parsed.data.agent_version_id,
            link_status: parsed.data.link_status,
            usage_role: parsed.data.usage_role,
            deployment_environment: parsed.data.deployment_environment,
            q: parsed.data.q,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return {
        use_case_asset_links: out.value.rows.map(serializeUseCaseAssetLink),
        next_cursor: out.value.nextCursor,
      };
    } catch (err) {
      return onError(req, reply, err, 'list_use_case_asset_links');
    }
  });

  app.post('/v1/regulatory/use-case-asset-links', async (req, reply) => {
    const parsed = CreateUseCaseAssetLinkBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => createUseCaseAssetLink(ctx, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { use_case_asset_link: serializeUseCaseAssetLink(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_use_case_asset_link');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/use-case-asset-links/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_use_case_asset_link_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => getVisibleUseCaseAssetLink(ctx, req.params.id));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'use_case_asset_link_not_found' };
      }
      return { use_case_asset_link: serializeUseCaseAssetLink(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_use_case_asset_link');
    }
  });

  app.patch<{ Params: { id: string } }>('/v1/regulatory/use-case-asset-links/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_use_case_asset_link_id' };
    }
    const parsed = UpdateUseCaseAssetLinkBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => updateUseCaseAssetLink(ctx, req.params.id, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { use_case_asset_link: serializeUseCaseAssetLink(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'update_use_case_asset_link');
    }
  });

  // --- Use-case reviews ----------------------------------------------------

  app.post<{ Params: { id: string } }>('/v1/regulatory/use-cases/:id/reviews', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_use_case_id' };
    }
    const parsed = CreateUseCaseReviewBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => createUseCaseReview(ctx, req.params.id, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { use_case_review: serializeUseCaseReview(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_use_case_review');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/use-cases/:id/reviews', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_use_case_id' };
    }
    const parsed = ListUseCaseReviewsQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listUseCaseReviews(
          ctx,
          req.params.id,
          {
            review_type: parsed.data.review_type,
            review_status: parsed.data.review_status,
            review_outcome: parsed.data.review_outcome,
            reviewed_before: parsed.data.reviewed_before,
            next_review_before: parsed.data.next_review_before,
            q: parsed.data.q,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { use_case_reviews: out.value.rows.map(serializeUseCaseReview), next_cursor: out.value.nextCursor };
    } catch (err) {
      return onError(req, reply, err, 'list_use_case_reviews');
    }
  });

  app.get<{ Params: { reviewId: string } }>('/v1/regulatory/use-case-reviews/:reviewId', async (req, reply) => {
    if (!validId(req.params.reviewId)) {
      reply.code(400);
      return { error: 'invalid_use_case_review_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => getVisibleUseCaseReview(ctx, req.params.reviewId));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'use_case_review_not_found' };
      }
      return { use_case_review: serializeUseCaseReview(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_use_case_review');
    }
  });

  app.patch<{ Params: { reviewId: string } }>('/v1/regulatory/use-case-reviews/:reviewId', async (req, reply) => {
    if (!validId(req.params.reviewId)) {
      reply.code(400);
      return { error: 'invalid_use_case_review_id' };
    }
    const parsed = UpdateUseCaseReviewBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => updateUseCaseReview(ctx, req.params.reviewId, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { use_case_review: serializeUseCaseReview(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'update_use_case_review');
    }
  });

  // --- Risk methods (PR-R7) -----------------------------------------------

  app.post('/v1/regulatory/risk-methods', async (req, reply) => {
    const parsed = CreateRiskMethodBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => createRiskMethod(ctx, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { risk_method: serializeRiskMethod(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_risk_method');
    }
  });

  app.get('/v1/regulatory/risk-methods', async (req, reply) => {
    const parsed = ListRiskMethodsQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listRiskMethods(
          ctx,
          {
            method_status: parsed.data.method_status,
            framework_profile: parsed.data.framework_profile,
            method_key: parsed.data.method_key,
            q: parsed.data.q,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { risk_methods: out.value.rows.map(serializeRiskMethod), next_cursor: out.value.nextCursor };
    } catch (err) {
      return onError(req, reply, err, 'list_risk_methods');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/risk-methods/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_risk_method_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => getVisibleRiskMethod(ctx, req.params.id));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'risk_method_not_found' };
      }
      return { risk_method: serializeRiskMethod(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_risk_method');
    }
  });

  app.patch<{ Params: { id: string } }>('/v1/regulatory/risk-methods/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_risk_method_id' };
    }
    const parsed = UpdateRiskMethodBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => updateRiskMethod(ctx, req.params.id, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { risk_method: serializeRiskMethod(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'update_risk_method');
    }
  });

  // --- Risk classifications -----------------------------------------------

  // Stateless preview endpoint: runs the deterministic engine and returns the
  // proposed classification without persisting or emitting audit events.
  app.post('/v1/regulatory/risk-classifications/evaluate', async (req, reply) => {
    const parsed = EvaluateRiskClassificationBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => evaluateRiskClassification(ctx, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { risk_classification_preview: out.value };
    } catch (err) {
      return onError(req, reply, err, 'evaluate_risk_classification');
    }
  });

  app.post('/v1/regulatory/risk-classifications', async (req, reply) => {
    const parsed = CreateRiskClassificationBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => createRiskClassification(ctx, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return {
        risk_classification: serializeRiskClassification(out.value.classification),
        risk_classification_factors: out.value.factors.map(serializeRiskClassificationFactor),
      };
    } catch (err) {
      return onError(req, reply, err, 'create_risk_classification');
    }
  });

  app.get('/v1/regulatory/risk-classifications', async (req, reply) => {
    const parsed = ListRiskClassificationsQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listRiskClassifications(
          ctx,
          {
            classification_status: parsed.data.classification_status,
            risk_method_id: parsed.data.risk_method_id,
            use_case_id: parsed.data.use_case_id,
            ai_system_id: parsed.data.ai_system_id,
            use_case_asset_link_id: parsed.data.use_case_asset_link_id,
            model_id: parsed.data.model_id,
            model_version_id: parsed.data.model_version_id,
            agent_id: parsed.data.agent_id,
            agent_version_id: parsed.data.agent_version_id,
            inherent_risk_tier: parsed.data.inherent_risk_tier,
            residual_risk_tier: parsed.data.residual_risk_tier,
            requires_high_risk_review: parsed.data.requires_high_risk_review,
            requires_prohibited_use_review: parsed.data.requires_prohibited_use_review,
            classification_basis: parsed.data.classification_basis,
            decision_scope: parsed.data.decision_scope,
            q: parsed.data.q,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return {
        risk_classifications: out.value.rows.map(serializeRiskClassification),
        next_cursor: out.value.nextCursor,
      };
    } catch (err) {
      return onError(req, reply, err, 'list_risk_classifications');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/risk-classifications/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_risk_classification_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => getVisibleRiskClassification(ctx, req.params.id));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'risk_classification_not_found' };
      }
      return { risk_classification: serializeRiskClassification(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_risk_classification');
    }
  });

  app.patch<{ Params: { id: string } }>('/v1/regulatory/risk-classifications/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_risk_classification_id' };
    }
    const parsed = UpdateRiskClassificationBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => updateRiskClassification(ctx, req.params.id, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { risk_classification: serializeRiskClassification(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'update_risk_classification');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/risk-classifications/:id/factors', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_risk_classification_id' };
    }
    const parsed = ListRiskClassificationFactorsQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listRiskClassificationFactors(
          ctx,
          {
            classification_id: req.params.id,
            factor_category: parsed.data.factor_category,
            factor_severity: parsed.data.factor_severity,
            triggered: parsed.data.triggered,
            q: parsed.data.q,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return {
        risk_classification_factors: out.value.rows.map(serializeRiskClassificationFactor),
        next_cursor: out.value.nextCursor,
      };
    } catch (err) {
      return onError(req, reply, err, 'list_risk_classification_factors_for_classification');
    }
  });

  app.get('/v1/regulatory/risk-classification-factors', async (req, reply) => {
    const parsed = ListRiskClassificationFactorsQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listRiskClassificationFactors(
          ctx,
          {
            classification_id: parsed.data.classification_id,
            factor_category: parsed.data.factor_category,
            factor_severity: parsed.data.factor_severity,
            triggered: parsed.data.triggered,
            q: parsed.data.q,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return {
        risk_classification_factors: out.value.rows.map(serializeRiskClassificationFactor),
        next_cursor: out.value.nextCursor,
      };
    } catch (err) {
      return onError(req, reply, err, 'list_risk_classification_factors');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/risk-classification-factors/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_risk_classification_factor_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => getVisibleRiskClassificationFactor(ctx, req.params.id));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'risk_classification_factor_not_found' };
      }
      return { risk_classification_factor: serializeRiskClassificationFactor(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_risk_classification_factor');
    }
  });

  // --- Reclassification triggers ------------------------------------------

  app.post('/v1/regulatory/reclassification-triggers', async (req, reply) => {
    const parsed = CreateReclassificationTriggerBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => createReclassificationTrigger(ctx, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { reclassification_trigger: serializeReclassificationTrigger(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_reclassification_trigger');
    }
  });

  app.get('/v1/regulatory/reclassification-triggers', async (req, reply) => {
    const parsed = ListReclassificationTriggersQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listReclassificationTriggers(
          ctx,
          {
            classification_id: parsed.data.classification_id,
            use_case_id: parsed.data.use_case_id,
            ai_system_id: parsed.data.ai_system_id,
            trigger_status: parsed.data.trigger_status,
            trigger_type: parsed.data.trigger_type,
            recommended_action: parsed.data.recommended_action,
            due_before: parsed.data.due_before,
            q: parsed.data.q,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return {
        reclassification_triggers: out.value.rows.map(serializeReclassificationTrigger),
        next_cursor: out.value.nextCursor,
      };
    } catch (err) {
      return onError(req, reply, err, 'list_reclassification_triggers');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/reclassification-triggers/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_reclassification_trigger_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => getVisibleReclassificationTrigger(ctx, req.params.id));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'reclassification_trigger_not_found' };
      }
      return { reclassification_trigger: serializeReclassificationTrigger(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_reclassification_trigger');
    }
  });

  app.patch<{ Params: { id: string } }>('/v1/regulatory/reclassification-triggers/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_reclassification_trigger_id' };
    }
    const parsed = UpdateReclassificationTriggerBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        updateReclassificationTrigger(ctx, req.params.id, parsed.data),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { reclassification_trigger: serializeReclassificationTrigger(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'update_reclassification_trigger');
    }
  });

  // --- High-risk review workflow (PR-R8) -----------------------------------
  //
  // APPROVED on a high-risk review case is governance evidence only: it does
  // not mean legal approval, does not mean compliance certification, does not
  // mean safety certification, and does not authorize runtime execution.
  // PR-R8 does NOT implement prohibited-use workflow, hard-deny enforcement,
  // runtime enforcement, or legal advice.

  app.post('/v1/regulatory/high-risk-reviews', async (req, reply) => {
    const parsed = CreateHighRiskReviewBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => createHighRiskReview(ctx, parsed.data));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { high_risk_review: serializeHighRiskReview(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_high_risk_review');
    }
  });

  app.get('/v1/regulatory/high-risk-reviews', async (req, reply) => {
    const parsed = ListHighRiskReviewsQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listHighRiskReviews(
          ctx,
          {
            review_status: parsed.data.review_status,
            risk_classification_id: parsed.data.risk_classification_id,
            risk_method_id: parsed.data.risk_method_id,
            use_case_id: parsed.data.use_case_id,
            ai_system_id: parsed.data.ai_system_id,
            workroom_id: parsed.data.workroom_id,
            review_basis: parsed.data.review_basis,
            due_before: parsed.data.due_before,
            q: parsed.data.q,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return {
        high_risk_reviews: out.value.rows.map(serializeHighRiskReview),
        next_cursor: out.value.nextCursor,
      };
    } catch (err) {
      return onError(req, reply, err, 'list_high_risk_reviews');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/high-risk-reviews/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_high_risk_review_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) => getVisibleHighRiskReview(ctx, req.params.id));
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'high_risk_review_not_found' };
      }
      return { high_risk_review: serializeHighRiskReview(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_high_risk_review');
    }
  });

  app.patch<{ Params: { id: string } }>('/v1/regulatory/high-risk-reviews/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_high_risk_review_id' };
    }
    const parsed = UpdateHighRiskReviewBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        updateHighRiskReview(ctx, req.params.id, parsed.data),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { high_risk_review: serializeHighRiskReview(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'update_high_risk_review');
    }
  });

  app.post<{ Params: { id: string } }>('/v1/regulatory/high-risk-reviews/:id/submit', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_high_risk_review_id' };
    }
    const parsed = SubmitHighRiskReviewBody.safeParse(req.body ?? {});
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        submitHighRiskReview(ctx, req.params.id, parsed.data),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { high_risk_review: serializeHighRiskReview(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'submit_high_risk_review');
    }
  });

  app.post<{ Params: { id: string } }>('/v1/regulatory/high-risk-reviews/:id/cancel', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_high_risk_review_id' };
    }
    const parsed = CancelHighRiskReviewBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        cancelHighRiskReview(ctx, req.params.id, parsed.data),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { high_risk_review: serializeHighRiskReview(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'cancel_high_risk_review');
    }
  });

  // --- Evidence sub-resource ----------------------------------------------

  app.post<{ Params: { id: string } }>('/v1/regulatory/high-risk-reviews/:id/evidence', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_high_risk_review_id' };
    }
    const parsed = CreateHighRiskReviewEvidenceBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        createHighRiskReviewEvidence(ctx, req.params.id, parsed.data),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { high_risk_review_evidence: serializeHighRiskReviewEvidence(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_high_risk_review_evidence');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/high-risk-reviews/:id/evidence', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_high_risk_review_id' };
    }
    const parsed = ListHighRiskReviewEvidenceQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listHighRiskReviewEvidence(
          ctx,
          {
            high_risk_review_id: req.params.id,
            evidence_type: parsed.data.evidence_type,
            evidence_status: parsed.data.evidence_status,
            q: parsed.data.q,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return {
        high_risk_review_evidence: out.value.rows.map(serializeHighRiskReviewEvidence),
        next_cursor: out.value.nextCursor,
      };
    } catch (err) {
      return onError(req, reply, err, 'list_high_risk_review_evidence_for_review');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/high-risk-review-evidence/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_high_risk_review_evidence_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        getVisibleHighRiskReviewEvidence(ctx, req.params.id),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'high_risk_review_evidence_not_found' };
      }
      return { high_risk_review_evidence: serializeHighRiskReviewEvidence(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_high_risk_review_evidence');
    }
  });

  app.patch<{ Params: { id: string } }>('/v1/regulatory/high-risk-review-evidence/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_high_risk_review_evidence_id' };
    }
    const parsed = UpdateHighRiskReviewEvidenceBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        updateHighRiskReviewEvidence(ctx, req.params.id, parsed.data),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { high_risk_review_evidence: serializeHighRiskReviewEvidence(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'update_high_risk_review_evidence');
    }
  });

  // --- Assignment sub-resource --------------------------------------------

  app.post<{ Params: { id: string } }>('/v1/regulatory/high-risk-reviews/:id/assignments', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_high_risk_review_id' };
    }
    const parsed = CreateHighRiskReviewAssignmentBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        createHighRiskReviewAssignment(ctx, req.params.id, parsed.data),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return { high_risk_review_assignment: serializeHighRiskReviewAssignment(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'create_high_risk_review_assignment');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/high-risk-reviews/:id/assignments', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_high_risk_review_id' };
    }
    const parsed = ListHighRiskReviewAssignmentsQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listHighRiskReviewAssignments(
          ctx,
          {
            high_risk_review_id: req.params.id,
            reviewer_role: parsed.data.reviewer_role,
            assignment_status: parsed.data.assignment_status,
            assignee_user_id: parsed.data.assignee_user_id,
            assignee_participant_id: parsed.data.assignee_participant_id,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return {
        high_risk_review_assignments: out.value.rows.map(serializeHighRiskReviewAssignment),
        next_cursor: out.value.nextCursor,
      };
    } catch (err) {
      return onError(req, reply, err, 'list_high_risk_review_assignments_for_review');
    }
  });

  app.patch<{ Params: { id: string } }>('/v1/regulatory/high-risk-review-assignments/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_high_risk_review_assignment_id' };
    }
    const parsed = UpdateHighRiskReviewAssignmentBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        updateHighRiskReviewAssignment(ctx, req.params.id, parsed.data),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return { high_risk_review_assignment: serializeHighRiskReviewAssignment(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'update_high_risk_review_assignment');
    }
  });

  // --- Decision sub-resource ----------------------------------------------

  app.post<{ Params: { id: string } }>('/v1/regulatory/high-risk-reviews/:id/decisions', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_high_risk_review_id' };
    }
    const parsed = CreateHighRiskReviewDecisionBody.safeParse(req.body);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    if (!requireWriteRole(identity, reply)) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        createHighRiskReviewDecision(ctx, req.params.id, parsed.data),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      reply.code(201);
      return {
        high_risk_review_decision: serializeHighRiskReviewDecision(out.value.decision),
        high_risk_review: serializeHighRiskReview(out.value.review),
      };
    } catch (err) {
      return onError(req, reply, err, 'create_high_risk_review_decision');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/high-risk-reviews/:id/decisions', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_high_risk_review_id' };
    }
    const parsed = ListHighRiskReviewDecisionsQuery.safeParse(req.query);
    if (!parsed.success) return zodError(reply, parsed);
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        listHighRiskReviewDecisions(
          ctx,
          {
            high_risk_review_id: req.params.id,
            decision: parsed.data.decision,
            reviewer_role: parsed.data.reviewer_role,
            decided_by_user_id: parsed.data.decided_by_user_id,
            decided_by_participant_id: parsed.data.decided_by_participant_id,
          },
          cursorFromQuery(parsed.data),
        ),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      return {
        high_risk_review_decisions: out.value.rows.map(serializeHighRiskReviewDecision),
        next_cursor: out.value.nextCursor,
      };
    } catch (err) {
      return onError(req, reply, err, 'list_high_risk_review_decisions_for_review');
    }
  });

  app.get<{ Params: { id: string } }>('/v1/regulatory/high-risk-review-decisions/:id', async (req, reply) => {
    if (!validId(req.params.id)) {
      reply.code(400);
      return { error: 'invalid_high_risk_review_decision_id' };
    }
    const identity = await authenticate(app, req, reply);
    if (!identity) return reply;
    try {
      const out = await runTenant(app, identity, (ctx) =>
        getVisibleHighRiskReviewDecision(ctx, req.params.id),
      );
      if (!out.ok) {
        reply.code(out.status);
        return out.body;
      }
      if (!out.value) {
        reply.code(404);
        return { error: 'high_risk_review_decision_not_found' };
      }
      return { high_risk_review_decision: serializeHighRiskReviewDecision(out.value) };
    } catch (err) {
      return onError(req, reply, err, 'get_high_risk_review_decision');
    }
  });
}
