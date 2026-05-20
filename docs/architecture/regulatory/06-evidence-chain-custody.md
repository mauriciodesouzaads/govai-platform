# Evidence Chain and Chain of Custody

## Purpose

This document maps GovAI's evidence primitives — what is implemented, with
which constraints, and what is missing — against the technical objectives
typically associated with evidence integrity and chain of custody.

It is technical evidence architecture mapping. It is **not** legal advice,
**not** a forensic certification, and **not** a guarantee of judicial
admissibility. It does not perform the professional work of a perito,
auditor, lawyer, or DPO.

Status taxonomy is defined in `README.md`; the source register is
`15-source-register.md`; provider/customer/GovAI boundaries are in
`16-shared-responsibility-model.md`.

## Sources

This mapping cites only sources recorded in `15-source-register.md`:

- **BR-DP-01** — LGPD, Lei 13.709/2018 (CONFIRMED_PRIMARY_SOURCE) — used where
  data-protection evidence and retention intersect with chain handling.
- **BR-NET-02** — Lei 11.419/2006, electronic judicial process
  (CONFIRMED_PRIMARY_SOURCE) — referenced for electronic-record context.
- **BR-NET-03** — MP 2.200-2/2001, ICP-Brasil
  (CONFIRMED_PRIMARY_SOURCE) — referenced for evidentiary uplift via
  ICP-Brasil signature.
- **BR-NET-04** — Lei 14.063/2020, electronic signatures
  (CONFIRMED_PRIMARY_SOURCE) — referenced for signature regimes.
- **BR-NET-05** — CPC, Lei 13.105/2015, civil-procedure evidence framework
  (CONFIRMED_PRIMARY_SOURCE) — used only for technical mapping; not for
  procedural legal conclusions.
- **BR-NET-06** — RFC 3161 trusted timestamping
  (CONFIRMED_PRIMARY_SOURCE) — referenced for external timestamping.
- **BR-NET-07** — ABNT NBR ISO/IEC 27037 (PAYWALLED_LIMITED_DETAIL).
- **BR-NET-08** — ABNT NBR ISO/IEC 27042 (PAYWALLED_LIMITED_DETAIL).

ABNT/ISO standards are referenced at the control-family level only. Clause
text is paywalled and is not quoted or fabricated.

## Evidence primitives in GovAI

Each primitive below is implemented in the repository:

- **Append-only HMAC-chained audit events** — `apps/api/src/db/migrations/0001_audit_chain.sql`
  (table `govai.audit_events` with `previous_hmac`, `hmac`, `sequence_number`,
  `canonical_hash`, `canonical_bytes`, `key_id`, `key_version`,
  `evidence_strength`). Append-only enforced by triggers and by
  `audit_append_locked` plus an `INSERT`-only grant.
- **Canonical serialization** — `packages/core-audit/src/canonical-json.ts`
  (sorted-key canonical JSON used as the HMAC input).
- **HMAC under a KMS-derived key** — `packages/core-audit/src/hmac.ts`
  driving `auditAppend` in `packages/core-audit/src/append.ts`; key derived
  through `Kms.deriveKey` (`packages/core-identity/src/kms/index.ts`,
  `KmsPurpose='audit_hmac'`).
- **Per-chain serialization** — per-chain advisory `xact` lock in
  `audit_append_locked` (`0001_audit_chain.sql`) plus `UNIQUE(chain_id,
  sequence_number)`.
- **Independent chain verification** — `packages/core-audit/src/verify.ts`;
  covered by `tests/integration/audit-canary.test.ts`,
  `tests/integration/canonical-reconstruction.test.ts`,
  `tests/integration/verify-edge-cases.test.ts`.
- **Append-only defense** — DB triggers blocking UPDATE/DELETE/TRUNCATE on
  `audit_events`, `workroom_turns`, `workroom_messages`, and
  `workroom_approval_decisions`; covered by
  `tests/integration/append-only-defense.test.ts`.
- **Envelope encryption at rest** —
  `audit_event_payloads.encrypted_payload` and `dek_wrapped` in
  `0001_audit_chain.sql`, written through
  `Kms.envelopeEncrypt` (AES-256-GCM, wrapped DEK,
  `packages/core-identity/src/kms/index.ts`).
