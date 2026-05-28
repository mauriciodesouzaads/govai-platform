// B2 — AuditSealer core library.
//
// Reusable TypeScript core that consumes the B0 SECURITY DEFINER functions
// (govai.audit_capture_claim_for_seal, govai.audit_capture_mark_sealed,
// govai.audit_capture_mark_failed) and the existing auditAppend adapter to
// turn captures from the outbox into sealed events in the HMAC chain.
//
// This file is a LIBRARY. It is NOT a runner. It does not own a process,
// a timer, a loop, a queue, a worker, observability, or a connection pool.
// It exposes composable primitives plus one convenience entry point that
// seals AT MOST one capture per call. A future runner (in-process or
// out-of-process) chooses scheduling, batching, retries, and observability.
//
// Doctrinal invariants:
//   - the library never executes BEGIN / COMMIT / ROLLBACK / SAVEPOINT;
//   - the library never executes SET ROLE / RESET ROLE / set_config /
//     setLocalAppOrgId — the caller owns role, tenant, and transaction;
//   - the library never reaches for a global pool;
//   - the library never reimplements the HMAC chain or canonicalization;
//   - the library calls auditAppend (the existing adapter) verbatim, not
//     govai.audit_append_locked directly;
//   - no raw payload, ciphertext, or DEK wrap is carried into the audit
//     event or into any thrown error / log line;
//   - mark_failed never runs automatically inside a transaction that is
//     already aborted by a previous SQL error — that path is explicit and
//     a runner is responsible for opening a fresh transaction.
//
// Grant split (B0 + 0001):
//   - audit_capture_claim_for_seal/mark_sealed/mark_failed → govai_audit_sealer
//   - audit_append_locked (used by auditAppend)            → govai_app
// The two roles do not inherit from each other. To call all four primitives
// inside a single transaction, the calling session must either be a member
// of both roles (and switch via SET LOCAL ROLE between phases) or run under
// a superuser that bypasses RLS. This library does NOT switch roles itself;
// sealNextAuditCapture accepts an optional `withSealerPhaseRole` callback
// that lets the caller perform the switch between phases. The callback is
// operational glue for the dedicated runner / test harness (see ADR-020),
// not observability, and must not be used from HTTP request handlers or the
// shared apps/api request pool.

import type { PoolClient } from 'pg';
import type { Kms } from '@govai/core-identity';

import { auditAppend, type AuditAppendInput, type AuditAppendOutput } from './append.js';
// Reuse the type aliases the B1 capture adapter already exports so the
// barrel does not double-export the same names.
import type { ChainCategory, Posture, CaptureIntegrityAlg } from './capture.js';

// Namespace import so vitest can spy on chainLockKey if needed; we never
// reimplement the derivation.
import * as lockKey from './lock-key.js';

// -----------------------------------------------------------------------------
// Shared types (kept close to B0 SQL shape, no raw payload exposed)
// -----------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function failInput(prefix: string, message: string): never {
  throw new Error(`${prefix}: ${message}`);
}

// ChainCategory, Posture, and CaptureIntegrityAlg are imported above from
// the B1 capture adapter so we do not double-export the same names from
// the package barrel.

/**
 * Subset of the outbox row returned by govai.audit_capture_claim_for_seal,
 * with bytea fields converted to hex digests / presence flags so callers
 * never receive raw ciphertext or DEK wraps.
 */
export interface ClaimedAuditCapture {
  captureId: string;
  orgId: string;
  /** Capture-chain id (B0 grain, e.g. `org:UUID:run:UUID`). Differs from
   *  the HMAC chain id used by auditAppend (`orgId:chainCategory`). */
  chainId: string;
  chainCategory: ChainCategory;
  /** Lossless decimal string for capture_seq. */
  captureSeq: string;
  eventType: string;
  eventVersion: string;
  subjectType: string;
  subjectId: string;
  /** ISO-8601 string. */
  occurredAt: string;
  /** Hex digest of the payload hash (the canonical hash of original
   *  payload content); never the payload itself. */
  payloadHashHex: string;
  /** True iff outbox row had a non-null payload_encrypted. Bytes withheld. */
  hasPayloadEncrypted: boolean;
  /** True iff outbox row had a non-null dek_wrapped. Bytes withheld. */
  hasDekWrapped: boolean;
  keyId: string;
  keyVersion: number;
  /** Server-validated jsonb (top-level raw-payload keys already rejected
   *  by B0 CHECK + B1 TS guard). */
  redactionMetadata: Record<string, unknown>;
  evidenceStrength: string;
  /** Algorithm only; the tag bytes are intentionally NOT returned. */
  captureIntegrityAlg: CaptureIntegrityAlg | null;
  hasCaptureIntegrityTag: boolean;
  posture: Posture;
}

