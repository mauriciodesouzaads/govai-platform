// Single source of truth for the audit-chain HMAC key identity (SPEC-01 §3,
// AR-1; CLU audit E.1). The HMAC material itself is derived inside `auditAppend`
// from the injected KMS (purpose `'audit_hmac'`,
// `packages/core-audit/src/hmac.ts`); this constant only pins the logical
// `keyId` / `keyVersion` that are stored on every audit event and re-checked on
// verify (`append.ts:130-131,315-316`). Centralizing the literal that the
// orchestrator, workrooms, and admin-credential paths all use guarantees the
// future AuditBridge capture metadata can never diverge from the keys the
// sealer's `auditAppend` path uses. Key rotation is a future ADR (out of scope).
export const AUDIT_CHAIN_KEY = Object.freeze({ keyId: 'audit-1', keyVersion: 1 } as const);
