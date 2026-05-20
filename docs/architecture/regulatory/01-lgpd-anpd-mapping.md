# LGPD and ANPD Mapping

## Purpose

This document maps GovAI's currently implemented primitives against the
control objectives of the Lei Geral de Proteção de Dados (LGPD, Lei
13.709/2018) and the Autoridade Nacional de Proteção de Dados (ANPD)
regulations and guidance.

It is technical architecture mapping. It is **not** legal advice and **not** a
compliance guarantee. Applicability of any specific LGPD obligation depends on
the customer's processing context and must be reviewed by qualified
professionals.

Status taxonomy is defined in `README.md`; the source register is
`15-source-register.md`; provider/customer/GovAI boundaries are in
`16-shared-responsibility-model.md`.

## Sources

This mapping cites only sources recorded in `15-source-register.md`:

- **BR-DP-01** — LGPD, Lei 13.709/2018 (CONFIRMED_PRIMARY_SOURCE).
- **BR-DP-02** — Resolução CD/ANPD nº 15/2024, incident communication
  (CONFIRMED_PRIMARY_SOURCE).
- **BR-DP-03** — Resolução CD/ANPD nº 2/2022, small processing agents
  (PARTIAL_PRIMARY_SOURCE).
- **BR-DP-04** — Resolução CD/ANPD nº 4/2023, sanction dosimetry
  (PARTIAL_PRIMARY_SOURCE).
- **BR-DP-05** — ANPD AI posture / sandbox / 2026-2027 priority map
  (PARTIAL_PRIMARY_SOURCE). Treated here as soft-law / supervisory context
  only; not a binding AI-specific regulation.

PARTIAL sources mean an official source exists and is identified but some
detail (exact instrument URL or current consolidated text) is not fully
confirmed. Detailed-mapping cells citing those sources inherit that limitation.

## Mapping method

- A cell is marked `COVERED` only when concrete repository evidence is cited:
  a file or migration; a function / schema / route / table / event; an audit
  artifact or DB evidence; and test or validation evidence where available.
- `PARTIAL` means relevant primitives exist but workflow, UI, report, export,
  configuration, policy, retention, or operational process is missing.
- `GAP` means no implementation exists.
- `NEEDS_SOURCE_VERIFICATION` means the source, requirement, or applicability
  could not be confirmed from a primary source.

A `COVERED` status does not imply that the corresponding LGPD obligation is
satisfied for any given customer. Obligations depend on customer
configuration, legal bases, contracts, and qualified review.

## GovAI primitives considered

These are the implemented primitives this mapping draws on. Each is a real
asset in the repository; this is not a planned-feature list.

- HMAC-chained audit events — `apps/api/src/db/migrations/0001_audit_chain.sql`
  (table `govai.audit_events` with `previous_hmac`, `hmac`, `canonical_bytes`,
  `canonical_hash`, `sequence_number`, `evidence_strength`).
- Append-only audit pipeline — `packages/core-audit/src/append.ts`
  (`auditAppend`) and `packages/core-audit/src/verify.ts` (chain verification).
- Canonical serialization and hashing — `packages/core-audit/src/canonical-json.ts`,
  `packages/core-audit/src/hash.ts`.
- HMAC under KMS-derived key — `packages/core-audit/src/hmac.ts`.
- Envelope encryption at rest — `audit_event_payloads.encrypted_payload` and
  `dek_wrapped` in `0001_audit_chain.sql`, written through
  `packages/core-identity/src/kms/index.ts` (`Kms.envelopeEncrypt`,
  AES-256-GCM, wrapped DEK; `KmsPurpose` includes `audit_hmac` and
  `payload_dek`).
- Crypto-shred / right-to-erasure of payloads — `audit_event_payloads.status`
  values `active|crypto_shredded|tombstoned` plus
  `apps/api/src/routes/admin-audit-shred.ts`.
