# Marco Civil Mapping

## Purpose

This document maps GovAI's implemented primitives against the parts of the
Marco Civil da Internet (Lei 12.965/2014) and adjacent Brazilian instruments
that intersect with how GovAI records, retains, secures, and surfaces
governance evidence.

It is technical architecture mapping. It is **not** legal advice and **not** a
litigation or court-admissibility opinion. Marco Civil obligations (in
particular the connection-record and application-record retention duties of
Arts. 13–15) target specific kinds of internet providers; their applicability
to any particular GovAI customer depends on the customer's role and use case
and is for that customer's qualified counsel to determine.

Status taxonomy is defined in `README.md`; the source register is
`15-source-register.md`; provider/customer/GovAI boundaries are in
`16-shared-responsibility-model.md`.

## Sources

This mapping cites only sources recorded in `15-source-register.md`:

- **BR-NET-01** — Marco Civil da Internet, Lei 12.965/2014
  (CONFIRMED_PRIMARY_SOURCE).
- **BR-NET-02** — Lei 11.419/2006, electronic judicial process
  (CONFIRMED_PRIMARY_SOURCE) — used only where electronic-document handling
  intersects.
- **BR-NET-03** — MP 2.200-2/2001, ICP-Brasil
  (CONFIRMED_PRIMARY_SOURCE) — used only where signature uplift is discussed.
- **BR-NET-04** — Lei 14.063/2020, electronic signatures
  (CONFIRMED_PRIMARY_SOURCE) — used only where signature uplift is discussed.
- **BR-NET-05** — CPC, Lei 13.105/2015, civil-procedure evidence framework
  (CONFIRMED_PRIMARY_SOURCE) — used only for technical mapping; not for
  procedural legal conclusions.
- **BR-NET-06** — RFC 3161 trusted timestamping
  (CONFIRMED_PRIMARY_SOURCE) — used only where external timestamping is
  discussed.
- **BR-NET-07 / BR-NET-08** — ABNT NBR ISO/IEC 27037 and 27042
  (PAYWALLED_LIMITED_DETAIL) — referenced at control-family level only; clause
  text is not quoted or fabricated.

Detailed chain-of-custody primitives and limitations are discussed in
`06-evidence-chain-custody.md`. Sensitive-data semantics are in
`07-sensitive-data-handling.md`.

## Mapping method

- `COVERED` requires concrete repository evidence and tests.
- `PARTIAL` means primitives exist but workflow, configuration, retention
  engine, export, or operational process is missing.
- `GAP` means no implementation.
- `NEEDS_SOURCE_VERIFICATION` is used where applicability cannot be confirmed
  from a primary source.
- Marco Civil applicability to a given customer is a legal-applicability
  question; the mapping below describes only what GovAI's primitives provide
  technically, not what any particular customer must do.

## GovAI primitives considered

Each primitive cited here is implemented in the repository:

- HMAC-chained audit events and canonical bytes — `0001_audit_chain.sql`;
  `packages/core-audit/src/append.ts`; `packages/core-audit/src/verify.ts`.
- Envelope-encrypted payloads at rest — `audit_event_payloads.encrypted_payload`
  + `dek_wrapped`; `packages/core-identity/src/kms/index.ts`
  (`Kms.envelopeEncrypt`, AES-256-GCM).
- Redaction metadata in audit events — `audit_events.redaction_metadata`
  (`0001_audit_chain.sql`).
- Tenant isolation — RLS + `app.org_id` (`packages/core-tenant`).
- Authenticated actor identity — `0010_api_keys_roles.sql`;
  `packages/core-identity/src/api-keys.ts`,
  `packages/core-identity/src/rbac.ts`.
- Append-only Workroom timeline — `workroom_turns` and triggers
  (`0012_workrooms.sql`).
- Workroom evidence artifacts — `workroom_evidence_artifacts`
  (`0013_workroom_messages_tasks_evidence.sql`).
- Governed and passthrough provider surfaces — `apps/api/src/pipeline/run-orchestrator.ts`;
  `apps/api/src/routes/governed-anthropic.ts`, `governed-openai.ts`,
  `passthrough-anthropic.ts`, `passthrough-openai.ts`.