- **Wrapped DEK lifecycle / crypto-shred** —
  `audit_event_payloads.status` (`active|crypto_shredded|tombstoned`) and
  `apps/api/src/routes/admin-audit-shred.ts`.
- **Redaction metadata** — `audit_events.redaction_metadata` (`jsonb`) is the
  safe-metadata surface; ciphertext never travels in event records.
- **Actor identity** — `0010_api_keys_roles.sql`,
  `packages/core-identity/src/api-keys.ts`,
  `packages/core-identity/src/rbac.ts`; participant binding through
  `workroom_participants.actor_participant_id`.
- **Tenant isolation** — RLS `ENABLE + FORCE` on every `govai.*` table,
  scoped by `current_setting('app.org_id')` via `packages/core-tenant`;
  covered by `tests/integration/audit-events-rls.test.ts` and
  `tests/integration/workroom-rls.test.ts`.
- **Workroom timeline** — `workroom_turns` rows anchored to a real
  `audit_event_id` (`0012`–`0015`); append-only.
- **Workroom evidence artifacts** — `workroom_evidence_artifacts` linking
  each artifact to a `workroom_turn_id`, `audit_event_id`, and
  `payload_ref → audit_event_payloads.id` (`0013`).
- **Approval evidence (Phase 4)** — `workroom_approval_requests` with
  `intended_action_hash` (sha256 of the canonical intended action),
  `intended_action_payload_id → audit_event_payloads.id`, `consumed_run_id`
  one-time binding; `workroom_approval_decisions` append-only with a
  separation-of-duties trigger (`0015`).
- **Provider invocation hashes** — `provider_invocations.native_request_hash`,
  `native_response_hash` (`0002_runs_and_invocations.sql`).
- **CI / test evidence** — the suites listed above plus
  `tests/integration/governed-run-e2e.test.ts`,
  `tests/integration/runs-passthrough-mode.test.ts`,
  `tests/integration/workroom-audit-subview.test.ts`,
  `tests/integration/workroom-approvals.test.ts`,
  `tests/integration/workroom-approvals-runs.test.ts`.

## Evidence mapping table