- Tenant isolation — RLS `ENABLE + FORCE` on every `govai.*` table, scoped by
  `current_setting('app.org_id')` via `packages/core-tenant`
  (`setLocalAppOrgId`); covered by `tests/integration/audit-events-rls.test.ts`
  and `tests/integration/workroom-rls.test.ts`.
- Authenticated actor identity — `apps/api/src/db/migrations/0010_api_keys_roles.sql`
  (`govai.api_keys` with hashed prefix + roles), `packages/core-identity/src/api-keys.ts`,
  `packages/core-identity/src/rbac.ts` (`hasAnyRole`).
- DLP detectors — `packages/dlp-br/src/baseline-detectors.ts`
  (`detectAllBaseline`: `cpf`, `cnpj`, `email`, `phone_br`) and
  `custom-detectors.ts`; pipeline use in `apps/api/src/pipeline/dlp.ts`.
- Capability admission and hard-deny — `apps/api/src/pipeline/capability-resolution.ts`
  (`assertCapabilityExecutable` rejects `status='blocked'`).
- Provider credential envelope encryption — `apps/api/src/db/migrations/0009_provider_credentials.sql`
  with `dek_wrapped`; covered by
  `tests/integration/provider-credentials-plaintext-leak.test.ts`.
- Governed and passthrough surfaces — `apps/api/src/pipeline/run-orchestrator.ts`
  (`executeGovernedRun`, `executePassthroughRun`); `/v1/runs` and provider
  governed/passthrough routes.
- Workroom governance container — `0012_workrooms.sql` (immutable
  `governance_mode`, soft-remove-only participants), `0013` (encrypted message
  payloads via `content_ref` → `audit_event_payloads`), `0014` (Workroom-owned
  runs), `0015` (approval requests/decisions with one-time consumption and
  separation-of-duties trigger).
- Audit query surface — `apps/api/src/routes/audit-events.ts` (`GET /v1/audit-events`).

## LGPD mapping table

