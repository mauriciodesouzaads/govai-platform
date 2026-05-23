// Regulatory Core PR-R1 — service/repository layer (issue #59, umbrella #33).
//
// Native source registry + control catalog primitives. Each mutating function
// assumes the caller has already opened a transaction and set the tenant
// context (setLocalAppOrgId), then: validates business rules, performs the
// insert/update under RLS, and emits a real audit event onto the existing
// `policy` ChainCategory via auditAppend. No external fetch, crawler, scheduler,
// or diff engine — those remain future work.
//
// Scope rules (mirrors migration 0016):
//   - Tenants create/update only their own rows (scope='tenant', org_id=caller).
//   - System rows (scope='system', org_id IS NULL) are read-only via this API.
//   - Child rows (versions/relationships/links/mappings) anchor to a PRIMARY
//     parent the caller owns; they may reference system rows as secondary
//     endpoints (to_source, link/mapping source) when those are visible.

import type { PoolClient } from 'pg';
import { auditAppend, sha256 } from '@govai/core-audit';
import { chainIdFor } from '@govai/core-events';
import type { Kms } from '@govai/core-identity';
import type {
  CreateSourceInput,
  UpdateSourceInput,
  CreateVersionInput,
  CreateRelationshipInput,
  CreateControlInput,
  UpdateControlInput,
  CreateSourceLinkInput,
  CreateFrameworkMappingInput,
  CreateAiSystemInput,
  UpdateAiSystemInput,
  CreateProviderInput,
  UpdateProviderInput,
  CreateModelInput,
  UpdateModelInput,
  CreateModelVersionInput,
  UpdateModelVersionInput,
  CreateAiSystemModelLinkInput,
  UpdateAiSystemModelLinkInput,
  CreateAgentInput,
  UpdateAgentInput,
  CreateAgentVersionInput,
  UpdateAgentVersionInput,
  CreateAgentCapabilityBindingInput,
  UpdateAgentCapabilityBindingInput,
  CreateUseCaseInput,
  UpdateUseCaseInput,
  CreateUseCaseAssetLinkInput,
  UpdateUseCaseAssetLinkInput,
  CreateUseCaseReviewInput,
  UpdateUseCaseReviewInput,
  CreateRiskMethodInput,
  UpdateRiskMethodInput,
  EvaluateRiskClassificationInput,
  CreateRiskClassificationInput,
  UpdateRiskClassificationInput,
  CreateReclassificationTriggerInput,
  UpdateReclassificationTriggerInput,
  FactorInputsValue,
} from './validation.js';

// Same audit key id/version the rest of the platform uses for the policy chain.
const AUDIT_KEY_ID = 'audit-1';
const AUDIT_KEY_VERSION = 1;

export class RegulatoryError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(`${code}${details ? ': ' + JSON.stringify(details) : ''}`);
    this.name = 'RegulatoryError';
  }
}

export type RegulatoryActor = { orgId: string; userId: string };
export type Ctx = { client: PoolClient; kms: Kms; actor: RegulatoryActor };

export type Cursor = { before_created_at?: string; before_id?: string; limit: number };

