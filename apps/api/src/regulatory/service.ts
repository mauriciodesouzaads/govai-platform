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