| Area | Source reference | Requirement / control objective | GovAI support | Status | Evidence | Gaps / next work |
|---|---|---|---|---|---|---|
| Personal data scope (Art. 5) | BR-DP-01 | Define personal/sensitive/anonymized data; identify processing roles. | Not an implementation requirement; informs every other row. | PARTIAL | Used as definitional context across mapping rows; no data catalog. | Future data catalog and processing-roles registry. |
| Sensitive personal data (Art. 11) | BR-DP-01 | Apply heightened protections to sensitive categories. | Encryption-at-rest primitives apply uniformly; category-aware classification is not implemented. | PARTIAL | Envelope encryption (`audit_event_payloads`, `Kms.envelopeEncrypt`); DLP detects only `cpf`, `cnpj`, `email`, `phone_br`. | Sensitive-category classifier; policy ceiling per category; see `07-sensitive-data-handling.md`. |
| Children and adolescents (Art. 14) | BR-DP-01 | Special-case protection for minors' data. | No age-based classification or special handling. | GAP | None. | Detection, consent capture, special-case policy. |
| Legal basis (Art. 7, 11 §1) | BR-DP-01 | Record and justify a lawful basis per processing operation. | No legal-basis registry. | GAP | None. | Legal-basis registry tied to processing operations and runs. |
| Transparency and data subject information (Art. 9) | BR-DP-01 | Make processing information available to data subjects. | Architecture documentation exists; no data-subject-facing transparency artifact. | PARTIAL | `docs/architecture/governance-philosophy.md`; Workroom audit subview (`GET /v1/workrooms/{id}/audit`). | Data-subject-facing transparency surface. |
| Automated decision review (Art. 20) | BR-DP-01 | Allow review of decisions based solely on automated processing. | Approval / human-in-the-loop primitives exist; no Art. 20 review workflow. | GAP | Phase 4 approval loop addresses a related governance control, not Art. 20 review. | Automated-decision review request and response workflow. |
| Data subject rights (Art. 18) | BR-DP-01 | Confirm processing, access, correct, anonymize, port, delete, etc. | No DSR endpoints or workflow; crypto-shred exists for evidence payloads. | GAP | `admin-audit-shred` is an admin tool, not a DSR endpoint. | Authenticated DSR endpoints and operator workflow. |
| Records of processing (Art. 37) | BR-DP-01 | Maintain records of processing operations (RoPA). | Audit events are not RoPA. | GAP | None. | RoPA model and export. |
| RIPD / DPIA (Art. 38) | BR-DP-01 | Produce a Data Protection Impact Report when required. | No RIPD/DPIA workflow. | GAP | None. | RIPD/DPIA template + report generation. |
| Security — encryption at rest | BR-DP-01 Art. 46 | Protect personal data with appropriate security measures. | Envelope encryption (AES-256-GCM + wrapped DEK) of sensitive evidence payloads and provider credentials. | COVERED | `0001_audit_chain.sql` (`audit_event_payloads.encrypted_payload`/`dek_wrapped`); `packages/core-identity/src/kms/index.ts` (`Kms.envelopeEncrypt`); `0009_provider_credentials.sql`; `tests/integration/provider-credentials-plaintext-leak.test.ts`. | Key rotation/lifecycle documentation; HSM/KMS production hardening tracked elsewhere. |
| Security — tenant isolation | BR-DP-01 Art. 46 | Logically segregate tenant data. | RLS `ENABLE + FORCE` on every `govai.*` table, scoped by `current_setting('app.org_id')`. | COVERED | `0001_audit_chain.sql`; `0012_workrooms.sql`–`0015_workroom_approvals.sql`; `packages/core-tenant` (`setLocalAppOrgId`); `tests/integration/audit-events-rls.test.ts`; `tests/integration/workroom-rls.test.ts`. | Cross-tenant penetration tests; explicit production runbook. |
| Security — authentication and authorization | BR-DP-01 Art. 46 | Authenticate actors and authorize access. | Hashed API keys with `roles[]`; `hasAnyRole`; per-route checks. | COVERED | `0010_api_keys_roles.sql`; `packages/core-identity/src/api-keys.ts`; `packages/core-identity/src/rbac.ts`; route-level checks in `apps/api/src/routes/*`. | Customer SSO/IdP integration. |
| Security — chain integrity / audit | BR-DP-01 Art. 46, Art. 50 | Maintain tamper-evident logs of processing actions. | HMAC-chained, append-only audit events with canonical bytes and per-chain advisory lock. | COVERED | `0001_audit_chain.sql`; `packages/core-audit/src/append.ts`; `packages/core-audit/src/verify.ts`; `tests/integration/audit-canary.test.ts`; `tests/integration/canonical-reconstruction.test.ts`; `tests/integration/verify-edge-cases.test.ts`; `tests/integration/append-only-defense.test.ts`. | Customer-facing chain verification UI; external anchoring (see `06-evidence-chain-custody.md`). |
| Security — append-only timelines | BR-DP-01 Art. 46, Art. 50 | Prevent retroactive tampering of governance records. | Triggers on `workroom_turns`, `workroom_messages`, `workroom_approval_decisions` reject UPDATE/DELETE/TRUNCATE. | COVERED | `0012`, `0013`, `0015` migrations; `tests/integration/append-only-defense.test.ts`; `tests/integration/workroom-turn-ordering.test.ts`. | None at primitive level; downstream report workflows pending. |
| Incident communication (Art. 48; BR-DP-02) | BR-DP-01; BR-DP-02 | Notify ANPD and data subjects within 3 business days when an incident may cause relevant risk. | No notification workflow; the audit chain captures events but does not generate a notification artifact. | GAP | None. | ANPD-format incident notification workflow and DPO/DSR routing. |
| International transfer (Art. 33) | BR-DP-01 | Use a permitted transfer basis when data leaves Brazil. | No transfer registry or per-flow basis tagging. | GAP | None. | Provider/region/legal-basis registry; transfer-aware policy. |
| Privacy by design (Art. 49) | BR-DP-01 | Adopt security and privacy measures from system design. | RLS, encryption, hard-deny floor, append-only audit, and approval-by-exception are baseline architectural choices. | PARTIAL | `docs/architecture/governance-philosophy.md`; `docs/architecture/regulatory/00-philosophy-and-positioning.md`. | Customer-facing privacy-by-design report; sensitive-category-aware controls. |
| Governance and best practices (Art. 50) | BR-DP-01 | Maintain a governance program with policies, training, controls, evidence. | Workroom governance container, approval loop, audit subview, evidence artifacts. | PARTIAL | `0012`–`0015` migrations; `apps/api/src/routes/workroom-*.ts`; Phase 4 approval primitives. | DPO-facing program reports, training tracking, control-attestation workflows. |
| Accountability (Art. 50 §2 II "g") | BR-DP-01 | Demonstrate the governance program with documented evidence. | Per-organization audit chain plus Workroom timelines surfaced via the audit subview. | PARTIAL | `apps/api/src/routes/audit-events.ts`; `apps/api/src/routes/workroom-transcript.ts` audit subview; Phase 2 evidence artifacts. | DPO/auditor-grade evidence bundles, exports, and reports. |

