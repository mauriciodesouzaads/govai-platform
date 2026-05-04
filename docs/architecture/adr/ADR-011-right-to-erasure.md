# ADR-011 — Right-to-erasure compatível com append-only

**Status:** accepted (baseline)

Crypto-shredding implementado em `audit_event_payload_crypto_shred`:
- `dek_wrapped = NULL` + `status = 'crypto_shredded'`.
- Hash original em `audit_events.payload_hash` permanece.
- `verifyFullChain` continua válido.
- Operação gera audit event próprio na chain `admin`.
- RBAC enforcement em app layer (admin ou data_protection_officer).