- Provider-native request/response hashes — `provider_invocations.native_request_hash`,
  `native_response_hash` (`0002_runs_and_invocations.sql`).
- `created_at`/`occurred_at` timestamps on all audit-anchored rows
  (`0001`, `0012`–`0015`).
- Crypto-shred for right-to-erasure of evidence payloads —
  `audit_event_payloads.status='crypto_shredded'`;
  `apps/api/src/routes/admin-audit-shred.ts`.

## Marco Civil mapping table

| Area | Source reference | Requirement / control objective | GovAI support | Status | Evidence | Gaps / next work |
|---|---|---|---|---|---|---|
| Privacy of user data (Art. 7 II, VIII) | BR-NET-01 | Maintain privacy and inviolability of user data and communications. | Envelope encryption of sensitive payloads, tenant isolation, RBAC, hard-deny floor. | PARTIAL | `audit_event_payloads.encrypted_payload`/`dek_wrapped`; `Kms.envelopeEncrypt`; RLS on every `govai.*` table; `0010_api_keys_roles.sql`; tests `audit-events-rls.test.ts`, `workroom-rls.test.ts`. | Customer-facing privacy posture report; data-subject-facing transparency surface. |
| Security of stored data (Art. 7 III) | BR-NET-01 | Apply security measures to stored data. | Envelope encryption at rest; HMAC-chained tamper-evident audit; append-only triggers; provider credentials envelope-encrypted. | COVERED | `0001_audit_chain.sql` (audit chain primitives); `Kms.envelopeEncrypt`; `0009_provider_credentials.sql`; `tests/integration/audit-canary.test.ts`; `tests/integration/append-only-defense.test.ts`; `tests/integration/provider-credentials-plaintext-leak.test.ts`. | Customer-facing chain verification UI; external anchoring (see `06-evidence-chain-custody.md`). |
| Records — application records (Art. 15) | BR-NET-01 | Where the customer is an internet application provider, retain application records under defined conditions. | GovAI captures governed-action records (`audit_events`, Workroom turns, evidence artifacts) but does not implement a Marco Civil retention engine. | PARTIAL | Recording primitives in `0001`, `0012`–`0015`. | Configurable retention policy; access-by-court-order workflow; per-record-type retention windows. |
| Integrity and traceability of records | BR-NET-01 Art. 7 III, Art. 15; BR-NET-05 | Preserve integrity and traceability of records. | HMAC chain, canonical bytes, append-only audit and timelines. | COVERED | `0001_audit_chain.sql`; `packages/core-audit/src/append.ts`; `verify.ts`; tests `audit-canary`, `canonical-reconstruction`, `verify-edge-cases`, `append-only-defense`. | Customer-facing integrity report. |
| Authenticated actor attribution | BR-NET-01 Art. 7 | Bind records to an authenticated actor. | API-key authentication; per-event `actor_user_id` (where present) and Workroom participant linkage. | COVERED | `0010_api_keys_roles.sql`; `packages/core-identity/src/api-keys.ts`; `audit_events.subject_id`/`redaction_metadata`; Workroom participant primitives. | Customer SSO/IdP integration. |
| Temporal ordering | BR-NET-01 Art. 7, Art. 15 | Provide a reliable order of events. | Per-chain `sequence_number` under per-chain advisory lock; `(workroom_id, turn_number)` UNIQUE; `created_at`/`occurred_at`. | COVERED | `0001_audit_chain.sql` (`UNIQUE(chain_id, sequence_number)`); `packages/core-audit/src/append.ts` (advisory lock); `0012_workrooms.sql` (`workroom_turns` UNIQUE); `tests/integration/workroom-turn-ordering.test.ts`. | External trusted timestamping; see `06-evidence-chain-custody.md`. |
| Metadata versus content | BR-NET-01 Art. 7, Art. 16 | Distinguish metadata from content and avoid exposing content unnecessarily. | Content is envelope-encrypted in `audit_event_payloads`; only hash + redaction metadata travel in `audit_events`; the audit query route returns hashes and redaction metadata, never ciphertext. | COVERED | `audit_events.payload_hash` + `redaction_metadata`; `audit_event_payloads` separation; `apps/api/src/routes/audit-events.ts` (no payload bytes in the response); `apps/api/src/routes/workroom-transcript.ts` (encrypted-at-rest message content). | Customer-controlled redaction policies; classification-aware redaction. |
| Right to deletion at content level | BR-NET-01 Art. 7 X; BR-DP-01 Art. 18 | Allow deletion of personal data when no retention basis applies. | Crypto-shred destroys the wrapped DEK so content becomes unrecoverable while the hash chain stays intact. | PARTIAL | `audit_event_payloads.status` (`active|crypto_shredded|tombstoned`); `apps/api/src/routes/admin-audit-shred.ts`. | DSR endpoints; retention/litigation hold engine; documented deletion runbook. |
| Access to records by judicial order (Art. 10) | BR-NET-01 | Make records available only via competent judicial order or as permitted by law. | Authenticated, RLS-scoped audit/Workroom queries; `auditor`/`admin` role gate on the Workroom audit subview. | PARTIAL | `0010_api_keys_roles.sql`; `apps/api/src/routes/audit-events.ts`; `apps/api/src/routes/workroom-transcript.ts` (audit subview role gate). | Court-order intake workflow; legal-hold integration; export-with-chain-context bundle. |
| Cross-border / third-party-provider considerations | BR-NET-01 | Be transparent and protective when data crosses borders or sits with third parties. | Provider invocations record `native_request_hash`/`native_response_hash`, `status_code`, latency; no cross-border or per-region transfer registry. | GAP | `provider_invocations` columns (`0002_runs_and_invocations.sql`). | Provider/region/legal-basis transfer registry; cross-border tagging on `provider_invocations`. |
| Provider/customer/GovAI shared responsibility | BR-NET-01 | Clear allocation of responsibility across actors. | Shared-responsibility model documented; native vs connector modes distinguished. | PARTIAL | `docs/architecture/regulatory/16-shared-responsibility-model.md`. | Per-connector responsibility cells (PR-D). |