export type SourceRow = {
  id: string;
  org_id: string | null;
  scope: 'system' | 'tenant';
  source_key: string;
  title: string;
  jurisdiction: string;
  authority: string | null;
  instrument_type: string | null;
  source_quality: string;
  verification_status: string;
  legal_status: string;
  official_url: string | null;
  publication_date: string | null;
  effective_date: string | null;
  last_verified_at: Date | null;
  next_review_at: Date | null;
  review_frequency: string;
  legal_owner: string | null;
  product_owner: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const SOURCE_COLUMNS = `id, org_id, scope, source_key, title, jurisdiction, authority, instrument_type,
  source_quality, verification_status, legal_status, official_url,
  to_char(publication_date, 'YYYY-MM-DD') AS publication_date,
  to_char(effective_date, 'YYYY-MM-DD') AS effective_date,
  last_verified_at, next_review_at, review_frequency, legal_owner, product_owner, notes,
  metadata, created_by_user_id, updated_by_user_id, created_at, updated_at`;

export type VersionRow = {
  id: string;
  org_id: string;
  source_id: string;
  version_number: string;
  version_key: string | null;
  source_url: string | null;
  retrieved_at: Date | null;
  verified_at: Date | null;
  content_hash: string | null;
  diff_hash: string | null;
  archived_snapshot_hash: string | null;
  change_type: string;
  summary: string | null;
  verification_status: string;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  created_at: Date;
};

const VERSION_COLUMNS = `id, org_id, source_id, version_number, version_key, source_url,
  retrieved_at, verified_at, content_hash, diff_hash, archived_snapshot_hash, change_type,
  summary, verification_status, metadata, created_by_user_id, created_at`;

export type RelationshipRow = {
  id: string;
  org_id: string;
  from_source_id: string;
  to_source_id: string;
  relationship_type: string;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: Date;
};

const RELATIONSHIP_COLUMNS = `id, org_id, from_source_id, to_source_id, relationship_type, notes,
  created_by_user_id, created_at`;

export type ControlRow = {
  id: string;
  org_id: string | null;
  scope: 'system' | 'tenant';
  control_key: string;
  domain: string;
  name: string;
  description: string;
  capability_type: string;
  implementation_state: string;
  build_decision: string;
  automation_level: string;
  owner_role: string | null;
  review_frequency: string;
  evidence_required: unknown;
  current_govai_primitive: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const CONTROL_COLUMNS = `id, org_id, scope, control_key, domain, name, description, capability_type,
  implementation_state, build_decision, automation_level, owner_role, review_frequency,
  evidence_required, current_govai_primitive, metadata, created_by_user_id, updated_by_user_id,
  created_at, updated_at`;

export type LinkRow = {
  id: string;
  org_id: string;
  control_id: string;
  source_id: string;
  link_type: string;
  requirement_ref: string;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: Date;
};

const LINK_COLUMNS = `id, org_id, control_id, source_id, link_type, requirement_ref, notes,
  created_by_user_id, created_at`;

export type MappingRow = {
  id: string;
  org_id: string;
  control_id: string;
  framework_key: string;
  requirement_ref: string;
  requirement_title: string | null;
  mapping_status: string;
  source_id: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  created_at: Date;
};

const MAPPING_COLUMNS = `id, org_id, control_id, framework_key, requirement_ref, requirement_title,
  mapping_status, source_id, notes, metadata, created_by_user_id, created_at`;

const UNIQUE_VIOLATION = '23505';

async function appendAudit(
  ctx: Ctx,
  args: { eventType: string; subjectType: string; subjectId: string; metadata: Record<string, unknown> },
): Promise<string> {
  const occurredAt = new Date();
  const event = {
    event_type: args.eventType,
    occurred_at: occurredAt.toISOString(),
    org_id: ctx.actor.orgId,
    actor_user_id: ctx.actor.userId,
    ...args.metadata,
  };
  const payloadHash = sha256(Buffer.from(JSON.stringify(event), 'utf8'));
  const out = await auditAppend(ctx.client, ctx.kms, {
    orgId: ctx.actor.orgId,
    chainId: chainIdFor(ctx.actor.orgId, 'policy'),
    eventType: args.eventType,
    eventVersion: '1',
    subjectType: args.subjectType,
    subjectId: args.subjectId,
    occurredAt,
    payloadHash,
    keyId: AUDIT_KEY_ID,
    keyVersion: AUDIT_KEY_VERSION,
    redactionMetadata: { [args.eventType]: event },
  });
  return out.eventId;
}

function parseDay(s: string | undefined | null): number | null {
  if (!s) return null;
  return Date.parse(`${s}T00:00:00Z`);
}

/** effective_date must not precede publication_date unless notes explain it. */
function validateSourceDates(input: {
  publication_date?: string | null;
  effective_date?: string | null;
  next_review_at?: string | null;
  notes?: string | null;
}): void {
  const pub = parseDay(input.publication_date ?? null);
  const eff = parseDay(input.effective_date ?? null);
  if (pub !== null && eff !== null && eff < pub && !(input.notes && input.notes.length > 0)) {
    throw new RegulatoryError(400, 'effective_date_before_publication_date', {
      message: 'effective_date precedes publication_date; provide notes to justify',
    });
  }
  if (input.next_review_at && pub !== null) {
    const review = Date.parse(input.next_review_at);
    if (!Number.isNaN(review) && review <= pub) {
      throw new RegulatoryError(400, 'next_review_at_not_after_publication_date', {
        message: 'next_review_at must be after publication_date',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export async function createSource(ctx: Ctx, input: CreateSourceInput): Promise<SourceRow> {
  validateSourceDates(input);
  let res;
  try {
    res = await ctx.client.query<SourceRow>(
      `INSERT INTO govai.regulatory_sources
         (org_id, scope, source_key, title, jurisdiction, authority, instrument_type,
          source_quality, verification_status, legal_status, official_url,
          publication_date, effective_date, last_verified_at, next_review_at, review_frequency,
          legal_owner, product_owner, notes, metadata, created_by_user_id, updated_by_user_id)
       VALUES ($1::uuid, 'tenant', $2, $3, $4, $5, $6, $7, $8, $9, $10,
               $11::date, $12::date, $13::timestamptz, $14::timestamptz, $15,
               $16, $17, $18, $19::jsonb, $20::uuid, $20::uuid)
       RETURNING ${SOURCE_COLUMNS}`,
      [
        ctx.actor.orgId,
        input.source_key,
        input.title,
        input.jurisdiction,
        input.authority ?? null,
        input.instrument_type ?? null,
        input.source_quality,
        input.verification_status,
        input.legal_status,
        input.official_url ?? null,
        input.publication_date ?? null,
        input.effective_date ?? null,
        input.last_verified_at ?? null,
        input.next_review_at ?? null,
        input.review_frequency,
        input.legal_owner ?? null,
        input.product_owner ?? null,
        input.notes ?? null,
        JSON.stringify(input.metadata ?? {}),
        ctx.actor.userId,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegulatoryError(409, 'source_key_conflict', { source_key: input.source_key });
    }
    throw err;
  }
  const row = res.rows[0]!;
  await appendAudit(ctx, {
    eventType: 'regulatory_source.created',
    subjectType: 'regulatory_source',
    subjectId: row.id,
    metadata: {
      source_id: row.id,
      source_key: row.source_key,
      scope: row.scope,
      jurisdiction: row.jurisdiction,
      authority: row.authority,
      source_quality: row.source_quality,
      verification_status: row.verification_status,
      legal_status: row.legal_status,
      official_url: row.official_url,
    },
  });
  return row;
}

export async function getVisibleSource(ctx: Ctx, id: string): Promise<SourceRow | null> {
  const r = await ctx.client.query<SourceRow>(
    `SELECT ${SOURCE_COLUMNS} FROM govai.regulatory_sources WHERE id = $1::uuid`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function updateSource(
  ctx: Ctx,
  id: string,
  input: UpdateSourceInput,
): Promise<SourceRow> {
  const existing = await getVisibleSource(ctx, id);
  if (!existing) throw new RegulatoryError(404, 'source_not_found');
  if (existing.org_id !== ctx.actor.orgId) {
    throw new RegulatoryError(403, 'cannot_modify_non_tenant_source', { scope: existing.scope });
  }
  // Validate the merged date view (existing values overridden by provided ones).
  validateSourceDates({
    publication_date:
      input.publication_date !== undefined ? input.publication_date : existing.publication_date,
    effective_date:
      input.effective_date !== undefined ? input.effective_date : existing.effective_date,
    next_review_at:
      input.next_review_at !== undefined
        ? input.next_review_at
        : existing.next_review_at
          ? existing.next_review_at.toISOString()
          : null,
    notes: input.notes !== undefined ? input.notes : existing.notes,
  });

  const sets: string[] = [];
  const params: unknown[] = [];
  const col = (name: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${name} = $${params.length}${cast}`);
  };
  if (input.title !== undefined) col('title', input.title);
  if (input.jurisdiction !== undefined) col('jurisdiction', input.jurisdiction);
  if (input.authority !== undefined) col('authority', input.authority);
  if (input.instrument_type !== undefined) col('instrument_type', input.instrument_type);
  if (input.source_quality !== undefined) col('source_quality', input.source_quality);
  if (input.verification_status !== undefined) col('verification_status', input.verification_status);
  if (input.legal_status !== undefined) col('legal_status', input.legal_status);
  if (input.official_url !== undefined) col('official_url', input.official_url);
  if (input.publication_date !== undefined) col('publication_date', input.publication_date, '::date');
  if (input.effective_date !== undefined) col('effective_date', input.effective_date, '::date');
  if (input.last_verified_at !== undefined) col('last_verified_at', input.last_verified_at, '::timestamptz');
  if (input.next_review_at !== undefined) col('next_review_at', input.next_review_at, '::timestamptz');
  if (input.review_frequency !== undefined) col('review_frequency', input.review_frequency);
  if (input.legal_owner !== undefined) col('legal_owner', input.legal_owner);
  if (input.product_owner !== undefined) col('product_owner', input.product_owner);
  if (input.notes !== undefined) col('notes', input.notes);
  if (input.metadata !== undefined) col('metadata', JSON.stringify(input.metadata), '::jsonb');
  col('updated_by_user_id', ctx.actor.userId, '::uuid');
  sets.push('updated_at = now()');

  params.push(id);
  const idIdx = params.length;
  params.push(ctx.actor.orgId);
  const orgIdx = params.length;

  const res = await ctx.client.query<SourceRow>(
    `UPDATE govai.regulatory_sources SET ${sets.join(', ')}
      WHERE id = $${idIdx}::uuid AND org_id = $${orgIdx}::uuid
      RETURNING ${SOURCE_COLUMNS}`,
    params,
  );
  const row = res.rows[0];
  if (!row) throw new RegulatoryError(404, 'source_not_found');
  await appendAudit(ctx, {
    eventType: 'regulatory_source.updated',
    subjectType: 'regulatory_source',
    subjectId: row.id,
    metadata: {
      source_id: row.id,
      source_key: row.source_key,
      updated_fields: Object.keys(input),
      verification_status: row.verification_status,
      legal_status: row.legal_status,
    },
  });
  return row;
}

export type ListResult<T> = { rows: T[]; nextCursor: { before_created_at: string; before_id: string } | null };

function applyCursor(where: string[], params: unknown[], cursor: Cursor): void {
  if (cursor.before_created_at && cursor.before_id) {
    params.push(cursor.before_created_at);
    const tsIdx = params.length;
    params.push(cursor.before_id);
    const idIdx = params.length;
    where.push(
      `(created_at < $${tsIdx}::timestamptz OR (created_at = $${tsIdx}::timestamptz AND id < $${idIdx}::uuid))`,
    );
  }
}

function nextCursorFrom<T extends { created_at: Date; id: string }>(
  rows: T[],
  limit: number,
): { before_created_at: string; before_id: string } | null {
  if (rows.length !== limit) return null;
  const last = rows[rows.length - 1]!;
  return { before_created_at: last.created_at.toISOString(), before_id: last.id };
}

export async function listSources(
  ctx: Ctx,
  filters: {
    scope?: 'system' | 'tenant';
    jurisdiction?: string;
    authority?: string;
    source_quality?: string;
    verification_status?: string;
    legal_status?: string;
    q?: string;
  },
  cursor: Cursor,
): Promise<ListResult<SourceRow>> {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  const eq = (col: string, val: string | undefined) => {
    if (val === undefined) return;
    params.push(val);
    where.push(`${col} = $${params.length}`);
  };
  eq('scope', filters.scope);
  eq('jurisdiction', filters.jurisdiction);
  eq('authority', filters.authority);
  eq('source_quality', filters.source_quality);
  eq('verification_status', filters.verification_status);
  eq('legal_status', filters.legal_status);
  if (filters.q !== undefined) {
    params.push(`%${filters.q}%`);
    where.push(`(source_key ILIKE $${params.length} OR title ILIKE $${params.length})`);
  }
  applyCursor(where, params, cursor);
  params.push(cursor.limit);
  const res = await ctx.client.query<SourceRow>(
    `SELECT ${SOURCE_COLUMNS} FROM govai.regulatory_sources
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}

// ---------------------------------------------------------------------------
// Source versions
// ---------------------------------------------------------------------------

async function requireOwnedSource(ctx: Ctx, id: string): Promise<SourceRow> {
  const src = await getVisibleSource(ctx, id);
  if (!src) throw new RegulatoryError(404, 'source_not_found');
  if (src.org_id !== ctx.actor.orgId) {
    throw new RegulatoryError(403, 'cannot_modify_non_tenant_source', { scope: src.scope });
  }
  return src;
}

export async function createSourceVersion(
  ctx: Ctx,
  sourceId: string,
  input: CreateVersionInput,
): Promise<VersionRow> {
  await requireOwnedSource(ctx, sourceId);
  // Deterministic per-source version numbering, serialized by an advisory lock.
  await ctx.client.query("SELECT pg_advisory_xact_lock(hashtext('reg_source_version:' || $1)::bigint)", [
    sourceId,
  ]);
  const seqRes = await ctx.client.query<{ next: string }>(
    'SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM govai.regulatory_source_versions WHERE source_id = $1::uuid',
    [sourceId],
  );
  const versionNumber = seqRes.rows[0]?.next ?? '1';
  const res = await ctx.client.query<VersionRow>(
    `INSERT INTO govai.regulatory_source_versions
       (org_id, source_id, version_number, version_key, source_url, retrieved_at, verified_at,
        content_hash, diff_hash, archived_snapshot_hash, change_type, summary, verification_status,
        metadata, created_by_user_id)
     VALUES ($1::uuid, $2::uuid, $3::bigint, $4, $5, $6::timestamptz, $7::timestamptz,
             $8, $9, $10, $11, $12, $13, $14::jsonb, $15::uuid)
     RETURNING ${VERSION_COLUMNS}`,
    [
      ctx.actor.orgId,
      sourceId,
      versionNumber,
      input.version_key ?? null,
      input.source_url ?? null,
      input.retrieved_at ?? null,
      input.verified_at ?? null,
      input.content_hash ?? null,
      input.diff_hash ?? null,
      input.archived_snapshot_hash ?? null,
      input.change_type,
      input.summary ?? null,
      input.verification_status,
      JSON.stringify(input.metadata ?? {}),
      ctx.actor.userId,
    ],
  );
  const row = res.rows[0]!;
  await appendAudit(ctx, {
    eventType: 'regulatory_source.version_created',
    subjectType: 'regulatory_source',
    subjectId: sourceId,
    metadata: {
      source_id: sourceId,
      version_id: row.id,
      version_number: row.version_number,
      change_type: row.change_type,
      verification_status: row.verification_status,
      content_hash: row.content_hash,
      diff_hash: row.diff_hash,
    },
  });
  return row;
}

export async function listSourceVersions(
  ctx: Ctx,
  sourceId: string,
  filters: { change_type?: string },
  cursor: Cursor,
): Promise<ListResult<VersionRow>> {
  // Visibility check: the source must be visible to the caller (system or own).
  const src = await getVisibleSource(ctx, sourceId);
  if (!src) throw new RegulatoryError(404, 'source_not_found');
  const where: string[] = ['source_id = $1::uuid'];
  const params: unknown[] = [sourceId];
  if (filters.change_type !== undefined) {
    params.push(filters.change_type);
    where.push(`change_type = $${params.length}`);
  }
  applyCursor(where, params, cursor);
  params.push(cursor.limit);
  const res = await ctx.client.query<VersionRow>(
    `SELECT ${VERSION_COLUMNS} FROM govai.regulatory_source_versions
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}

export async function createSourceRelationship(
  ctx: Ctx,
  fromSourceId: string,
  input: CreateRelationshipInput,
): Promise<RelationshipRow> {
  await requireOwnedSource(ctx, fromSourceId);
  if (fromSourceId === input.to_source_id) {
    throw new RegulatoryError(400, 'self_relationship_forbidden');
  }
  const to = await getVisibleSource(ctx, input.to_source_id);
  if (!to) throw new RegulatoryError(404, 'to_source_not_found');
  let res;
  try {
    res = await ctx.client.query<RelationshipRow>(
      `INSERT INTO govai.regulatory_source_relationships
         (org_id, from_source_id, to_source_id, relationship_type, notes, created_by_user_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid)
       RETURNING ${RELATIONSHIP_COLUMNS}`,
      [
        ctx.actor.orgId,
        fromSourceId,
        input.to_source_id,
        input.relationship_type,
        input.notes ?? null,
        ctx.actor.userId,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegulatoryError(409, 'relationship_conflict', {
        relationship_type: input.relationship_type,
      });
    }
    throw err;
  }
  const row = res.rows[0]!;
  await appendAudit(ctx, {
    eventType: 'regulatory_source.relationship_created',
    subjectType: 'regulatory_source',
    subjectId: fromSourceId,
    metadata: {
      relationship_id: row.id,
      from_source_id: fromSourceId,
      to_source_id: input.to_source_id,
      relationship_type: input.relationship_type,
    },
  });
  return row;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export async function createControl(ctx: Ctx, input: CreateControlInput): Promise<ControlRow> {
  let res;
  try {
    res = await ctx.client.query<ControlRow>(
      `INSERT INTO govai.regulatory_controls
         (org_id, scope, control_key, domain, name, description, capability_type,
          implementation_state, build_decision, automation_level, owner_role, review_frequency,
          evidence_required, current_govai_primitive, metadata, created_by_user_id, updated_by_user_id)
       VALUES ($1::uuid, 'tenant', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               $12::jsonb, $13::jsonb, $14::jsonb, $15::uuid, $15::uuid)
       RETURNING ${CONTROL_COLUMNS}`,
      [
        ctx.actor.orgId,
        input.control_key,
        input.domain,
        input.name,
        input.description,
        input.capability_type,
        input.implementation_state,
        input.build_decision,
        input.automation_level,
        input.owner_role ?? null,
        input.review_frequency,
        JSON.stringify(input.evidence_required ?? []),
        JSON.stringify(input.current_govai_primitive ?? {}),
        JSON.stringify(input.metadata ?? {}),
        ctx.actor.userId,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegulatoryError(409, 'control_key_conflict', { control_key: input.control_key });
    }
    throw err;
  }
  const row = res.rows[0]!;
  await appendAudit(ctx, {
    eventType: 'regulatory_control.created',
    subjectType: 'regulatory_control',
    subjectId: row.id,
    metadata: {
      control_id: row.id,
      control_key: row.control_key,
      scope: row.scope,
      domain: row.domain,
      capability_type: row.capability_type,
      implementation_state: row.implementation_state,
      build_decision: row.build_decision,
    },
  });
  return row;
}

export async function getVisibleControl(ctx: Ctx, id: string): Promise<ControlRow | null> {
  const r = await ctx.client.query<ControlRow>(
    `SELECT ${CONTROL_COLUMNS} FROM govai.regulatory_controls WHERE id = $1::uuid`,
    [id],
  );
  return r.rows[0] ?? null;
}

async function requireOwnedControl(ctx: Ctx, id: string): Promise<ControlRow> {
  const ctrl = await getVisibleControl(ctx, id);
  if (!ctrl) throw new RegulatoryError(404, 'control_not_found');
  if (ctrl.org_id !== ctx.actor.orgId) {
    throw new RegulatoryError(403, 'cannot_modify_non_tenant_control', { scope: ctrl.scope });
  }
  return ctrl;
}

export async function updateControl(
  ctx: Ctx,
  id: string,
  input: UpdateControlInput,
): Promise<ControlRow> {
  await requireOwnedControl(ctx, id);
  const sets: string[] = [];
  const params: unknown[] = [];
  const col = (name: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${name} = $${params.length}${cast}`);
  };
  if (input.domain !== undefined) col('domain', input.domain);
  if (input.name !== undefined) col('name', input.name);
  if (input.description !== undefined) col('description', input.description);
  if (input.capability_type !== undefined) col('capability_type', input.capability_type);
  if (input.implementation_state !== undefined) col('implementation_state', input.implementation_state);
  if (input.build_decision !== undefined) col('build_decision', input.build_decision);
  if (input.automation_level !== undefined) col('automation_level', input.automation_level);
  if (input.owner_role !== undefined) col('owner_role', input.owner_role);
  if (input.review_frequency !== undefined) col('review_frequency', input.review_frequency);
  if (input.evidence_required !== undefined)
    col('evidence_required', JSON.stringify(input.evidence_required), '::jsonb');
  if (input.current_govai_primitive !== undefined)
    col('current_govai_primitive', JSON.stringify(input.current_govai_primitive), '::jsonb');
  if (input.metadata !== undefined) col('metadata', JSON.stringify(input.metadata), '::jsonb');
  col('updated_by_user_id', ctx.actor.userId, '::uuid');
  sets.push('updated_at = now()');

  params.push(id);
  const idIdx = params.length;
  params.push(ctx.actor.orgId);
  const orgIdx = params.length;
  const res = await ctx.client.query<ControlRow>(
    `UPDATE govai.regulatory_controls SET ${sets.join(', ')}
      WHERE id = $${idIdx}::uuid AND org_id = $${orgIdx}::uuid
      RETURNING ${CONTROL_COLUMNS}`,
    params,
  );
  const row = res.rows[0];
  if (!row) throw new RegulatoryError(404, 'control_not_found');
  await appendAudit(ctx, {
    eventType: 'regulatory_control.updated',
    subjectType: 'regulatory_control',
    subjectId: row.id,
    metadata: {
      control_id: row.id,
      control_key: row.control_key,
      updated_fields: Object.keys(input),
      capability_type: row.capability_type,
      implementation_state: row.implementation_state,
    },
  });
  return row;
}

export async function listControls(
  ctx: Ctx,
  filters: {
    scope?: 'system' | 'tenant';
    domain?: string;
    capability_type?: string;
    implementation_state?: string;
    build_decision?: string;
    framework_key?: string;
    q?: string;
  },
  cursor: Cursor,
): Promise<ListResult<ControlRow>> {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  const eq = (column: string, val: string | undefined) => {
    if (val === undefined) return;
    params.push(val);
    where.push(`c.${column} = $${params.length}`);
  };
  eq('scope', filters.scope);
  eq('domain', filters.domain);
  eq('capability_type', filters.capability_type);
  eq('implementation_state', filters.implementation_state);
  eq('build_decision', filters.build_decision);
  if (filters.q !== undefined) {
    params.push(`%${filters.q}%`);
    where.push(`(c.control_key ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
  }
  if (filters.framework_key !== undefined) {
    params.push(filters.framework_key);
    where.push(
      `EXISTS (SELECT 1 FROM govai.regulatory_control_framework_mappings m
                WHERE m.control_id = c.id AND m.framework_key = $${params.length})`,
    );
  }
  if (cursor.before_created_at && cursor.before_id) {
    params.push(cursor.before_created_at);
    const tsIdx = params.length;
    params.push(cursor.before_id);
    const idIdx = params.length;
    where.push(
      `(c.created_at < $${tsIdx}::timestamptz OR (c.created_at = $${tsIdx}::timestamptz AND c.id < $${idIdx}::uuid))`,
    );
  }
  params.push(cursor.limit);
  const res = await ctx.client.query<ControlRow>(
    `SELECT c.* FROM govai.regulatory_controls c
      WHERE ${where.join(' AND ')}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}

// ---------------------------------------------------------------------------
// Control → source links
// ---------------------------------------------------------------------------

export async function createControlSourceLink(
  ctx: Ctx,
  controlId: string,
  input: CreateSourceLinkInput,
): Promise<LinkRow> {
  await requireOwnedControl(ctx, controlId);
  const src = await getVisibleSource(ctx, input.source_id);
  if (!src) throw new RegulatoryError(404, 'source_not_found');
  let res;
  try {
    res = await ctx.client.query<LinkRow>(
      `INSERT INTO govai.regulatory_control_source_links
         (org_id, control_id, source_id, link_type, requirement_ref, notes, created_by_user_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::uuid)
       RETURNING ${LINK_COLUMNS}`,
      [
        ctx.actor.orgId,
        controlId,
        input.source_id,
        input.link_type,
        input.requirement_ref ?? '',
        input.notes ?? null,
        ctx.actor.userId,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegulatoryError(409, 'source_link_conflict', { link_type: input.link_type });
    }
    throw err;
  }
  const row = res.rows[0]!;
  await appendAudit(ctx, {
    eventType: 'regulatory_control.source_link_created',
    subjectType: 'regulatory_control',
    subjectId: controlId,
    metadata: {
      link_id: row.id,
      control_id: controlId,
      source_id: input.source_id,
      link_type: input.link_type,
      requirement_ref: row.requirement_ref,
    },
  });
  return row;
}

export async function listControlSourceLinks(
  ctx: Ctx,
  controlId: string,
  filters: { link_type?: string },
  cursor: Cursor,
): Promise<ListResult<LinkRow>> {
  const ctrl = await getVisibleControl(ctx, controlId);
  if (!ctrl) throw new RegulatoryError(404, 'control_not_found');
  const where: string[] = ['control_id = $1::uuid'];
  const params: unknown[] = [controlId];
  if (filters.link_type !== undefined) {
    params.push(filters.link_type);
    where.push(`link_type = $${params.length}`);
  }
  applyCursor(where, params, cursor);
  params.push(cursor.limit);
  const res = await ctx.client.query<LinkRow>(
    `SELECT ${LINK_COLUMNS} FROM govai.regulatory_control_source_links
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}

// ---------------------------------------------------------------------------
// Control → framework mappings
// ---------------------------------------------------------------------------

export async function createFrameworkMapping(
  ctx: Ctx,
  controlId: string,
  input: CreateFrameworkMappingInput,
): Promise<MappingRow> {
  await requireOwnedControl(ctx, controlId);
  if (input.source_id !== undefined) {
    const src = await getVisibleSource(ctx, input.source_id);
    if (!src) throw new RegulatoryError(404, 'source_not_found');
  }
  let res;
  try {
    res = await ctx.client.query<MappingRow>(
      `INSERT INTO govai.regulatory_control_framework_mappings
         (org_id, control_id, framework_key, requirement_ref, requirement_title, mapping_status,
          source_id, notes, metadata, created_by_user_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9::jsonb, $10::uuid)
       RETURNING ${MAPPING_COLUMNS}`,
      [
        ctx.actor.orgId,
        controlId,
        input.framework_key,
        input.requirement_ref ?? '',
        input.requirement_title ?? null,
        input.mapping_status,
        input.source_id ?? null,
        input.notes ?? null,
        JSON.stringify(input.metadata ?? {}),
        ctx.actor.userId,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegulatoryError(409, 'framework_mapping_conflict', {
        framework_key: input.framework_key,
      });
    }
    throw err;
  }
  const row = res.rows[0]!;
  await appendAudit(ctx, {
    eventType: 'regulatory_control.framework_mapping_created',
    subjectType: 'regulatory_control',
    subjectId: controlId,
    metadata: {
      mapping_id: row.id,
      control_id: controlId,
      framework_key: input.framework_key,
      requirement_ref: row.requirement_ref,
      mapping_status: input.mapping_status,
      source_id: input.source_id ?? null,
    },
  });
  return row;
}

export async function listFrameworkMappings(
  ctx: Ctx,
  controlId: string,
  filters: { framework_key?: string; mapping_status?: string },
  cursor: Cursor,
): Promise<ListResult<MappingRow>> {
  const ctrl = await getVisibleControl(ctx, controlId);
  if (!ctrl) throw new RegulatoryError(404, 'control_not_found');
  const where: string[] = ['control_id = $1::uuid'];
  const params: unknown[] = [controlId];
  if (filters.framework_key !== undefined) {
    params.push(filters.framework_key);
    where.push(`framework_key = $${params.length}`);
  }
  if (filters.mapping_status !== undefined) {
    params.push(filters.mapping_status);
    where.push(`mapping_status = $${params.length}`);
  }
  applyCursor(where, params, cursor);
  params.push(cursor.limit);
  const res = await ctx.client.query<MappingRow>(
    `SELECT ${MAPPING_COLUMNS} FROM govai.regulatory_control_framework_mappings
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}

// ---------------------------------------------------------------------------
// AI System Registry (PR-R2)
// ---------------------------------------------------------------------------

export type AiSystemRow = {
  id: string;
  org_id: string;
  system_key: string;
  name: string;
  description: string;
  system_type: string;
  lifecycle_state: string;
  business_owner: string | null;
  technical_owner: string | null;
  legal_owner: string | null;
  dpo_owner: string | null;
  intended_purpose: string;
  primary_jurisdiction: string;
  deployment_environment: string;
  external_provider_id: string | null;
  regulatory_source_id: string | null;
  control_id: string | null;
  review_frequency: string;
  last_reviewed_at: Date | null;
  next_review_at: Date | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const AI_SYSTEM_COLUMNS = `id, org_id, system_key, name, description, system_type, lifecycle_state,
  business_owner, technical_owner, legal_owner, dpo_owner, intended_purpose, primary_jurisdiction,
  deployment_environment, external_provider_id, regulatory_source_id, control_id, review_frequency,
  last_reviewed_at, next_review_at, metadata, created_by_user_id, updated_by_user_id,
  created_at, updated_at`;

/**
 * Validate that an optional parent reference resolves to a row visible to the
 * caller (own-tenant or system). The DB RLS WITH CHECK is the backstop; this
 * gives a clean 404 instead of an opaque RLS violation. A hidden cross-tenant
 * parent is invisible here and so reports as not-found, never as forbidden,
 * avoiding an existence oracle.
 */
async function requireVisibleParents(
  ctx: Ctx,
  refs: { regulatory_source_id?: string | null; control_id?: string | null },
): Promise<void> {
  if (refs.regulatory_source_id) {
    const src = await getVisibleSource(ctx, refs.regulatory_source_id);
    if (!src) throw new RegulatoryError(404, 'regulatory_source_not_found');
  }
  if (refs.control_id) {
    const ctrl = await getVisibleControl(ctx, refs.control_id);
    if (!ctrl) throw new RegulatoryError(404, 'control_not_found');
  }
}

export async function createAiSystem(ctx: Ctx, input: CreateAiSystemInput): Promise<AiSystemRow> {
  await requireVisibleParents(ctx, {
    regulatory_source_id: input.regulatory_source_id ?? null,
    control_id: input.control_id ?? null,
  });
  let res;
  try {
    res = await ctx.client.query<AiSystemRow>(
      `INSERT INTO govai.regulatory_ai_systems
         (org_id, system_key, name, description, system_type, lifecycle_state,
          business_owner, technical_owner, legal_owner, dpo_owner, intended_purpose,
          primary_jurisdiction, deployment_environment, external_provider_id,
          regulatory_source_id, control_id, review_frequency, last_reviewed_at, next_review_at,
          metadata, created_by_user_id, updated_by_user_id)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14::uuid, $15::uuid, $16::uuid, $17, $18::timestamptz, $19::timestamptz,
               $20::jsonb, $21::uuid, $21::uuid)
       RETURNING ${AI_SYSTEM_COLUMNS}`,
      [
        ctx.actor.orgId,
        input.system_key,
        input.name,
        input.description,
        input.system_type,
        input.lifecycle_state,
        input.business_owner ?? null,
        input.technical_owner ?? null,
        input.legal_owner ?? null,
        input.dpo_owner ?? null,
        input.intended_purpose,
        input.primary_jurisdiction,
        input.deployment_environment,
        input.external_provider_id ?? null,
        input.regulatory_source_id ?? null,
        input.control_id ?? null,
        input.review_frequency,
        input.last_reviewed_at ?? null,
        input.next_review_at ?? null,
        JSON.stringify(input.metadata ?? {}),
        ctx.actor.userId,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegulatoryError(409, 'ai_system_key_conflict', { system_key: input.system_key });
    }
    throw err;
  }
  const row = res.rows[0]!;
  await appendAudit(ctx, {
    eventType: 'regulatory_ai_system.created',
    subjectType: 'regulatory_ai_system',
    subjectId: row.id,
    metadata: {
      ai_system_id: row.id,
      system_key: row.system_key,
      system_type: row.system_type,
      lifecycle_state: row.lifecycle_state,
      deployment_environment: row.deployment_environment,
      primary_jurisdiction: row.primary_jurisdiction,
      regulatory_source_id: row.regulatory_source_id,
      control_id: row.control_id,
    },
  });
  return row;
}

export async function getVisibleAiSystem(ctx: Ctx, id: string): Promise<AiSystemRow | null> {
  const r = await ctx.client.query<AiSystemRow>(
    `SELECT ${AI_SYSTEM_COLUMNS} FROM govai.regulatory_ai_systems WHERE id = $1::uuid`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function updateAiSystem(
  ctx: Ctx,
  id: string,
  input: UpdateAiSystemInput,
): Promise<AiSystemRow> {
  // RLS already scopes visibility to the caller's org, so another tenant's row
  // (or a missing id) reads as null → 404 with no leakage.
  const existing = await getVisibleAiSystem(ctx, id);
  if (!existing) throw new RegulatoryError(404, 'ai_system_not_found');
  await requireVisibleParents(ctx, {
    regulatory_source_id:
      input.regulatory_source_id !== undefined
        ? input.regulatory_source_id
        : existing.regulatory_source_id,
    control_id: input.control_id !== undefined ? input.control_id : existing.control_id,
  });

  const sets: string[] = [];
  const params: unknown[] = [];
  const col = (name: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${name} = $${params.length}${cast}`);
  };
  if (input.name !== undefined) col('name', input.name);
  if (input.description !== undefined) col('description', input.description);
  if (input.system_type !== undefined) col('system_type', input.system_type);
  if (input.lifecycle_state !== undefined) col('lifecycle_state', input.lifecycle_state);
  if (input.business_owner !== undefined) col('business_owner', input.business_owner);
  if (input.technical_owner !== undefined) col('technical_owner', input.technical_owner);
  if (input.legal_owner !== undefined) col('legal_owner', input.legal_owner);
  if (input.dpo_owner !== undefined) col('dpo_owner', input.dpo_owner);
  if (input.intended_purpose !== undefined) col('intended_purpose', input.intended_purpose);
  if (input.primary_jurisdiction !== undefined) col('primary_jurisdiction', input.primary_jurisdiction);
  if (input.deployment_environment !== undefined) col('deployment_environment', input.deployment_environment);
  if (input.external_provider_id !== undefined) col('external_provider_id', input.external_provider_id, '::uuid');
  if (input.regulatory_source_id !== undefined) col('regulatory_source_id', input.regulatory_source_id, '::uuid');
  if (input.control_id !== undefined) col('control_id', input.control_id, '::uuid');
  if (input.review_frequency !== undefined) col('review_frequency', input.review_frequency);
  if (input.last_reviewed_at !== undefined) col('last_reviewed_at', input.last_reviewed_at, '::timestamptz');
  if (input.next_review_at !== undefined) col('next_review_at', input.next_review_at, '::timestamptz');
  if (input.metadata !== undefined) col('metadata', JSON.stringify(input.metadata), '::jsonb');
  col('updated_by_user_id', ctx.actor.userId, '::uuid');
  sets.push('updated_at = now()');

  params.push(id);
  const idIdx = params.length;
  params.push(ctx.actor.orgId);
  const orgIdx = params.length;
  const res = await ctx.client.query<AiSystemRow>(
    `UPDATE govai.regulatory_ai_systems SET ${sets.join(', ')}
      WHERE id = $${idIdx}::uuid AND org_id = $${orgIdx}::uuid
      RETURNING ${AI_SYSTEM_COLUMNS}`,
    params,
  );
  const row = res.rows[0];
  if (!row) throw new RegulatoryError(404, 'ai_system_not_found');

  const lifecycleChanged =
    input.lifecycle_state !== undefined && input.lifecycle_state !== existing.lifecycle_state;

  await appendAudit(ctx, {
    eventType: 'regulatory_ai_system.updated',
    subjectType: 'regulatory_ai_system',
    subjectId: row.id,
    metadata: {
      ai_system_id: row.id,
      system_key: row.system_key,
      changed_fields: Object.keys(input),
      lifecycle_state: row.lifecycle_state,
      ...(lifecycleChanged ? { previous_lifecycle_state: existing.lifecycle_state } : {}),
    },
  });
  // A lifecycle transition is governance-significant evidence in its own right;
  // emit a dedicated event in addition to `updated`. auditAppend chains both
  // sequentially within this transaction.
  if (lifecycleChanged) {
    await appendAudit(ctx, {
      eventType: 'regulatory_ai_system.lifecycle_changed',
      subjectType: 'regulatory_ai_system',
      subjectId: row.id,
      metadata: {
        ai_system_id: row.id,
        system_key: row.system_key,
        previous_lifecycle_state: existing.lifecycle_state,
        lifecycle_state: row.lifecycle_state,
      },
    });
  }
  return row;
}

export async function listAiSystems(
  ctx: Ctx,
  filters: {
    system_type?: string;
    lifecycle_state?: string;
    primary_jurisdiction?: string;
    deployment_environment?: string;
    q?: string;
  },
  cursor: Cursor,
): Promise<ListResult<AiSystemRow>> {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  const eq = (column: string, val: string | undefined) => {
    if (val === undefined) return;
    params.push(val);
    where.push(`${column} = $${params.length}`);
  };
  eq('system_type', filters.system_type);
  eq('lifecycle_state', filters.lifecycle_state);
  eq('primary_jurisdiction', filters.primary_jurisdiction);
  eq('deployment_environment', filters.deployment_environment);
  if (filters.q !== undefined) {
    params.push(`%${filters.q}%`);
    const i = params.length;
    where.push(
      `(system_key ILIKE $${i} OR name ILIKE $${i} OR description ILIKE $${i} OR intended_purpose ILIKE $${i})`,
    );
  }
  applyCursor(where, params, cursor);
  params.push(cursor.limit);
  const res = await ctx.client.query<AiSystemRow>(
    `SELECT ${AI_SYSTEM_COLUMNS} FROM govai.regulatory_ai_systems
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}

// ---------------------------------------------------------------------------
// Provider Registry (PR-R3)
// ---------------------------------------------------------------------------

export type ProviderRow = {
  id: string;
  org_id: string;
  provider_key: string;
  name: string;
  description: string;
  provider_type: string;
  provider_status: string;
  deployment_model: string;
  data_processing_role: string;
  primary_jurisdiction: string;
  headquarters_country: string | null;
  website_url: string | null;
  contact_name: string | null;
  contact_email: string | null;
  dpa_status: string;
  security_review_status: string;
  subprocessors_review_status: string;
  ai_terms_review_status: string;
  last_reviewed_at: Date | null;
  next_review_at: Date | null;
  review_frequency: string;
  regulatory_source_id: string | null;
  control_id: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const PROVIDER_COLUMNS = `id, org_id, provider_key, name, description, provider_type, provider_status,
  deployment_model, data_processing_role, primary_jurisdiction, headquarters_country, website_url,
  contact_name, contact_email, dpa_status, security_review_status, subprocessors_review_status,
  ai_terms_review_status, last_reviewed_at, next_review_at, review_frequency, regulatory_source_id,
  control_id, metadata, created_by_user_id, updated_by_user_id, created_at, updated_at`;

// The review-status fields whose changes trigger a review_status_changed event.
const PROVIDER_REVIEW_FIELDS = [
  'dpa_status',
  'security_review_status',
  'subprocessors_review_status',
  'ai_terms_review_status',
] as const;

export async function createProvider(ctx: Ctx, input: CreateProviderInput): Promise<ProviderRow> {
  await requireVisibleParents(ctx, {
    regulatory_source_id: input.regulatory_source_id ?? null,
    control_id: input.control_id ?? null,
  });
  let res;
  try {
    res = await ctx.client.query<ProviderRow>(
      `INSERT INTO govai.regulatory_providers
         (org_id, provider_key, name, description, provider_type, provider_status, deployment_model,
          data_processing_role, primary_jurisdiction, headquarters_country, website_url, contact_name,
          contact_email, dpa_status, security_review_status, subprocessors_review_status,
          ai_terms_review_status, last_reviewed_at, next_review_at, review_frequency,
          regulatory_source_id, control_id, metadata, created_by_user_id, updated_by_user_id)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
               $18::timestamptz, $19::timestamptz, $20, $21::uuid, $22::uuid, $23::jsonb, $24::uuid, $24::uuid)
       RETURNING ${PROVIDER_COLUMNS}`,
      [
        ctx.actor.orgId,
        input.provider_key,
        input.name,
        input.description,
        input.provider_type,
        input.provider_status,
        input.deployment_model,
        input.data_processing_role,
        input.primary_jurisdiction,
        input.headquarters_country ?? null,
        input.website_url ?? null,
        input.contact_name ?? null,
        input.contact_email ?? null,
        input.dpa_status,
        input.security_review_status,
        input.subprocessors_review_status,
        input.ai_terms_review_status,
        input.last_reviewed_at ?? null,
        input.next_review_at ?? null,
        input.review_frequency,
        input.regulatory_source_id ?? null,
        input.control_id ?? null,
        JSON.stringify(input.metadata ?? {}),
        ctx.actor.userId,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegulatoryError(409, 'provider_key_conflict', { provider_key: input.provider_key });
    }
    throw err;
  }
  const row = res.rows[0]!;
  await appendAudit(ctx, {
    eventType: 'regulatory_provider.created',
    subjectType: 'regulatory_provider',
    subjectId: row.id,
    metadata: {
      provider_id: row.id,
      provider_key: row.provider_key,
      provider_type: row.provider_type,
      provider_status: row.provider_status,
      data_processing_role: row.data_processing_role,
      primary_jurisdiction: row.primary_jurisdiction,
      regulatory_source_id: row.regulatory_source_id,
      control_id: row.control_id,
    },
  });
  return row;
}

export async function getVisibleProvider(ctx: Ctx, id: string): Promise<ProviderRow | null> {
  const r = await ctx.client.query<ProviderRow>(
    `SELECT ${PROVIDER_COLUMNS} FROM govai.regulatory_providers WHERE id = $1::uuid`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function updateProvider(
  ctx: Ctx,
  id: string,
  input: UpdateProviderInput,
): Promise<ProviderRow> {
  // RLS already scopes visibility to the caller's org, so another tenant's row
  // (or a missing id) reads as null → 404 with no leakage.
  const existing = await getVisibleProvider(ctx, id);
  if (!existing) throw new RegulatoryError(404, 'provider_not_found');
  await requireVisibleParents(ctx, {
    regulatory_source_id:
      input.regulatory_source_id !== undefined
        ? input.regulatory_source_id
        : existing.regulatory_source_id,
    control_id: input.control_id !== undefined ? input.control_id : existing.control_id,
  });

  const sets: string[] = [];
  const params: unknown[] = [];
  const col = (name: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${name} = $${params.length}${cast}`);
  };
  if (input.name !== undefined) col('name', input.name);
  if (input.description !== undefined) col('description', input.description);
  if (input.provider_type !== undefined) col('provider_type', input.provider_type);
  if (input.provider_status !== undefined) col('provider_status', input.provider_status);
  if (input.deployment_model !== undefined) col('deployment_model', input.deployment_model);
  if (input.data_processing_role !== undefined) col('data_processing_role', input.data_processing_role);
  if (input.primary_jurisdiction !== undefined) col('primary_jurisdiction', input.primary_jurisdiction);
  if (input.headquarters_country !== undefined) col('headquarters_country', input.headquarters_country);
  if (input.website_url !== undefined) col('website_url', input.website_url);
  if (input.contact_name !== undefined) col('contact_name', input.contact_name);
  if (input.contact_email !== undefined) col('contact_email', input.contact_email);
  if (input.dpa_status !== undefined) col('dpa_status', input.dpa_status);
  if (input.security_review_status !== undefined) col('security_review_status', input.security_review_status);
  if (input.subprocessors_review_status !== undefined)
    col('subprocessors_review_status', input.subprocessors_review_status);
  if (input.ai_terms_review_status !== undefined) col('ai_terms_review_status', input.ai_terms_review_status);
  if (input.last_reviewed_at !== undefined) col('last_reviewed_at', input.last_reviewed_at, '::timestamptz');
  if (input.next_review_at !== undefined) col('next_review_at', input.next_review_at, '::timestamptz');
  if (input.review_frequency !== undefined) col('review_frequency', input.review_frequency);
  if (input.regulatory_source_id !== undefined) col('regulatory_source_id', input.regulatory_source_id, '::uuid');
  if (input.control_id !== undefined) col('control_id', input.control_id, '::uuid');
  if (input.metadata !== undefined) col('metadata', JSON.stringify(input.metadata), '::jsonb');
  col('updated_by_user_id', ctx.actor.userId, '::uuid');
  sets.push('updated_at = now()');

  params.push(id);
  const idIdx = params.length;
  params.push(ctx.actor.orgId);
  const orgIdx = params.length;
  const res = await ctx.client.query<ProviderRow>(
    `UPDATE govai.regulatory_providers SET ${sets.join(', ')}
      WHERE id = $${idIdx}::uuid AND org_id = $${orgIdx}::uuid
      RETURNING ${PROVIDER_COLUMNS}`,
    params,
  );
  const row = res.rows[0];
  if (!row) throw new RegulatoryError(404, 'provider_not_found');

  const statusChanged =
    input.provider_status !== undefined && input.provider_status !== existing.provider_status;
  // Collect each review-status field that actually changed value.
  const reviewChanges: Record<string, { from: string; to: string }> = {};
  for (const field of PROVIDER_REVIEW_FIELDS) {
    const next = (input as Record<string, unknown>)[field];
    if (next !== undefined && next !== existing[field]) {
      reviewChanges[field] = { from: existing[field], to: next as string };
    }
  }
  const reviewChanged = Object.keys(reviewChanges).length > 0;

  await appendAudit(ctx, {
    eventType: 'regulatory_provider.updated',
    subjectType: 'regulatory_provider',
    subjectId: row.id,
    metadata: {
      provider_id: row.id,
      provider_key: row.provider_key,
      changed_fields: Object.keys(input),
      provider_status: row.provider_status,
      ...(statusChanged ? { previous_provider_status: existing.provider_status } : {}),
      ...(reviewChanged ? { review_status_changes: reviewChanges } : {}),
    },
  });
  // A provider_status transition is governance-significant evidence; emit a
  // dedicated event in addition to `updated`. auditAppend chains sequentially.
  if (statusChanged) {
    await appendAudit(ctx, {
      eventType: 'regulatory_provider.status_changed',
      subjectType: 'regulatory_provider',
      subjectId: row.id,
      metadata: {
        provider_id: row.id,
        provider_key: row.provider_key,
        previous_provider_status: existing.provider_status,
        provider_status: row.provider_status,
      },
    });
  }
  // Any review-posture transition is likewise tracked as its own evidence event.
  if (reviewChanged) {
    await appendAudit(ctx, {
      eventType: 'regulatory_provider.review_status_changed',
      subjectType: 'regulatory_provider',
      subjectId: row.id,
      metadata: {
        provider_id: row.id,
        provider_key: row.provider_key,
        review_status_changes: reviewChanges,
      },
    });
  }
  return row;
}

export async function listProviders(
  ctx: Ctx,
  filters: {
    provider_type?: string;
    provider_status?: string;
    deployment_model?: string;
    data_processing_role?: string;
    primary_jurisdiction?: string;
    security_review_status?: string;
    dpa_status?: string;
    q?: string;
  },
  cursor: Cursor,
): Promise<ListResult<ProviderRow>> {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  const eq = (column: string, val: string | undefined) => {
    if (val === undefined) return;
    params.push(val);
    where.push(`${column} = $${params.length}`);
  };
  eq('provider_type', filters.provider_type);
  eq('provider_status', filters.provider_status);
  eq('deployment_model', filters.deployment_model);
  eq('data_processing_role', filters.data_processing_role);
  eq('primary_jurisdiction', filters.primary_jurisdiction);
  eq('security_review_status', filters.security_review_status);
  eq('dpa_status', filters.dpa_status);
  if (filters.q !== undefined) {
    params.push(`%${filters.q}%`);
    const i = params.length;
    where.push(
      `(provider_key ILIKE $${i} OR name ILIKE $${i} OR description ILIKE $${i} OR contact_email ILIKE $${i})`,
    );
  }
  applyCursor(where, params, cursor);
  params.push(cursor.limit);
  const res = await ctx.client.query<ProviderRow>(
    `SELECT ${PROVIDER_COLUMNS} FROM govai.regulatory_providers
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}

// ---------------------------------------------------------------------------
// Model Registry (PR-R4)
// ---------------------------------------------------------------------------

export type ModelRow = {
  id: string;
  org_id: string;
  model_key: string;
  name: string;
  description: string;
  model_type: string;
  model_status: string;
  provider_id: string;
  primary_ai_system_id: string | null;
  primary_jurisdiction: string;
  business_owner: string | null;
  technical_owner: string | null;
  legal_owner: string | null;
  dpo_owner: string | null;
  intended_use: string;
  prohibited_uses: string;
  training_data_summary: string;
  evaluation_summary: string;
  human_oversight_summary: string;
  last_reviewed_at: Date | null;
  next_review_at: Date | null;
  review_frequency: string;
  regulatory_source_id: string | null;
  control_id: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const MODEL_COLUMNS = `id, org_id, model_key, name, description, model_type, model_status, provider_id,
  primary_ai_system_id, primary_jurisdiction, business_owner, technical_owner, legal_owner, dpo_owner,
  intended_use, prohibited_uses, training_data_summary, evaluation_summary, human_oversight_summary,
  last_reviewed_at, next_review_at, review_frequency, regulatory_source_id, control_id, metadata,
  created_by_user_id, updated_by_user_id, created_at, updated_at`;

export type ModelVersionRow = {
  id: string;
  org_id: string;
  model_id: string;
  version_key: string;
  version_label: string;
  version_status: string;
  provider_model_name: string | null;
  provider_model_version: string | null;
  artifact_uri: string | null;
  artifact_hash: string | null;
  training_data_hash: string | null;
  evaluation_dataset_hash: string | null;
  evaluation_score_summary: string;
  release_notes: string;
  approval_reference: string | null;
  approved_at: Date | null;
  approved_by_user_id: string | null;
  retired_at: Date | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const MODEL_VERSION_COLUMNS = `id, org_id, model_id, version_key, version_label, version_status,
  provider_model_name, provider_model_version, artifact_uri, artifact_hash, training_data_hash,
  evaluation_dataset_hash, evaluation_score_summary, release_notes, approval_reference, approved_at,
  approved_by_user_id, retired_at, metadata, created_by_user_id, updated_by_user_id, created_at, updated_at`;

export type AiSystemModelLinkRow = {
  id: string;
  org_id: string;
  ai_system_id: string;
  model_id: string;
  model_version_id: string;
  link_status: string;
  usage_role: string;
  deployment_environment: string;
  effective_from: Date | null;
  effective_to: Date | null;
  rationale: string;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const LINK_MODEL_COLUMNS = `id, org_id, ai_system_id, model_id, model_version_id, link_status, usage_role,
  deployment_environment, effective_from, effective_to, rationale, metadata, created_by_user_id,
  updated_by_user_id, created_at, updated_at`;

const VERSION_APPROVAL_STATES = new Set(['APPROVED', 'ACTIVE']);

// Models reference an own-tenant provider (required) and optionally an own-tenant
// AI system, plus optionally own/system source/control. Service-level checks give
// clean 404s; the DB RLS WITH CHECK is the backstop.
async function requireModelParents(
  ctx: Ctx,
  refs: {
    provider_id?: string | null;
    primary_ai_system_id?: string | null;
    regulatory_source_id?: string | null;
    control_id?: string | null;
  },
): Promise<void> {
  if (refs.provider_id) {
    const p = await getVisibleProvider(ctx, refs.provider_id);
    if (!p) throw new RegulatoryError(404, 'provider_not_found');
  }
  if (refs.primary_ai_system_id) {
    const a = await getVisibleAiSystem(ctx, refs.primary_ai_system_id);
    if (!a) throw new RegulatoryError(404, 'ai_system_not_found');
  }
  await requireVisibleParents(ctx, {
    regulatory_source_id: refs.regulatory_source_id ?? null,
    control_id: refs.control_id ?? null,
  });
}

export async function createModel(ctx: Ctx, input: CreateModelInput): Promise<ModelRow> {
  await requireModelParents(ctx, {
    provider_id: input.provider_id,
    primary_ai_system_id: input.primary_ai_system_id ?? null,
    regulatory_source_id: input.regulatory_source_id ?? null,
    control_id: input.control_id ?? null,
  });
  let res;
  try {
    res = await ctx.client.query<ModelRow>(
      `INSERT INTO govai.regulatory_models
         (org_id, model_key, name, description, model_type, model_status, provider_id,
          primary_ai_system_id, primary_jurisdiction, business_owner, technical_owner, legal_owner,
          dpo_owner, intended_use, prohibited_uses, training_data_summary, evaluation_summary,
          human_oversight_summary, last_reviewed_at, next_review_at, review_frequency,
          regulatory_source_id, control_id, metadata, created_by_user_id, updated_by_user_id)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid, $8::uuid, $9, $10, $11, $12, $13, $14, $15, $16,
               $17, $18, $19::timestamptz, $20::timestamptz, $21, $22::uuid, $23::uuid, $24::jsonb,
               $25::uuid, $25::uuid)
       RETURNING ${MODEL_COLUMNS}`,
      [
        ctx.actor.orgId,
        input.model_key,
        input.name,
        input.description,
        input.model_type,
        input.model_status,
        input.provider_id,
        input.primary_ai_system_id ?? null,
        input.primary_jurisdiction,
        input.business_owner ?? null,
        input.technical_owner ?? null,
        input.legal_owner ?? null,
        input.dpo_owner ?? null,
        input.intended_use,
        input.prohibited_uses,
        input.training_data_summary,
        input.evaluation_summary,
        input.human_oversight_summary,
        input.last_reviewed_at ?? null,
        input.next_review_at ?? null,
        input.review_frequency,
        input.regulatory_source_id ?? null,
        input.control_id ?? null,
        JSON.stringify(input.metadata ?? {}),
        ctx.actor.userId,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegulatoryError(409, 'model_key_conflict', { model_key: input.model_key });
    }
    throw err;
  }
  const row = res.rows[0]!;
  await appendAudit(ctx, {
    eventType: 'regulatory_model.created',
    subjectType: 'regulatory_model',
    subjectId: row.id,
    metadata: {
      model_id: row.id,
      model_key: row.model_key,
      model_type: row.model_type,
      model_status: row.model_status,
      provider_id: row.provider_id,
      primary_ai_system_id: row.primary_ai_system_id,
    },
  });
  return row;
}

export async function getVisibleModel(ctx: Ctx, id: string): Promise<ModelRow | null> {
  const r = await ctx.client.query<ModelRow>(
    `SELECT ${MODEL_COLUMNS} FROM govai.regulatory_models WHERE id = $1::uuid`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function updateModel(ctx: Ctx, id: string, input: UpdateModelInput): Promise<ModelRow> {
  const existing = await getVisibleModel(ctx, id);
  if (!existing) throw new RegulatoryError(404, 'model_not_found');
  await requireModelParents(ctx, {
    provider_id: input.provider_id !== undefined ? input.provider_id : existing.provider_id,
    primary_ai_system_id:
      input.primary_ai_system_id !== undefined ? input.primary_ai_system_id : existing.primary_ai_system_id,
    regulatory_source_id:
      input.regulatory_source_id !== undefined ? input.regulatory_source_id : existing.regulatory_source_id,
    control_id: input.control_id !== undefined ? input.control_id : existing.control_id,
  });

  const sets: string[] = [];
  const params: unknown[] = [];
  const col = (name: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${name} = $${params.length}${cast}`);
  };
  if (input.name !== undefined) col('name', input.name);
  if (input.description !== undefined) col('description', input.description);
  if (input.model_type !== undefined) col('model_type', input.model_type);
  if (input.model_status !== undefined) col('model_status', input.model_status);
  if (input.provider_id !== undefined) col('provider_id', input.provider_id, '::uuid');
  if (input.primary_ai_system_id !== undefined) col('primary_ai_system_id', input.primary_ai_system_id, '::uuid');
  if (input.primary_jurisdiction !== undefined) col('primary_jurisdiction', input.primary_jurisdiction);
  if (input.business_owner !== undefined) col('business_owner', input.business_owner);
  if (input.technical_owner !== undefined) col('technical_owner', input.technical_owner);
  if (input.legal_owner !== undefined) col('legal_owner', input.legal_owner);
  if (input.dpo_owner !== undefined) col('dpo_owner', input.dpo_owner);
  if (input.intended_use !== undefined) col('intended_use', input.intended_use);
  if (input.prohibited_uses !== undefined) col('prohibited_uses', input.prohibited_uses);
  if (input.training_data_summary !== undefined) col('training_data_summary', input.training_data_summary);
  if (input.evaluation_summary !== undefined) col('evaluation_summary', input.evaluation_summary);
  if (input.human_oversight_summary !== undefined) col('human_oversight_summary', input.human_oversight_summary);
  if (input.last_reviewed_at !== undefined) col('last_reviewed_at', input.last_reviewed_at, '::timestamptz');
  if (input.next_review_at !== undefined) col('next_review_at', input.next_review_at, '::timestamptz');
  if (input.review_frequency !== undefined) col('review_frequency', input.review_frequency);
  if (input.regulatory_source_id !== undefined) col('regulatory_source_id', input.regulatory_source_id, '::uuid');
  if (input.control_id !== undefined) col('control_id', input.control_id, '::uuid');
  if (input.metadata !== undefined) col('metadata', JSON.stringify(input.metadata), '::jsonb');
  col('updated_by_user_id', ctx.actor.userId, '::uuid');
  sets.push('updated_at = now()');

  params.push(id);
  const idIdx = params.length;
  params.push(ctx.actor.orgId);
  const orgIdx = params.length;
  const res = await ctx.client.query<ModelRow>(
    `UPDATE govai.regulatory_models SET ${sets.join(', ')}
      WHERE id = $${idIdx}::uuid AND org_id = $${orgIdx}::uuid
      RETURNING ${MODEL_COLUMNS}`,
    params,
  );
  const row = res.rows[0];
  if (!row) throw new RegulatoryError(404, 'model_not_found');

  const statusChanged = input.model_status !== undefined && input.model_status !== existing.model_status;
  await appendAudit(ctx, {
    eventType: 'regulatory_model.updated',
    subjectType: 'regulatory_model',
    subjectId: row.id,
    metadata: {
      model_id: row.id,
      model_key: row.model_key,
      changed_fields: Object.keys(input),
      model_status: row.model_status,
      ...(statusChanged ? { previous_model_status: existing.model_status } : {}),
    },
  });
  if (statusChanged) {
    await appendAudit(ctx, {
      eventType: 'regulatory_model.status_changed',
      subjectType: 'regulatory_model',
      subjectId: row.id,
      metadata: {
        model_id: row.id,
        model_key: row.model_key,
        previous_model_status: existing.model_status,
        model_status: row.model_status,
      },
    });
  }
  return row;
}

export async function listModels(
  ctx: Ctx,
  filters: {
    model_type?: string;
    model_status?: string;
    provider_id?: string;
    primary_ai_system_id?: string;
    primary_jurisdiction?: string;
    q?: string;
  },
  cursor: Cursor,
): Promise<ListResult<ModelRow>> {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  const eq = (column: string, val: string | undefined, cast = '') => {
    if (val === undefined) return;
    params.push(val);
    where.push(`${column} = $${params.length}${cast}`);
  };
  eq('model_type', filters.model_type);
  eq('model_status', filters.model_status);
  eq('provider_id', filters.provider_id, '::uuid');
  eq('primary_ai_system_id', filters.primary_ai_system_id, '::uuid');
  eq('primary_jurisdiction', filters.primary_jurisdiction);
  if (filters.q !== undefined) {
    params.push(`%${filters.q}%`);
    const i = params.length;
    where.push(`(model_key ILIKE $${i} OR name ILIKE $${i} OR description ILIKE $${i} OR intended_use ILIKE $${i})`);
  }
  applyCursor(where, params, cursor);
  params.push(cursor.limit);
  const res = await ctx.client.query<ModelRow>(
    `SELECT ${MODEL_COLUMNS} FROM govai.regulatory_models
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}

// --- Model versions --------------------------------------------------------

async function requireOwnedModel(ctx: Ctx, id: string): Promise<ModelRow> {
  const m = await getVisibleModel(ctx, id);
  if (!m) throw new RegulatoryError(404, 'model_not_found');
  return m;
}

export async function createModelVersion(
  ctx: Ctx,
  modelId: string,
  input: CreateModelVersionInput,
): Promise<ModelVersionRow> {
  await requireOwnedModel(ctx, modelId);
  let res;
  try {
    res = await ctx.client.query<ModelVersionRow>(
      `INSERT INTO govai.regulatory_model_versions
         (org_id, model_id, version_key, version_label, version_status, provider_model_name,
          provider_model_version, artifact_uri, artifact_hash, training_data_hash,
          evaluation_dataset_hash, evaluation_score_summary, release_notes, approval_reference,
          approved_at, approved_by_user_id, retired_at, metadata, created_by_user_id, updated_by_user_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15::timestamptz, $16::uuid, $17::timestamptz, $18::jsonb, $19::uuid, $19::uuid)
       RETURNING ${MODEL_VERSION_COLUMNS}`,
      [
        ctx.actor.orgId,
        modelId,
        input.version_key,
        input.version_label,
        input.version_status,
        input.provider_model_name ?? null,
        input.provider_model_version ?? null,
        input.artifact_uri ?? null,
        input.artifact_hash ?? null,
        input.training_data_hash ?? null,
        input.evaluation_dataset_hash ?? null,
        input.evaluation_score_summary,
        input.release_notes,
        input.approval_reference ?? null,
        input.approved_at ?? null,
        input.approved_by_user_id ?? null,
        input.retired_at ?? null,
        JSON.stringify(input.metadata ?? {}),
        ctx.actor.userId,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegulatoryError(409, 'model_version_key_conflict', { version_key: input.version_key });
    }
    throw err;
  }
  const row = res.rows[0]!;
  await appendAudit(ctx, {
    eventType: 'regulatory_model_version.created',
    subjectType: 'regulatory_model_version',
    subjectId: row.id,
    metadata: {
      model_id: modelId,
      version_id: row.id,
      version_key: row.version_key,
      version_status: row.version_status,
    },
  });
  return row;
}

export async function getVisibleModelVersion(ctx: Ctx, id: string): Promise<ModelVersionRow | null> {
  const r = await ctx.client.query<ModelVersionRow>(
    `SELECT ${MODEL_VERSION_COLUMNS} FROM govai.regulatory_model_versions WHERE id = $1::uuid`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function updateModelVersion(
  ctx: Ctx,
  id: string,
  input: UpdateModelVersionInput,
): Promise<ModelVersionRow> {
  const existing = await getVisibleModelVersion(ctx, id);
  if (!existing) throw new RegulatoryError(404, 'model_version_not_found');

  const sets: string[] = [];
  const params: unknown[] = [];
  const col = (name: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${name} = $${params.length}${cast}`);
  };
  if (input.version_label !== undefined) col('version_label', input.version_label);
  if (input.version_status !== undefined) col('version_status', input.version_status);
  if (input.provider_model_name !== undefined) col('provider_model_name', input.provider_model_name);
  if (input.provider_model_version !== undefined) col('provider_model_version', input.provider_model_version);
  if (input.artifact_uri !== undefined) col('artifact_uri', input.artifact_uri);
  if (input.artifact_hash !== undefined) col('artifact_hash', input.artifact_hash);
  if (input.training_data_hash !== undefined) col('training_data_hash', input.training_data_hash);
  if (input.evaluation_dataset_hash !== undefined) col('evaluation_dataset_hash', input.evaluation_dataset_hash);
  if (input.evaluation_score_summary !== undefined) col('evaluation_score_summary', input.evaluation_score_summary);
  if (input.release_notes !== undefined) col('release_notes', input.release_notes);
  if (input.approval_reference !== undefined) col('approval_reference', input.approval_reference);
  if (input.approved_at !== undefined) col('approved_at', input.approved_at, '::timestamptz');
  if (input.approved_by_user_id !== undefined) col('approved_by_user_id', input.approved_by_user_id, '::uuid');
  if (input.retired_at !== undefined) col('retired_at', input.retired_at, '::timestamptz');
  if (input.metadata !== undefined) col('metadata', JSON.stringify(input.metadata), '::jsonb');
  col('updated_by_user_id', ctx.actor.userId, '::uuid');
  sets.push('updated_at = now()');

  params.push(id);
  const idIdx = params.length;
  params.push(ctx.actor.orgId);
  const orgIdx = params.length;
  const res = await ctx.client.query<ModelVersionRow>(
    `UPDATE govai.regulatory_model_versions SET ${sets.join(', ')}
      WHERE id = $${idIdx}::uuid AND org_id = $${orgIdx}::uuid
      RETURNING ${MODEL_VERSION_COLUMNS}`,
    params,
  );
  const row = res.rows[0];
  if (!row) throw new RegulatoryError(404, 'model_version_not_found');

  const statusChanged = input.version_status !== undefined && input.version_status !== existing.version_status;
  const approvedTransition = statusChanged && VERSION_APPROVAL_STATES.has(row.version_status);
  const retiredTransition =
    (statusChanged && row.version_status === 'RETIRED') ||
    (input.retired_at !== undefined && input.retired_at !== null && existing.retired_at === null);

  await appendAudit(ctx, {
    eventType: 'regulatory_model_version.updated',
    subjectType: 'regulatory_model_version',
    subjectId: row.id,
    metadata: {
      model_id: row.model_id,
      version_id: row.id,
      version_key: row.version_key,
      changed_fields: Object.keys(input),
      version_status: row.version_status,
      ...(statusChanged ? { previous_version_status: existing.version_status } : {}),
    },
  });
  if (statusChanged) {
    await appendAudit(ctx, {
      eventType: 'regulatory_model_version.status_changed',
      subjectType: 'regulatory_model_version',
      subjectId: row.id,
      metadata: {
        model_id: row.model_id,
        version_id: row.id,
        previous_version_status: existing.version_status,
        version_status: row.version_status,
      },
    });
  }
  if (approvedTransition) {
    await appendAudit(ctx, {
      eventType: 'regulatory_model_version.approved',
      subjectType: 'regulatory_model_version',
      subjectId: row.id,
      metadata: {
        model_id: row.model_id,
        version_id: row.id,
        version_status: row.version_status,
        approved_at: row.approved_at ? row.approved_at.toISOString() : null,
        approved_by_user_id: row.approved_by_user_id,
        approval_reference: row.approval_reference,
      },
    });
  }
  if (retiredTransition) {
    await appendAudit(ctx, {
      eventType: 'regulatory_model_version.retired',
      subjectType: 'regulatory_model_version',
      subjectId: row.id,
      metadata: {
        model_id: row.model_id,
        version_id: row.id,
        version_status: row.version_status,
        retired_at: row.retired_at ? row.retired_at.toISOString() : null,
      },
    });
  }
  return row;
}

export async function listModelVersions(
  ctx: Ctx,
  modelId: string,
  filters: { version_status?: string; q?: string },
  cursor: Cursor,
): Promise<ListResult<ModelVersionRow>> {
  // The model must be visible to the caller (own tenant).
  await requireOwnedModel(ctx, modelId);
  const where: string[] = ['model_id = $1::uuid'];
  const params: unknown[] = [modelId];
  if (filters.version_status !== undefined) {
    params.push(filters.version_status);
    where.push(`version_status = $${params.length}`);
  }
  if (filters.q !== undefined) {
    params.push(`%${filters.q}%`);
    const i = params.length;
    where.push(
      `(version_key ILIKE $${i} OR version_label ILIKE $${i} OR provider_model_name ILIKE $${i}
        OR provider_model_version ILIKE $${i} OR release_notes ILIKE $${i})`,
    );
  }
  applyCursor(where, params, cursor);
  params.push(cursor.limit);
  const res = await ctx.client.query<ModelVersionRow>(
    `SELECT ${MODEL_VERSION_COLUMNS} FROM govai.regulatory_model_versions
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}

// --- AI system ↔ model version links ---------------------------------------

export async function createAiSystemModelLink(
  ctx: Ctx,
  input: CreateAiSystemModelLinkInput,
): Promise<AiSystemModelLinkRow> {
  // Clean 404/400s; DB RLS WITH CHECK is the backstop.
  const ai = await getVisibleAiSystem(ctx, input.ai_system_id);
  if (!ai) throw new RegulatoryError(404, 'ai_system_not_found');
  const model = await getVisibleModel(ctx, input.model_id);
  if (!model) throw new RegulatoryError(404, 'model_not_found');
  const version = await getVisibleModelVersion(ctx, input.model_version_id);
  if (!version) throw new RegulatoryError(404, 'model_version_not_found');
  if (version.model_id !== input.model_id) {
    throw new RegulatoryError(400, 'model_version_model_mismatch', {
      model_id: input.model_id,
      model_version_id: input.model_version_id,
    });
  }
  let res;
  try {
    res = await ctx.client.query<AiSystemModelLinkRow>(
      `INSERT INTO govai.regulatory_ai_system_model_links
         (org_id, ai_system_id, model_id, model_version_id, link_status, usage_role,
          deployment_environment, effective_from, effective_to, rationale, metadata,
          created_by_user_id, updated_by_user_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8::timestamptz, $9::timestamptz,
               $10, $11::jsonb, $12::uuid, $12::uuid)
       RETURNING ${LINK_MODEL_COLUMNS}`,
      [
        ctx.actor.orgId,
        input.ai_system_id,
        input.model_id,
        input.model_version_id,
        input.link_status,
        input.usage_role,
        input.deployment_environment,
        input.effective_from ?? null,
        input.effective_to ?? null,
        input.rationale,
        JSON.stringify(input.metadata ?? {}),
        ctx.actor.userId,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegulatoryError(409, 'ai_system_model_link_conflict', {
        usage_role: input.usage_role,
        deployment_environment: input.deployment_environment,
      });
    }
    throw err;
  }
  const row = res.rows[0]!;
  await appendAudit(ctx, {
    eventType: 'regulatory_ai_system_model_link.created',
    subjectType: 'regulatory_ai_system_model_link',
    subjectId: row.id,
    metadata: {
      link_id: row.id,
      ai_system_id: row.ai_system_id,
      model_id: row.model_id,
      model_version_id: row.model_version_id,
      usage_role: row.usage_role,
      deployment_environment: row.deployment_environment,
      link_status: row.link_status,
    },
  });
  return row;
}

export async function getVisibleAiSystemModelLink(
  ctx: Ctx,
  id: string,
): Promise<AiSystemModelLinkRow | null> {
  const r = await ctx.client.query<AiSystemModelLinkRow>(
    `SELECT ${LINK_MODEL_COLUMNS} FROM govai.regulatory_ai_system_model_links WHERE id = $1::uuid`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function updateAiSystemModelLink(
  ctx: Ctx,
  id: string,
  input: UpdateAiSystemModelLinkInput,
): Promise<AiSystemModelLinkRow> {
  const existing = await getVisibleAiSystemModelLink(ctx, id);
  if (!existing) throw new RegulatoryError(404, 'ai_system_model_link_not_found');

  const sets: string[] = [];
  const params: unknown[] = [];
  const col = (name: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${name} = $${params.length}${cast}`);
  };
  if (input.link_status !== undefined) col('link_status', input.link_status);
  if (input.effective_from !== undefined) col('effective_from', input.effective_from, '::timestamptz');
  if (input.effective_to !== undefined) col('effective_to', input.effective_to, '::timestamptz');
  if (input.rationale !== undefined) col('rationale', input.rationale);
  if (input.metadata !== undefined) col('metadata', JSON.stringify(input.metadata), '::jsonb');
  col('updated_by_user_id', ctx.actor.userId, '::uuid');
  sets.push('updated_at = now()');

  params.push(id);
  const idIdx = params.length;
  params.push(ctx.actor.orgId);
  const orgIdx = params.length;
  const res = await ctx.client.query<AiSystemModelLinkRow>(
    `UPDATE govai.regulatory_ai_system_model_links SET ${sets.join(', ')}
      WHERE id = $${idIdx}::uuid AND org_id = $${orgIdx}::uuid
      RETURNING ${LINK_MODEL_COLUMNS}`,
    params,
  );
  const row = res.rows[0];
  if (!row) throw new RegulatoryError(404, 'ai_system_model_link_not_found');

  const statusChanged = input.link_status !== undefined && input.link_status !== existing.link_status;
  await appendAudit(ctx, {
    eventType: 'regulatory_ai_system_model_link.updated',
    subjectType: 'regulatory_ai_system_model_link',
    subjectId: row.id,
    metadata: {
      link_id: row.id,
      ai_system_id: row.ai_system_id,
      model_id: row.model_id,
      model_version_id: row.model_version_id,
      usage_role: row.usage_role,
      deployment_environment: row.deployment_environment,
      changed_fields: Object.keys(input),
      link_status: row.link_status,
      ...(statusChanged ? { previous_link_status: existing.link_status } : {}),
    },
  });
  if (statusChanged) {
    await appendAudit(ctx, {
      eventType: 'regulatory_ai_system_model_link.status_changed',
      subjectType: 'regulatory_ai_system_model_link',
      subjectId: row.id,
      metadata: {
        link_id: row.id,
        ai_system_id: row.ai_system_id,
        model_id: row.model_id,
        model_version_id: row.model_version_id,
        usage_role: row.usage_role,
        deployment_environment: row.deployment_environment,
        previous_link_status: existing.link_status,
        link_status: row.link_status,
      },
    });
  }
  return row;
}

export async function listAiSystemModelLinks(
  ctx: Ctx,
  filters: {
    ai_system_id?: string;
    model_id?: string;
    model_version_id?: string;
    link_status?: string;
    usage_role?: string;
    deployment_environment?: string;
  },
  cursor: Cursor,
): Promise<ListResult<AiSystemModelLinkRow>> {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  const eq = (column: string, val: string | undefined, cast = '') => {
    if (val === undefined) return;
    params.push(val);
    where.push(`${column} = $${params.length}${cast}`);
  };
  eq('ai_system_id', filters.ai_system_id, '::uuid');
  eq('model_id', filters.model_id, '::uuid');
  eq('model_version_id', filters.model_version_id, '::uuid');
  eq('link_status', filters.link_status);
  eq('usage_role', filters.usage_role);
  eq('deployment_environment', filters.deployment_environment);
  applyCursor(where, params, cursor);
  params.push(cursor.limit);
  const res = await ctx.client.query<AiSystemModelLinkRow>(
    `SELECT ${LINK_MODEL_COLUMNS} FROM govai.regulatory_ai_system_model_links
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}

// ---------------------------------------------------------------------------
// Agent Registry (PR-R5)
// ---------------------------------------------------------------------------

export type AgentRow = {
  id: string;
  org_id: string;
  agent_key: string;
  name: string;
  description: string;
  agent_type: string;
  agent_status: string;
  autonomy_level: string;
  execution_boundary: string;
  human_oversight_mode: string;
  provider_id: string | null;
  primary_ai_system_id: string | null;
  primary_model_id: string | null;
  primary_model_version_id: string | null;
  primary_jurisdiction: string;
  business_owner: string | null;
  technical_owner: string | null;
  legal_owner: string | null;
  dpo_owner: string | null;
  intended_purpose: string;
  prohibited_uses: string;
  capability_summary: string;
  tool_access_summary: string;
  data_access_summary: string;
  human_oversight_summary: string;
  last_reviewed_at: Date | null;
  next_review_at: Date | null;
  review_frequency: string;
  regulatory_source_id: string | null;
  control_id: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const AGENT_COLUMNS = `id, org_id, agent_key, name, description, agent_type, agent_status, autonomy_level,
  execution_boundary, human_oversight_mode, provider_id, primary_ai_system_id, primary_model_id,
  primary_model_version_id, primary_jurisdiction, business_owner, technical_owner, legal_owner, dpo_owner,
  intended_purpose, prohibited_uses, capability_summary, tool_access_summary, data_access_summary,
  human_oversight_summary, last_reviewed_at, next_review_at, review_frequency, regulatory_source_id,
  control_id, metadata, created_by_user_id, updated_by_user_id, created_at, updated_at`;

export type AgentVersionRow = {
  id: string;
  org_id: string;
  agent_id: string;
  version_key: string;
  version_label: string;
  version_status: string;
  configuration_hash: string | null;
  prompt_policy_hash: string | null;
  tool_manifest_hash: string | null;
  sandbox_policy_hash: string | null;
  capability_manifest_hash: string | null;
  evaluation_score_summary: string;
  release_notes: string;
  approval_reference: string | null;
  approved_at: Date | null;
  approved_by_user_id: string | null;
  retired_at: Date | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const AGENT_VERSION_COLUMNS = `id, org_id, agent_id, version_key, version_label, version_status,
  configuration_hash, prompt_policy_hash, tool_manifest_hash, sandbox_policy_hash, capability_manifest_hash,
  evaluation_score_summary, release_notes, approval_reference, approved_at, approved_by_user_id, retired_at,
  metadata, created_by_user_id, updated_by_user_id, created_at, updated_at`;

export type AgentCapabilityBindingRow = {
  id: string;
  org_id: string;
  agent_id: string;
  agent_version_id: string | null;
  capability_key: string;
  capability_name: string;
  capability_category: string;
  capability_status: string;
  risk_posture: string;
  hard_deny_floor_expected: boolean;
  approval_required: boolean;
  evidence_required: boolean;
  scope_summary: string;
  restriction_summary: string;
  rationale: string;
  regulatory_source_id: string | null;
  control_id: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const AGENT_BINDING_COLUMNS = `id, org_id, agent_id, agent_version_id, capability_key, capability_name,
  capability_category, capability_status, risk_posture, hard_deny_floor_expected, approval_required,
  evidence_required, scope_summary, restriction_summary, rationale, regulatory_source_id, control_id,
  metadata, created_by_user_id, updated_by_user_id, created_at, updated_at`;

// Agents reference optional own-tenant provider / AI system / model, and an
// optional model version that must (a) exist and (b) belong to the model. A
// version without a model is rejected up front (the DB CHECK is the backstop).
// Service-level checks give clean 404/400s; the DB RLS WITH CHECK is the backstop.
async function requireAgentParents(
  ctx: Ctx,
  refs: {
    provider_id?: string | null;
    primary_ai_system_id?: string | null;
    primary_model_id?: string | null;
    primary_model_version_id?: string | null;
    regulatory_source_id?: string | null;
    control_id?: string | null;
  },
): Promise<void> {
  if (refs.primary_model_version_id && !refs.primary_model_id) {
    throw new RegulatoryError(400, 'model_version_requires_model');
  }
  if (refs.provider_id) {
    if (!(await getVisibleProvider(ctx, refs.provider_id))) throw new RegulatoryError(404, 'provider_not_found');
  }
  if (refs.primary_ai_system_id) {
    if (!(await getVisibleAiSystem(ctx, refs.primary_ai_system_id)))
      throw new RegulatoryError(404, 'ai_system_not_found');
  }
  if (refs.primary_model_id) {
    if (!(await getVisibleModel(ctx, refs.primary_model_id))) throw new RegulatoryError(404, 'model_not_found');
  }
  if (refs.primary_model_version_id) {
    const v = await getVisibleModelVersion(ctx, refs.primary_model_version_id);
    if (!v) throw new RegulatoryError(404, 'model_version_not_found');
    if (v.model_id !== refs.primary_model_id) {
      throw new RegulatoryError(400, 'model_version_model_mismatch', {
        primary_model_id: refs.primary_model_id,
        primary_model_version_id: refs.primary_model_version_id,
      });
    }
  }
  await requireVisibleParents(ctx, {
    regulatory_source_id: refs.regulatory_source_id ?? null,
    control_id: refs.control_id ?? null,
  });
}

export async function createAgent(ctx: Ctx, input: CreateAgentInput): Promise<AgentRow> {
  await requireAgentParents(ctx, {
    provider_id: input.provider_id ?? null,
    primary_ai_system_id: input.primary_ai_system_id ?? null,
    primary_model_id: input.primary_model_id ?? null,
    primary_model_version_id: input.primary_model_version_id ?? null,
    regulatory_source_id: input.regulatory_source_id ?? null,
    control_id: input.control_id ?? null,
  });
  let res;
  try {
    res = await ctx.client.query<AgentRow>(
      `INSERT INTO govai.regulatory_agents
         (org_id, agent_key, name, description, agent_type, agent_status, autonomy_level,
          execution_boundary, human_oversight_mode, provider_id, primary_ai_system_id, primary_model_id,
          primary_model_version_id, primary_jurisdiction, business_owner, technical_owner, legal_owner,
          dpo_owner, intended_purpose, prohibited_uses, capability_summary, tool_access_summary,
          data_access_summary, human_oversight_summary, last_reviewed_at, next_review_at, review_frequency,
          regulatory_source_id, control_id, metadata, created_by_user_id, updated_by_user_id)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid, $11::uuid, $12::uuid, $13::uuid, $14,
               $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25::timestamptz, $26::timestamptz, $27,
               $28::uuid, $29::uuid, $30::jsonb, $31::uuid, $31::uuid)
       RETURNING ${AGENT_COLUMNS}`,
      [
        ctx.actor.orgId,
        input.agent_key,
        input.name,
        input.description,
        input.agent_type,
        input.agent_status,
        input.autonomy_level,
        input.execution_boundary,
        input.human_oversight_mode,
        input.provider_id ?? null,
        input.primary_ai_system_id ?? null,
        input.primary_model_id ?? null,
        input.primary_model_version_id ?? null,
        input.primary_jurisdiction,
        input.business_owner ?? null,
        input.technical_owner ?? null,
        input.legal_owner ?? null,
        input.dpo_owner ?? null,
        input.intended_purpose,
        input.prohibited_uses,
        input.capability_summary,
        input.tool_access_summary,
        input.data_access_summary,
        input.human_oversight_summary,
        input.last_reviewed_at ?? null,
        input.next_review_at ?? null,
        input.review_frequency,
        input.regulatory_source_id ?? null,
        input.control_id ?? null,
        JSON.stringify(input.metadata ?? {}),
        ctx.actor.userId,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegulatoryError(409, 'agent_key_conflict', { agent_key: input.agent_key });
    }
    throw err;
  }
  const row = res.rows[0]!;
  await appendAudit(ctx, {
    eventType: 'regulatory_agent.created',
    subjectType: 'regulatory_agent',
    subjectId: row.id,
    metadata: {
      agent_id: row.id,
      agent_key: row.agent_key,
      agent_type: row.agent_type,
      agent_status: row.agent_status,
      autonomy_level: row.autonomy_level,
      execution_boundary: row.execution_boundary,
      provider_id: row.provider_id,
      primary_ai_system_id: row.primary_ai_system_id,
      primary_model_id: row.primary_model_id,
      primary_model_version_id: row.primary_model_version_id,
    },
  });
  return row;
}

export async function getVisibleAgent(ctx: Ctx, id: string): Promise<AgentRow | null> {
  const r = await ctx.client.query<AgentRow>(
    `SELECT ${AGENT_COLUMNS} FROM govai.regulatory_agents WHERE id = $1::uuid`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function updateAgent(ctx: Ctx, id: string, input: UpdateAgentInput): Promise<AgentRow> {
  const existing = await getVisibleAgent(ctx, id);
  if (!existing) throw new RegulatoryError(404, 'agent_not_found');
  // Validate the merged (existing + patch) parent references, including the
  // version-requires-model and version-belongs-to-model rules.
  await requireAgentParents(ctx, {
    provider_id: input.provider_id !== undefined ? input.provider_id : existing.provider_id,
    primary_ai_system_id:
      input.primary_ai_system_id !== undefined ? input.primary_ai_system_id : existing.primary_ai_system_id,
    primary_model_id: input.primary_model_id !== undefined ? input.primary_model_id : existing.primary_model_id,
    primary_model_version_id:
      input.primary_model_version_id !== undefined
        ? input.primary_model_version_id
        : existing.primary_model_version_id,
    regulatory_source_id:
      input.regulatory_source_id !== undefined ? input.regulatory_source_id : existing.regulatory_source_id,
    control_id: input.control_id !== undefined ? input.control_id : existing.control_id,
  });

  const sets: string[] = [];
  const params: unknown[] = [];
  const col = (name: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${name} = $${params.length}${cast}`);
  };
  if (input.name !== undefined) col('name', input.name);
  if (input.description !== undefined) col('description', input.description);
  if (input.agent_type !== undefined) col('agent_type', input.agent_type);
  if (input.agent_status !== undefined) col('agent_status', input.agent_status);
  if (input.autonomy_level !== undefined) col('autonomy_level', input.autonomy_level);
  if (input.execution_boundary !== undefined) col('execution_boundary', input.execution_boundary);
  if (input.human_oversight_mode !== undefined) col('human_oversight_mode', input.human_oversight_mode);
  if (input.provider_id !== undefined) col('provider_id', input.provider_id, '::uuid');
  if (input.primary_ai_system_id !== undefined) col('primary_ai_system_id', input.primary_ai_system_id, '::uuid');
  if (input.primary_model_id !== undefined) col('primary_model_id', input.primary_model_id, '::uuid');
  if (input.primary_model_version_id !== undefined)
    col('primary_model_version_id', input.primary_model_version_id, '::uuid');
  if (input.primary_jurisdiction !== undefined) col('primary_jurisdiction', input.primary_jurisdiction);
  if (input.business_owner !== undefined) col('business_owner', input.business_owner);
  if (input.technical_owner !== undefined) col('technical_owner', input.technical_owner);
  if (input.legal_owner !== undefined) col('legal_owner', input.legal_owner);
  if (input.dpo_owner !== undefined) col('dpo_owner', input.dpo_owner);
  if (input.intended_purpose !== undefined) col('intended_purpose', input.intended_purpose);
  if (input.prohibited_uses !== undefined) col('prohibited_uses', input.prohibited_uses);
  if (input.capability_summary !== undefined) col('capability_summary', input.capability_summary);
  if (input.tool_access_summary !== undefined) col('tool_access_summary', input.tool_access_summary);
  if (input.data_access_summary !== undefined) col('data_access_summary', input.data_access_summary);
  if (input.human_oversight_summary !== undefined) col('human_oversight_summary', input.human_oversight_summary);
  if (input.last_reviewed_at !== undefined) col('last_reviewed_at', input.last_reviewed_at, '::timestamptz');
  if (input.next_review_at !== undefined) col('next_review_at', input.next_review_at, '::timestamptz');
  if (input.review_frequency !== undefined) col('review_frequency', input.review_frequency);
  if (input.regulatory_source_id !== undefined) col('regulatory_source_id', input.regulatory_source_id, '::uuid');
  if (input.control_id !== undefined) col('control_id', input.control_id, '::uuid');
  if (input.metadata !== undefined) col('metadata', JSON.stringify(input.metadata), '::jsonb');
  col('updated_by_user_id', ctx.actor.userId, '::uuid');
  sets.push('updated_at = now()');

  params.push(id);
  const idIdx = params.length;
  params.push(ctx.actor.orgId);
  const orgIdx = params.length;
  const res = await ctx.client.query<AgentRow>(
    `UPDATE govai.regulatory_agents SET ${sets.join(', ')}
      WHERE id = $${idIdx}::uuid AND org_id = $${orgIdx}::uuid
      RETURNING ${AGENT_COLUMNS}`,
    params,
  );
  const row = res.rows[0];
  if (!row) throw new RegulatoryError(404, 'agent_not_found');

  const statusChanged = input.agent_status !== undefined && input.agent_status !== existing.agent_status;
  await appendAudit(ctx, {
    eventType: 'regulatory_agent.updated',
    subjectType: 'regulatory_agent',
    subjectId: row.id,
    metadata: {
      agent_id: row.id,
      agent_key: row.agent_key,
      changed_fields: Object.keys(input),
      agent_status: row.agent_status,
      ...(statusChanged ? { previous_agent_status: existing.agent_status } : {}),
    },
  });
  if (statusChanged) {
    await appendAudit(ctx, {
      eventType: 'regulatory_agent.status_changed',
      subjectType: 'regulatory_agent',
      subjectId: row.id,
      metadata: {
        agent_id: row.id,
        agent_key: row.agent_key,
        previous_agent_status: existing.agent_status,
        agent_status: row.agent_status,
      },
    });
  }
  return row;
}

export async function listAgents(
  ctx: Ctx,
  filters: {
    agent_type?: string;
    agent_status?: string;
    autonomy_level?: string;
    execution_boundary?: string;
    provider_id?: string;
    primary_ai_system_id?: string;
    primary_model_id?: string;
    primary_jurisdiction?: string;
    q?: string;
  },
  cursor: Cursor,
): Promise<ListResult<AgentRow>> {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  const eq = (column: string, val: string | undefined, cast = '') => {
    if (val === undefined) return;
    params.push(val);
    where.push(`${column} = $${params.length}${cast}`);
  };
  eq('agent_type', filters.agent_type);
  eq('agent_status', filters.agent_status);
  eq('autonomy_level', filters.autonomy_level);
  eq('execution_boundary', filters.execution_boundary);
  eq('provider_id', filters.provider_id, '::uuid');
  eq('primary_ai_system_id', filters.primary_ai_system_id, '::uuid');
  eq('primary_model_id', filters.primary_model_id, '::uuid');
  eq('primary_jurisdiction', filters.primary_jurisdiction);
  if (filters.q !== undefined) {
    params.push(`%${filters.q}%`);
    const i = params.length;
    where.push(
      `(agent_key ILIKE $${i} OR name ILIKE $${i} OR description ILIKE $${i}
        OR intended_purpose ILIKE $${i} OR capability_summary ILIKE $${i})`,
    );
  }
  applyCursor(where, params, cursor);
  params.push(cursor.limit);
  const res = await ctx.client.query<AgentRow>(
    `SELECT ${AGENT_COLUMNS} FROM govai.regulatory_agents
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}

// --- Agent versions --------------------------------------------------------

async function requireOwnedAgent(ctx: Ctx, id: string): Promise<AgentRow> {
  const a = await getVisibleAgent(ctx, id);
  if (!a) throw new RegulatoryError(404, 'agent_not_found');
  return a;
}

export async function createAgentVersion(
  ctx: Ctx,
  agentId: string,
  input: CreateAgentVersionInput,
): Promise<AgentVersionRow> {
  await requireOwnedAgent(ctx, agentId);
  let res;
  try {
    res = await ctx.client.query<AgentVersionRow>(
      `INSERT INTO govai.regulatory_agent_versions
         (org_id, agent_id, version_key, version_label, version_status, configuration_hash,
          prompt_policy_hash, tool_manifest_hash, sandbox_policy_hash, capability_manifest_hash,
          evaluation_score_summary, release_notes, approval_reference, approved_at, approved_by_user_id,
          retired_at, metadata, created_by_user_id, updated_by_user_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14::timestamptz, $15::uuid, $16::timestamptz, $17::jsonb, $18::uuid, $18::uuid)
       RETURNING ${AGENT_VERSION_COLUMNS}`,
      [
        ctx.actor.orgId,
        agentId,
        input.version_key,
        input.version_label,
        input.version_status,
        input.configuration_hash ?? null,
        input.prompt_policy_hash ?? null,
        input.tool_manifest_hash ?? null,
        input.sandbox_policy_hash ?? null,
        input.capability_manifest_hash ?? null,
        input.evaluation_score_summary,
        input.release_notes,
        input.approval_reference ?? null,
        input.approved_at ?? null,
        input.approved_by_user_id ?? null,
        input.retired_at ?? null,
        JSON.stringify(input.metadata ?? {}),
        ctx.actor.userId,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegulatoryError(409, 'agent_version_key_conflict', { version_key: input.version_key });
    }
    throw err;
  }
  const row = res.rows[0]!;
  await appendAudit(ctx, {
    eventType: 'regulatory_agent_version.created',
    subjectType: 'regulatory_agent_version',
    subjectId: row.id,
    metadata: {
      agent_id: agentId,
      version_id: row.id,
      version_key: row.version_key,
      version_status: row.version_status,
    },
  });
  return row;
}

export async function getVisibleAgentVersion(ctx: Ctx, id: string): Promise<AgentVersionRow | null> {
  const r = await ctx.client.query<AgentVersionRow>(
    `SELECT ${AGENT_VERSION_COLUMNS} FROM govai.regulatory_agent_versions WHERE id = $1::uuid`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function updateAgentVersion(
  ctx: Ctx,
  id: string,
  input: UpdateAgentVersionInput,
): Promise<AgentVersionRow> {
  const existing = await getVisibleAgentVersion(ctx, id);
  if (!existing) throw new RegulatoryError(404, 'agent_version_not_found');

  const sets: string[] = [];
  const params: unknown[] = [];
  const col = (name: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${name} = $${params.length}${cast}`);
  };
  if (input.version_label !== undefined) col('version_label', input.version_label);
  if (input.version_status !== undefined) col('version_status', input.version_status);
  if (input.configuration_hash !== undefined) col('configuration_hash', input.configuration_hash);
  if (input.prompt_policy_hash !== undefined) col('prompt_policy_hash', input.prompt_policy_hash);
  if (input.tool_manifest_hash !== undefined) col('tool_manifest_hash', input.tool_manifest_hash);
  if (input.sandbox_policy_hash !== undefined) col('sandbox_policy_hash', input.sandbox_policy_hash);
  if (input.capability_manifest_hash !== undefined)
    col('capability_manifest_hash', input.capability_manifest_hash);
  if (input.evaluation_score_summary !== undefined)
    col('evaluation_score_summary', input.evaluation_score_summary);
  if (input.release_notes !== undefined) col('release_notes', input.release_notes);
  if (input.approval_reference !== undefined) col('approval_reference', input.approval_reference);
  if (input.approved_at !== undefined) col('approved_at', input.approved_at, '::timestamptz');
  if (input.approved_by_user_id !== undefined) col('approved_by_user_id', input.approved_by_user_id, '::uuid');
  if (input.retired_at !== undefined) col('retired_at', input.retired_at, '::timestamptz');
  if (input.metadata !== undefined) col('metadata', JSON.stringify(input.metadata), '::jsonb');
  col('updated_by_user_id', ctx.actor.userId, '::uuid');
  sets.push('updated_at = now()');

  params.push(id);
  const idIdx = params.length;
  params.push(ctx.actor.orgId);
  const orgIdx = params.length;
  const res = await ctx.client.query<AgentVersionRow>(
    `UPDATE govai.regulatory_agent_versions SET ${sets.join(', ')}
      WHERE id = $${idIdx}::uuid AND org_id = $${orgIdx}::uuid
      RETURNING ${AGENT_VERSION_COLUMNS}`,
    params,
  );
  const row = res.rows[0];
  if (!row) throw new RegulatoryError(404, 'agent_version_not_found');

  const statusChanged = input.version_status !== undefined && input.version_status !== existing.version_status;
  const approvedTransition = statusChanged && VERSION_APPROVAL_STATES.has(row.version_status);
  const retiredTransition =
    (statusChanged && row.version_status === 'RETIRED') ||
    (input.retired_at !== undefined && input.retired_at !== null && existing.retired_at === null);

  await appendAudit(ctx, {
    eventType: 'regulatory_agent_version.updated',
    subjectType: 'regulatory_agent_version',
    subjectId: row.id,
    metadata: {
      agent_id: row.agent_id,
      version_id: row.id,
      version_key: row.version_key,
      changed_fields: Object.keys(input),
      version_status: row.version_status,
      ...(statusChanged ? { previous_version_status: existing.version_status } : {}),
    },
  });
  if (statusChanged) {
    await appendAudit(ctx, {
      eventType: 'regulatory_agent_version.status_changed',
      subjectType: 'regulatory_agent_version',
      subjectId: row.id,
      metadata: {
        agent_id: row.agent_id,
        version_id: row.id,
        previous_version_status: existing.version_status,
        version_status: row.version_status,
      },
    });
  }
  if (approvedTransition) {
    await appendAudit(ctx, {
      eventType: 'regulatory_agent_version.approved',
      subjectType: 'regulatory_agent_version',
      subjectId: row.id,
      metadata: {
        agent_id: row.agent_id,
        version_id: row.id,
        version_status: row.version_status,
        approved_at: row.approved_at ? row.approved_at.toISOString() : null,
        approved_by_user_id: row.approved_by_user_id,
        approval_reference: row.approval_reference,
      },
    });
  }
  if (retiredTransition) {
    await appendAudit(ctx, {
      eventType: 'regulatory_agent_version.retired',
      subjectType: 'regulatory_agent_version',
      subjectId: row.id,
      metadata: {
        agent_id: row.agent_id,
        version_id: row.id,
        version_status: row.version_status,
        retired_at: row.retired_at ? row.retired_at.toISOString() : null,
      },
    });
  }
  return row;
}

export async function listAgentVersions(
  ctx: Ctx,
  agentId: string,
  filters: { version_status?: string; q?: string },
  cursor: Cursor,
): Promise<ListResult<AgentVersionRow>> {
  await requireOwnedAgent(ctx, agentId);
  const where: string[] = ['agent_id = $1::uuid'];
  const params: unknown[] = [agentId];
  if (filters.version_status !== undefined) {
    params.push(filters.version_status);
    where.push(`version_status = $${params.length}`);
  }
  if (filters.q !== undefined) {
    params.push(`%${filters.q}%`);
    const i = params.length;
    where.push(
      `(version_key ILIKE $${i} OR version_label ILIKE $${i} OR release_notes ILIKE $${i}
        OR evaluation_score_summary ILIKE $${i})`,
    );
  }
  applyCursor(where, params, cursor);
  params.push(cursor.limit);
  const res = await ctx.client.query<AgentVersionRow>(
    `SELECT ${AGENT_VERSION_COLUMNS} FROM govai.regulatory_agent_versions
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}

// --- Agent capability bindings ---------------------------------------------

export async function createAgentCapabilityBinding(
  ctx: Ctx,
  input: CreateAgentCapabilityBindingInput,
): Promise<AgentCapabilityBindingRow> {
  const agent = await getVisibleAgent(ctx, input.agent_id);
  if (!agent) throw new RegulatoryError(404, 'agent_not_found');
  if (input.agent_version_id) {
    const version = await getVisibleAgentVersion(ctx, input.agent_version_id);
    if (!version) throw new RegulatoryError(404, 'agent_version_not_found');
    if (version.agent_id !== input.agent_id) {
      throw new RegulatoryError(400, 'agent_version_agent_mismatch', {
        agent_id: input.agent_id,
        agent_version_id: input.agent_version_id,
      });
    }
  }
  await requireVisibleParents(ctx, {
    regulatory_source_id: input.regulatory_source_id ?? null,
    control_id: input.control_id ?? null,
  });
  let res;
  try {
    res = await ctx.client.query<AgentCapabilityBindingRow>(
      `INSERT INTO govai.regulatory_agent_capability_bindings
         (org_id, agent_id, agent_version_id, capability_key, capability_name, capability_category,
          capability_status, risk_posture, hard_deny_floor_expected, approval_required, evidence_required,
          scope_summary, restriction_summary, rationale, regulatory_source_id, control_id, metadata,
          created_by_user_id, updated_by_user_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15::uuid, $16::uuid, $17::jsonb, $18::uuid, $18::uuid)
       RETURNING ${AGENT_BINDING_COLUMNS}`,
      [
        ctx.actor.orgId,
        input.agent_id,
        input.agent_version_id ?? null,
        input.capability_key,
        input.capability_name,
        input.capability_category,
        input.capability_status,
        input.risk_posture,
        input.hard_deny_floor_expected,
        input.approval_required,
        input.evidence_required,
        input.scope_summary,
        input.restriction_summary,
        input.rationale,
        input.regulatory_source_id ?? null,
        input.control_id ?? null,
        JSON.stringify(input.metadata ?? {}),
        ctx.actor.userId,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegulatoryError(409, 'agent_capability_binding_conflict', {
        capability_key: input.capability_key,
      });
    }
    throw err;
  }
  const row = res.rows[0]!;
  await appendAudit(ctx, {
    eventType: 'regulatory_agent_capability_binding.created',
    subjectType: 'regulatory_agent_capability_binding',
    subjectId: row.id,
    metadata: {
      binding_id: row.id,
      agent_id: row.agent_id,
      agent_version_id: row.agent_version_id,
      capability_key: row.capability_key,
      capability_category: row.capability_category,
      capability_status: row.capability_status,
      risk_posture: row.risk_posture,
      hard_deny_floor_expected: row.hard_deny_floor_expected,
    },
  });
  return row;
}

export async function getVisibleAgentCapabilityBinding(
  ctx: Ctx,
  id: string,
): Promise<AgentCapabilityBindingRow | null> {
  const r = await ctx.client.query<AgentCapabilityBindingRow>(
    `SELECT ${AGENT_BINDING_COLUMNS} FROM govai.regulatory_agent_capability_bindings WHERE id = $1::uuid`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function updateAgentCapabilityBinding(
  ctx: Ctx,
  id: string,
  input: UpdateAgentCapabilityBindingInput,
): Promise<AgentCapabilityBindingRow> {
  const existing = await getVisibleAgentCapabilityBinding(ctx, id);
  if (!existing) throw new RegulatoryError(404, 'agent_capability_binding_not_found');
  if (input.regulatory_source_id !== undefined || input.control_id !== undefined) {
    await requireVisibleParents(ctx, {
      regulatory_source_id:
        input.regulatory_source_id !== undefined ? input.regulatory_source_id : existing.regulatory_source_id,
      control_id: input.control_id !== undefined ? input.control_id : existing.control_id,
    });
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const col = (name: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${name} = $${params.length}${cast}`);
  };
  if (input.capability_name !== undefined) col('capability_name', input.capability_name);
  if (input.capability_category !== undefined) col('capability_category', input.capability_category);
  if (input.capability_status !== undefined) col('capability_status', input.capability_status);
  if (input.risk_posture !== undefined) col('risk_posture', input.risk_posture);
  if (input.hard_deny_floor_expected !== undefined)
    col('hard_deny_floor_expected', input.hard_deny_floor_expected);
  if (input.approval_required !== undefined) col('approval_required', input.approval_required);
  if (input.evidence_required !== undefined) col('evidence_required', input.evidence_required);
  if (input.scope_summary !== undefined) col('scope_summary', input.scope_summary);
  if (input.restriction_summary !== undefined) col('restriction_summary', input.restriction_summary);
  if (input.rationale !== undefined) col('rationale', input.rationale);
  if (input.regulatory_source_id !== undefined) col('regulatory_source_id', input.regulatory_source_id, '::uuid');
  if (input.control_id !== undefined) col('control_id', input.control_id, '::uuid');
  if (input.metadata !== undefined) col('metadata', JSON.stringify(input.metadata), '::jsonb');
  col('updated_by_user_id', ctx.actor.userId, '::uuid');
  sets.push('updated_at = now()');

  params.push(id);
  const idIdx = params.length;
  params.push(ctx.actor.orgId);
  const orgIdx = params.length;
  const res = await ctx.client.query<AgentCapabilityBindingRow>(
    `UPDATE govai.regulatory_agent_capability_bindings SET ${sets.join(', ')}
      WHERE id = $${idIdx}::uuid AND org_id = $${orgIdx}::uuid
      RETURNING ${AGENT_BINDING_COLUMNS}`,
    params,
  );
  const row = res.rows[0];
  if (!row) throw new RegulatoryError(404, 'agent_capability_binding_not_found');

  const statusChanged =
    input.capability_status !== undefined && input.capability_status !== existing.capability_status;
  const riskChanged = input.risk_posture !== undefined && input.risk_posture !== existing.risk_posture;
  await appendAudit(ctx, {
    eventType: 'regulatory_agent_capability_binding.updated',
    subjectType: 'regulatory_agent_capability_binding',
    subjectId: row.id,
    metadata: {
      binding_id: row.id,
      agent_id: row.agent_id,
      agent_version_id: row.agent_version_id,
      capability_key: row.capability_key,
      capability_category: row.capability_category,
      changed_fields: Object.keys(input),
      capability_status: row.capability_status,
      risk_posture: row.risk_posture,
      hard_deny_floor_expected: row.hard_deny_floor_expected,
      ...(statusChanged ? { previous_capability_status: existing.capability_status } : {}),
      ...(riskChanged ? { previous_risk_posture: existing.risk_posture } : {}),
    },
  });
  if (statusChanged) {
    await appendAudit(ctx, {
      eventType: 'regulatory_agent_capability_binding.status_changed',
      subjectType: 'regulatory_agent_capability_binding',
      subjectId: row.id,
      metadata: {
        binding_id: row.id,
        agent_id: row.agent_id,
        agent_version_id: row.agent_version_id,
        capability_key: row.capability_key,
        capability_category: row.capability_category,
        risk_posture: row.risk_posture,
        hard_deny_floor_expected: row.hard_deny_floor_expected,
        previous_capability_status: existing.capability_status,
        capability_status: row.capability_status,
      },
    });
  }
  if (riskChanged) {
    await appendAudit(ctx, {
      eventType: 'regulatory_agent_capability_binding.risk_posture_changed',
      subjectType: 'regulatory_agent_capability_binding',
      subjectId: row.id,
      metadata: {
        binding_id: row.id,
        agent_id: row.agent_id,
        agent_version_id: row.agent_version_id,
        capability_key: row.capability_key,
        capability_category: row.capability_category,
        capability_status: row.capability_status,
        hard_deny_floor_expected: row.hard_deny_floor_expected,
        previous_risk_posture: existing.risk_posture,
        risk_posture: row.risk_posture,
      },
    });
  }
  return row;
}

export async function listAgentCapabilityBindings(
  ctx: Ctx,
  filters: {
    agent_id?: string;
    agent_version_id?: string;
    capability_category?: string;
    capability_status?: string;
    risk_posture?: string;
    hard_deny_floor_expected?: boolean;
    approval_required?: boolean;
    evidence_required?: boolean;
    q?: string;
  },
  cursor: Cursor,
): Promise<ListResult<AgentCapabilityBindingRow>> {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  const eq = (column: string, val: string | undefined, cast = '') => {
    if (val === undefined) return;
    params.push(val);
    where.push(`${column} = $${params.length}${cast}`);
  };
  const eqBool = (column: string, val: boolean | undefined) => {
    if (val === undefined) return;
    params.push(val);
    where.push(`${column} = $${params.length}`);
  };
  eq('agent_id', filters.agent_id, '::uuid');
  eq('agent_version_id', filters.agent_version_id, '::uuid');
  eq('capability_category', filters.capability_category);
  eq('capability_status', filters.capability_status);
  eq('risk_posture', filters.risk_posture);
  eqBool('hard_deny_floor_expected', filters.hard_deny_floor_expected);
  eqBool('approval_required', filters.approval_required);
  eqBool('evidence_required', filters.evidence_required);
  if (filters.q !== undefined) {
    params.push(`%${filters.q}%`);
    const i = params.length;
    where.push(
      `(capability_key ILIKE $${i} OR capability_name ILIKE $${i} OR scope_summary ILIKE $${i}
        OR restriction_summary ILIKE $${i} OR rationale ILIKE $${i})`,
    );
  }
  applyCursor(where, params, cursor);
  params.push(cursor.limit);
  const res = await ctx.client.query<AgentCapabilityBindingRow>(
    `SELECT ${AGENT_BINDING_COLUMNS} FROM govai.regulatory_agent_capability_bindings
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}

// ---------------------------------------------------------------------------
// Use-case Registry (PR-R6)
// ---------------------------------------------------------------------------

export type UseCaseRow = {
  id: string;
  org_id: string;
  use_case_key: string;
  name: string;
  description: string;
  use_case_status: string;
  use_case_category: string;
  business_criticality: string;
  deployment_scope: string;
  primary_jurisdiction: string;
  business_owner: string | null;
  technical_owner: string | null;
  legal_owner: string | null;
  dpo_owner: string | null;
  accountable_executive: string | null;
  intended_purpose: string;
  expected_benefits: string;
  prohibited_uses: string;
  restricted_uses: string;
  target_users: string;
  affected_subjects: string;
  data_categories_summary: string;
  sensitive_data_summary: string;
  legal_basis_summary: string;
  regulatory_basis_summary: string;
  human_oversight_summary: string;
  review_frequency: string;
  last_reviewed_at: Date | null;
  next_review_at: Date | null;
  primary_ai_system_id: string | null;
  regulatory_source_id: string | null;
  control_id: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const USE_CASE_COLUMNS = `id, org_id, use_case_key, name, description, use_case_status, use_case_category,
  business_criticality, deployment_scope, primary_jurisdiction, business_owner, technical_owner, legal_owner,
  dpo_owner, accountable_executive, intended_purpose, expected_benefits, prohibited_uses, restricted_uses,
  target_users, affected_subjects, data_categories_summary, sensitive_data_summary, legal_basis_summary,
  regulatory_basis_summary, human_oversight_summary, review_frequency, last_reviewed_at, next_review_at,
  primary_ai_system_id, regulatory_source_id, control_id, metadata, created_by_user_id, updated_by_user_id,
  created_at, updated_at`;

export type UseCaseAssetLinkRow = {
  id: string;
  org_id: string;
  use_case_id: string;
  ai_system_id: string;
  model_id: string | null;
  model_version_id: string | null;
  agent_id: string | null;
  agent_version_id: string | null;
  link_status: string;
  usage_role: string;
  deployment_environment: string;
  effective_from: Date | null;
  effective_to: Date | null;
  rationale: string;
  evidence_reference: string | null;
  regulatory_source_id: string | null;
  control_id: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const USE_CASE_ASSET_LINK_COLUMNS = `id, org_id, use_case_id, ai_system_id, model_id, model_version_id,
  agent_id, agent_version_id, link_status, usage_role, deployment_environment, effective_from, effective_to,
  rationale, evidence_reference, regulatory_source_id, control_id, metadata, created_by_user_id,
  updated_by_user_id, created_at, updated_at`;

export type UseCaseReviewRow = {
  id: string;
  org_id: string;
  use_case_id: string;
  review_key: string;
  review_type: string;
  review_status: string;
  review_outcome: string;
  reviewer_user_id: string | null;
  reviewer_name: string | null;
  reviewed_at: Date | null;
  next_review_at: Date | null;
  findings_summary: string;
  decision_summary: string;
  conditions_summary: string;
  evidence_reference: string | null;
  evidence_hash: string | null;
  regulatory_source_id: string | null;
  control_id: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const USE_CASE_REVIEW_COLUMNS = `id, org_id, use_case_id, review_key, review_type, review_status,
  review_outcome, reviewer_user_id, reviewer_name, reviewed_at, next_review_at, findings_summary,
  decision_summary, conditions_summary, evidence_reference, evidence_hash, regulatory_source_id, control_id,
  metadata, created_by_user_id, updated_by_user_id, created_at, updated_at`;

// Use cases reference an optional own-tenant AI system and optional own/system
// source/control. Service-level checks give clean 404s; the DB RLS is the backstop.
async function requireUseCaseParents(
  ctx: Ctx,
  refs: { primary_ai_system_id?: string | null; regulatory_source_id?: string | null; control_id?: string | null },
): Promise<void> {
  if (refs.primary_ai_system_id) {
    if (!(await getVisibleAiSystem(ctx, refs.primary_ai_system_id)))
      throw new RegulatoryError(404, 'ai_system_not_found');
  }
  await requireVisibleParents(ctx, {
    regulatory_source_id: refs.regulatory_source_id ?? null,
    control_id: refs.control_id ?? null,
  });
}

export async function createUseCase(ctx: Ctx, input: CreateUseCaseInput): Promise<UseCaseRow> {
  await requireUseCaseParents(ctx, {
    primary_ai_system_id: input.primary_ai_system_id ?? null,
    regulatory_source_id: input.regulatory_source_id ?? null,
    control_id: input.control_id ?? null,
  });
  let res;
  try {
    res = await ctx.client.query<UseCaseRow>(
      `INSERT INTO govai.regulatory_use_cases
         (org_id, use_case_key, name, description, use_case_status, use_case_category, business_criticality,
          deployment_scope, primary_jurisdiction, business_owner, technical_owner, legal_owner, dpo_owner,
          accountable_executive, intended_purpose, expected_benefits, prohibited_uses, restricted_uses,
          target_users, affected_subjects, data_categories_summary, sensitive_data_summary, legal_basis_summary,
          regulatory_basis_summary, human_oversight_summary, review_frequency, last_reviewed_at, next_review_at,
          primary_ai_system_id, regulatory_source_id, control_id, metadata, created_by_user_id, updated_by_user_id)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
               $21, $22, $23, $24, $25, $26, $27::timestamptz, $28::timestamptz, $29::uuid, $30::uuid, $31::uuid,
               $32::jsonb, $33::uuid, $33::uuid)
       RETURNING ${USE_CASE_COLUMNS}`,
      [
        ctx.actor.orgId,
        input.use_case_key,
        input.name,
        input.description,
        input.use_case_status,
        input.use_case_category,
        input.business_criticality,
        input.deployment_scope,
        input.primary_jurisdiction,
        input.business_owner ?? null,
        input.technical_owner ?? null,
        input.legal_owner ?? null,
        input.dpo_owner ?? null,
        input.accountable_executive ?? null,
        input.intended_purpose,
        input.expected_benefits,
        input.prohibited_uses,
        input.restricted_uses,
        input.target_users,
        input.affected_subjects,
        input.data_categories_summary,
        input.sensitive_data_summary,
        input.legal_basis_summary,
        input.regulatory_basis_summary,
        input.human_oversight_summary,
        input.review_frequency,
        input.last_reviewed_at ?? null,
        input.next_review_at ?? null,
        input.primary_ai_system_id ?? null,
        input.regulatory_source_id ?? null,
        input.control_id ?? null,
        JSON.stringify(input.metadata ?? {}),
        ctx.actor.userId,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegulatoryError(409, 'use_case_key_conflict', { use_case_key: input.use_case_key });
    }
    throw err;
  }
  const row = res.rows[0]!;
  await appendAudit(ctx, {
    eventType: 'regulatory_use_case.created',
    subjectType: 'regulatory_use_case',
    subjectId: row.id,
    metadata: useCaseAuditMeta(row),
  });
  return row;
}

function useCaseAuditMeta(row: UseCaseRow): Record<string, unknown> {
  return {
    use_case_id: row.id,
    use_case_key: row.use_case_key,
    use_case_status: row.use_case_status,
    use_case_category: row.use_case_category,
    business_criticality: row.business_criticality,
    deployment_scope: row.deployment_scope,
    primary_ai_system_id: row.primary_ai_system_id,
  };
}

export async function getVisibleUseCase(ctx: Ctx, id: string): Promise<UseCaseRow | null> {
  const r = await ctx.client.query<UseCaseRow>(
    `SELECT ${USE_CASE_COLUMNS} FROM govai.regulatory_use_cases WHERE id = $1::uuid`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function updateUseCase(ctx: Ctx, id: string, input: UpdateUseCaseInput): Promise<UseCaseRow> {
  const existing = await getVisibleUseCase(ctx, id);
  if (!existing) throw new RegulatoryError(404, 'use_case_not_found');
  await requireUseCaseParents(ctx, {
    primary_ai_system_id:
      input.primary_ai_system_id !== undefined ? input.primary_ai_system_id : existing.primary_ai_system_id,
    regulatory_source_id:
      input.regulatory_source_id !== undefined ? input.regulatory_source_id : existing.regulatory_source_id,
    control_id: input.control_id !== undefined ? input.control_id : existing.control_id,
  });

  const sets: string[] = [];
  const params: unknown[] = [];
  const col = (name: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${name} = $${params.length}${cast}`);
  };
  if (input.name !== undefined) col('name', input.name);
  if (input.description !== undefined) col('description', input.description);
  if (input.use_case_status !== undefined) col('use_case_status', input.use_case_status);
  if (input.use_case_category !== undefined) col('use_case_category', input.use_case_category);
  if (input.business_criticality !== undefined) col('business_criticality', input.business_criticality);
  if (input.deployment_scope !== undefined) col('deployment_scope', input.deployment_scope);
  if (input.primary_jurisdiction !== undefined) col('primary_jurisdiction', input.primary_jurisdiction);
  if (input.business_owner !== undefined) col('business_owner', input.business_owner);
  if (input.technical_owner !== undefined) col('technical_owner', input.technical_owner);
  if (input.legal_owner !== undefined) col('legal_owner', input.legal_owner);
  if (input.dpo_owner !== undefined) col('dpo_owner', input.dpo_owner);
  if (input.accountable_executive !== undefined) col('accountable_executive', input.accountable_executive);
  if (input.intended_purpose !== undefined) col('intended_purpose', input.intended_purpose);
  if (input.expected_benefits !== undefined) col('expected_benefits', input.expected_benefits);
  if (input.prohibited_uses !== undefined) col('prohibited_uses', input.prohibited_uses);
  if (input.restricted_uses !== undefined) col('restricted_uses', input.restricted_uses);
  if (input.target_users !== undefined) col('target_users', input.target_users);
  if (input.affected_subjects !== undefined) col('affected_subjects', input.affected_subjects);
  if (input.data_categories_summary !== undefined) col('data_categories_summary', input.data_categories_summary);
  if (input.sensitive_data_summary !== undefined) col('sensitive_data_summary', input.sensitive_data_summary);
  if (input.legal_basis_summary !== undefined) col('legal_basis_summary', input.legal_basis_summary);
  if (input.regulatory_basis_summary !== undefined) col('regulatory_basis_summary', input.regulatory_basis_summary);
  if (input.human_oversight_summary !== undefined) col('human_oversight_summary', input.human_oversight_summary);
  if (input.review_frequency !== undefined) col('review_frequency', input.review_frequency);
  if (input.last_reviewed_at !== undefined) col('last_reviewed_at', input.last_reviewed_at, '::timestamptz');
  if (input.next_review_at !== undefined) col('next_review_at', input.next_review_at, '::timestamptz');
  if (input.primary_ai_system_id !== undefined) col('primary_ai_system_id', input.primary_ai_system_id, '::uuid');
  if (input.regulatory_source_id !== undefined) col('regulatory_source_id', input.regulatory_source_id, '::uuid');
  if (input.control_id !== undefined) col('control_id', input.control_id, '::uuid');
  if (input.metadata !== undefined) col('metadata', JSON.stringify(input.metadata), '::jsonb');
  col('updated_by_user_id', ctx.actor.userId, '::uuid');
  sets.push('updated_at = now()');

  params.push(id);
  const idIdx = params.length;
  params.push(ctx.actor.orgId);
  const orgIdx = params.length;
  const res = await ctx.client.query<UseCaseRow>(
    `UPDATE govai.regulatory_use_cases SET ${sets.join(', ')}
      WHERE id = $${idIdx}::uuid AND org_id = $${orgIdx}::uuid
      RETURNING ${USE_CASE_COLUMNS}`,
    params,
  );
  const row = res.rows[0];
  if (!row) throw new RegulatoryError(404, 'use_case_not_found');

  const statusChanged = input.use_case_status !== undefined && input.use_case_status !== existing.use_case_status;
  const reviewDueChanged =
    input.next_review_at !== undefined &&
    (existing.next_review_at ? existing.next_review_at.toISOString() : null) !==
      (row.next_review_at ? row.next_review_at.toISOString() : null);
  await appendAudit(ctx, {
    eventType: 'regulatory_use_case.updated',
    subjectType: 'regulatory_use_case',
    subjectId: row.id,
    metadata: {
      ...useCaseAuditMeta(row),
      changed_fields: Object.keys(input),
      ...(statusChanged ? { previous_use_case_status: existing.use_case_status } : {}),
    },
  });
  if (statusChanged) {
    await appendAudit(ctx, {
      eventType: 'regulatory_use_case.status_changed',
      subjectType: 'regulatory_use_case',
      subjectId: row.id,
      metadata: {
        use_case_id: row.id,
        use_case_key: row.use_case_key,
        previous_use_case_status: existing.use_case_status,
        use_case_status: row.use_case_status,
      },
    });
  }
  if (reviewDueChanged) {
    await appendAudit(ctx, {
      eventType: 'regulatory_use_case.review_due_changed',
      subjectType: 'regulatory_use_case',
      subjectId: row.id,
      metadata: {
        use_case_id: row.id,
        use_case_key: row.use_case_key,
        previous_next_review_at: existing.next_review_at ? existing.next_review_at.toISOString() : null,
        next_review_at: row.next_review_at ? row.next_review_at.toISOString() : null,
      },
    });
  }
  return row;
}

export async function listUseCases(
  ctx: Ctx,
  filters: {
    use_case_status?: string;
    use_case_category?: string;
    business_criticality?: string;
    deployment_scope?: string;
    primary_jurisdiction?: string;
    primary_ai_system_id?: string;
    next_review_before?: string;
    q?: string;
  },
  cursor: Cursor,
): Promise<ListResult<UseCaseRow>> {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  const eq = (column: string, val: string | undefined, cast = '') => {
    if (val === undefined) return;
    params.push(val);
    where.push(`${column} = $${params.length}${cast}`);
  };
  eq('use_case_status', filters.use_case_status);
  eq('use_case_category', filters.use_case_category);
  eq('business_criticality', filters.business_criticality);
  eq('deployment_scope', filters.deployment_scope);
  eq('primary_jurisdiction', filters.primary_jurisdiction);
  eq('primary_ai_system_id', filters.primary_ai_system_id, '::uuid');
  if (filters.next_review_before !== undefined) {
    params.push(filters.next_review_before);
    where.push(`next_review_at IS NOT NULL AND next_review_at <= $${params.length}::timestamptz`);
  }
  if (filters.q !== undefined) {
    params.push(`%${filters.q}%`);
    const i = params.length;
    where.push(
      `(use_case_key ILIKE $${i} OR name ILIKE $${i} OR description ILIKE $${i} OR intended_purpose ILIKE $${i}
        OR prohibited_uses ILIKE $${i} OR restricted_uses ILIKE $${i} OR legal_basis_summary ILIKE $${i}
        OR regulatory_basis_summary ILIKE $${i})`,
    );
  }
  applyCursor(where, params, cursor);
  params.push(cursor.limit);
  const res = await ctx.client.query<UseCaseRow>(
    `SELECT ${USE_CASE_COLUMNS} FROM govai.regulatory_use_cases
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}

// --- Use-case asset links --------------------------------------------------

async function requireOwnedUseCase(ctx: Ctx, id: string): Promise<UseCaseRow> {
  const u = await getVisibleUseCase(ctx, id);
  if (!u) throw new RegulatoryError(404, 'use_case_not_found');
  return u;
}

// Validate all asset-link parents: own-tenant visibility, version-requires-parent,
// and version-belongs-to-parent. Clean 404/400s; DB RLS is the backstop.
async function requireAssetLinkParents(
  ctx: Ctx,
  refs: {
    use_case_id: string;
    ai_system_id: string;
    model_id?: string | null;
    model_version_id?: string | null;
    agent_id?: string | null;
    agent_version_id?: string | null;
    regulatory_source_id?: string | null;
    control_id?: string | null;
  },
): Promise<void> {
  if (refs.model_version_id && !refs.model_id) throw new RegulatoryError(400, 'model_version_requires_model');
  if (refs.agent_version_id && !refs.agent_id) throw new RegulatoryError(400, 'agent_version_requires_agent');
  if (!(await getVisibleUseCase(ctx, refs.use_case_id))) throw new RegulatoryError(404, 'use_case_not_found');
  if (!(await getVisibleAiSystem(ctx, refs.ai_system_id))) throw new RegulatoryError(404, 'ai_system_not_found');
  if (refs.model_id) {
    if (!(await getVisibleModel(ctx, refs.model_id))) throw new RegulatoryError(404, 'model_not_found');
  }
  if (refs.model_version_id) {
    const v = await getVisibleModelVersion(ctx, refs.model_version_id);
    if (!v) throw new RegulatoryError(404, 'model_version_not_found');
    if (v.model_id !== refs.model_id) {
      throw new RegulatoryError(400, 'model_version_model_mismatch', {
        model_id: refs.model_id,
        model_version_id: refs.model_version_id,
      });
    }
  }
  if (refs.agent_id) {
    if (!(await getVisibleAgent(ctx, refs.agent_id))) throw new RegulatoryError(404, 'agent_not_found');
  }
  if (refs.agent_version_id) {
    const v = await getVisibleAgentVersion(ctx, refs.agent_version_id);
    if (!v) throw new RegulatoryError(404, 'agent_version_not_found');
    if (v.agent_id !== refs.agent_id) {
      throw new RegulatoryError(400, 'agent_version_agent_mismatch', {
        agent_id: refs.agent_id,
        agent_version_id: refs.agent_version_id,
      });
    }
  }
  await requireVisibleParents(ctx, {
    regulatory_source_id: refs.regulatory_source_id ?? null,
    control_id: refs.control_id ?? null,
  });
}

export async function createUseCaseAssetLink(
  ctx: Ctx,
  input: CreateUseCaseAssetLinkInput,
): Promise<UseCaseAssetLinkRow> {
  await requireAssetLinkParents(ctx, {
    use_case_id: input.use_case_id,
    ai_system_id: input.ai_system_id,
    model_id: input.model_id ?? null,
    model_version_id: input.model_version_id ?? null,
    agent_id: input.agent_id ?? null,
    agent_version_id: input.agent_version_id ?? null,
    regulatory_source_id: input.regulatory_source_id ?? null,
    control_id: input.control_id ?? null,
  });
  let res;
  try {
    res = await ctx.client.query<UseCaseAssetLinkRow>(
      `INSERT INTO govai.regulatory_use_case_asset_links
         (org_id, use_case_id, ai_system_id, model_id, model_version_id, agent_id, agent_version_id,
          link_status, usage_role, deployment_environment, effective_from, effective_to, rationale,
          evidence_reference, regulatory_source_id, control_id, metadata, created_by_user_id, updated_by_user_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid, $8, $9, $10,
               $11::timestamptz, $12::timestamptz, $13, $14, $15::uuid, $16::uuid, $17::jsonb, $18::uuid, $18::uuid)
       RETURNING ${USE_CASE_ASSET_LINK_COLUMNS}`,
      [
        ctx.actor.orgId,
        input.use_case_id,
        input.ai_system_id,
        input.model_id ?? null,
        input.model_version_id ?? null,
        input.agent_id ?? null,
        input.agent_version_id ?? null,
        input.link_status,
        input.usage_role,
        input.deployment_environment,
        input.effective_from ?? null,
        input.effective_to ?? null,
        input.rationale,
        input.evidence_reference ?? null,
        input.regulatory_source_id ?? null,
        input.control_id ?? null,
        JSON.stringify(input.metadata ?? {}),
        ctx.actor.userId,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegulatoryError(409, 'use_case_asset_link_conflict', {
        usage_role: input.usage_role,
        deployment_environment: input.deployment_environment,
      });
    }
    throw err;
  }
  const row = res.rows[0]!;
  await appendAudit(ctx, {
    eventType: 'regulatory_use_case_asset_link.created',
    subjectType: 'regulatory_use_case_asset_link',
    subjectId: row.id,
    metadata: assetLinkAuditMeta(row),
  });
  return row;
}

function assetLinkAuditMeta(row: UseCaseAssetLinkRow): Record<string, unknown> {
  return {
    link_id: row.id,
    use_case_id: row.use_case_id,
    ai_system_id: row.ai_system_id,
    model_id: row.model_id,
    model_version_id: row.model_version_id,
    agent_id: row.agent_id,
    agent_version_id: row.agent_version_id,
    link_status: row.link_status,
    usage_role: row.usage_role,
    deployment_environment: row.deployment_environment,
  };
}

export async function getVisibleUseCaseAssetLink(
  ctx: Ctx,
  id: string,
): Promise<UseCaseAssetLinkRow | null> {
  const r = await ctx.client.query<UseCaseAssetLinkRow>(
    `SELECT ${USE_CASE_ASSET_LINK_COLUMNS} FROM govai.regulatory_use_case_asset_links WHERE id = $1::uuid`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function updateUseCaseAssetLink(
  ctx: Ctx,
  id: string,
  input: UpdateUseCaseAssetLinkInput,
): Promise<UseCaseAssetLinkRow> {
  const existing = await getVisibleUseCaseAssetLink(ctx, id);
  if (!existing) throw new RegulatoryError(404, 'use_case_asset_link_not_found');
  if (input.regulatory_source_id !== undefined || input.control_id !== undefined) {
    await requireVisibleParents(ctx, {
      regulatory_source_id:
        input.regulatory_source_id !== undefined ? input.regulatory_source_id : existing.regulatory_source_id,
      control_id: input.control_id !== undefined ? input.control_id : existing.control_id,
    });
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const col = (name: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${name} = $${params.length}${cast}`);
  };
  if (input.link_status !== undefined) col('link_status', input.link_status);
  if (input.effective_from !== undefined) col('effective_from', input.effective_from, '::timestamptz');
  if (input.effective_to !== undefined) col('effective_to', input.effective_to, '::timestamptz');
  if (input.rationale !== undefined) col('rationale', input.rationale);
  if (input.evidence_reference !== undefined) col('evidence_reference', input.evidence_reference);
  if (input.regulatory_source_id !== undefined) col('regulatory_source_id', input.regulatory_source_id, '::uuid');
  if (input.control_id !== undefined) col('control_id', input.control_id, '::uuid');
  if (input.metadata !== undefined) col('metadata', JSON.stringify(input.metadata), '::jsonb');
  col('updated_by_user_id', ctx.actor.userId, '::uuid');
  sets.push('updated_at = now()');

  params.push(id);
  const idIdx = params.length;
  params.push(ctx.actor.orgId);
  const orgIdx = params.length;
  const res = await ctx.client.query<UseCaseAssetLinkRow>(
    `UPDATE govai.regulatory_use_case_asset_links SET ${sets.join(', ')}
      WHERE id = $${idIdx}::uuid AND org_id = $${orgIdx}::uuid
      RETURNING ${USE_CASE_ASSET_LINK_COLUMNS}`,
    params,
  );
  const row = res.rows[0];
  if (!row) throw new RegulatoryError(404, 'use_case_asset_link_not_found');

  const statusChanged = input.link_status !== undefined && input.link_status !== existing.link_status;
  const retiredTransition =
    (statusChanged && row.link_status === 'RETIRED') ||
    (input.effective_to !== undefined && input.effective_to !== null && existing.effective_to === null);
  await appendAudit(ctx, {
    eventType: 'regulatory_use_case_asset_link.updated',
    subjectType: 'regulatory_use_case_asset_link',
    subjectId: row.id,
    metadata: {
      ...assetLinkAuditMeta(row),
      changed_fields: Object.keys(input),
      ...(statusChanged ? { previous_link_status: existing.link_status } : {}),
    },
  });
  if (statusChanged) {
    await appendAudit(ctx, {
      eventType: 'regulatory_use_case_asset_link.status_changed',
      subjectType: 'regulatory_use_case_asset_link',
      subjectId: row.id,
      metadata: { ...assetLinkAuditMeta(row), previous_link_status: existing.link_status },
    });
  }
  if (retiredTransition) {
    await appendAudit(ctx, {
      eventType: 'regulatory_use_case_asset_link.retired',
      subjectType: 'regulatory_use_case_asset_link',
      subjectId: row.id,
      metadata: {
        ...assetLinkAuditMeta(row),
        effective_to: row.effective_to ? row.effective_to.toISOString() : null,
      },
    });
  }
  return row;
}

export async function listUseCaseAssetLinks(
  ctx: Ctx,
  filters: {
    use_case_id?: string;
    ai_system_id?: string;
    model_id?: string;
    model_version_id?: string;
    agent_id?: string;
    agent_version_id?: string;
    link_status?: string;
    usage_role?: string;
    deployment_environment?: string;
    q?: string;
  },
  cursor: Cursor,
): Promise<ListResult<UseCaseAssetLinkRow>> {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  const eq = (column: string, val: string | undefined, cast = '') => {
    if (val === undefined) return;
    params.push(val);
    where.push(`${column} = $${params.length}${cast}`);
  };
  eq('use_case_id', filters.use_case_id, '::uuid');
  eq('ai_system_id', filters.ai_system_id, '::uuid');
  eq('model_id', filters.model_id, '::uuid');
  eq('model_version_id', filters.model_version_id, '::uuid');
  eq('agent_id', filters.agent_id, '::uuid');
  eq('agent_version_id', filters.agent_version_id, '::uuid');
  eq('link_status', filters.link_status);
  eq('usage_role', filters.usage_role);
  eq('deployment_environment', filters.deployment_environment);
  if (filters.q !== undefined) {
    params.push(`%${filters.q}%`);
    const i = params.length;
    where.push(`(rationale ILIKE $${i} OR evidence_reference ILIKE $${i})`);
  }
  applyCursor(where, params, cursor);
  params.push(cursor.limit);
  const res = await ctx.client.query<UseCaseAssetLinkRow>(
    `SELECT ${USE_CASE_ASSET_LINK_COLUMNS} FROM govai.regulatory_use_case_asset_links
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}

// --- Use-case reviews ------------------------------------------------------

export async function createUseCaseReview(
  ctx: Ctx,
  useCaseId: string,
  input: CreateUseCaseReviewInput,
): Promise<UseCaseReviewRow> {
  await requireOwnedUseCase(ctx, useCaseId);
  await requireVisibleParents(ctx, {
    regulatory_source_id: input.regulatory_source_id ?? null,
    control_id: input.control_id ?? null,
  });
  let res;
  try {
    res = await ctx.client.query<UseCaseReviewRow>(
      `INSERT INTO govai.regulatory_use_case_reviews
         (org_id, use_case_id, review_key, review_type, review_status, review_outcome, reviewer_user_id,
          reviewer_name, reviewed_at, next_review_at, findings_summary, decision_summary, conditions_summary,
          evidence_reference, evidence_hash, regulatory_source_id, control_id, metadata, created_by_user_id,
          updated_by_user_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9::timestamptz, $10::timestamptz, $11, $12,
               $13, $14, $15, $16::uuid, $17::uuid, $18::jsonb, $19::uuid, $19::uuid)
       RETURNING ${USE_CASE_REVIEW_COLUMNS}`,
      [
        ctx.actor.orgId,
        useCaseId,
        input.review_key,
        input.review_type,
        input.review_status,
        input.review_outcome,
        input.reviewer_user_id ?? null,
        input.reviewer_name ?? null,
        input.reviewed_at ?? null,
        input.next_review_at ?? null,
        input.findings_summary,
        input.decision_summary,
        input.conditions_summary,
        input.evidence_reference ?? null,
        input.evidence_hash ?? null,
        input.regulatory_source_id ?? null,
        input.control_id ?? null,
        JSON.stringify(input.metadata ?? {}),
        ctx.actor.userId,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegulatoryError(409, 'use_case_review_key_conflict', { review_key: input.review_key });
    }
    throw err;
  }
  const row = res.rows[0]!;
  await appendAudit(ctx, {
    eventType: 'regulatory_use_case_review.created',
    subjectType: 'regulatory_use_case_review',
    subjectId: row.id,
    metadata: reviewAuditMeta(row),
  });
  return row;
}

function reviewAuditMeta(row: UseCaseReviewRow): Record<string, unknown> {
  return {
    review_id: row.id,
    use_case_id: row.use_case_id,
    review_key: row.review_key,
    review_type: row.review_type,
    review_status: row.review_status,
    review_outcome: row.review_outcome,
  };
}

export async function getVisibleUseCaseReview(ctx: Ctx, id: string): Promise<UseCaseReviewRow | null> {
  const r = await ctx.client.query<UseCaseReviewRow>(
    `SELECT ${USE_CASE_REVIEW_COLUMNS} FROM govai.regulatory_use_case_reviews WHERE id = $1::uuid`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function updateUseCaseReview(
  ctx: Ctx,
  id: string,
  input: UpdateUseCaseReviewInput,
): Promise<UseCaseReviewRow> {
  const existing = await getVisibleUseCaseReview(ctx, id);
  if (!existing) throw new RegulatoryError(404, 'use_case_review_not_found');
  if (input.regulatory_source_id !== undefined || input.control_id !== undefined) {
    await requireVisibleParents(ctx, {
      regulatory_source_id:
        input.regulatory_source_id !== undefined ? input.regulatory_source_id : existing.regulatory_source_id,
      control_id: input.control_id !== undefined ? input.control_id : existing.control_id,
    });
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const col = (name: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${name} = $${params.length}${cast}`);
  };
  if (input.review_type !== undefined) col('review_type', input.review_type);
  if (input.review_status !== undefined) col('review_status', input.review_status);
  if (input.review_outcome !== undefined) col('review_outcome', input.review_outcome);
  if (input.reviewer_user_id !== undefined) col('reviewer_user_id', input.reviewer_user_id, '::uuid');
  if (input.reviewer_name !== undefined) col('reviewer_name', input.reviewer_name);
  if (input.reviewed_at !== undefined) col('reviewed_at', input.reviewed_at, '::timestamptz');
  if (input.next_review_at !== undefined) col('next_review_at', input.next_review_at, '::timestamptz');
  if (input.findings_summary !== undefined) col('findings_summary', input.findings_summary);
  if (input.decision_summary !== undefined) col('decision_summary', input.decision_summary);
  if (input.conditions_summary !== undefined) col('conditions_summary', input.conditions_summary);
  if (input.evidence_reference !== undefined) col('evidence_reference', input.evidence_reference);
  if (input.evidence_hash !== undefined) col('evidence_hash', input.evidence_hash);
  if (input.regulatory_source_id !== undefined) col('regulatory_source_id', input.regulatory_source_id, '::uuid');
  if (input.control_id !== undefined) col('control_id', input.control_id, '::uuid');
  if (input.metadata !== undefined) col('metadata', JSON.stringify(input.metadata), '::jsonb');
  col('updated_by_user_id', ctx.actor.userId, '::uuid');
  sets.push('updated_at = now()');

  params.push(id);
  const idIdx = params.length;
  params.push(ctx.actor.orgId);
  const orgIdx = params.length;
  const res = await ctx.client.query<UseCaseReviewRow>(
    `UPDATE govai.regulatory_use_case_reviews SET ${sets.join(', ')}
      WHERE id = $${idIdx}::uuid AND org_id = $${orgIdx}::uuid
      RETURNING ${USE_CASE_REVIEW_COLUMNS}`,
    params,
  );
  const row = res.rows[0];
  if (!row) throw new RegulatoryError(404, 'use_case_review_not_found');

  const statusChanged = input.review_status !== undefined && input.review_status !== existing.review_status;
  const completedTransition = statusChanged && row.review_status === 'COMPLETED';
  const outcomeChanged = input.review_outcome !== undefined && input.review_outcome !== existing.review_outcome;
  await appendAudit(ctx, {
    eventType: 'regulatory_use_case_review.updated',
    subjectType: 'regulatory_use_case_review',
    subjectId: row.id,
    metadata: {
      ...reviewAuditMeta(row),
      changed_fields: Object.keys(input),
      ...(statusChanged ? { previous_review_status: existing.review_status } : {}),
      ...(outcomeChanged ? { previous_review_outcome: existing.review_outcome } : {}),
    },
  });
  if (statusChanged) {
    await appendAudit(ctx, {
      eventType: 'regulatory_use_case_review.status_changed',
      subjectType: 'regulatory_use_case_review',
      subjectId: row.id,
      metadata: { ...reviewAuditMeta(row), previous_review_status: existing.review_status },
    });
  }
  if (completedTransition) {
    await appendAudit(ctx, {
      eventType: 'regulatory_use_case_review.completed',
      subjectType: 'regulatory_use_case_review',
      subjectId: row.id,
      metadata: {
        ...reviewAuditMeta(row),
        reviewed_at: row.reviewed_at ? row.reviewed_at.toISOString() : null,
      },
    });
  }
  if (outcomeChanged) {
    await appendAudit(ctx, {
      eventType: 'regulatory_use_case_review.outcome_changed',
      subjectType: 'regulatory_use_case_review',
      subjectId: row.id,
      metadata: { ...reviewAuditMeta(row), previous_review_outcome: existing.review_outcome },
    });
  }
  return row;
}

export async function listUseCaseReviews(
  ctx: Ctx,
  useCaseId: string,
  filters: {
    review_type?: string;
    review_status?: string;
    review_outcome?: string;
    reviewed_before?: string;
    next_review_before?: string;
    q?: string;
  },
  cursor: Cursor,
): Promise<ListResult<UseCaseReviewRow>> {
  await requireOwnedUseCase(ctx, useCaseId);
  const where: string[] = ['use_case_id = $1::uuid'];
  const params: unknown[] = [useCaseId];
  const eq = (column: string, val: string | undefined) => {
    if (val === undefined) return;
    params.push(val);
    where.push(`${column} = $${params.length}`);
  };
  eq('review_type', filters.review_type);
  eq('review_status', filters.review_status);
  eq('review_outcome', filters.review_outcome);
  if (filters.reviewed_before !== undefined) {
    params.push(filters.reviewed_before);
    where.push(`reviewed_at IS NOT NULL AND reviewed_at <= $${params.length}::timestamptz`);
  }
  if (filters.next_review_before !== undefined) {
    params.push(filters.next_review_before);
    where.push(`next_review_at IS NOT NULL AND next_review_at <= $${params.length}::timestamptz`);
  }
  if (filters.q !== undefined) {
    params.push(`%${filters.q}%`);
    const i = params.length;
    where.push(
      `(review_key ILIKE $${i} OR findings_summary ILIKE $${i} OR decision_summary ILIKE $${i}
        OR conditions_summary ILIKE $${i} OR evidence_reference ILIKE $${i})`,
    );
  }
  applyCursor(where, params, cursor);
  params.push(cursor.limit);
  const res = await ctx.client.query<UseCaseReviewRow>(
    `SELECT ${USE_CASE_REVIEW_COLUMNS} FROM govai.regulatory_use_case_reviews
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}

// ---------------------------------------------------------------------------
// Risk Classification Engine (PR-R7)
// ---------------------------------------------------------------------------

// Deterministic technical risk classifier. Pure function: same inputs always
// produce the same factor list, tier, and score. Mitigation posture is recorded
// as an evidence-only factor and does NOT downgrade tier or score in PR-R7.
// Review flags (requires_high_risk_review / requires_prohibited_use_review) are
// evidence flags only — PR-R7 does NOT create review workflows, assign
// reviewers, block execution, or enforce runtime decisions.

const RISK_TIER_ORDER = ['MINIMAL', 'LOW', 'MODERATE', 'HIGH', 'PROHIBITED'] as const;
const RISK_TIER_SCORE: Record<string, number> = {
  MINIMAL: 5,
  LOW: 20,
  MODERATE: 50,
  HIGH: 80,
  PROHIBITED: 100,
  UNKNOWN: 0,
};
const EXTERNAL_DECISION_SCOPES = new Set([
  'EXTERNAL_EFFECT',
  'AUTOMATED_DECISION',
  'PUBLIC_SECTOR_DECISION',
  'JUDICIAL_SUPPORT',
]);
const PUBLIC_JUDICIAL_DECISION_SCOPES = new Set(['PUBLIC_SECTOR_DECISION', 'JUDICIAL_SUPPORT']);
const AUTONOMOUS_AGENT_LEVELS = new Set(['AUTONOMOUS_WITH_GUARDRAILS', 'SUPERVISED_AUTONOMOUS']);

export type RiskEngineFactor = {
  factor_key: string;
  factor_category: string;
  factor_severity: string;
  factor_value: string;
  triggered: boolean;
  score_contribution: number;
  rationale: string;
};

export type RiskEngineResult = {
  inherent_risk_tier: string;
  residual_risk_tier: string;
  risk_score: number;
  residual_risk_score: number;
  mitigation_strength: string;
  requires_high_risk_review: boolean;
  requires_prohibited_use_review: boolean;
  insufficient_information: boolean;
  factors: RiskEngineFactor[];
  factor_summary: string;
};

export function classifyRisk(input: FactorInputsValue, decisionScope: string): RiskEngineResult {
  const factors: RiskEngineFactor[] = [];
  const mitigation = input.mitigation_strength ?? 'UNKNOWN';
  const automatedDec = input.automated_decisioning ?? 'NONE';
  const agentAutonomy = input.agent_autonomy_level ?? 'NONE';

  // 1. Insufficient information short-circuits to UNKNOWN.
  if (input.insufficient_information === true) {
    factors.push({
      factor_key: 'insufficient_information',
      factor_category: 'INSUFFICIENT_INFORMATION',
      factor_severity: 'UNKNOWN',
      factor_value: 'true',
      triggered: true,
      score_contribution: 0,
      rationale: 'insufficient information provided to classify',
    });
    return {
      inherent_risk_tier: 'UNKNOWN',
      residual_risk_tier: 'UNKNOWN',
      risk_score: 0,
      residual_risk_score: 0,
      mitigation_strength: mitigation,
      requires_high_risk_review: false,
      requires_prohibited_use_review: false,
      insufficient_information: true,
      factors,
      factor_summary: 'UNKNOWN: insufficient information',
    };
  }

  // 2. Prohibited signals short-circuit to PROHIBITED.
  const prohibitedSignals: Array<readonly [string, boolean | undefined, string]> = [
    ['prohibited_use_signal', input.prohibited_use_signal, 'declared prohibited use'],
    ['social_scoring_signal', input.social_scoring_signal, 'social scoring signal'],
    [
      'biometric_emotion_recognition_signal',
      input.biometric_emotion_recognition_signal,
      'biometric emotion recognition signal',
    ],
  ];
  let prohibited = false;
  for (const [key, val, rationale] of prohibitedSignals) {
    if (val === true) {
      prohibited = true;
      factors.push({
        factor_key: key,
        factor_category: 'PROHIBITED_SIGNAL',
        factor_severity: 'PROHIBITED',
        factor_value: 'true',
        triggered: true,
        score_contribution: 100,
        rationale,
      });
    }
  }
  if (prohibited) {
    if (mitigation !== 'UNKNOWN') {
      factors.push({
        factor_key: 'mitigation_strength',
        factor_category: 'MITIGATION',
        factor_severity: 'UNKNOWN',
        factor_value: mitigation,
        triggered: false,
        score_contribution: 0,
        rationale: 'mitigation posture recorded as evidence (PR-R7 does not downgrade)',
      });
    }
    return {
      inherent_risk_tier: 'PROHIBITED',
      residual_risk_tier: 'PROHIBITED',
      risk_score: 100,
      residual_risk_score: 100,
      mitigation_strength: mitigation,
      requires_high_risk_review: true,
      requires_prohibited_use_review: true,
      insufficient_information: false,
      factors,
      factor_summary: 'PROHIBITED: prohibited signal triggered',
    };
  }

  // 3. HIGH-trigger rules.
  type RuleSpec = readonly [string, boolean, string, string];
  const highRules: RuleSpec[] = [
    [
      'rights_affecting_automated_decision',
      input.rights_affecting_automated_decision === true,
      'SUBJECT_RIGHTS',
      'rights-affecting automated decision',
    ],
    [
      'sensitive_data_with_automation',
      input.sensitive_data === true && automatedDec !== 'NONE',
      'DATA_SENSITIVITY',
      'sensitive data combined with automated decisioning',
    ],
    [
      'children_or_adolescents_data',
      input.children_or_adolescents_data === true,
      'DATA_SENSITIVITY',
      'data on children or adolescents',
    ],
    [
      'judicial_secret_data',
      input.judicial_secret_data === true,
      'JUDICIARY_CONTEXT',
      'judicial secret data',
    ],
    [
      'attorney_client_privileged_data',
      input.attorney_client_privileged_data === true,
      'JUDICIARY_CONTEXT',
      'attorney-client privileged data',
    ],
    ['biometric_data', input.biometric_data === true, 'DATA_SENSITIVITY', 'biometric data'],
    [
      'health_data_external_scope',
      input.health_data === true && EXTERNAL_DECISION_SCOPES.has(decisionScope),
      'DATA_SENSITIVITY',
      'health data with external/decisioning scope',
    ],
    [
      'employment_or_credit_access_with_automation',
      input.employment_or_credit_access === true && automatedDec !== 'NONE',
      'SUBJECT_RIGHTS',
      'employment or credit access with automated decisioning',
    ],
    [
      'public_sector_judicial_context',
      input.public_sector_context === true && PUBLIC_JUDICIAL_DECISION_SCOPES.has(decisionScope),
      'SECTOR_CONTEXT',
      'public-sector context with public-sector or judicial-support decision scope',
    ],
    [
      'agent_external_side_effects_autonomous',
      input.agent_external_side_effects === true && AUTONOMOUS_AGENT_LEVELS.has(agentAutonomy),
      'AGENT_AUTONOMY',
      'agent external side effects under (supervised) autonomous operation',
    ],
  ];

  const moderateRules: RuleSpec[] = [
    ['personal_data', input.personal_data === true, 'DATA_SENSITIVITY', 'personal data processing'],
    [
      'customer_or_public_facing',
      input.customer_facing_or_public_facing === true,
      'DECISION_SCOPE',
      'customer-facing or public-facing deployment',
    ],
    [
      'third_party_runtime',
      input.third_party_runtime === true,
      'PROVIDER_POSTURE',
      'third-party runtime',
    ],
    [
      'limited_human_oversight',
      input.limited_human_oversight === true,
      'HUMAN_OVERSIGHT',
      'limited human oversight',
    ],
  ];

  for (const [key, triggered, category, rationale] of highRules) {
    factors.push({
      factor_key: key,
      factor_category: category,
      factor_severity: triggered ? 'HIGH' : 'MINIMAL',
      factor_value: String(Boolean(triggered)),
      triggered,
      score_contribution: triggered ? 80 : 0,
      rationale,
    });
  }
  for (const [key, triggered, category, rationale] of moderateRules) {
    factors.push({
      factor_key: key,
      factor_category: category,
      factor_severity: triggered ? 'MODERATE' : 'MINIMAL',
      factor_value: String(Boolean(triggered)),
      triggered,
      score_contribution: triggered ? 50 : 0,
      rationale,
    });
  }

  // Mitigation posture is evidence only — PR-R7 does NOT downgrade tier/score.
  if (mitigation !== 'UNKNOWN') {
    factors.push({
      factor_key: 'mitigation_strength',
      factor_category: 'MITIGATION',
      factor_severity: 'UNKNOWN',
      factor_value: mitigation,
      triggered: false,
      score_contribution: 0,
      rationale: 'mitigation posture recorded as evidence (PR-R7 does not downgrade)',
    });
  }

  // Aggregate: tier = max severity among triggered non-mitigation factors.
  const triggeredSeverities = factors
    .filter(
      (f) =>
        f.triggered &&
        f.factor_category !== 'MITIGATION' &&
        f.factor_category !== 'INSUFFICIENT_INFORMATION',
    )
    .map((f) => f.factor_severity);

  let bestIdx = -1;
  for (const sev of triggeredSeverities) {
    const i = RISK_TIER_ORDER.indexOf(sev as (typeof RISK_TIER_ORDER)[number]);
    if (i > bestIdx) bestIdx = i;
  }
  const tier = bestIdx === -1 ? 'MINIMAL' : RISK_TIER_ORDER[bestIdx]!;
  const score = RISK_TIER_SCORE[tier]!;

  return {
    inherent_risk_tier: tier,
    residual_risk_tier: tier,
    risk_score: score,
    residual_risk_score: score,
    mitigation_strength: mitigation,
    requires_high_risk_review: tier === 'HIGH' || tier === 'PROHIBITED',
    requires_prohibited_use_review: tier === 'PROHIBITED',
    insufficient_information: false,
    factors,
    factor_summary: `${tier}: ${triggeredSeverities.length} triggered factor(s)`,
  };
}

// ---- Row types -----------------------------------------------------------

export type RiskMethodRow = {
  id: string;
  org_id: string;
  method_key: string;
  method_version: string;
  name: string;
  method_status: string;
  framework_profile: string;
  methodology_summary: string;
  scoring_summary: string;
  high_risk_criteria_summary: string;
  prohibited_criteria_summary: string;
  mitigation_policy_summary: string;
  regulatory_source_id: string | null;
  control_id: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const RISK_METHOD_COLUMNS = `id, org_id, method_key, method_version, name, method_status, framework_profile,
  methodology_summary, scoring_summary, high_risk_criteria_summary, prohibited_criteria_summary,
  mitigation_policy_summary, regulatory_source_id, control_id, metadata, created_by_user_id,
  updated_by_user_id, created_at, updated_at`;

export type RiskClassificationRow = {
  id: string;
  org_id: string;
  classification_key: string;
  classification_status: string;
  risk_method_id: string;
  use_case_id: string;
  ai_system_id: string;
  use_case_asset_link_id: string | null;
  model_id: string | null;
  model_version_id: string | null;
  agent_id: string | null;
  agent_version_id: string | null;
  classification_basis: string;
  decision_scope: string;
  inherent_risk_tier: string;
  residual_risk_tier: string;
  risk_score: number;
  residual_risk_score: number;
  mitigation_strength: string;
  requires_high_risk_review: boolean;
  requires_prohibited_use_review: boolean;
  insufficient_information: boolean;
  rationale_summary: string;
  factor_summary: string;
  evidence_summary: string;
  mitigation_summary: string;
  residual_risk_summary: string;
  recommended_controls_summary: string;
  review_notes: string;
  effective_from: Date | null;
  effective_to: Date | null;
  supersedes_classification_id: string | null;
  regulatory_source_id: string | null;
  control_id: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const RISK_CLASSIFICATION_COLUMNS = `id, org_id, classification_key, classification_status, risk_method_id,
  use_case_id, ai_system_id, use_case_asset_link_id, model_id, model_version_id, agent_id, agent_version_id,
  classification_basis, decision_scope, inherent_risk_tier, residual_risk_tier, risk_score,
  residual_risk_score, mitigation_strength, requires_high_risk_review, requires_prohibited_use_review,
  insufficient_information, rationale_summary, factor_summary, evidence_summary, mitigation_summary,
  residual_risk_summary, recommended_controls_summary, review_notes, effective_from, effective_to,
  supersedes_classification_id, regulatory_source_id, control_id, metadata, created_by_user_id,
  updated_by_user_id, created_at, updated_at`;

export type RiskClassificationFactorRow = {
  id: string;
  org_id: string;
  classification_id: string;
  factor_key: string;
  factor_category: string;
  factor_severity: string;
  factor_value: string;
  triggered: boolean;
  score_contribution: number;
  rationale: string;
  evidence_reference: string | null;
  regulatory_source_id: string | null;
  control_id: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const RISK_FACTOR_COLUMNS = `id, org_id, classification_id, factor_key, factor_category, factor_severity,
  factor_value, triggered, score_contribution, rationale, evidence_reference, regulatory_source_id,
  control_id, metadata, created_by_user_id, updated_by_user_id, created_at, updated_at`;

export type ReclassificationTriggerRow = {
  id: string;
  org_id: string;
  trigger_key: string;
  trigger_status: string;
  trigger_type: string;
  recommended_action: string;
  classification_id: string | null;
  use_case_id: string;
  ai_system_id: string;
  prior_risk_tier: string | null;
  trigger_reason: string;
  evidence_reference: string | null;
  detected_at: Date | null;
  due_at: Date | null;
  resolved_at: Date | null;
  regulatory_source_id: string | null;
  control_id: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const RECLASSIFICATION_TRIGGER_COLUMNS = `id, org_id, trigger_key, trigger_status, trigger_type,
  recommended_action, classification_id, use_case_id, ai_system_id, prior_risk_tier, trigger_reason,
  evidence_reference, detected_at, due_at, resolved_at, regulatory_source_id, control_id, metadata,
  created_by_user_id, updated_by_user_id, created_at, updated_at`;

// ---- Risk methods --------------------------------------------------------

export async function createRiskMethod(
  ctx: Ctx,
  input: CreateRiskMethodInput,
): Promise<RiskMethodRow> {
  await requireVisibleParents(ctx, {
    regulatory_source_id: input.regulatory_source_id ?? null,
    control_id: input.control_id ?? null,
  });
  let res;
  try {
    res = await ctx.client.query<RiskMethodRow>(
      `INSERT INTO govai.regulatory_risk_methods
         (org_id, method_key, method_version, name, method_status, framework_profile,
          methodology_summary, scoring_summary, high_risk_criteria_summary, prohibited_criteria_summary,
          mitigation_policy_summary, regulatory_source_id, control_id, metadata, created_by_user_id,
          updated_by_user_id)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid, $13::uuid, $14::jsonb,
               $15::uuid, $15::uuid)
       RETURNING ${RISK_METHOD_COLUMNS}`,
      [
        ctx.actor.orgId,
        input.method_key,
        input.method_version,
        input.name,
        input.method_status,
        input.framework_profile,
        input.methodology_summary,
        input.scoring_summary,
        input.high_risk_criteria_summary,
        input.prohibited_criteria_summary,
        input.mitigation_policy_summary,
        input.regulatory_source_id ?? null,
        input.control_id ?? null,
        JSON.stringify(input.metadata ?? {}),
        ctx.actor.userId,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegulatoryError(409, 'risk_method_key_conflict', {
        method_key: input.method_key,
        method_version: input.method_version,
      });
    }
    throw err;
  }
  const row = res.rows[0]!;
  await appendAudit(ctx, {
    eventType: 'regulatory_risk_method.created',
    subjectType: 'regulatory_risk_method',
    subjectId: row.id,
    metadata: {
      risk_method_id: row.id,
      method_key: row.method_key,
      method_version: row.method_version,
      method_status: row.method_status,
      framework_profile: row.framework_profile,
    },
  });
  return row;
}

export async function getVisibleRiskMethod(ctx: Ctx, id: string): Promise<RiskMethodRow | null> {
  const r = await ctx.client.query<RiskMethodRow>(
    `SELECT ${RISK_METHOD_COLUMNS} FROM govai.regulatory_risk_methods WHERE id = $1::uuid`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function updateRiskMethod(
  ctx: Ctx,
  id: string,
  input: UpdateRiskMethodInput,
): Promise<RiskMethodRow> {
  const existing = await getVisibleRiskMethod(ctx, id);
  if (!existing) throw new RegulatoryError(404, 'risk_method_not_found');
  if (input.regulatory_source_id !== undefined || input.control_id !== undefined) {
    await requireVisibleParents(ctx, {
      regulatory_source_id:
        input.regulatory_source_id !== undefined ? input.regulatory_source_id : existing.regulatory_source_id,
      control_id: input.control_id !== undefined ? input.control_id : existing.control_id,
    });
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const col = (name: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${name} = $${params.length}${cast}`);
  };
  if (input.name !== undefined) col('name', input.name);
  if (input.method_status !== undefined) col('method_status', input.method_status);
  if (input.framework_profile !== undefined) col('framework_profile', input.framework_profile);
  if (input.methodology_summary !== undefined) col('methodology_summary', input.methodology_summary);
  if (input.scoring_summary !== undefined) col('scoring_summary', input.scoring_summary);
  if (input.high_risk_criteria_summary !== undefined)
    col('high_risk_criteria_summary', input.high_risk_criteria_summary);
  if (input.prohibited_criteria_summary !== undefined)
    col('prohibited_criteria_summary', input.prohibited_criteria_summary);
  if (input.mitigation_policy_summary !== undefined)
    col('mitigation_policy_summary', input.mitigation_policy_summary);
  if (input.regulatory_source_id !== undefined)
    col('regulatory_source_id', input.regulatory_source_id, '::uuid');
  if (input.control_id !== undefined) col('control_id', input.control_id, '::uuid');
  if (input.metadata !== undefined) col('metadata', JSON.stringify(input.metadata), '::jsonb');
  col('updated_by_user_id', ctx.actor.userId, '::uuid');
  sets.push('updated_at = now()');

  params.push(id);
  const idIdx = params.length;
  params.push(ctx.actor.orgId);
  const orgIdx = params.length;
  const res = await ctx.client.query<RiskMethodRow>(
    `UPDATE govai.regulatory_risk_methods SET ${sets.join(', ')}
      WHERE id = $${idIdx}::uuid AND org_id = $${orgIdx}::uuid
      RETURNING ${RISK_METHOD_COLUMNS}`,
    params,
  );
  const row = res.rows[0];
  if (!row) throw new RegulatoryError(404, 'risk_method_not_found');

  const statusChanged = input.method_status !== undefined && input.method_status !== existing.method_status;
  await appendAudit(ctx, {
    eventType: 'regulatory_risk_method.updated',
    subjectType: 'regulatory_risk_method',
    subjectId: row.id,
    metadata: {
      risk_method_id: row.id,
      method_key: row.method_key,
      method_version: row.method_version,
      changed_fields: Object.keys(input),
      method_status: row.method_status,
      ...(statusChanged ? { previous_method_status: existing.method_status } : {}),
    },
  });
  if (statusChanged) {
    await appendAudit(ctx, {
      eventType: 'regulatory_risk_method.status_changed',
      subjectType: 'regulatory_risk_method',
      subjectId: row.id,
      metadata: {
        risk_method_id: row.id,
        method_key: row.method_key,
        method_version: row.method_version,
        previous_method_status: existing.method_status,
        method_status: row.method_status,
      },
    });
  }
  return row;
}

export async function listRiskMethods(
  ctx: Ctx,
  filters: {
    method_status?: string;
    framework_profile?: string;
    method_key?: string;
    q?: string;
  },
  cursor: Cursor,
): Promise<ListResult<RiskMethodRow>> {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  const eq = (column: string, val: string | undefined) => {
    if (val === undefined) return;
    params.push(val);
    where.push(`${column} = $${params.length}`);
  };
  eq('method_status', filters.method_status);
  eq('framework_profile', filters.framework_profile);
  eq('method_key', filters.method_key);
  if (filters.q !== undefined) {
    params.push(`%${filters.q}%`);
    const i = params.length;
    where.push(
      `(method_key ILIKE $${i} OR name ILIKE $${i} OR methodology_summary ILIKE $${i}
        OR scoring_summary ILIKE $${i} OR high_risk_criteria_summary ILIKE $${i}
        OR prohibited_criteria_summary ILIKE $${i})`,
    );
  }
  applyCursor(where, params, cursor);
  params.push(cursor.limit);
  const res = await ctx.client.query<RiskMethodRow>(
    `SELECT ${RISK_METHOD_COLUMNS} FROM govai.regulatory_risk_methods
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}

// ---- Risk classifications ------------------------------------------------

// Validate every parent reference for a classification: cross-tenant 404,
// version-without-parent 400, version-belongs-to-parent 400, asset-link
// consistency 400. Service-level checks give clean errors; the DB RLS WITH
// CHECK is the backstop.
async function requireClassificationParents(
  ctx: Ctx,
  refs: {
    risk_method_id: string;
    use_case_id: string;
    ai_system_id: string;
    use_case_asset_link_id?: string | null;
    model_id?: string | null;
    model_version_id?: string | null;
    agent_id?: string | null;
    agent_version_id?: string | null;
    supersedes_classification_id?: string | null;
    regulatory_source_id?: string | null;
    control_id?: string | null;
  },
): Promise<void> {
  if (refs.model_version_id && !refs.model_id)
    throw new RegulatoryError(400, 'model_version_requires_model');
  if (refs.agent_version_id && !refs.agent_id)
    throw new RegulatoryError(400, 'agent_version_requires_agent');
  if (!(await getVisibleRiskMethod(ctx, refs.risk_method_id)))
    throw new RegulatoryError(404, 'risk_method_not_found');
  if (!(await getVisibleUseCase(ctx, refs.use_case_id)))
    throw new RegulatoryError(404, 'use_case_not_found');
  if (!(await getVisibleAiSystem(ctx, refs.ai_system_id)))
    throw new RegulatoryError(404, 'ai_system_not_found');
  if (refs.use_case_asset_link_id) {
    const al = await getVisibleUseCaseAssetLink(ctx, refs.use_case_asset_link_id);
    if (!al) throw new RegulatoryError(404, 'use_case_asset_link_not_found');
    if (al.use_case_id !== refs.use_case_id || al.ai_system_id !== refs.ai_system_id) {
      throw new RegulatoryError(400, 'use_case_asset_link_subject_mismatch', {
        use_case_id: refs.use_case_id,
        ai_system_id: refs.ai_system_id,
        use_case_asset_link_id: refs.use_case_asset_link_id,
      });
    }
  }
  if (refs.model_id) {
    if (!(await getVisibleModel(ctx, refs.model_id)))
      throw new RegulatoryError(404, 'model_not_found');
  }
  if (refs.model_version_id) {
    const v = await getVisibleModelVersion(ctx, refs.model_version_id);
    if (!v) throw new RegulatoryError(404, 'model_version_not_found');
    if (v.model_id !== refs.model_id) {
      throw new RegulatoryError(400, 'model_version_model_mismatch', {
        model_id: refs.model_id,
        model_version_id: refs.model_version_id,
      });
    }
  }
  if (refs.agent_id) {
    if (!(await getVisibleAgent(ctx, refs.agent_id)))
      throw new RegulatoryError(404, 'agent_not_found');
  }
  if (refs.agent_version_id) {
    const v = await getVisibleAgentVersion(ctx, refs.agent_version_id);
    if (!v) throw new RegulatoryError(404, 'agent_version_not_found');
    if (v.agent_id !== refs.agent_id) {
      throw new RegulatoryError(400, 'agent_version_agent_mismatch', {
        agent_id: refs.agent_id,
        agent_version_id: refs.agent_version_id,
      });
    }
  }
  if (refs.supersedes_classification_id) {
    if (!(await getVisibleRiskClassification(ctx, refs.supersedes_classification_id))) {
      throw new RegulatoryError(404, 'supersedes_classification_not_found');
    }
  }
  await requireVisibleParents(ctx, {
    regulatory_source_id: refs.regulatory_source_id ?? null,
    control_id: refs.control_id ?? null,
  });
}

export async function evaluateRiskClassification(
  _ctx: Ctx,
  input: EvaluateRiskClassificationInput,
): Promise<RiskEngineResult> {
  // Preview only: deterministic engine, no DB writes, no audit, no parent lookup.
  // The route may still reject invalid request shape via zod before reaching here.
  return classifyRisk(input.factor_inputs, input.decision_scope);
}

export async function createRiskClassification(
  ctx: Ctx,
  input: CreateRiskClassificationInput,
): Promise<{ classification: RiskClassificationRow; factors: RiskClassificationFactorRow[] }> {
  await requireClassificationParents(ctx, {
    risk_method_id: input.risk_method_id,
    use_case_id: input.use_case_id,
    ai_system_id: input.ai_system_id,
    use_case_asset_link_id: input.use_case_asset_link_id ?? null,
    model_id: input.model_id ?? null,
    model_version_id: input.model_version_id ?? null,
    agent_id: input.agent_id ?? null,
    agent_version_id: input.agent_version_id ?? null,
    supersedes_classification_id: input.supersedes_classification_id ?? null,
    regulatory_source_id: input.regulatory_source_id ?? null,
    control_id: input.control_id ?? null,
  });
  const result = classifyRisk(input.factor_inputs, input.decision_scope);

  let classificationRes;
  try {
    classificationRes = await ctx.client.query<RiskClassificationRow>(
      `INSERT INTO govai.regulatory_risk_classifications
         (org_id, classification_key, classification_status, risk_method_id, use_case_id, ai_system_id,
          use_case_asset_link_id, model_id, model_version_id, agent_id, agent_version_id,
          classification_basis, decision_scope, inherent_risk_tier, residual_risk_tier, risk_score,
          residual_risk_score, mitigation_strength, requires_high_risk_review, requires_prohibited_use_review,
          insufficient_information, rationale_summary, factor_summary, evidence_summary, mitigation_summary,
          residual_risk_summary, recommended_controls_summary, review_notes, effective_from, effective_to,
          supersedes_classification_id, regulatory_source_id, control_id, metadata, created_by_user_id,
          updated_by_user_id)
       VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid, $6::uuid, $7::uuid, $8::uuid, $9::uuid, $10::uuid,
               $11::uuid, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27,
               $28, $29::timestamptz, $30::timestamptz, $31::uuid, $32::uuid, $33::uuid, $34::jsonb,
               $35::uuid, $35::uuid)
       RETURNING ${RISK_CLASSIFICATION_COLUMNS}`,
      [
        ctx.actor.orgId,
        input.classification_key,
        input.classification_status,
        input.risk_method_id,
        input.use_case_id,
        input.ai_system_id,
        input.use_case_asset_link_id ?? null,
        input.model_id ?? null,
        input.model_version_id ?? null,
        input.agent_id ?? null,
        input.agent_version_id ?? null,
        input.classification_basis,
        input.decision_scope,
        result.inherent_risk_tier,
        result.residual_risk_tier,
        result.risk_score,
        result.residual_risk_score,
        result.mitigation_strength,
        result.requires_high_risk_review,
        result.requires_prohibited_use_review,
        result.insufficient_information,
        input.rationale_summary,
        // Use engine-produced factor_summary if user did not supply one.
        input.factor_summary && input.factor_summary.length > 0 ? input.factor_summary : result.factor_summary,
        input.evidence_summary,
        input.mitigation_summary,
        input.residual_risk_summary,
        input.recommended_controls_summary,
        input.review_notes,
        input.effective_from ?? null,
        input.effective_to ?? null,
        input.supersedes_classification_id ?? null,
        input.regulatory_source_id ?? null,
        input.control_id ?? null,
        JSON.stringify(input.metadata ?? {}),
        ctx.actor.userId,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegulatoryError(409, 'risk_classification_key_conflict', {
        classification_key: input.classification_key,
      });
    }
    throw err;
  }
  const classification = classificationRes.rows[0]!;

  // Fetch the risk method for audit metadata (method_key/method_version).
  const method = await getVisibleRiskMethod(ctx, input.risk_method_id);

  // Persist factor rows.
  const factorRows: RiskClassificationFactorRow[] = [];
  for (const f of result.factors) {
    const fr = await ctx.client.query<RiskClassificationFactorRow>(
      `INSERT INTO govai.regulatory_risk_classification_factors
         (org_id, classification_id, factor_key, factor_category, factor_severity, factor_value,
          triggered, score_contribution, rationale, evidence_reference, regulatory_source_id, control_id,
          metadata, created_by_user_id, updated_by_user_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, NULL, NULL, NULL, '{}'::jsonb, $10::uuid, $10::uuid)
       RETURNING ${RISK_FACTOR_COLUMNS}`,
      [
        ctx.actor.orgId,
        classification.id,
        f.factor_key,
        f.factor_category,
        f.factor_severity,
        f.factor_value,
        f.triggered,
        f.score_contribution,
        f.rationale,
        ctx.actor.userId,
      ],
    );
    factorRows.push(fr.rows[0]!);
  }

  // Audit: created + risk_tier_assigned + per-factor created + (optional) superseded.
  const auditCore = classificationAuditMeta(classification, method, result);
  await appendAudit(ctx, {
    eventType: 'regulatory_risk_classification.created',
    subjectType: 'regulatory_risk_classification',
    subjectId: classification.id,
    metadata: auditCore,
  });
  await appendAudit(ctx, {
    eventType: 'regulatory_risk_classification.risk_tier_assigned',
    subjectType: 'regulatory_risk_classification',
    subjectId: classification.id,
    metadata: auditCore,
  });
  for (const f of factorRows) {
    await appendAudit(ctx, {
      eventType: 'regulatory_risk_classification_factor.created',
      subjectType: 'regulatory_risk_classification_factor',
      subjectId: f.id,
      metadata: {
        factor_id: f.id,
        classification_id: classification.id,
        factor_key: f.factor_key,
        factor_category: f.factor_category,
        factor_severity: f.factor_severity,
        triggered: f.triggered,
        score_contribution: f.score_contribution,
      },
    });
  }
  if (classification.supersedes_classification_id) {
    await appendAudit(ctx, {
      eventType: 'regulatory_risk_classification.superseded',
      subjectType: 'regulatory_risk_classification',
      subjectId: classification.id,
      metadata: {
        classification_id: classification.id,
        supersedes_classification_id: classification.supersedes_classification_id,
      },
    });
  }
  return { classification, factors: factorRows };
}

function classificationAuditMeta(
  row: RiskClassificationRow,
  method: RiskMethodRow | null,
  result: RiskEngineResult,
): Record<string, unknown> {
  const triggeredFactorKeys = result.factors.filter((f) => f.triggered).map((f) => f.factor_key);
  return {
    classification_id: row.id,
    classification_key: row.classification_key,
    classification_status: row.classification_status,
    risk_method_id: row.risk_method_id,
    method_key: method?.method_key ?? null,
    method_version: method?.method_version ?? null,
    use_case_id: row.use_case_id,
    ai_system_id: row.ai_system_id,
    use_case_asset_link_id: row.use_case_asset_link_id,
    model_id: row.model_id,
    model_version_id: row.model_version_id,
    agent_id: row.agent_id,
    agent_version_id: row.agent_version_id,
    classification_basis: row.classification_basis,
    decision_scope: row.decision_scope,
    inherent_risk_tier: row.inherent_risk_tier,
    residual_risk_tier: row.residual_risk_tier,
    risk_score: row.risk_score,
    residual_risk_score: row.residual_risk_score,
    mitigation_strength: row.mitigation_strength,
    requires_high_risk_review: row.requires_high_risk_review,
    requires_prohibited_use_review: row.requires_prohibited_use_review,
    insufficient_information: row.insufficient_information,
    factor_count: result.factors.length,
    triggered_factor_keys: triggeredFactorKeys,
  };
}

export async function getVisibleRiskClassification(
  ctx: Ctx,
  id: string,
): Promise<RiskClassificationRow | null> {
  const r = await ctx.client.query<RiskClassificationRow>(
    `SELECT ${RISK_CLASSIFICATION_COLUMNS} FROM govai.regulatory_risk_classifications WHERE id = $1::uuid`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function updateRiskClassification(
  ctx: Ctx,
  id: string,
  input: UpdateRiskClassificationInput,
): Promise<RiskClassificationRow> {
  const existing = await getVisibleRiskClassification(ctx, id);
  if (!existing) throw new RegulatoryError(404, 'risk_classification_not_found');
  if (input.regulatory_source_id !== undefined || input.control_id !== undefined) {
    await requireVisibleParents(ctx, {
      regulatory_source_id:
        input.regulatory_source_id !== undefined ? input.regulatory_source_id : existing.regulatory_source_id,
      control_id: input.control_id !== undefined ? input.control_id : existing.control_id,
    });
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const col = (name: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${name} = $${params.length}${cast}`);
  };
  if (input.classification_status !== undefined) col('classification_status', input.classification_status);
  if (input.effective_from !== undefined) col('effective_from', input.effective_from, '::timestamptz');
  if (input.effective_to !== undefined) col('effective_to', input.effective_to, '::timestamptz');
  if (input.rationale_summary !== undefined) col('rationale_summary', input.rationale_summary);
  if (input.factor_summary !== undefined) col('factor_summary', input.factor_summary);
  if (input.evidence_summary !== undefined) col('evidence_summary', input.evidence_summary);
  if (input.mitigation_summary !== undefined) col('mitigation_summary', input.mitigation_summary);
  if (input.residual_risk_summary !== undefined) col('residual_risk_summary', input.residual_risk_summary);
  if (input.recommended_controls_summary !== undefined)
    col('recommended_controls_summary', input.recommended_controls_summary);
  if (input.review_notes !== undefined) col('review_notes', input.review_notes);
  if (input.regulatory_source_id !== undefined)
    col('regulatory_source_id', input.regulatory_source_id, '::uuid');
  if (input.control_id !== undefined) col('control_id', input.control_id, '::uuid');
  if (input.metadata !== undefined) col('metadata', JSON.stringify(input.metadata), '::jsonb');
  col('updated_by_user_id', ctx.actor.userId, '::uuid');
  sets.push('updated_at = now()');

  params.push(id);
  const idIdx = params.length;
  params.push(ctx.actor.orgId);
  const orgIdx = params.length;
  const res = await ctx.client.query<RiskClassificationRow>(
    `UPDATE govai.regulatory_risk_classifications SET ${sets.join(', ')}
      WHERE id = $${idIdx}::uuid AND org_id = $${orgIdx}::uuid
      RETURNING ${RISK_CLASSIFICATION_COLUMNS}`,
    params,
  );
  const row = res.rows[0];
  if (!row) throw new RegulatoryError(404, 'risk_classification_not_found');

  const statusChanged =
    input.classification_status !== undefined && input.classification_status !== existing.classification_status;
  const supersededTransition = statusChanged && row.classification_status === 'SUPERSEDED';
  await appendAudit(ctx, {
    eventType: 'regulatory_risk_classification.updated',
    subjectType: 'regulatory_risk_classification',
    subjectId: row.id,
    metadata: {
      classification_id: row.id,
      classification_key: row.classification_key,
      changed_fields: Object.keys(input),
      classification_status: row.classification_status,
      inherent_risk_tier: row.inherent_risk_tier,
      residual_risk_tier: row.residual_risk_tier,
      ...(statusChanged ? { previous_classification_status: existing.classification_status } : {}),
    },
  });
  if (statusChanged) {
    await appendAudit(ctx, {
      eventType: 'regulatory_risk_classification.status_changed',
      subjectType: 'regulatory_risk_classification',
      subjectId: row.id,
      metadata: {
        classification_id: row.id,
        classification_key: row.classification_key,
        previous_classification_status: existing.classification_status,
        classification_status: row.classification_status,
      },
    });
  }
  if (supersededTransition) {
    await appendAudit(ctx, {
      eventType: 'regulatory_risk_classification.superseded',
      subjectType: 'regulatory_risk_classification',
      subjectId: row.id,
      metadata: {
        classification_id: row.id,
        classification_key: row.classification_key,
      },
    });
  }
  return row;
}

export async function listRiskClassifications(
  ctx: Ctx,
  filters: {
    classification_status?: string;
    risk_method_id?: string;
    use_case_id?: string;
    ai_system_id?: string;
    use_case_asset_link_id?: string;
    model_id?: string;
    model_version_id?: string;
    agent_id?: string;
    agent_version_id?: string;
    inherent_risk_tier?: string;
    residual_risk_tier?: string;
    requires_high_risk_review?: boolean;
    requires_prohibited_use_review?: boolean;
    classification_basis?: string;
    decision_scope?: string;
    q?: string;
  },
  cursor: Cursor,
): Promise<ListResult<RiskClassificationRow>> {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  const eq = (column: string, val: string | undefined, cast = '') => {
    if (val === undefined) return;
    params.push(val);
    where.push(`${column} = $${params.length}${cast}`);
  };
  const eqBool = (column: string, val: boolean | undefined) => {
    if (val === undefined) return;
    params.push(val);
    where.push(`${column} = $${params.length}`);
  };
  eq('classification_status', filters.classification_status);
  eq('risk_method_id', filters.risk_method_id, '::uuid');
  eq('use_case_id', filters.use_case_id, '::uuid');
  eq('ai_system_id', filters.ai_system_id, '::uuid');
  eq('use_case_asset_link_id', filters.use_case_asset_link_id, '::uuid');
  eq('model_id', filters.model_id, '::uuid');
  eq('model_version_id', filters.model_version_id, '::uuid');
  eq('agent_id', filters.agent_id, '::uuid');
  eq('agent_version_id', filters.agent_version_id, '::uuid');
  eq('inherent_risk_tier', filters.inherent_risk_tier);
  eq('residual_risk_tier', filters.residual_risk_tier);
  eqBool('requires_high_risk_review', filters.requires_high_risk_review);
  eqBool('requires_prohibited_use_review', filters.requires_prohibited_use_review);
  eq('classification_basis', filters.classification_basis);
  eq('decision_scope', filters.decision_scope);
  if (filters.q !== undefined) {
    params.push(`%${filters.q}%`);
    const i = params.length;
    where.push(
      `(classification_key ILIKE $${i} OR rationale_summary ILIKE $${i} OR factor_summary ILIKE $${i}
        OR evidence_summary ILIKE $${i} OR mitigation_summary ILIKE $${i}
        OR recommended_controls_summary ILIKE $${i})`,
    );
  }
  applyCursor(where, params, cursor);
  params.push(cursor.limit);
  const res = await ctx.client.query<RiskClassificationRow>(
    `SELECT ${RISK_CLASSIFICATION_COLUMNS} FROM govai.regulatory_risk_classifications
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}

// ---- Risk classification factors (read-only) -----------------------------

export async function getVisibleRiskClassificationFactor(
  ctx: Ctx,
  id: string,
): Promise<RiskClassificationFactorRow | null> {
  const r = await ctx.client.query<RiskClassificationFactorRow>(
    `SELECT ${RISK_FACTOR_COLUMNS} FROM govai.regulatory_risk_classification_factors WHERE id = $1::uuid`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function listRiskClassificationFactors(
  ctx: Ctx,
  filters: {
    classification_id?: string;
    factor_category?: string;
    factor_severity?: string;
    triggered?: boolean;
    q?: string;
  },
  cursor: Cursor,
): Promise<ListResult<RiskClassificationFactorRow>> {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  const eq = (column: string, val: string | undefined, cast = '') => {
    if (val === undefined) return;
    params.push(val);
    where.push(`${column} = $${params.length}${cast}`);
  };
  eq('classification_id', filters.classification_id, '::uuid');
  eq('factor_category', filters.factor_category);
  eq('factor_severity', filters.factor_severity);
  if (filters.triggered !== undefined) {
    params.push(filters.triggered);
    where.push(`triggered = $${params.length}`);
  }
  if (filters.q !== undefined) {
    params.push(`%${filters.q}%`);
    const i = params.length;
    where.push(
      `(factor_key ILIKE $${i} OR factor_value ILIKE $${i} OR rationale ILIKE $${i}
        OR evidence_reference ILIKE $${i})`,
    );
  }
  applyCursor(where, params, cursor);
  params.push(cursor.limit);
  const res = await ctx.client.query<RiskClassificationFactorRow>(
    `SELECT ${RISK_FACTOR_COLUMNS} FROM govai.regulatory_risk_classification_factors
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}

// ---- Reclassification triggers -------------------------------------------

async function requireTriggerParents(
  ctx: Ctx,
  refs: {
    classification_id?: string | null;
    use_case_id: string;
    ai_system_id: string;
    regulatory_source_id?: string | null;
    control_id?: string | null;
  },
): Promise<void> {
  if (!(await getVisibleUseCase(ctx, refs.use_case_id)))
    throw new RegulatoryError(404, 'use_case_not_found');
  if (!(await getVisibleAiSystem(ctx, refs.ai_system_id)))
    throw new RegulatoryError(404, 'ai_system_not_found');
  if (refs.classification_id) {
    const c = await getVisibleRiskClassification(ctx, refs.classification_id);
    if (!c) throw new RegulatoryError(404, 'risk_classification_not_found');
    if (c.use_case_id !== refs.use_case_id || c.ai_system_id !== refs.ai_system_id) {
      throw new RegulatoryError(400, 'classification_subject_mismatch', {
        classification_id: refs.classification_id,
        use_case_id: refs.use_case_id,
        ai_system_id: refs.ai_system_id,
      });
    }
  }
  await requireVisibleParents(ctx, {
    regulatory_source_id: refs.regulatory_source_id ?? null,
    control_id: refs.control_id ?? null,
  });
}

export async function createReclassificationTrigger(
  ctx: Ctx,
  input: CreateReclassificationTriggerInput,
): Promise<ReclassificationTriggerRow> {
  await requireTriggerParents(ctx, {
    classification_id: input.classification_id ?? null,
    use_case_id: input.use_case_id,
    ai_system_id: input.ai_system_id,
    regulatory_source_id: input.regulatory_source_id ?? null,
    control_id: input.control_id ?? null,
  });
  let res;
  try {
    res = await ctx.client.query<ReclassificationTriggerRow>(
      `INSERT INTO govai.regulatory_reclassification_triggers
         (org_id, trigger_key, trigger_status, trigger_type, recommended_action, classification_id,
          use_case_id, ai_system_id, prior_risk_tier, trigger_reason, evidence_reference, detected_at,
          due_at, resolved_at, regulatory_source_id, control_id, metadata, created_by_user_id, updated_by_user_id)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7::uuid, $8::uuid, $9, $10, $11,
               $12::timestamptz, $13::timestamptz, $14::timestamptz, $15::uuid, $16::uuid, $17::jsonb,
               $18::uuid, $18::uuid)
       RETURNING ${RECLASSIFICATION_TRIGGER_COLUMNS}`,
      [
        ctx.actor.orgId,
        input.trigger_key,
        input.trigger_status,
        input.trigger_type,
        input.recommended_action,
        input.classification_id ?? null,
        input.use_case_id,
        input.ai_system_id,
        input.prior_risk_tier ?? null,
        input.trigger_reason,
        input.evidence_reference ?? null,
        input.detected_at ?? null,
        input.due_at ?? null,
        input.resolved_at ?? null,
        input.regulatory_source_id ?? null,
        input.control_id ?? null,
        JSON.stringify(input.metadata ?? {}),
        ctx.actor.userId,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegulatoryError(409, 'reclassification_trigger_key_conflict', {
        trigger_key: input.trigger_key,
      });
    }
    throw err;
  }
  const row = res.rows[0]!;
  await appendAudit(ctx, {
    eventType: 'regulatory_reclassification_trigger.created',
    subjectType: 'regulatory_reclassification_trigger',
    subjectId: row.id,
    metadata: triggerAuditMeta(row),
  });
  return row;
}

function triggerAuditMeta(row: ReclassificationTriggerRow): Record<string, unknown> {
  return {
    trigger_id: row.id,
    trigger_key: row.trigger_key,
    trigger_type: row.trigger_type,
    trigger_status: row.trigger_status,
    recommended_action: row.recommended_action,
    classification_id: row.classification_id,
    use_case_id: row.use_case_id,
    ai_system_id: row.ai_system_id,
    prior_risk_tier: row.prior_risk_tier,
  };
}

export async function getVisibleReclassificationTrigger(
  ctx: Ctx,
  id: string,
): Promise<ReclassificationTriggerRow | null> {
  const r = await ctx.client.query<ReclassificationTriggerRow>(
    `SELECT ${RECLASSIFICATION_TRIGGER_COLUMNS} FROM govai.regulatory_reclassification_triggers WHERE id = $1::uuid`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function updateReclassificationTrigger(
  ctx: Ctx,
  id: string,
  input: UpdateReclassificationTriggerInput,
): Promise<ReclassificationTriggerRow> {
  const existing = await getVisibleReclassificationTrigger(ctx, id);
  if (!existing) throw new RegulatoryError(404, 'reclassification_trigger_not_found');
  if (input.regulatory_source_id !== undefined || input.control_id !== undefined) {
    await requireVisibleParents(ctx, {
      regulatory_source_id:
        input.regulatory_source_id !== undefined ? input.regulatory_source_id : existing.regulatory_source_id,
      control_id: input.control_id !== undefined ? input.control_id : existing.control_id,
    });
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const col = (name: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${name} = $${params.length}${cast}`);
  };
  if (input.trigger_status !== undefined) col('trigger_status', input.trigger_status);
  if (input.trigger_type !== undefined) col('trigger_type', input.trigger_type);
  if (input.recommended_action !== undefined) col('recommended_action', input.recommended_action);
  if (input.prior_risk_tier !== undefined) col('prior_risk_tier', input.prior_risk_tier);
  if (input.trigger_reason !== undefined) col('trigger_reason', input.trigger_reason);
  if (input.evidence_reference !== undefined) col('evidence_reference', input.evidence_reference);
  if (input.detected_at !== undefined) col('detected_at', input.detected_at, '::timestamptz');
  if (input.due_at !== undefined) col('due_at', input.due_at, '::timestamptz');
  if (input.resolved_at !== undefined) col('resolved_at', input.resolved_at, '::timestamptz');
  if (input.regulatory_source_id !== undefined)
    col('regulatory_source_id', input.regulatory_source_id, '::uuid');
  if (input.control_id !== undefined) col('control_id', input.control_id, '::uuid');
  if (input.metadata !== undefined) col('metadata', JSON.stringify(input.metadata), '::jsonb');
  col('updated_by_user_id', ctx.actor.userId, '::uuid');
  sets.push('updated_at = now()');

  params.push(id);
  const idIdx = params.length;
  params.push(ctx.actor.orgId);
  const orgIdx = params.length;
  const res = await ctx.client.query<ReclassificationTriggerRow>(
    `UPDATE govai.regulatory_reclassification_triggers SET ${sets.join(', ')}
      WHERE id = $${idIdx}::uuid AND org_id = $${orgIdx}::uuid
      RETURNING ${RECLASSIFICATION_TRIGGER_COLUMNS}`,
    params,
  );
  const row = res.rows[0];
  if (!row) throw new RegulatoryError(404, 'reclassification_trigger_not_found');

  const statusChanged = input.trigger_status !== undefined && input.trigger_status !== existing.trigger_status;
  const resolvedTransition =
    (statusChanged && row.trigger_status === 'RESOLVED') ||
    (input.resolved_at !== undefined && input.resolved_at !== null && existing.resolved_at === null);
  await appendAudit(ctx, {
    eventType: 'regulatory_reclassification_trigger.updated',
    subjectType: 'regulatory_reclassification_trigger',
    subjectId: row.id,
    metadata: {
      ...triggerAuditMeta(row),
      changed_fields: Object.keys(input),
      ...(statusChanged ? { previous_trigger_status: existing.trigger_status } : {}),
    },
  });
  if (statusChanged) {
    await appendAudit(ctx, {
      eventType: 'regulatory_reclassification_trigger.status_changed',
      subjectType: 'regulatory_reclassification_trigger',
      subjectId: row.id,
      metadata: { ...triggerAuditMeta(row), previous_trigger_status: existing.trigger_status },
    });
  }
  if (resolvedTransition) {
    await appendAudit(ctx, {
      eventType: 'regulatory_reclassification_trigger.resolved',
      subjectType: 'regulatory_reclassification_trigger',
      subjectId: row.id,
      metadata: {
        ...triggerAuditMeta(row),
        resolved_at: row.resolved_at ? row.resolved_at.toISOString() : null,
      },
    });
  }
  return row;
}

export async function listReclassificationTriggers(
  ctx: Ctx,
  filters: {
    classification_id?: string;
    use_case_id?: string;
    ai_system_id?: string;
    trigger_status?: string;
    trigger_type?: string;
    recommended_action?: string;
    due_before?: string;
    q?: string;
  },
  cursor: Cursor,
): Promise<ListResult<ReclassificationTriggerRow>> {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  const eq = (column: string, val: string | undefined, cast = '') => {
    if (val === undefined) return;
    params.push(val);
    where.push(`${column} = $${params.length}${cast}`);
  };
  eq('classification_id', filters.classification_id, '::uuid');
  eq('use_case_id', filters.use_case_id, '::uuid');
  eq('ai_system_id', filters.ai_system_id, '::uuid');
  eq('trigger_status', filters.trigger_status);
  eq('trigger_type', filters.trigger_type);
  eq('recommended_action', filters.recommended_action);
  if (filters.due_before !== undefined) {
    params.push(filters.due_before);
    where.push(`due_at IS NOT NULL AND due_at <= $${params.length}::timestamptz`);
  }
  if (filters.q !== undefined) {
    params.push(`%${filters.q}%`);
    const i = params.length;
    where.push(`(trigger_key ILIKE $${i} OR trigger_reason ILIKE $${i} OR evidence_reference ILIKE $${i})`);
  }
  applyCursor(where, params, cursor);
  params.push(cursor.limit);
  const res = await ctx.client.query<ReclassificationTriggerRow>(
    `SELECT ${RECLASSIFICATION_TRIGGER_COLUMNS} FROM govai.regulatory_reclassification_triggers
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows: res.rows, nextCursor: nextCursorFrom(res.rows, cursor.limit) };
}