| Evidence objective | Source reference | GovAI support | Status | Implementation evidence | Limitations / next work |
|---|---|---|---|---|---|
| Integrity of recorded events | BR-NET-05; BR-NET-07/08 | HMAC chain over canonical bytes; `previous_hmac → hmac`; canonical hash stored. | COVERED | `0001_audit_chain.sql`; `packages/core-audit/src/append.ts`; `verify.ts`; `audit-canary`, `canonical-reconstruction`, `verify-edge-cases` tests. | Customer-facing chain verification UI; external anchoring not yet implemented. |
| Tamper evidence | BR-NET-05; BR-NET-07/08 | Append-only triggers reject UPDATE/DELETE/TRUNCATE; chain breaks if any event is mutated. | COVERED | `0001_audit_chain.sql`; `0012`–`0015` migrations (audit-table triggers); `tests/integration/append-only-defense.test.ts`. | None at the primitive level. |
| Temporal ordering | BR-NET-05 | Per-chain `sequence_number` under advisory `xact` lock; per-Workroom `turn_number` UNIQUE under advisory `xact` lock; `occurred_at`/`created_at`. | COVERED | `0001_audit_chain.sql`; `0012_workrooms.sql` (`workroom_turns` UNIQUE); `packages/core-audit/src/append.ts`; `tests/integration/workroom-turn-ordering.test.ts`. | External (signed) timestamping is `GAP` (next rows). |
| Actor attribution | BR-NET-05; BR-DP-01 Art. 46 | Authenticated API keys with roles; Workroom participant identity bound to events. | COVERED | `0010_api_keys_roles.sql`; `packages/core-identity/src/api-keys.ts`; `packages/core-identity/src/rbac.ts`; Workroom participant primitives in `0012`. | Customer SSO/IdP integration; per-customer key-rotation policy. |
| Confidentiality of evidence | BR-DP-01 Art. 46 | Envelope encryption (AES-256-GCM + wrapped DEK) of sensitive payloads. | COVERED | `0001_audit_chain.sql` (`audit_event_payloads`); `packages/core-identity/src/kms/index.ts` (`Kms.envelopeEncrypt`); `0009_provider_credentials.sql`; `tests/integration/provider-credentials-plaintext-leak.test.ts`. | Customer-managed-key (CMK / BYOK) options; HSM production hardening. |
| Tenant isolation | BR-DP-01 Art. 46 | RLS `ENABLE + FORCE` on every `govai.*` table; per-command per-role policies; `current_setting('app.org_id')`. | COVERED | Every migration `0001`, `0012`–`0015`; `packages/core-tenant`; `tests/integration/audit-events-rls.test.ts`; `tests/integration/workroom-rls.test.ts`. | Cross-tenant penetration tests. |
| Redaction / minimization on the chain | BR-DP-01 Art. 46, Art. 6 | Only `payload_hash` and `redaction_metadata` travel in `audit_events`; ciphertext is in `audit_event_payloads`. | COVERED | `0001_audit_chain.sql`; `apps/api/src/routes/audit-events.ts` (response shape excludes payload bytes); `apps/api/src/routes/workroom-transcript.ts` (encrypted message content). | Customer-controlled redaction policies; classification-aware redaction. |
| Provider-native request/response binding | BR-NET-05 | `provider_invocations.native_request_hash`, `native_response_hash`. | COVERED | `0002_runs_and_invocations.sql`; `apps/api/src/pipeline/run-orchestrator.ts`; `tests/integration/governed-run-e2e.test.ts`, `runs-passthrough-mode.test.ts`. | None at primitive level. |
| Approval evidence — parameter binding | BR-DP-01 Art. 50 | `intended_action_hash` (sha256 of canonical intended action) binds an approval to exact run parameters; one-time consumption via `consumed_run_id`. | COVERED | `0015_workroom_approvals.sql`; `apps/api/src/pipeline/run-orchestrator.ts` (`intendedActionHash`, `validateApprovalForRun`); `tests/integration/workroom-approvals-runs.test.ts`. | None at primitive level. |
| Separation of duties on approvals | BR-DP-01 Art. 50 | Decider must not be the requester; DB trigger backstops the route check. | COVERED | `0015_workroom_approvals.sql` (`workroom_approval_decisions_sod_trg`); `tests/integration/workroom-approvals.test.ts`. | Multi-approver flows tracked outside this PR. |
| Workroom evidence anchoring | BR-DP-01 Art. 50 | Every Workroom event is anchored to a real `audit_event_id`; evidence artifacts also carry `payload_ref → audit_event_payloads.id`. | COVERED | `0012`–`0015`; `apps/api/src/routes/workroom-transcript.ts` (audit subview); `tests/integration/workroom-audit-subview.test.ts`. | Customer-facing evidence bundle pending (see below). |
| Chain continuity across categories | BR-DP-01 Art. 50; BR-NET-05 | `ChainCategory` is fixed at `auth`, `run`, `policy`, and `admin`; no new audit chain is created by later phases. | COVERED | `packages/core-events/src/index.ts` (`ChainCategory`, `chainIdFor`); Workroom and approval events on existing categories. | None at primitive level. |
| Right-to-erasure mechanics (Art. 18 LGPD) | BR-DP-01 | Crypto-shred destroys the wrapped DEK so payload becomes unrecoverable while the hash chain remains intact. | PARTIAL | `audit_event_payloads.status='crypto_shredded'` (`0001_audit_chain.sql`); `apps/api/src/routes/admin-audit-shred.ts`. | DSR endpoints; documented operator runbook; retention-aware deletion. |
| Evidence export and bundles | BR-NET-05; BR-NET-07/08 | `GET /v1/audit-events` and `GET /v1/workrooms/{id}/audit` return chain rows; there is no consolidated, source-referenced, professional-grade evidence bundle. | PARTIAL | `apps/api/src/routes/audit-events.ts`; `apps/api/src/routes/workroom-transcript.ts`. | Legal-grade evidence bundle / PDF / PDF-A; date-range and per-subject scoping. |
| External trusted timestamping (RFC 3161) | BR-NET-06 | Schema reserves `evidence_strength='icp_brasil_tsa'`; no TSA integration is implemented. | GAP | `audit_events.evidence_strength` CHECK in `0001_audit_chain.sql` (value reserved only). | RFC 3161 TSA integration; provider selection; key management. |
| ICP-Brasil signature uplift | BR-NET-03; BR-NET-04 | Schema reserves `customer_signed` and `icp_brasil_tsa` as `evidence_strength`; no signing integration. | GAP | `audit_events.evidence_strength` CHECK (reserved values only). | ICP-Brasil A1/A3 signing integration; signature verification surface. |
| External anchoring | BR-NET-05 | Schema reserves `external_anchor`; not implemented. | GAP | `audit_events.evidence_strength` CHECK (reserved value only). | Transparency log / blockchain / TSA-anchored chain head. |
| Retention and litigation hold | BR-DP-01 Art. 16; BR-NET-01 | Per-record retention is currently uniform append-only; no retention policy engine, no litigation hold. | GAP | None. | Retention policy + litigation hold engine; per-tenant retention windows. |
| Forensic interpretation | BR-NET-05; BR-NET-07/08 | GovAI provides verifiable technical evidence; interpretation is the professional responsibility of qualified experts and is intentionally not a GovAI product feature. | GAP | No in-product forensic-conclusion features; framed as a designed-out responsibility, not a missing capability. | Continue to defer to qualified experts; never implement automatic forensic conclusions. |
| Connector evidence provenance | BR-NET-01 Art. 7; BR-DP-01 Art. 46 | Native primitives only; no third-party connector implemented yet. | GAP | None. | Per-connector provenance, retention windows, API limitations; defined in PR-D `13-connector-compliance-mapping.md`. |

