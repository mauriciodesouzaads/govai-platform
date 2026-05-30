# SPEC — AWS KMS Adapter

**Status:** Implemented (Foundation Release)
**Date:** 2026-05-27 (updated 2026-05-29)
**Related:** Plane 4, Foundation Release, `packages/core-identity/src/kms/aws-kms.ts`

## 1. Purpose

Implement the first production KMS adapter (`AwsKms`) so GovAI can run outside
dev/test without `ProductionKmsRequired` failing cryptographic operations. This
closes the P0 identified post-merge of PR #78.

## 2. Design — Option B (sequential): KMS unwraps a master seed; HKDF/HMAC stay local

AWS KMS is used **only** to unwrap a 32-byte master seed (a single `kms:Decrypt`
per cache window). All key derivation (HKDF-SHA256) and HMAC-SHA256 happen
**locally in-process**, mirroring the DevKms cryptographic model.

Rationale: every audit append HMACs once and every chain verify re-HMACs every
event, inside a per-chain advisory lock. A remote `GenerateMac`/`VerifyMac` per
event would put KMS round-trip latency on the audit hot path. Therefore the
adapter does **not** use `GenerateMac`/`VerifyMac` and requires no IAM permission
for them — only `kms:Decrypt` on the foundation key.

This is a production fresh-start: `AwsKms` does **not** need to read DevKms
envelopes. Local development continues to use `DevKms`; production must use
`AwsKms`.

## 3. AWS resources (already provisioned — examples, not secrets)

- account: `205639151434`
- region: `us-east-1` (conscious bootstrap choice for the Foundation Release)
- KMS key: symmetric `SYMMETRIC_DEFAULT` / `ENCRYPT_DECRYPT`, rotation enabled
- alias: `alias/govai-foundation`
- IAM: the runtime role needs only `kms:Decrypt` on this key.
- The KMS-encrypted master seed lives as a **ciphertext-only file OUTSIDE the
  repository** (e.g. `~/.govai/secrets/govai-kms-master-seed.ciphertext`).

## 4. Environment variables (consumed by `createKmsFromEnv`)

| Var | Required (prod, provider=aws) | Notes |
| --- | --- | --- |
| `GOVAI_KMS_PROVIDER=aws` | yes | selects the adapter |
| `GOVAI_KMS_AWS_REGION` | yes | e.g. `us-east-1` |
| `GOVAI_KMS_AWS_KEY_ID` | yes | key id or alias, e.g. `alias/govai-foundation` |
| `GOVAI_KMS_AWS_MASTER_CIPHERTEXT_FILE` | yes | path to the ciphertext-only file, **outside the repo** |
| `GOVAI_KMS_SEED_CACHE_TTL_SECONDS` | no (default 900) | positive integer seconds |

Fail-closed (all via `KmsBootError` / `BootError`):
- missing region / key id / ciphertext-file path;
- ciphertext file missing, empty, or unreadable;
- TTL not a positive integer;
- production with `GOVAI_KMS_PROVIDER=dev`;
- production with `KMS_DEV_SEED` set;
- KMS errors never downgrade to DevKms.

## 5. Encryption context contract (master-seed Decrypt)

The Decrypt call passes exactly, as a structured string→string object:

```
{ app: "govai", purpose: "master-seed", version: "1" }
```

Every value is a **string**; `version` is the string `"1"`, never the number `1`.
No tenant/org/path/user data is ever added to this context.

## 6. Envelope encryption v1 (two layers)

Returned across the existing `Kms` two-field shape (the interface is unchanged):

- `dekWrapped` = `MAGIC("GVK1")` ‖ `IV_dek`(12) ‖ `tag_dek`(16) ‖ `wrapped_dek`(32) = 64 bytes
- `ciphertext` = `IV_payload`(12) ‖ `tag_payload`(16) ‖ `payload_ciphertext`(var)

Layers:
- **Layer 1 (payload):** a fresh random 32-byte DEK encrypts the payload with
  AES-256-GCM; `IV_payload` is a fresh 12-byte CSPRNG value; 16-byte auth tag.
- **Layer 2 (DEK wrapping):** a KEK derived from the master seed via HKDF
  (`purpose: "payload_dek"`) wraps the DEK with AES-256-GCM; `IV_dek` is an
  independent fresh 12-byte CSPRNG value; 16-byte auth tag.

`IV_payload` and `IV_dek` are always distinct, fresh per operation; no fixed,
derived, or counter IVs. The magic/version prefix is validated **before** any
deeper parse; unknown magic/version, truncation, or tampering fail closed with a
sanitized error. DEK and KEK temporaries are zeroized (`.fill(0)`) after use.

## 7. Cache model

- The plaintext master seed is cached as a **Buffer**, never a string (strings are
  immutable and cannot be zeroized).
- Within the TTL no further `kms:Decrypt` occurs; after expiry the next use
  re-decrypts.
- On expiry the cached Buffer is overwritten with `.fill(0)` and dropped.
- The cache is never logged, serialized, or returned to callers.

## 8. Local derivation

After unwrap, keys are derived locally with HKDF-SHA256 using a **production salt**
`govai-aws-kms-v1` (distinct from DevKms's `govai-dev-kms` — outputs are NOT
interchangeable, and there is intentionally no AwsKms↔DevKms parity test). The
HKDF `info` binds `purpose | orgId | keyId | version`.

## 9. Rotation model

- **AWS KMS key rotation:** enabled on the CMK (annual). Transparent to decrypt of
  existing ciphertext.
- **GovAI master-seed rotation:** generate a new seed, KMS-encrypt it (same context
  or a bumped `version`), replace the ciphertext file; bump the seed/key version so
  derived keys change deterministically.
- **DevKms data migration:** not applicable to a production fresh start; if DevKms
  envelopes ever needed reading, that would be an explicit, separate migration —
  `AwsKms` v1 decode does not attempt legacy parsing.

## 10. Testing

- All adapter tests use an **injected fake KMS client**; no real AWS, no
  `govai-admin` profile, no `~/.govai` access, no real ciphertext.
- Coverage: encryption-context contract (string `"1"`), Decrypt called once within
  TTL and again after expiry, seed cached as Buffer and zeroized on expiry,
  deriveKey/hmac determinism, envelope roundtrip, two encrypts differ, magic/
  version/truncation/tamper matrix, sanitized errors, factory fail-closed paths.
- Real-AWS validation is a **manual post-merge step** (see runbook), never in CI.

## 11. Acceptance criteria

- Production config with AWS KMS boots successfully (manual post-merge).
- Production config without AWS KMS fails closed.
- Provider credential encrypt/decrypt roundtrip passes.
- Audit append/verify roundtrip passes (unchanged HMAC contract).
- KMS outage / tamper tests fail safely.
- Logs contain no plaintext secrets.
- Rotation runbook exists.

## 12. Resolved open questions

- **HMAC approach:** RESOLVED → derived local key (Option B). KMS HMAC keys are not
  used.
- Per-tenant CMK vs shared environment CMK and BYOK timeline remain future work
  (out of scope for this PR).
