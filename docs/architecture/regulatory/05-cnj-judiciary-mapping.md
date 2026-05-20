# CNJ / Judiciary AI Governance Mapping

## Purpose

This document maps GovAI's implemented primitives against the technical
governance objectives associated with the Brazilian judiciary's AI rules.

It is technical architecture mapping. It is **not** legal advice, **not** a
court-admissibility opinion, and **not** a compliance certification. It does
not perform the professional work of a magistrate, court servant, perito,
auditor, lawyer, or DPO.

Status taxonomy is defined in `README.md`; the source register is
`15-source-register.md`; provider/customer/GovAI boundaries are in
`16-shared-responsibility-model.md`. Sensitive-data semantics are in
`07-sensitive-data-handling.md`.

## Scope and non-goals

- In scope: technical mapping of GovAI primitives against judiciary AI
  governance themes.
- Out of scope: implementation of court systems, model registries, public
  notice surfaces, CNIAJ-side reporting tooling, judicial-secrecy classifiers,
  DataJud / Sinapses / PJe / Justiça 4.0 connectors, and court-grade evidence
  exports. Those are tracked as gaps and addressed in later PRs.
- GovAI is not a court system. GovAI does not certify CNJ compliance.

## Sources

This mapping cites only sources recorded in `15-source-register.md`:

- **BR-JUD-01** — CNJ Resolução 332/2020 — historical/revoked. Used only as a
  contextual baseline.
- **BR-JUD-02** — CNJ Resolução 615/2025 — current judiciary AI governance
  baseline (CONFIRMED_PRIMARY_SOURCE).
- **BR-JUD-03** — CNJ Resolução 674/2026 — amendment to Resolução 615/2025
  (PARTIAL_PRIMARY_SOURCE; the CNJ atos detail URL and the exact amended
  article remain to be verified before downstream judiciary mapping treats
  this source as fully verified).
- **BR-JUD-05** — Comitê Nacional de Inteligência Artificial do Judiciário
  (CNIAJ).
- **BR-JUD-06** — DataJud, Codex, Sinapses, PJe, Justiça 4.0 — judiciary AI
  ecosystem references (PARTIAL_PRIMARY_SOURCE; exact roles to be confirmed
  against CNJ primary sources before each program is cited as authoritative).
- **BR-DP-01** — LGPD, Lei 13.709/2018 — used where data-protection alignment
  intersects judiciary handling.
- **BR-NET-05** — CPC, Lei 13.105/2015 — used only for technical mapping; not
  for procedural legal conclusions.

## Source verification notes

- CNJ Resolução 332/2020 is treated as historical/revoked, not current law.
- CNJ Resolução 615/2025 is the current judiciary AI baseline; rows that
  reference 615/2025 are mapped against that source.
- CNJ Resolução 674/2026 remains PARTIAL until the CNJ atos detail URL and the
  exact amended article are confirmed.
- The judiciary AI ecosystem programs (DataJud, Codex, Sinapses, PJe, Justiça
  4.0) remain PARTIAL until each program is independently verified against a
  CNJ primary source.

## Judiciary AI baseline

CNJ Resolução 615/2025 establishes risk-classification, mandatory periodic
audits, generative-AI rules, human supervision, transparency, privacy by
design and by default, impact assessments, and the CNIAJ. CNJ Resolução
674/2026 amends 615/2025 (amendment scope tracked as PARTIAL in the source
register). The mapping below uses 615/2025 as the current authoritative
baseline.

## GovAI primitives considered

Each primitive cited is implemented in the repository:

- HMAC-chained audit events — `apps/api/src/db/migrations/0001_audit_chain.sql`
  (`govai.audit_events`); `packages/core-audit/src/append.ts` (`auditAppend`);
  `packages/core-audit/src/verify.ts`; covered by
  `tests/integration/audit-canary.test.ts`,
  `tests/integration/canonical-reconstruction.test.ts`,
  `tests/integration/verify-edge-cases.test.ts`.
- Append-only triggers — `audit_events`, `workroom_turns`,
  `workroom_messages`, `workroom_approval_decisions` (`0001`, `0012`–`0015`);
  covered by `tests/integration/append-only-defense.test.ts`.
