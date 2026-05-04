# ADR-008 — KMS correto desde o início

**Status:** accepted (baseline)

DevKms com HKDF determinístico per (purpose, orgId, keyId, version).
Production sem provider real → boot fail (`packages/core-identity/src/kms/index.ts`).
`KMS_DEV_SEED` per-developer; `.env.example` instrui geração local.
gitleaks rule rejeita commit de seed real.
