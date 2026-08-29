// Conversation title encryption at rest (EP-AI-CONVERSATION-CONTINUITY-V1 P0-B; spec §6/§18).
//
// There is NO plaintext title column to misuse: migration 0031 stores a title only as
// `ciphertext + wrapped DEK + kms key id/version + a KEYED digest`, all-or-none by CHECK. This
// module is the one place that produces and consumes that group.
//
// ★ WHY A KEYED DIGEST AND NOT sha256(plaintext) (§6, verbatim reasoning): a deterministic
// UNKEYED hash sitting beside the ciphertext would let anyone holding a database dump or a
// backup — with NO KMS access — CONFIRM guesses of low-entropy content. A conversation title is
// exactly that: short, human, and often the most sensitive line in the thread. The digest is
// therefore `Kms.hmacSha256` under the dedicated `conversation_content_integrity` purpose.
//
// ★ PURPOSE ISOLATION IS REAL, NOT NOMINAL. The envelope is taken under the
// `conversation_content` purpose, which selects a DISTINCT wrapping-KEK derivation domain from
// `payload_dek`; cross-purpose decryption fails closed (proven in
// `packages/core-identity/src/kms/index.test.ts`). The two purposes are also distinct from each
// other, so the integrity key cannot decrypt and the envelope key cannot forge a digest.
//
// ★ WIRE ORDER: digest -> encrypt -> store, the `workroom-transcript.ts:215-222` convention.
//
// ★ NO SECRET MATERIAL IN ERRORS. Nothing here interpolates a title, a key, a DEK or a digest
// into an exception message. A decrypt failure is raised as an infrastructure invariant break —
// a title this service wrote it must be able to read — and the route turns it into a bare 500.
// Swallowing it into `title: null` would hide a real key/rotation fault behind a UI that simply
// looks untitled.

import type { Kms } from '@govai/core-identity';
import { AI_CONVERSATION_CONTENT_KEY } from './keys.js';

/** The persisted encrypted-title group (0031's `ai_conversations_title_group_check`). */
export type EncryptedTitle = {
  ciphertext: Buffer;
  dekWrapped: Buffer;
  kmsKeyId: string;
  kmsKeyVersion: number;
  /** Keyed HMAC-SHA256 of the plaintext — 32 bytes, enforced by CHECK. */
  hmac: Buffer;
};

/** The columns a title decryption needs, exactly as they come off the row. */
export type StoredTitle = {
  title_ciphertext: Buffer | null;
  title_dek_wrapped: Buffer | null;
  title_kms_key_id: string | null;
  title_kms_key_version: number | null;
};

export async function encryptConversationTitle(
  kms: Kms,
  orgId: string,
  title: string,
): Promise<EncryptedTitle> {
  const plaintext = new Uint8Array(Buffer.from(title, 'utf8'));
  const hmac = await kms.hmacSha256({
    purpose: 'conversation_content_integrity',
    orgId,
    keyId: AI_CONVERSATION_CONTENT_KEY.keyId,
    version: AI_CONVERSATION_CONTENT_KEY.keyVersion,
    message: plaintext,
  });
  const enc = await kms.envelopeEncrypt({
    orgId,
    keyId: AI_CONVERSATION_CONTENT_KEY.keyId,
    version: AI_CONVERSATION_CONTENT_KEY.keyVersion,
    plaintext,
    purpose: 'conversation_content',
  });
  return {
    ciphertext: Buffer.from(enc.ciphertext),
    dekWrapped: Buffer.from(enc.dekWrapped),
    kmsKeyId: AI_CONVERSATION_CONTENT_KEY.keyId,
    kmsKeyVersion: AI_CONVERSATION_CONTENT_KEY.keyVersion,
    hmac: Buffer.from(hmac),
  };
}

/**
 * Decrypt one row's title. `null` when the row simply has no title yet (§18: a title arrives
 * with the first rename; nothing derives one at creation). Decryption uses the key identity
 * PERSISTED ON THE ROW, never the current constant, so a future rotation reads old rows under
 * the identity that wrapped them.
 */