- Envelope encryption — `audit_event_payloads.encrypted_payload` +
  `dek_wrapped`; `packages/core-identity/src/kms/index.ts` (`Kms.envelopeEncrypt`,
  AES-256-GCM).
- Tenant isolation — RLS `ENABLE + FORCE` on every `govai.*` table; scoped by
  `current_setting('app.org_id')`; covered by
  `tests/integration/audit-events-rls.test.ts`,
  `tests/integration/workroom-rls.test.ts`.
- AuthIdentity / RBAC — `0010_api_keys_roles.sql`;
  `packages/core-identity/src/api-keys.ts`,
  `packages/core-identity/src/rbac.ts` (`hasAnyRole`).
- Capability hard-deny floor — `apps/api/src/pipeline/capability-resolution.ts`
  (`assertCapabilityExecutable` rejects `status='blocked'`); preserved across
  the Workroom approval path by `tests/integration/workroom-approvals-runs.test.ts`.
- Workroom container — `0012_workrooms.sql` (immutable `governance_mode`;
  participants with judicial-relevant roles `human_owner`, `human_approver`,
  `human_reviewer`, `dpo_reviewer`, `auditor_agent`); `0013` (encrypted
  message payloads); `0014` (Workroom-owned runs); `0015` (approval requests
  and decisions).
- Approval loop with separation-of-duties — `0015_workroom_approvals.sql`
  (`workroom_approval_decisions_sod_trg`, `consumed_run_id` one-time use,
  `intended_action_hash`); `apps/api/src/routes/workroom-approvals.ts`;
  `apps/api/src/pipeline/run-orchestrator.ts` (`validateApprovalForRun`).
- Workroom audit subview — `apps/api/src/routes/workroom-transcript.ts`;
  `auditor` / `admin` role gate; covered by
  `tests/integration/workroom-audit-subview.test.ts`.
- Crypto-shred — `audit_event_payloads.status` values `active`,
  `crypto_shredded`, and `tombstoned`; `apps/api/src/routes/admin-audit-shred.ts`.

## CNJ / judiciary mapping table

