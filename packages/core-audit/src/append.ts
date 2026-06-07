import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Kms } from '@govai/core-identity';
import { canonicalize } from './canonical-json.js';
import { sha256 } from './hash.js';
import { chainLockKey } from './lock-key.js';
import { hmacSign } from './hmac.js';

export type AuditAppendInput = {
  orgId: string;
  chainId: string;
  eventType: string;
  eventVersion: string;
  subjectType: string;
  subjectId: string;
  occurredAt: Date;
  payloadHash: Uint8Array;
  payloadEncrypted?: Uint8Array;
  dekWrapped?: Uint8Array;
  keyId: string;
  keyVersion: number;
  redactionMetadata: Record<string, unknown>;
  evidenceStrength?: 'hmac_internal' | 'dev_signed';
  /**
   * Optional caller-supplied event id.
   *
   * When omitted (the default for every existing caller) a fresh
   * `randomUUID()` is generated, preserving today's behavior exactly.
   *
   * When supplied, it MUST be a UUID and enables ADR-023 Option A(b)
   * deterministic-append idempotency: `auditAppend` looks the id up — under
   * the per-chain advisory lock, before computing a new head/sequence — and,
   * if a matching event already exists, returns that existing event instead of
   * writing a duplicate. The AuditSealer path passes
   * `deriveAuditSealerCaptureEventId(...)` here. This is the append primitive
   * only: it does NOT wire routes, dispatch runtime events, or start a runner.
   */
  eventId?: string;
};

export type AuditAppendOutput = {
  eventId: string;
  payloadId: string | null;
  sequenceNumber: bigint;
  hmac: Uint8Array;
  canonical: string;
  canonicalBytes: Uint8Array;
  canonicalHash: Uint8Array;
};

/**
 * Append idempotente-protegido: assume transação já aberta e tenant já setado.
 * O caller deve estar dentro de uma transação com `app.org_id` setado em LOCAL.
 */
export async function auditAppend(
  client: PoolClient,
  kms: Kms,
  input: AuditAppendInput,
): Promise<AuditAppendOutput> {
  // Validação de tenant context.
  const sessionRes = await client.query<{ v: string | null }>(
    "SELECT current_setting('app.org_id', true) AS v",
  );
  const sessionOrg = sessionRes.rows[0]?.v ?? null;
  if (!sessionOrg || sessionOrg !== input.orgId) {
    throw new Error(
      `auditAppend: tenant context mismatch (session=${sessionOrg ?? 'NULL'} input=${input.orgId})`,
    );
  }

  if (input.eventId !== undefined && !isUuid(input.eventId)) {
    throw new Error(
      `auditAppend: eventId, when provided, must be a UUID (got ${JSON.stringify(input.eventId)})`,
    );
  }

  const lockKey = chainLockKey(input.chainId);
  // Dentro da transação corrente.
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey.toString()]);

  // ADR-023 Option A(b) deterministic-append idempotency.
  //
  // When the caller supplies an explicit eventId, look it up AFTER the
  // per-chain advisory lock (so the read is serialized against concurrent
  // appends on the same chain) and BEFORE computing a new head/sequence.
  //
  // Lock/race model: a capture belongs to exactly one chain and the
  // deterministic id is derived from org_id + capture_id, so every retry for
  // the same capture serializes on this same chain lock. The post-lock lookup
  // is therefore authoritative and there is no `unique_violation` race to
  // handle here. If a matching event exists, return it verbatim (no re-append,
  // no re-HMAC, no new sequence, no payload insert). If it exists but its
  // immutable content diverges, fail safe without appending.
  if (input.eventId !== undefined) {
    const existing = await findExistingEventById(client, input.eventId);
    if (existing) {
      assertExistingEventMatches(input, existing);
      return existingEventToOutput(existing);
    }
  }

  const headRes = await client.query<{ hmac: Buffer | null; sequence_number: string | null }>(
    `SELECT hmac, sequence_number
       FROM govai.audit_events
      WHERE chain_id = $1
      ORDER BY sequence_number DESC
      LIMIT 1`,
    [input.chainId],
  );
  const head = headRes.rows[0];
  const prevHmac: Buffer | null = head?.hmac ?? null;
  const nextSeq: bigint = (head?.sequence_number ? BigInt(head.sequence_number) : 0n) + 1n;

  const eventId = input.eventId ?? randomUUID();
  const payloadId = input.payloadEncrypted ? randomUUID() : null;

  const canonical = canonicalize({
    event_id: eventId,
    org_id: input.orgId,
    chain_id: input.chainId,
    sequence_number: nextSeq.toString(),
    previous_hmac: prevHmac ? prevHmac.toString('hex') : null,
    event_type: input.eventType,
    event_version: input.eventVersion,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    occurred_at: input.occurredAt.toISOString(),
    payload_hash: Buffer.from(input.payloadHash).toString('hex'),
    payload_ref: payloadId,
    key_id: input.keyId,
    key_version: input.keyVersion,
    evidence_strength: input.evidenceStrength ?? 'hmac_internal',
    redaction_metadata: input.redactionMetadata,
  });
  const canonicalBytes = Buffer.from(canonical, 'utf8');
  const canonicalHash = sha256(canonicalBytes);

  const hmac = await hmacSign(
    { kms, orgId: input.orgId, keyId: input.keyId, keyVersion: input.keyVersion },
    canonicalBytes,
  );

  await client.query(
    `SELECT govai.audit_append_locked(
       $1::uuid, $2::uuid, $3::text, $4::bigint, $5::bytea, $6::bigint,
       $7::bytea, $8::bytea, $9::bytea,
       $10::text, $11::text, $12::text, $13::uuid, $14::timestamptz,
       $15::bytea, $16::uuid, $17::bytea, $18::bytea,
       $19::text, $20::integer, $21::jsonb, $22::text
     )`,
    [
      eventId,
      input.orgId,
      input.chainId,
      lockKey.toString(),
      prevHmac,
      nextSeq.toString(),
      Buffer.from(canonicalHash),
      Buffer.from(canonicalBytes),
      Buffer.from(hmac),
      input.eventType,
      input.eventVersion,
      input.subjectType,
      input.subjectId,
      input.occurredAt.toISOString(),
      Buffer.from(input.payloadHash),
      payloadId,
      input.payloadEncrypted ? Buffer.from(input.payloadEncrypted) : null,
      input.dekWrapped ? Buffer.from(input.dekWrapped) : null,
      input.keyId,
      input.keyVersion,
      JSON.stringify(input.redactionMetadata),
      input.evidenceStrength ?? 'hmac_internal',
    ],
  );

  return {
    eventId,
    payloadId,
    sequenceNumber: nextSeq,
    hmac,
    canonical,
    canonicalBytes: new Uint8Array(canonicalBytes),
    canonicalHash,
  };
}