export async function decryptConversationTitle(
  kms: Kms,
  orgId: string,
  row: StoredTitle,
): Promise<string | null> {
  if (
    row.title_ciphertext === null ||
    row.title_dek_wrapped === null ||
    row.title_kms_key_id === null ||
    row.title_kms_key_version === null
  ) {
    return null;
  }
  const plaintext = await kms.envelopeDecrypt({
    orgId,
    keyId: row.title_kms_key_id,
    version: row.title_kms_key_version,
    ciphertext: new Uint8Array(row.title_ciphertext),
    dekWrapped: new Uint8Array(row.title_dek_wrapped),
    purpose: 'conversation_content',
  });
  return Buffer.from(plaintext).toString('utf8');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Conversation CONTENT envelope (P0-C; spec §6/§3).
//
// The same two purposes as the title group, applied to the `ai_conversation_content` rows that
// hold a turn's immutable native request config and an attempt's provider-native output. The
// digest is `Kms.hmacSha256` under `conversation_content_integrity` for exactly the §6 reason
// restated above: an UNKEYED sha256 beside the ciphertext would let a database dump confirm
// guesses of low-entropy content without any KMS access.
//
// ★ OPERATIONAL KEYED INTEGRITY ≠ FORENSIC EVIDENCE HASH. `content_hmac` is an operational
// tamper check on the operational store. It is NOT the evidence plane's SHA-256 and must never
// be substituted for it: the AuditBridge computes its own `native_request_hash` /
// `payloadHash` over the bytes it forwards, under the audit chain's own key identity. Two
// planes, two keys, two purposes — the §5 separation.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The persisted encrypted-content group (0031's `ai_conversation_content` columns). */
export type EncryptedContent = {
  ciphertext: Buffer;
  dekWrapped: Buffer;
  kmsKeyId: string;
  kmsKeyVersion: number;
  /** Keyed HMAC-SHA256 of the plaintext — 32 bytes, enforced by CHECK. */
  contentHmac: Buffer;
};

/** The columns a content decryption needs, exactly as they come off the row. */
export type StoredContent = {
  ciphertext: Buffer;
  dek_wrapped: Buffer | null;
  kms_key_id: string;
  kms_key_version: number;
};

/** Raised when a content row cannot be decrypted. Carries NO plaintext, NO key material and NO
 *  ciphertext — only the reason class, so a route can turn it into a bare 500 and a worker can
 *  classify the attempt without leaking. */
export class ConversationContentUnreadableError extends Error {
  readonly code = 'conversation_content_unreadable';
  constructor(readonly reason: 'crypto_shredded' | 'decrypt_failed') {
    super(`conversation content is unreadable (${reason})`);
    this.name = 'ConversationContentUnreadableError';
  }
}

export async function encryptConversationContent(
  kms: Kms,
  orgId: string,
  plaintext: Buffer,
): Promise<EncryptedContent> {
  const bytes = new Uint8Array(plaintext);
  const contentHmac = await kms.hmacSha256({
    purpose: 'conversation_content_integrity',
    orgId,
    keyId: AI_CONVERSATION_CONTENT_KEY.keyId,
    version: AI_CONVERSATION_CONTENT_KEY.keyVersion,
    message: bytes,
  });
  const enc = await kms.envelopeEncrypt({
    orgId,
    keyId: AI_CONVERSATION_CONTENT_KEY.keyId,
    version: AI_CONVERSATION_CONTENT_KEY.keyVersion,
    plaintext: bytes,
    purpose: 'conversation_content',
  });
  return {
    ciphertext: Buffer.from(enc.ciphertext),
    dekWrapped: Buffer.from(enc.dekWrapped),
    kmsKeyId: AI_CONVERSATION_CONTENT_KEY.keyId,
    kmsKeyVersion: AI_CONVERSATION_CONTENT_KEY.keyVersion,
    contentHmac: Buffer.from(contentHmac),
  };
}

/**
 * Decrypt one content row, using the key identity PERSISTED ON THE ROW — never the current
 * constant — so a future rotation reads old rows under the identity that wrapped them.
 *
 * A crypto-shredded row (LAW 12: `dek_wrapped` nulled, ciphertext retained) is reported as such
 * rather than as a decrypt failure: the two are operationally different — one is a lawful,
 * intentional destruction of readability, the other is a key/rotation fault that needs an
 * operator.
 */
export async function decryptConversationContent(
  kms: Kms,
  orgId: string,
  row: StoredContent,
): Promise<Buffer> {
  if (row.dek_wrapped === null) {
    throw new ConversationContentUnreadableError('crypto_shredded');
  }
  try {
    const plaintext = await kms.envelopeDecrypt({
      orgId,
      keyId: row.kms_key_id,
      version: row.kms_key_version,
      ciphertext: new Uint8Array(row.ciphertext),
      dekWrapped: new Uint8Array(row.dek_wrapped),
      purpose: 'conversation_content',
    });
    return Buffer.from(plaintext);
  } catch {
    // The caught error is deliberately NOT chained: KMS failures can carry key identifiers and
    // provider detail, and this error crosses into HTTP responses and worker logs.
    throw new ConversationContentUnreadableError('decrypt_failed');
  }
}
