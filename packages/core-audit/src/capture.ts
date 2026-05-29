// B1 — AuditBridge.capture TypeScript adapter for the B0 Evidence Plane.
//
// Thin, idempotent wrapper around govai.audit_capture_insert_locked
// (migration 0025_audit_capture_outbox_foundation). It:
//
//   - validates obviously-bad input in TypeScript (UUIDs, enums, redaction
//     guard, integrity-tag pairing) BEFORE the DB call so callers get sharp
//     errors with no DB round-trip;
//   - imports chainLockKey from this same package (NEVER reimplements
//     SHA-256, NEVER accepts an external lock key on the public input);
//   - executes ONE SQL call on the caller-supplied PoolClient. It does NOT
//     open BEGIN/COMMIT/ROLLBACK, does NOT call setLocalAppOrgId, does NOT
//     reach for a global pool, and does NOT manage the connection.
//
// The SQL is the source of truth for:
//   - capture_id idempotency (under chain_state row-level lock — see B0
//     migration concurrency contract);
//   - tenant validation (current_setting('app.org_id'));
//   - capture_seq allocation;
//   - all invariants enforced by triggers and CHECK constraints.
//
// B1 does NOT touch routes, providers, auditAppend, audit_append_locked,
// canonicalize, verify, or any migration. The outbox stays dormant until a
// future caller (B3+) wires this adapter into a runtime pipeline.

import type { PoolClient } from 'pg';

// Namespace import so vitest can spy on `chainLockKey` without losing the
// real implementation. NEVER reimplement the derivation here — this is the
// single canonical lock-key function for the package.
import * as lockKey from './lock-key.js';

// -----------------------------------------------------------------------------
// Local UUID validation
//
// We deliberately do NOT add @govai/core-tenant as a new dependency of
// core-audit just for one regex. The pattern below is the same one used by
// @govai/core-tenant's isUuid (case-insensitive RFC 4122-ish 8-4-4-4-12).
// -----------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

// -----------------------------------------------------------------------------
// Redaction metadata guard
//
// The B0 SQL CHECK rejects four top-level keys: prompt, response, raw_input,
// raw_output. B1 adds TS-side defense-in-depth that also rejects messages,
// completion, requestBody, responseBody at the top level. Nested occurrences
// of these keys are intentionally allowed in B0/B1: deep-JSON redaction is a
// future capability of AuditBridge (B2+). See ADR-017.
// -----------------------------------------------------------------------------

/** Top-level keys that the B0 SQL CHECK constraint rejects. */
export const SQL_BANNED_REDACTION_KEYS: readonly string[] = Object.freeze([
  'prompt',
  'response',
  'raw_input',
  'raw_output',
]);

/** Additional top-level keys that B1 rejects in TypeScript only. */
export const TS_BANNED_REDACTION_KEYS: readonly string[] = Object.freeze([
  'messages',
  'completion',
  'requestBody',
  'responseBody',
]);

/** All top-level keys forbidden in redaction_metadata by B0+B1. */
export const ALL_BANNED_REDACTION_KEYS: readonly string[] = Object.freeze([
  ...SQL_BANNED_REDACTION_KEYS,
  ...TS_BANNED_REDACTION_KEYS,
]);

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type ChainCategory = 'auth' | 'run' | 'policy' | 'admin';
export type Posture = 'strict' | 'best_effort';
export type CaptureIntegrityAlg = 'kms_hmac_sha256' | 'sha256_digest';

/**
 * Input for {@link captureAuditEvent}. Mirrors the parameters of
 * govai.audit_capture_insert_locked but omits the advisory lock key (the
 * adapter computes it via {@link lockKey.chainLockKey}). No field accepts
 * raw prompt/response content.
 */
export interface CaptureAuditEventInput {
  captureId: string;
  orgId: string;
  chainId: string;
  chainCategory: ChainCategory;
  eventType: string;
  eventVersion: string;
  subjectType: string;
  subjectId: string;
  occurredAt: Date | string;
  payloadHash: Buffer | Uint8Array;
  payloadEncrypted?: Buffer | Uint8Array | null;
  dekWrapped?: Buffer | Uint8Array | null;
  keyId: string;
  keyVersion: number;
  redactionMetadata?: Record<string, unknown>;
  evidenceStrength?: string;
  captureIntegrityTag?: Buffer | Uint8Array | null;
  captureIntegrityAlg?: CaptureIntegrityAlg | null;
  posture?: Posture;
}