## Boundary with evidence law

Marco Civil overlaps with civil-procedure evidence (BR-NET-05), but the
mapping here is not a court-admissibility opinion and does not assert any
specific evidentiary weight under the CPC. Detailed evidence-chain primitives
and the boundary with chain-of-custody are in `06-evidence-chain-custody.md`.

ICP-Brasil (BR-NET-03) and Lei 14.063/2020 (BR-NET-04) define signature
regimes that can uplift evidentiary strength. GovAI's `audit_events` schema
reserves an `evidence_strength` value for `icp_brasil_tsa`, but neither
ICP-Brasil signing nor RFC 3161 (BR-NET-06) timestamping is implemented today;
both are tracked as `GAP` in `06-evidence-chain-custody.md`.

ABNT NBR ISO/IEC 27037 and 27042 (BR-NET-07, BR-NET-08) are referenced at the
control-family level only. Their clause text is paywalled; this document does
not quote or paraphrase clause text.

## Connector implications

The Marco Civil mapping above applies to native GovAI usage. A future
connector framework must, for each connector, distinguish:

- provider-produced logs (provider-side controls and contracts);
- customer-granted access scopes (customer responsibility);
- GovAI-ingested evidence (ingestion fidelity, retention windows, API
  limitations);
- GovAI-normalized evidence (transformations the docs PR-D will detail);
- GovAI-independent audit anchoring (HMAC chain over the ingested view).

PR-B does not implement connectors. The connector compliance mapping is
PR-D's `13-connector-compliance-mapping.md`.

## Disclaimers

- This document is technical architecture mapping. It is not legal advice.
- GovAI does not guarantee compliance with Marco Civil for any particular
  customer or use case.
- GovAI does not guarantee judicial admissibility of any record.
- GovAI does not certify third-party providers.
- GovAI does not substitute legal counsel, DPO review, forensic experts, or
  any other qualified professional review.
- Marco Civil applicability and obligations are for qualified counsel to
  determine in the customer's specific context.

## Relationship to issue #59

Relates to #59.

Relates to #33.

Umbrella tracker #33 remains active.

#59 remains open for PR-C and PR-D.