| Area | Source reference | Requirement / control objective | GovAI support | Status | Evidence | Gaps / next work |
|---|---|---|---|---|---|---|
| Historical baseline | BR-JUD-01 | CNJ Resolução 332/2020 set an initial AI-in-Judiciary baseline. | Historical context only; no implementation tied to a revoked instrument. | GAP | None — instrument is historical/revoked. | None at primitive level; informs the migration story to 615/2025. |
| Current judiciary AI governance baseline | BR-JUD-02 | CNJ Resolução 615/2025 governs AI development, use, governance, audits, risk classification, generative-AI rules, transparency, human supervision, privacy by design and by default, and the CNIAJ. | Generic GovAI primitives partially support several control objectives below; no judiciary-specific implementation. | PARTIAL | Generic primitives cited per-row below. | A judiciary-specific posture document tracked as future work. |
| CNJ Resolução 674/2026 amendment tracking | BR-JUD-03 | Track the amendment relationship to Resolução 615/2025. | No implementation; source remains PARTIAL until detail URL and exact amended article are verified. | NEEDS_SOURCE_VERIFICATION | Source-register note in `15-source-register.md` for BR-JUD-03. | Confirm CNJ atos detail URL and exact amended article; reconcile with 615/2025 in PR-D follow-ups. |
| AI governance and accountability program | BR-JUD-02 | Maintain an AI governance program with documented evidence. | Workroom governance container, immutable governance mode, approval primitives, and the existing audit chain provide evidence material. | PARTIAL | `0012_workrooms.sql` (`workrooms.governance_mode` immutable); `0015_workroom_approvals.sql`; `apps/api/src/routes/workroom-transcript.ts` audit subview. | Judiciary-specific governance attestation surface; CNIAJ-style reporting. |
| Risk classification | BR-JUD-02 | Classify AI systems by risk and apply proportional controls. | No AI-system risk registry or risk-based policy engine. | GAP | None. | Risk registry; risk-class policy ceiling; auditable risk reviews. |
| Human supervision and human review | BR-JUD-02 | Ensure human supervision proportional to risk. | Approval / HITL primitives exist; `governance_active` mode forces governed runs; passthrough override requires a human-approved one-time-use approval. | PARTIAL | `0012`–`0015` migrations; `apps/api/src/pipeline/run-orchestrator.ts`; `apps/api/src/routes/workroom-approvals.ts`; `tests/integration/workroom-approvals.test.ts`, `tests/integration/workroom-approvals-runs.test.ts`. | Judiciary-grade reviewer workflow; structured magistrate-facing review surface. |
| Generative AI and LLM use | BR-JUD-02 | Treat generative-AI use as decision-support, not decision-substitution; record provenance. | Provider-native invocations are hash-bound; native and passthrough surfaces record request and response hashes. | PARTIAL | `0002_runs_and_invocations.sql` (`provider_invocations.native_request_hash`, `native_response_hash`); `apps/api/src/pipeline/run-orchestrator.ts`; `tests/integration/governed-run-e2e.test.ts`, `tests/integration/runs-passthrough-mode.test.ts`. | GenAI-specific evidence bundle, model registry tagging, and per-action audit subview. |
| Transparency and public notice | BR-JUD-02 | Provide public-facing transparency where required. | No data-subject- or public-facing transparency surface today. | GAP | None. | Public-notice surface; transparency report generation. |
| Auditability and traceability | BR-JUD-02 | Provide tamper-evident logs and traceable actions. | HMAC chain over canonical bytes; append-only triggers; per-chain advisory lock; Workroom turns anchored to real audit events. | COVERED | `0001_audit_chain.sql`; `packages/core-audit/src/append.ts`; `verify.ts`; tests `audit-canary`, `canonical-reconstruction`, `verify-edge-cases`, `append-only-defense`; `0012`–`0015` migrations (Workroom turns). | Customer-facing chain verification surface and judiciary-grade evidence export. |
| Append-only timeline integrity | BR-JUD-02 | Prevent retroactive tampering of governance records. | Triggers reject UPDATE/DELETE/TRUNCATE on `audit_events`, `workroom_turns`, `workroom_messages`, and `workroom_approval_decisions`. | COVERED | `0001`, `0012`–`0015` migrations; `tests/integration/append-only-defense.test.ts`; `tests/integration/workroom-turn-ordering.test.ts`. | None at primitive level. |
| Privacy by design and by default | BR-JUD-02; BR-DP-01 | Apply RLS, encryption, hard-deny, and proportional friction by default. | RLS + envelope encryption at rest + capability hard-deny + approval-by-exception are baseline. | PARTIAL | RLS on every `govai.*` table; `Kms.envelopeEncrypt`; capability-block enforcement; approval-by-exception. | Customer-facing privacy-by-design posture document; sensitive-category-aware controls. |
| Data protection and LGPD alignment | BR-DP-01 | Align AI use with LGPD obligations. | LGPD/ANPD mapping in `01-lgpd-anpd-mapping.md`; encryption, RLS, audit primitives apply. | PARTIAL | See `01-lgpd-anpd-mapping.md`. | DSR endpoints; legal-basis registry; RIPD; incident workflow. |
| Judicial secrecy and segredo de justiça | BR-JUD-02; BR-NET-05; BR-DP-01 | Apply heightened protection to records subject to judicial secrecy. | Envelope encryption applies uniformly to evidence payloads; no judicial-secrecy classifier or matter-isolation tag. | GAP | Envelope encryption primitives are uniform, not segredo-aware. | Judicial-secrecy classifier; matter-level isolation tag; secrecy-aware access control. |
| Sensitive data in judicial context | BR-DP-01; BR-NET-05 | Handle sensitive personal data appropriately in judicial AI flows. | Generic primitives only; see `07-sensitive-data-handling.md`. | PARTIAL | See `07-sensitive-data-handling.md`. | Category-aware classifier, judiciary-specific sensitive-data catalog. |
| Bias and non-discrimination | BR-JUD-02 | Detect and mitigate bias risks in judicial AI. | No bias-evaluation tooling in the platform. | GAP | None. | Bias evaluation, monitoring, and reporting surfaces. |
| Due process and explainability | BR-JUD-02 | Support due process and explainability for AI-assisted decisions. | Approval and audit primitives record decisions and provenance; no model-level explanation generation. | PARTIAL | `0015_workroom_approvals.sql`; `apps/api/src/routes/workroom-approvals.ts`. | Explanation generation; structured rationale capture aligned with judicial process. |
| Adversarial event and incident tracking | BR-JUD-02; BR-DP-02 | Track and report adversarial or incident events. | Audit chain captures governed-action events; no AI-specific incident workflow. | PARTIAL | `0001_audit_chain.sql`; `apps/api/src/routes/audit-events.ts`. | AI-specific incident workflow, severity model, CNIAJ-format routing where applicable. |
| AI model and system registry | BR-JUD-02 | Maintain a registry of deployed AI systems with attributes and governance. | No model registry feature. | GAP | None. | Model registry with risk class, owner, version, audit links. |
| CNIAJ governance interface | BR-JUD-02; BR-JUD-05 | Interface with CNIAJ governance processes. | No CNIAJ-facing report or submission feature. | GAP | None. | CNIAJ-format reports and submission workflow once CNIAJ procedures are sourced. |
| DataJud, Sinapses, PJe, Justiça 4.0 evidence ingestion readiness | BR-JUD-06 | Be ready to consume judiciary-ecosystem evidence. | No connector implemented; programs treated as PARTIAL in the source register until each is independently verified. | GAP | None. | Per-program evidence ingestion; provenance tagging; aligns with PR-D `13-connector-compliance-mapping.md`. |
| External evidence bundle and court export readiness | BR-JUD-02; BR-NET-05 | Produce legal-grade evidence bundles suitable for court review. | No consolidated court-grade evidence bundle today. | GAP | None. | Legal-grade evidence bundle, ICP-Brasil signature uplift, RFC 3161 timestamping; see `06-evidence-chain-custody.md`. |