// -----------------------------------------------------------------------------
// ADR-023 Option A(b) explicit-eventId helpers (deterministic-append path)
// -----------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Row shape read back for an existing event during the explicit-eventId lookup. */
type ExistingEventRow = {
  id: string;
  org_id: string;
  chain_id: string;
  sequence_number: string;
  event_type: string;
  event_version: string;
  subject_type: string;
  subject_id: string;
  occurred_at: string | Date;
  payload_hash: unknown;
  payload_ref: string | null;
  redaction_metadata: Record<string, unknown> | null;
  hmac: unknown;
  canonical_hash: unknown;
  canonical_bytes: unknown;
  key_id: string;
  key_version: number | string;
  evidence_strength: string;
};

/**
 * Look up an existing event by primary key. Called only on the explicit-eventId
 * path, AFTER the per-chain advisory lock. Returns null when no row matches.
 */
async function findExistingEventById(
  client: PoolClient,
  eventId: string,
): Promise<ExistingEventRow | null> {
  const r = await client.query<ExistingEventRow>(
    `SELECT id::text, org_id::text, chain_id, sequence_number::text,
            event_type, event_version, subject_type, subject_id::text,
            occurred_at, payload_hash, payload_ref::text, redaction_metadata,
            hmac, canonical_hash, canonical_bytes, key_id, key_version,
            evidence_strength
       FROM govai.audit_events
      WHERE id = $1::uuid`,
    [eventId],
  );
  return r.rows[0] ?? null;
}

/** Convert a pg bytea field (Buffer, Uint8Array, or `\x`/hex string) to a Buffer. */
function asBytes(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') {
    if (value.startsWith('\\x')) return Buffer.from(value.slice(2), 'hex');
    if (value.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(value)) {
      return Buffer.from(value, 'hex');
    }
  }
  throw new Error(`auditAppend: cannot convert bytea field to bytes (typeof=${typeof value})`);
}

