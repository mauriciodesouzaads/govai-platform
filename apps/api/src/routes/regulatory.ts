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
}