## Judiciary-specific sensitive-data and secrecy considerations

- Judicial-secrecy content and matter-isolation tagging are not implemented;
  encryption-at-rest is uniform across payloads. Treat secrecy-aware
  classification as `GAP` until implemented.
- Personal and sensitive personal data in judicial AI flows inherit
  `07-sensitive-data-handling.md` posture; the bulk of category-aware
  classification is `GAP` today.
- Court-facing exports must preserve confidentiality boundaries; current
  exports are limited to authenticated, RLS-scoped audit and Workroom queries
  documented in `01-lgpd-anpd-mapping.md` and `04-marco-civil-mapping.md`.

## Generative AI and LLM considerations

- Generative-AI use is recorded through real provider invocations on the
  governed and passthrough surfaces; request and response hashes are stored
  in `provider_invocations` (`0002_runs_and_invocations.sql`).
- Approval requests carry an `intended_action_hash` that binds an approval to
  the exact run parameters; one-time-use consumption prevents replay.
- Generative-AI-specific evidence bundles (model identity, prompt provenance,
  output redaction, decision rationale) are not implemented; tracked as future
  work alongside the model registry.

## Gaps and follow-up work

The judiciary-specific gaps recorded above include risk classification, public
notice, judicial-secrecy classifier, model registry, CNIAJ-facing reporting,
DataJud / Sinapses / PJe / Justiça 4.0 evidence ingestion, GenAI-specific
evidence bundle, bias evaluation, and court-grade evidence export. These are
named honestly; they are not implementation commitments here. The PR-D gap
register will consolidate them with other regulatory gaps.

## Disclaimers

- This document is technical architecture mapping. It is not legal advice.
- GovAI is not a court system.
- GovAI does not certify CNJ compliance.
- GovAI does not replace magistrates, judicial servants, or any judicial
  professional.
- GovAI does not guarantee judicial validity of any record.
- GovAI does not make evidence automatically admissible in court.
- GovAI does not guarantee LGPD compliance.
- GovAI does not substitute legal counsel, DPO review, auditors, compliance
  officers, or forensic experts.
- Compliance outcomes depend on customer configuration, contracts,
  organizational processes, legal bases, applicable sector rules, and
  qualified professional review.

## Relationship to issue #59

Relates to #59.

Relates to #33.

Umbrella tracker #33 remains active.

#59 remains open for PR-D.
