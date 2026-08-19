> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** ACCEPTED_ARCHITECTURAL_DOCTRINE
> **ORIGINAL_SOURCE_VERSION:** v0.9 corpus (2026-05-27, Draft)
> **ORIGINAL_SOURCE_ANCHOR:** owner-supplied v0.9 architecture package
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D6=ACCEPT_AS_DOCTRINE)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES_WITH_BOUNDED_EDITS (status line reconciled; body otherwise byte-preserved)
> **SOURCE_SHA256:** `78f4b35e2fb8fba58357772a75b25479dd9032d7c8c2684cc95ee50f754f10fe` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** ACCEPTED as doctrine (D6). Architecture-level threat model; the "Foundation required controls" in §4 are the 2026-05 pre-implementation list — several are now realized (artifact hygiene + claims policy promulgated here; AuditBridge threat controls implemented via ADR-027/028 + AuditBridge/B3; AWS KMS adapter shipped; provider-native compatibility harness H1 v2 + Foundation M1/M2/M2A acceptance), while the "before regulated production" items (backup/DR, HMAC key rotation procedure, external security review, SBOM policy, distributed rate limiting) remain open — see `docs/architecture/current-state.md` and the residual register in `docs/architecture/foundation-v1-freeze.md`. This file closes the reference in `apps/api/src/db/migrations/0025_audit_capture_outbox_foundation.sql` (T1/T2).
> ---

# GovAI Threat Model

**Status:** Accepted as doctrine (M3 / owner decision D6, 2026-08-18) — originally Draft 2026-05-27  
**Date:** 2026-05-27  
**Scope:** Architecture-level threat model for Foundation Release and future planes.

## 1. Assets

Critical assets:
- provider API keys;
- audit chain integrity;
- audit capture outbox;
- KMS keys and key references;
- tenant data and prompts/responses;
- policy bindings and packs;
- DLP findings and classification metadata;
- Workroom approvals and intended-action hashes;
- connector credentials and external evidence;
- report/evidence bundles;
- shadow AI observations.

## 2. Threat actors

External attacker, malicious tenant user, compromised tenant admin, compromised GovAI admin, compromised sealer role, compromised connector, compromised policy/update signing key, provider outage, accidental operator mistake, malicious or manipulated AI agent.

## 3. Major threat scenarios

### T1 — Provider-native evidence bypass

A route forwards AI traffic but only logs audit events.

Controls: Audit Bridge required for supported surfaces; tests fail on log-only evidence; completeness verifier.

### T2 — Outbox tampering before seal

Attacker modifies captured event before HMAC chain seal.

Controls: immutable content trigger; integrity tag where posture requires; sealer verification; RLS FORCE; limited roles.

### T3 — Sealer role compromise

Compromise of sealer role could corrupt the evidence pipeline.

Controls: least-privilege role, strict chain-state enforcement, credential monitoring, external anchoring future, admin actions audited.

### T4 — Provider credential exfiltration

Controls: KMS envelope encryption, no plaintext logs/errors, credential use only in request scope, provider credential leak tests.

### T5 — Policy pack compromise

Controls: signed packs, pull-based updates, canary/stable promotion, key rotation/revocation, future transparency log.

### T6 — Connector poisoning

Compromised connector sends false classifications.

Controls: source quality, external evidence never outranks native evidence, connector trust profile, all ingest audited.

### T7 — Shadow AI privacy overreach

Controls: metadata-first, content only with policy + attestation, minimization, retention policy, user/admin notices where appropriate.

### T8 — Workroom approval abuse

Requester and approver collude or credentials are stolen.

Controls: SoD, intended-action hash, expiration, role-based approval, audit review, suspicious approval analytics future.

### T9 — Prompt injection/excessive agency

Controls: OWASP LLM risk mapping, least-privilege tools, tool/action risk class, human approval for irreversible actions, sandbox/dry-run future.

### T10 — Artifact leakage

A ZIP/shared artifact includes `.env.local`, `.git`, credentials or logs.

Controls: safe-package script, gitleaks scan of artifact, checklist, no full project ZIP sharing.

## 4. Foundation required controls

Before Foundation implementation:
- artifact hygiene;
- claims policy;
- Audit Bridge threat controls;
- AWS KMS threat controls;
- provider-native compatibility harness.

Before regulated production:
- backup/DR design;
- HMAC key rotation procedure;
- external security review;
- supply-chain/SBOM policy;
- distributed rate limiting.
