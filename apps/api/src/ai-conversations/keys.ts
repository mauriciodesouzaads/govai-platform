// AI Conversation domain KMS key identity (EP-AI-CONVERSATION-CONTINUITY-V1 P0-B).
//
// Single source of truth for the logical `keyId` / `keyVersion` persisted on every
// conversation-domain encrypted row, mirroring `pipeline/audit-keys.ts`'s role for the audit
// chain. The KEY MATERIAL is never here — it is derived inside the KMS from the PURPOSE plus
// this identity (`packages/core-identity/src/kms/index.ts`), and the two conversation purposes
// (`conversation_content` for the envelope, `conversation_content_integrity` for the keyed
// digest) are what keep this domain derivationally isolated from `audit_hmac` / `payload_dek` /
// `provider_credential` (spec §6).
//
// The literal is the one migration 0031's own domain fixtures already write
// (`tests/integration/helpers/ai-conversation-seed.ts`), so the first production writer agrees
// with the shape the schema was proven against rather than minting a second vocabulary.
//
// Rotation is an explicit future ADR (the `audit-keys.ts:9-10` posture): the key id/version are
// persisted PER ROW precisely so a later rotation can read old rows under their recorded
// identity. V1 inherits the frozen-key limitation and says so.
export const AI_CONVERSATION_CONTENT_KEY = Object.freeze({
  keyId: 'ai-conversation-content-v1',
  keyVersion: 1,
} as const);