export interface ClaimAuditCaptureForSealInput {
  orgId: string;
  chainId: string;
}

export interface MarkAuditCaptureSealedInput {
  orgId: string;
  chainId: string;
  captureId: string;
  auditEventId: string;
}

export interface MarkAuditCaptureFailedInput {
  orgId: string;
  captureId: string;
  /** Caller may pass a thrown `unknown` to be sanitized, or pre-sanitized
   *  errorClass + errorMessage strings. If both forms are provided, the
   *  explicit fields take precedence. */
  error?: unknown;
  errorClass?: string;
  errorMessage?: string;
}

export type AuditSealerPhase = 'claim' | 'append' | 'mark_sealed';

export interface SealNextAuditCaptureInput {
  orgId: string;
  /** Capture-chain id (B0 grain). The HMAC chain id is derived from
   *  (orgId, chainCategory) inside the library. */
  chainId: string;
  /** Kms required by the existing auditAppend adapter. The library does
   *  NOT instantiate Kms; the caller passes its singleton. */
  kms: Kms;
  /** Optional worker identifier echoed into the sealed audit event's
   *  redaction_metadata for traceability. Free-form string; the library
   *  caps it at 64 chars for safety. */
  workerId?: string;
  /**
   * Optional phase-role glue for the DEDICATED RUNNER or TEST HARNESS.
   *
   * Invoked by sealNextAuditCapture immediately before each phase so the
   * caller can `SET LOCAL ROLE` to the role that holds EXECUTE on the next
   * phase's SQL function (`govai_audit_sealer` for claim/mark_sealed;
   * `govai_app` for the auditAppend path). The library itself NEVER calls
   * SET ROLE / RESET ROLE / set_config — all role/session mutation happens
   * inside this caller-owned callback.
   *
   * Usage constraints:
   *   - intended for the dedicated AuditSealer runner (see ADR-020) or a
   *     test harness;
   *   - MUST NOT be used from an HTTP request handler;
   *   - MUST NOT be used with the shared request connection pool of
   *     apps/api (role mutation on a pooled request connection is unsafe);
   *   - if the caller's session role already has EXECUTE on all four
   *     B0/B1 SQL functions (e.g. a superuser or a combined runtime role),
   *     this callback may be omitted entirely.
   */
  withSealerPhaseRole?: (phase: AuditSealerPhase) => Promise<void>;
}

export type SealNextAuditCaptureResult =
  | {
      status: 'idle';
      claimed: false;
      orgId: string;
      chainId: string;
    }
  | {
      status: 'sealed';
      claimed: true;
      orgId: string;
      /** Original capture-chain id (B0 grain), echoed back from the claim. */
      chainId: string;
      /** HMAC chain id (`orgId:chainCategory`) where the audit event landed. */
      auditChainId: string;
      captureId: string;
      captureSeq: string;
      auditEventId: string;
    };

// -----------------------------------------------------------------------------
// Error sanitizer
// -----------------------------------------------------------------------------

const SEALER_ERROR_MESSAGE_MAX = 200; // matches B0 CHECK length(last_error) <= 200

/**
 * Public output shape of the sanitizer. The values are safe to write into
 * govai.audit_capture_mark_failed (which itself truncates to 200 chars on
 * the server side; this is defense in depth).
 */
export interface SanitizedSealerError {
  errorClass: string;
  errorMessage: string;
}