## Chain-of-custody boundaries

- GovAI can generate tamper-evident technical records, with verifiable
  integrity, encryption at rest, attribution, and ordering.
- Chain of custody, as a concept, is broader: it includes operational
  process, access control, retention, export, custody transfer, professional
  review, and the legal context the records are used in.
- GovAI does not guarantee judicial admissibility of any record.
- GovAI does not replace forensic experts. Where forensic conclusions are
  required, qualified peritos must perform that work.

## Native versus connector evidence

The boundary between native and connector evidence is defined in
`16-shared-responsibility-model.md`. In summary:

- **Native evidence** — generated by GovAI when AI usage is on GovAI's
  governed or passthrough surfaces. GovAI controls fidelity end-to-end.
- **Provider-generated evidence (connector mode)** — produced by a
  third-party platform. Fidelity, retention, and field availability depend on
  that platform.
- **Normalized evidence** — provider evidence transformed into a consistent
  GovAI representation; transformations and limitations will be detailed in
  the connector compliance mapping (PR-D).
- **Independent GovAI anchoring** — GovAI's HMAC chain over its own view of
  ingested evidence; anchors but does not change the third-party record.

## Missing capabilities

Honest gaps to be addressed in later docs and product PRs:

- Legal-grade evidence bundle and chain-of-custody report (consolidated,
  source-referenced output for professional review).
- RFC 3161 external trusted timestamping integration.
- ICP-Brasil signature uplift (A1/A3) for signed evidence.
- External anchoring (transparency log / TSA-anchored chain head).
- Retention and litigation hold engine.
- DSR endpoints aligned with crypto-shred.
- Connector evidence ingestion and provenance verification.
- PDF / PDF-A forensic-grade report generation.

## Disclaimers

- This document is technical evidence architecture mapping. It is not legal
  advice and not a forensic certification.
- GovAI does not guarantee judicial admissibility of any record.
- GovAI does not guarantee compliance with any specific legal or regulatory
  obligation.
- GovAI does not substitute legal counsel, DPO review, auditors, compliance
  officers, or forensic experts.
- Evidence admissibility, weight, and chain-of-custody integrity in any
  proceeding depend on qualified professional review, the specific legal
  context, and the customer's operational discipline.

## Relationship to issue #59

Relates to #59.

Relates to #33.

Umbrella tracker #33 remains active.

#59 remains open for PR-C and PR-D.
