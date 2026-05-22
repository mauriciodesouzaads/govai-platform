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