## ANPD-specific considerations

- **Incident communication regulation (BR-DP-02).** ANPD Resolução nº 15/2024
  defines triggers and a 3-business-day notification deadline (doubled for
  small processing agents under BR-DP-03). GovAI currently produces the
  evidence material an incident response can rely on (chained audit, encrypted
  payloads, Workroom evidence artifacts) but does not produce an ANPD-format
  notification artifact or operate a notification workflow. Mapped as `GAP`.
- **Small processing agents (BR-DP-03).** Source recorded as
  `PARTIAL_PRIMARY_SOURCE`; not relied on to lower obligations and no
  small-agent-specific automation is implemented.
- **Sanction dosimetry (BR-DP-04).** Source recorded as
  `PARTIAL_PRIMARY_SOURCE`; out of direct mapping scope here, used for
  awareness only.
- **ANPD AI posture (BR-DP-05).** The ANPD AI sandbox, AI-related supervisory
  posture, and the 2026-2027 priority-themes map are treated as soft-law and
  supervisory context. They are **not** treated as binding AI-specific
  regulation. Any AI-specific binding requirement will land in the source
  register after primary-source verification.

## Data subject rights and operational gaps

The mapping above tags several capabilities as `GAP` because they are
operational, not primitive. Building them does not require new audit or
encryption foundations; it requires endpoints, workflows, and reports.
Representative gaps to be tracked outside this PR:

- DSR (Art. 18) workflow and authenticated DSR endpoints.
- Correction, deletion, blocking, and portability workflows.
- Legal-basis registry tied to processing operations.
- RoPA / Art. 37 records-of-processing model and export.
- RIPD / Art. 38 report generation.
- ANPD-format incident notification workflow (Art. 48; Res. 15/2024).
- Retention and litigation hold engine; tested deletion paths beyond
  crypto-shred.
- Connector-specific data provenance for ingested evidence.

These are surfaced honestly; the docs PR-D gap register will consolidate them.

## Disclaimers

- This document is technical architecture mapping. It is not legal advice.
- GovAI does not guarantee LGPD compliance.
- GovAI does not substitute legal counsel.
- GovAI does not substitute DPO review.
- GovAI does not certify third-party providers.
- Compliance outcomes depend on customer configuration, provider contracts,
  legal bases, organizational processes, and qualified professional review.

## Relationship to issue #59

Relates to #59.

Relates to #33.

Umbrella tracker #33 remains active.

#59 remains open for PR-C and PR-D.