/**
 * Convert a thrown `unknown` (or an explicit class + message) into a short
 * safe-to-store description. The sanitizer:
 *   - keeps only `name`/`message` from Error-shaped inputs (no stack);
 *   - replaces newlines and control chars with spaces so the result is a
 *     single line;
 *   - hard-caps the message at SEALER_ERROR_MESSAGE_MAX chars.
 *
 * It does NOT introspect or strip "prompt"/"response"-like substrings —
 * the caller (especially `markAuditCaptureFailed`) is responsible for not
 * passing raw payload content into the error in the first place. Caller
 * contracts above (Decision 4) forbid that upstream.
 */
export function sanitizeSealerError(
  input:
    | { error?: unknown; errorClass?: string; errorMessage?: string }
    | Error
    | string
    | unknown,
): SanitizedSealerError {
  // Normalize to (cls, msg).
  let cls: string;
  let msg: string;

  if (
    input !== null &&
    typeof input === 'object' &&
    ('errorClass' in (input as Record<string, unknown>) ||
      'errorMessage' in (input as Record<string, unknown>) ||
      'error' in (input as Record<string, unknown>))
  ) {
    const obj = input as { error?: unknown; errorClass?: string; errorMessage?: string };
    if (typeof obj.errorClass === 'string' || typeof obj.errorMessage === 'string') {
      cls = typeof obj.errorClass === 'string' && obj.errorClass.length > 0
        ? obj.errorClass
        : 'unknown';
      msg = typeof obj.errorMessage === 'string' ? obj.errorMessage : '';
    } else {
      const inner = extractErrorClassMessage(obj.error);
      cls = inner.cls;
      msg = inner.msg;
    }
  } else {
    const inner = extractErrorClassMessage(input);
    cls = inner.cls;
    msg = inner.msg;
  }

  // Single-line, printable-only, length-capped.
  msg = msg.replace(/[\r\n\t\v\f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (msg.length > SEALER_ERROR_MESSAGE_MAX - 1) {
    msg = msg.slice(0, SEALER_ERROR_MESSAGE_MAX - 1) + '…';
  }
  if (msg.length === 0) msg = '<no_message>';

  cls = cls.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64);
  if (cls.length === 0) cls = 'unknown';

  return { errorClass: cls, errorMessage: msg };
}

function extractErrorClassMessage(value: unknown): { cls: string; msg: string } {
  if (value instanceof Error) {
    // Use only .name + .message; never fall back to String(value), which
    // would expose '<ErrorName>:' prefixes that defeat the "<no_message>"
    // path when the caller threw an Error with an empty message.
    return { cls: value.name || 'Error', msg: typeof value.message === 'string' ? value.message : '' };
  }
  if (typeof value === 'string') return { cls: 'unknown', msg: value };
  if (value === undefined || value === null) return { cls: 'unknown', msg: '' };
  // Avoid JSON.stringify on arbitrary objects (could contain payload).
  return { cls: 'unknown', msg: '<non-error value>' };
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

function validateOrgId(prefix: string, orgId: unknown): asserts orgId is string {
  if (!isUuid(orgId)) failInput(prefix, `orgId must be a UUID (got ${JSON.stringify(orgId)})`);
}

function validateChainId(prefix: string, chainId: unknown): asserts chainId is string {
  if (typeof chainId !== 'string' || chainId.length === 0) {
    failInput(prefix, 'chainId must be a non-empty string');
  }
}

function validateCaptureId(prefix: string, captureId: unknown): asserts captureId is string {
  if (!isUuid(captureId)) {
    failInput(prefix, `captureId must be a UUID (got ${JSON.stringify(captureId)})`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asChainCategory(value: unknown): ChainCategory {
  if (value === 'auth' || value === 'run' || value === 'policy' || value === 'admin') return value;
  throw new Error(`sealer: invalid chain_category from SQL: ${JSON.stringify(value)}`);
}

function asPosture(value: unknown): Posture {
  if (value === 'strict' || value === 'best_effort') return value;
  throw new Error(`sealer: invalid posture from SQL: ${JSON.stringify(value)}`);
}

function asCaptureIntegrityAlg(value: unknown): CaptureIntegrityAlg | null {
  if (value === null || value === undefined) return null;
  if (value === 'kms_hmac_sha256' || value === 'sha256_digest') return value;
  throw new Error(`sealer: invalid capture_integrity_alg from SQL: ${JSON.stringify(value)}`);
}

function asHex(value: unknown): string {
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (typeof value === 'string') {
    // pg may return bytea as a hex-string starting with `\x` in some configs.
    if (value.startsWith('\\x')) return value.slice(2);
    if (/^[0-9a-fA-F]*$/.test(value)) return value.toLowerCase();
  }
  throw new Error(`sealer: cannot convert bytea field to hex (typeof=${typeof value})`);
}

function asIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  throw new Error(`sealer: cannot convert occurred_at to ISO string (typeof=${typeof value})`);
}

/**
 * Derive the HMAC-chain id (used by auditAppend / govai.audit_events) from
 * the org and chain category.
 *
 * - mirrors the current auditAppend category-chain convention
 *   (@govai/core-events#chainIdFor → `${orgId}:${category}`);
 * - kept local to core-audit to avoid a package dependency cycle
 *   (core-audit must not import @govai/core-events);
 * - MUST be updated here if the canonical chain-id convention changes.
 */
export function auditCategoryChainId(orgId: string, category: ChainCategory): string {
  return `${orgId}:${category}`;
}

function safeWorkerId(workerId: string | undefined): string | undefined {
  if (workerId === undefined) return undefined;
  if (typeof workerId !== 'string') return undefined;
  // Strip everything but a safe subset; cap at 64.
  const cleaned = workerId.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64);
  return cleaned.length > 0 ? cleaned : undefined;
}

// -----------------------------------------------------------------------------
// Primitive 1: claim
// -----------------------------------------------------------------------------

/**
 * Call govai.audit_capture_claim_for_seal(p_org_id, p_chain_id,
 * p_chain_lock_key). The library computes the advisory lock key from
 * chainLockKey(chainId); B0 makes the function correct even if the key
 * is wrong, but the canonical value is always passed.
 *
 * Returns null when the chain has no contiguous next capture to claim
 * (empty queue OR the next sequence is not in status='captured'). Tenant
 * mismatch errors come from the SQL function directly and are NOT caught.
 */
export async function claimAuditCaptureForSeal(
  client: PoolClient,
  input: ClaimAuditCaptureForSealInput,
): Promise<ClaimedAuditCapture | null> {
  const prefix = 'claimAuditCaptureForSeal';
  validateOrgId(prefix, input.orgId);
  validateChainId(prefix, input.chainId);

  const advisory = lockKey.chainLockKey(input.chainId);

  const r = await client.query<{
    capture_id: string;
    org_id: string;
    chain_id: string;
    chain_category: string;
    capture_seq: string;
    event_type: string;
    event_version: string;
    subject_type: string;
    subject_id: string;
    occurred_at: string | Date;
    payload_hash: unknown;
    payload_encrypted: unknown | null;
    dek_wrapped: unknown | null;
    key_id: string;
    key_version: number;
    redaction_metadata: Record<string, unknown>;
    evidence_strength: string;
    capture_integrity_tag: unknown | null;
    capture_integrity_alg: string | null;
    posture: string;
  }>(
    `SELECT capture_id::text, org_id::text, chain_id, chain_category, capture_seq::text,
            event_type, event_version, subject_type, subject_id::text, occurred_at,
            payload_hash, payload_encrypted, dek_wrapped, key_id, key_version,
            redaction_metadata, evidence_strength,
            capture_integrity_tag, capture_integrity_alg, posture
       FROM govai.audit_capture_claim_for_seal($1::uuid, $2::text, $3::bigint)`,
    [input.orgId, input.chainId, advisory.toString()],
  );

  const row = r.rows[0];
  if (!row) return null;

  const claimed: ClaimedAuditCapture = {
    captureId: row.capture_id,
    orgId: row.org_id,
    chainId: row.chain_id,
    chainCategory: asChainCategory(row.chain_category),
    captureSeq: row.capture_seq,
    eventType: row.event_type,
    eventVersion: row.event_version,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    occurredAt: asIsoString(row.occurred_at),
    payloadHashHex: asHex(row.payload_hash),
    hasPayloadEncrypted: row.payload_encrypted !== null && row.payload_encrypted !== undefined,
    hasDekWrapped: row.dek_wrapped !== null && row.dek_wrapped !== undefined,
    keyId: row.key_id,
    keyVersion: row.key_version,
    redactionMetadata: isPlainObject(row.redaction_metadata) ? row.redaction_metadata : {},
    evidenceStrength: row.evidence_strength,
    captureIntegrityAlg: asCaptureIntegrityAlg(row.capture_integrity_alg),
    hasCaptureIntegrityTag:
      row.capture_integrity_tag !== null && row.capture_integrity_tag !== undefined,
    posture: asPosture(row.posture),
  };
  return claimed;
}

// -----------------------------------------------------------------------------
// Primitive 2: build the audit event (pure function)
// -----------------------------------------------------------------------------

export interface BuildAuditCaptureSealingEventOptions {
  workerId?: string;
  /** ISO timestamp recorded in redaction_metadata. Defaults to now(). */
  sealedAt?: Date;
}

/**
 * Construct the input shape that auditAppend expects from a ClaimedAuditCapture.
 *
 * Carries forward the captured event's semantic identity (orgId, eventType,
 * eventVersion, subjectType, subjectId, occurredAt, payload_hash, keyId,
 * keyVersion, evidenceStrength) so the HMAC chain records the original
 * captured event. The chain id is converted from B0's per-run grain to the
 * HMAC per-category grain.
 *
 * Adds a versioned `audit_sealer` block to redaction_metadata with safe
 * descriptors only:
 *   - version (1), capture_id (UUID), capture_seq (string),
 *     capture_chain_id (text), chain_category, posture,
 *     capture_integrity_alg, presence-flag booleans for
 *     payload_encrypted/dek_wrapped/capture_integrity_tag, sealed_at,
 *     sealed_by ('audit-sealer-core'), and an optional sanitized worker_id.
 *
 * Never carries: payload_encrypted bytes, dek_wrapped bytes,
 * capture_integrity_tag bytes, prompt/response/raw_input/raw_output,
 * messages/completion/requestBody/responseBody.
 */
export function buildAuditCaptureSealingEvent(
  claimed: ClaimedAuditCapture,
  options: BuildAuditCaptureSealingEventOptions = {},
): AuditAppendInput {
  // Defensive: refuse to build if the inbound metadata already carries a
  // banned top-level key. B1 + B0 already block this, but a malicious
  // future SQL bypass would still trip this guard before any HMAC write.
  for (const banned of [
    'prompt',
    'response',
    'raw_input',
    'raw_output',
    'messages',
    'completion',
    'requestBody',
    'responseBody',
  ]) {
    if (Object.prototype.hasOwnProperty.call(claimed.redactionMetadata, banned)) {
      throw new Error(
        `buildAuditCaptureSealingEvent: refusing to seal claimed.redactionMetadata with banned top-level key "${banned}"`,
      );
    }
  }

  const sealedAt = options.sealedAt ?? new Date();
  const worker = safeWorkerId(options.workerId);

  const mergedRedaction: Record<string, unknown> = {
    ...claimed.redactionMetadata,
    audit_sealer: {
      version: 1,
      capture_id: claimed.captureId,
      capture_seq: claimed.captureSeq,
      capture_chain_id: claimed.chainId,
      chain_category: claimed.chainCategory,
      posture: claimed.posture,
      capture_integrity_alg: claimed.captureIntegrityAlg,
      has_payload_encrypted: claimed.hasPayloadEncrypted,
      has_dek_wrapped: claimed.hasDekWrapped,
      has_capture_integrity_tag: claimed.hasCaptureIntegrityTag,
      sealed_at: sealedAt.toISOString(),
      sealed_by: 'audit-sealer-core',
      ...(worker !== undefined ? { worker_id: worker } : {}),
    },
  };

  const occurredAtDate = new Date(claimed.occurredAt);
  if (Number.isNaN(occurredAtDate.getTime())) {
    throw new Error(
      `buildAuditCaptureSealingEvent: cannot parse claimed.occurredAt as Date (got ${JSON.stringify(claimed.occurredAt)})`,
    );
  }

  const payloadHashBytes = Buffer.from(claimed.payloadHashHex, 'hex');

  // auditAppend's evidenceStrength is a narrow union 'hmac_internal' | 'dev_signed'.
  // If the captured value is one of those, pass it through; otherwise default
  // to 'hmac_internal' so the chain is well-formed.
  const evidence: 'hmac_internal' | 'dev_signed' =
    claimed.evidenceStrength === 'dev_signed' ? 'dev_signed' : 'hmac_internal';

  const appendInput: AuditAppendInput = {
    orgId: claimed.orgId,
    chainId: auditCategoryChainId(claimed.orgId, claimed.chainCategory),
    eventType: claimed.eventType,
    eventVersion: claimed.eventVersion,
    subjectType: claimed.subjectType,
    subjectId: claimed.subjectId,
    occurredAt: occurredAtDate,
    payloadHash: payloadHashBytes,
    keyId: claimed.keyId,
    keyVersion: claimed.keyVersion,
    redactionMetadata: mergedRedaction,
    evidenceStrength: evidence,
  };

  return appendInput;
}

// -----------------------------------------------------------------------------
// Primitive 3: mark_sealed
// -----------------------------------------------------------------------------

/**
 * Call govai.audit_capture_mark_sealed(orgId, captureId, auditEventId,
 * chain_lock_key) on the supplied client. Requires the caller's session
 * role to have EXECUTE on the SQL function (B0 grants it to
 * govai_audit_sealer). Caller owns the transaction and tenant context.
 */
export async function markAuditCaptureSealed(
  client: PoolClient,
  input: MarkAuditCaptureSealedInput,
): Promise<void> {
  const prefix = 'markAuditCaptureSealed';
  validateOrgId(prefix, input.orgId);
  validateChainId(prefix, input.chainId);
  validateCaptureId(prefix, input.captureId);
  if (!isUuid(input.auditEventId)) {
    failInput(prefix, `auditEventId must be a UUID (got ${JSON.stringify(input.auditEventId)})`);
  }
  const advisory = lockKey.chainLockKey(input.chainId);
  await client.query(
    'SELECT govai.audit_capture_mark_sealed($1::uuid, $2::uuid, $3::uuid, $4::bigint)',
    [input.orgId, input.captureId, input.auditEventId, advisory.toString()],
  );
}

// -----------------------------------------------------------------------------
// Primitive 4: mark_failed
// -----------------------------------------------------------------------------

/**
 * Call govai.audit_capture_mark_failed(orgId, captureId, error_class,
 * error_message) on the supplied client AFTER sanitizing the error.
 *
 * IMPORTANT: a runner must invoke this in a FRESH transaction whenever the
 * preceding seal attempt aborted its own transaction. Calling this in an
 * already-aborted transaction will not deliver the failure marker (the SQL
 * call would error with `25P02 in_failed_sql_transaction`).
 *
 * Caller owns the transaction and tenant context. Requires the session
 * role to have EXECUTE on the SQL function (B0 grants it to
 * govai_audit_sealer).
 */
export async function markAuditCaptureFailed(
  client: PoolClient,
  input: MarkAuditCaptureFailedInput,
): Promise<void> {
  const prefix = 'markAuditCaptureFailed';
  validateOrgId(prefix, input.orgId);
  validateCaptureId(prefix, input.captureId);

  const { errorClass, errorMessage } = sanitizeSealerError(input);

  await client.query(
    'SELECT govai.audit_capture_mark_failed($1::uuid, $2::uuid, $3::text, $4::text)',
    [input.orgId, input.captureId, errorClass, errorMessage],
  );
}

// -----------------------------------------------------------------------------
// Composite: sealNextAuditCapture
// -----------------------------------------------------------------------------

/**
 * One-shot orchestration: claim → auditAppend → mark_sealed. Seals AT MOST
 * one capture; never loops. Returns `{ status: 'idle' }` when the chain has
 * no contiguous next capture to claim.
 *
 * Failure semantics:
 *   - if `claim` raises, this throws and the caller's transaction is left
 *     to roll back; no `mark_failed` is attempted (the failure happened
 *     before any side-effect we own);
 *   - if `auditAppend` raises after a successful claim, the transaction is
 *     usually aborted by Postgres; this throws and does NOT attempt
 *     `mark_failed` in the same transaction (calling SQL there would error
 *     with `in_failed_sql_transaction`). A runner is expected to ROLLBACK
 *     and open a fresh transaction to call markAuditCaptureFailed for the
 *     captureId returned out-of-band by the runner's own state tracking;
 *   - if `mark_sealed` raises, same rationale as the auditAppend case.
 *
 * Role/session ownership:
 *   - this function NEVER calls SET ROLE / RESET ROLE / setLocalAppOrgId /
 *     set_config / BEGIN / COMMIT / ROLLBACK / SAVEPOINT;
 *   - if `withSealerPhaseRole` is provided, it is called before each phase
 *     so the caller can SET LOCAL ROLE to the role with EXECUTE on the next
 *     SQL function (govai_audit_sealer for claim/mark_sealed; govai_app
 *     for auditAppend);
 *   - if `withSealerPhaseRole` is not provided, the caller's session role
 *     must already have EXECUTE on all four functions (e.g. superuser).
 *
 * STALE SEALING — DEDICATED RUNNER REQUIREMENT (NOT implemented here):
 *   A successful `claim` flips the outbox row to status='sealing'. If the
 *   subsequent `auditAppend` or `mark_sealed` never completes (process
 *   crash, aborted transaction that is never retried, lost connection), the
 *   row is left stuck in status='sealing' and BLOCKS the chain, because
 *   mark_sealed requires capture_seq = last_sealed + 1. This library
 *   implements NO watcher, NO timeout, and NO loop to recover such rows.
 *   The future dedicated AuditSealer runner (see ADR-020) MUST:
 *     - detect status='sealing' captures older than a configured timeout;
 *     - roll back / open a FRESH transaction (never reuse an aborted one);
 *     - call markAuditCaptureFailed to release the sequence for retry;
 *     - emit a metric / alert for stuck captures.
 */
export async function sealNextAuditCapture(
  client: PoolClient,
  input: SealNextAuditCaptureInput,
): Promise<SealNextAuditCaptureResult> {
  const prefix = 'sealNextAuditCapture';
  validateOrgId(prefix, input.orgId);
  validateChainId(prefix, input.chainId);
  if (input.kms === null || input.kms === undefined || typeof input.kms !== 'object') {
    failInput(prefix, 'kms instance is required');
  }
  if (
    input.withSealerPhaseRole !== undefined &&
    typeof input.withSealerPhaseRole !== 'function'
  ) {
    failInput(prefix, 'withSealerPhaseRole, when provided, must be a function');
  }

  // ----- claim -----
  if (input.withSealerPhaseRole) await input.withSealerPhaseRole('claim');
  const claimed = await claimAuditCaptureForSeal(client, {
    orgId: input.orgId,
    chainId: input.chainId,
  });

  if (claimed === null) {
    return {
      status: 'idle',
      claimed: false,
      orgId: input.orgId,
      chainId: input.chainId,
    };
  }

  // ----- append -----
  const auditEventInput = buildAuditCaptureSealingEvent(claimed, {
    workerId: input.workerId,
  });

  if (input.withSealerPhaseRole) await input.withSealerPhaseRole('append');
  const appendOut: AuditAppendOutput = await auditAppend(
    client,
    input.kms,
    auditEventInput,
  );

  // ----- mark_sealed -----
  if (input.withSealerPhaseRole) await input.withSealerPhaseRole('mark_sealed');
  await markAuditCaptureSealed(client, {
    orgId: claimed.orgId,
    chainId: claimed.chainId,
    captureId: claimed.captureId,
    auditEventId: appendOut.eventId,
  });

  return {
    status: 'sealed',
    claimed: true,
    orgId: claimed.orgId,
    chainId: claimed.chainId,
    auditChainId: auditEventInput.chainId,
    captureId: claimed.captureId,
    captureSeq: claimed.captureSeq,
    auditEventId: appendOut.eventId,
  };
}

// -----------------------------------------------------------------------------
// Exports of internal helpers needed by tests
// -----------------------------------------------------------------------------

/** Exported for testing only; not part of the runtime API contract. */
export const __internal = Object.freeze({
  SEALER_ERROR_MESSAGE_MAX,
});