/** Safely read redaction_metadata.audit_sealer.capture_id, if present. */
function readSealerCaptureId(
  redaction: Record<string, unknown> | null | undefined,
): string | undefined {
  if (redaction === null || redaction === undefined || typeof redaction !== 'object') {
    return undefined;
  }
  const sealer = (redaction as Record<string, unknown>).audit_sealer;
  if (sealer === null || sealer === undefined || typeof sealer !== 'object') return undefined;
  const captureId = (sealer as Record<string, unknown>).capture_id;
  return typeof captureId === 'string' ? captureId : undefined;
}

/**
 * Validate that an existing event with the supplied explicit eventId carries
 * the SAME immutable content the caller is trying to append. On any divergence
 * this throws a payload-free error and the caller must NOT append. The
 * audit_sealer.capture_id binding is enforced only when the inbound event
 * carries one (the sealer path does), so generic explicit-eventId callers are
 * not forced to supply it.
 */
function assertExistingEventMatches(input: AuditAppendInput, row: ExistingEventRow): void {
  const mismatch = (field: string): never => {
    throw new Error(
      `auditAppend: explicit eventId already exists with divergent immutable content (mismatch: ${field})`,
    );
  };

  if (row.org_id !== input.orgId) mismatch('org_id');
  if (row.chain_id !== input.chainId) mismatch('chain_id');
  if (row.event_type !== input.eventType) mismatch('event_type');
  if (row.event_version !== input.eventVersion) mismatch('event_version');
  if (row.subject_type !== input.subjectType) mismatch('subject_type');
  if (row.subject_id !== input.subjectId) mismatch('subject_id');

  const existingPayloadHashHex = asBytes(row.payload_hash).toString('hex');
  const inputPayloadHashHex = Buffer.from(input.payloadHash).toString('hex');
  if (existingPayloadHashHex !== inputPayloadHashHex) mismatch('payload_hash');

  // Payload presence is immutable across explicit-eventId reuse. The new-append
  // path inserts an encrypted payload (and sets payload_ref) only when
  // payloadEncrypted is supplied; the reuse path returns the existing row's
  // payload_ref WITHOUT inserting anything. So a reuse whose payload presence
  // disagrees with the existing row would silently drop (or fabricate) payload
  // storage and still report success. Reject it. audit_events only exposes
  // payload_ref, so presence — not bytes — is the contract here; we do not join
  // audit_event_payloads in this guard.
  const inputHasPayload = input.payloadEncrypted !== undefined && input.payloadEncrypted !== null;
  const inputHasDekWrapped = input.dekWrapped !== undefined && input.dekWrapped !== null;

  // 1) The input must be internally consistent first: encrypted payload bytes
  //    and their wrapped DEK travel together (mirrors the new-append SQL
  //    contract). Checked BEFORE the existing-vs-input comparison so a
  //    malformed request is rejected as a storage error, not misattributed to
  //    a divergence against the existing row.
  if (inputHasPayload !== inputHasDekWrapped) mismatch('payload_storage_presence');

  // 2) Then the input's payload presence must match the existing event's.
  const existingHasPayload = row.payload_ref !== null && row.payload_ref !== undefined;
  if (existingHasPayload !== inputHasPayload) mismatch('payload_presence');

  if (row.key_id !== input.keyId) mismatch('key_id');
  if (Number(row.key_version) !== input.keyVersion) mismatch('key_version');

  const expectedEvidence = input.evidenceStrength ?? 'hmac_internal';
  if (row.evidence_strength !== expectedEvidence) mismatch('evidence_strength');

  const inputCaptureId = readSealerCaptureId(input.redactionMetadata);
  if (inputCaptureId !== undefined) {
    const existingCaptureId = readSealerCaptureId(row.redaction_metadata);
    if (existingCaptureId !== inputCaptureId) {
      mismatch('redaction_metadata.audit_sealer.capture_id');
    }
  }
}

/** Reconstruct an AuditAppendOutput from an existing event row (no recompute). */
function existingEventToOutput(row: ExistingEventRow): AuditAppendOutput {
  const canonicalBytes = asBytes(row.canonical_bytes);
  return {
    eventId: row.id,
    payloadId: row.payload_ref ?? null,
    sequenceNumber: BigInt(row.sequence_number),
    hmac: new Uint8Array(asBytes(row.hmac)),
    canonical: canonicalBytes.toString('utf8'),
    canonicalBytes: new Uint8Array(canonicalBytes),
    canonicalHash: new Uint8Array(asBytes(row.canonical_hash)),
  };
}