/**
 * Result of {@link captureAuditEvent}.
 *
 * captureSeq is returned as a decimal string so callers don't lose precision
 * past Number.MAX_SAFE_INTEGER and don't have to JSON-serialize a BigInt.
 * Conversion to bigint/number is the caller's explicit responsibility.
 */
export interface CaptureAuditEventResult {
  captureId: string;
  captureSeq: string;
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

function failInput(message: string): never {
  throw new Error(`captureAuditEvent: ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof Buffer) &&
    !(value instanceof Uint8Array)
  );
}

function validateInput(input: CaptureAuditEventInput): void {
  if (!isUuid(input.captureId)) {
    failInput(`captureId must be a UUID (got ${JSON.stringify(input.captureId)})`);
  }
  if (!isUuid(input.orgId)) {
    failInput(`orgId must be a UUID (got ${JSON.stringify(input.orgId)})`);
  }
  if (!isUuid(input.subjectId)) {
    failInput(`subjectId must be a UUID (got ${JSON.stringify(input.subjectId)})`);
  }
  if (typeof input.chainId !== 'string' || input.chainId.length === 0) {
    failInput('chainId must be a non-empty string');
  }
  if (
    input.chainCategory !== 'auth' &&
    input.chainCategory !== 'run' &&
    input.chainCategory !== 'policy' &&
    input.chainCategory !== 'admin'
  ) {
    failInput(`chainCategory must be one of auth|run|policy|admin (got ${String(input.chainCategory)})`);
  }
  if (typeof input.eventType !== 'string' || input.eventType.length === 0) {
    failInput('eventType must be a non-empty string');
  }
  if (typeof input.eventVersion !== 'string' || input.eventVersion.length === 0) {
    failInput('eventVersion must be a non-empty string');
  }
  if (typeof input.subjectType !== 'string' || input.subjectType.length === 0) {
    failInput('subjectType must be a non-empty string');
  }
  if (typeof input.keyId !== 'string' || input.keyId.length === 0) {
    failInput('keyId must be a non-empty string');
  }
  if (
    typeof input.keyVersion !== 'number' ||
    !Number.isInteger(input.keyVersion) ||
    input.keyVersion < 0
  ) {
    failInput(`keyVersion must be a non-negative integer (got ${String(input.keyVersion)})`);
  }
  if (
    !(input.payloadHash instanceof Buffer) &&
    !(input.payloadHash instanceof Uint8Array)
  ) {
    failInput('payloadHash is required and must be Buffer or Uint8Array');
  }

  const posture: Posture = input.posture ?? 'best_effort';
  if (posture !== 'strict' && posture !== 'best_effort') {
    failInput(`posture must be one of strict|best_effort (got ${String(input.posture)})`);
  }

  // Integrity tag <-> alg must be both null/undefined or both set.
  const tagPresent =
    input.captureIntegrityTag !== undefined && input.captureIntegrityTag !== null;
  const algPresent =
    input.captureIntegrityAlg !== undefined && input.captureIntegrityAlg !== null;
  if (tagPresent !== algPresent) {
    failInput(
      'captureIntegrityTag and captureIntegrityAlg must be both set or both omitted',
    );
  }
  if (algPresent) {
    const alg = input.captureIntegrityAlg as CaptureIntegrityAlg;
    if (alg !== 'kms_hmac_sha256' && alg !== 'sha256_digest') {
      failInput(`captureIntegrityAlg must be kms_hmac_sha256 or sha256_digest (got ${String(alg)})`);
    }
  }

  // redactionMetadata: optional, must be plain object when present, top-level
  // keys must not include any banned key (B0 SQL keys + B1 TS-only keys).
  if (input.redactionMetadata !== undefined) {
    if (!isPlainObject(input.redactionMetadata)) {
      failInput('redactionMetadata, when provided, must be a plain object');
    }
    for (const banned of ALL_BANNED_REDACTION_KEYS) {
      if (Object.prototype.hasOwnProperty.call(input.redactionMetadata, banned)) {
        failInput(
          `redactionMetadata must not contain top-level "${banned}" (raw payload content is not allowed in capture metadata)`,
        );
      }
    }
  }

  // occurredAt: accept Date or ISO-8601 string.
  if (
    !(input.occurredAt instanceof Date) &&
    typeof input.occurredAt !== 'string'
  ) {
    failInput('occurredAt must be a Date or ISO-8601 string');
  }
  if (input.occurredAt instanceof Date && Number.isNaN(input.occurredAt.getTime())) {
    failInput('occurredAt is an Invalid Date');
  }
}

// -----------------------------------------------------------------------------
// Marshalling helpers
// -----------------------------------------------------------------------------

function toBuffer(value: Buffer | Uint8Array): Buffer {
  return value instanceof Buffer ? value : Buffer.from(value);
}

function toNullableBuffer(value: Buffer | Uint8Array | null | undefined): Buffer | null {
  if (value === null || value === undefined) return null;
  return toBuffer(value);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

// -----------------------------------------------------------------------------
// Adapter
// -----------------------------------------------------------------------------

/**
 * Insert one capture into govai.audit_capture_outbox under the B0 SECURITY
 * DEFINER function.
 *
 * Preconditions (caller's responsibility):
 *   - `client` is already inside a transaction (BEGIN);
 *   - `app.org_id` is set in the current session (via setLocalAppOrgId or
 *     equivalent) to the same UUID as `input.orgId`;
 *   - the caller will COMMIT or ROLLBACK the surrounding transaction.
 *
 * Idempotency is enforced by the SQL function: a second call with the same
 * `captureId` and identical immutable fields returns the same `captureSeq`.
 * A second call with the same `captureId` but divergent content fails with
 * SQLSTATE 23505 (unique_violation).
 *
 * `captureSeq` is returned as a decimal string (lossless past 2^53). The
 * caller decides whether to convert to bigint/number.
 */
export async function captureAuditEvent(
  client: PoolClient,
  input: CaptureAuditEventInput,
): Promise<CaptureAuditEventResult> {
  validateInput(input);

  // Compute the per-chain advisory lock key from the canonical derivation.
  // The B0 SQL function is correct even if the caller passed a wrong key
  // (row-level lock on chain_state is the actual serialization primitive),
  // but B1 always passes the correct value to avoid operational contention.
  const advisoryKey = lockKey.chainLockKey(input.chainId);

  const params = [
    /*  $1 p_capture_id            */ input.captureId,
    /*  $2 p_org_id                */ input.orgId,
    /*  $3 p_chain_id              */ input.chainId,
    /*  $4 p_chain_category        */ input.chainCategory,
    /*  $5 p_chain_lock_key        */ advisoryKey.toString(),
    /*  $6 p_event_type            */ input.eventType,
    /*  $7 p_event_version         */ input.eventVersion,
    /*  $8 p_subject_type          */ input.subjectType,
    /*  $9 p_subject_id            */ input.subjectId,
    /* $10 p_occurred_at           */ toIso(input.occurredAt),
    /* $11 p_payload_hash          */ toBuffer(input.payloadHash),
    /* $12 p_payload_encrypted     */ toNullableBuffer(input.payloadEncrypted),
    /* $13 p_dek_wrapped           */ toNullableBuffer(input.dekWrapped),
    /* $14 p_key_id                */ input.keyId,
    /* $15 p_key_version           */ input.keyVersion,
    /* $16 p_redaction_metadata    */ JSON.stringify(input.redactionMetadata ?? {}),
    /* $17 p_evidence_strength     */ input.evidenceStrength ?? 'hmac_internal',
    /* $18 p_capture_integrity_tag */ toNullableBuffer(input.captureIntegrityTag),
    /* $19 p_capture_integrity_alg */ input.captureIntegrityAlg ?? null,
    /* $20 p_posture               */ input.posture ?? 'best_effort',
  ];

  const r = await client.query<{ capture_id: string; capture_seq: string }>(
    `SELECT capture_id::text, capture_seq::text
       FROM govai.audit_capture_insert_locked(
         $1::uuid, $2::uuid, $3::text, $4::text, $5::bigint,
         $6::text, $7::text, $8::text, $9::uuid, $10::timestamptz,
         $11::bytea, $12::bytea, $13::bytea, $14::text, $15::integer,
         $16::jsonb, $17::text, $18::bytea, $19::text, $20::text
       )`,
    params,
  );

  const row = r.rows[0];
  if (!row) {
    // The SECURITY DEFINER function always RETURN NEXT exactly one row on
    // success and RAISEs otherwise; this branch is for type-narrowing only.
    throw new Error('captureAuditEvent: audit_capture_insert_locked returned no row');
  }

  return {
    captureId: row.capture_id,
    captureSeq: row.capture_seq,
  };
}
