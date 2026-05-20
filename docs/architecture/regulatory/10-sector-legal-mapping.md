# Legal Sector Regulatory Profile

## Purpose

This document maps GovAI's implemented primitives against the technical
control objectives associated with the Brazilian legal sector's ethics,
professional-secrecy, and AI-assisted-practice expectations.

It is technical architecture mapping. It is **not** legal advice. GovAI does
not practice law. It does not perform the professional work of lawyers,
paralegals, peritos, magistrates, or any other legal professional.

Status taxonomy is defined in `README.md`; the source register is
`15-source-register.md`; provider/customer/GovAI boundaries are in
`16-shared-responsibility-model.md`. Evidence-chain primitives are in
`06-evidence-chain-custody.md`; sensitive-data semantics are in
`07-sensitive-data-handling.md`. Judiciary AI mapping is in
`05-cnj-judiciary-mapping.md`.

## Scope and non-goals

- In scope: technical mapping of GovAI primitives against legal-sector
  ethics, professional-secrecy, and AI-assisted-practice themes.
- Out of scope: implementation of privilege-aware classifiers,
  judicial-secrecy classifiers, matter-level legal hold, conflict-of-interest
  checks, court evidence export, legal-sector-specific consent workflow, and
  any feature that would substitute legal judgment.
- GovAI does not provide legal advice. GovAI does not determine privilege.
- The reference treatment of any pending AI bill belongs to PR-D.

## Sources

This mapping cites only sources recorded in `15-source-register.md`:

- **BR-SEC-08** — Recomendação CFOAB nº 001/2024 (CONFIRMED_PRIMARY_SOURCE).
- **BR-SEC-09** — Estatuto da Advocacia (Lei 8.906/1994) and Código de Ética
  e Disciplina da OAB (PARTIAL_PRIMARY_SOURCE).
- **BR-NET-05** — CPC, Lei 13.105/2015 (CONFIRMED_PRIMARY_SOURCE) — used only
  for technical mapping; not for procedural legal conclusions.
- **BR-DP-01** — LGPD, Lei 13.709/2018 (CONFIRMED_PRIMARY_SOURCE) — used where
  data-protection obligations intersect.
- **BR-JUD-02** — CNJ Resolução 615/2025 (CONFIRMED_PRIMARY_SOURCE) — used
  where judicial-secrecy and judiciary AI mapping overlap.

CFOAB Recomendação nº 001/2024 is a recommendation (soft-law guidance);
binding professional obligations are anchored in the Estatuto da Advocacia
and the Código de Ética e Disciplina.

## Legal-sector context

CFOAB Recomendação nº 001/2024 sets ethical guidance for the use of
generative AI in legal practice across four areas: applicable legislation,
confidentiality and privacy, ethical practice, and client communication.
Binding obligations on advocates flow from the Estatuto da Advocacia and the
Código de Ética e Disciplina; applicability and interpretation are for
qualified counsel.

This mapping describes only what GovAI's primitives provide technically. It
does not claim a particular customer's practice satisfies any particular OAB
obligation.

## GovAI primitives considered

Each primitive cited is implemented in the repository:

- HMAC-chained audit events, append-only triggers, canonical bytes — `0001_audit_chain.sql`;
  `packages/core-audit/src/append.ts`; `packages/core-audit/src/verify.ts`;
  tests `audit-canary`, `canonical-reconstruction`, `verify-edge-cases`,
  `append-only-defense`.
- Envelope encryption at rest — `audit_event_payloads.encrypted_payload` plus
  `dek_wrapped`; `packages/core-identity/src/kms/index.ts`
  (`Kms.envelopeEncrypt`, AES-256-GCM).
- Crypto-shred — `audit_event_payloads.status` values `active`,
  `crypto_shredded`, and `tombstoned`; `apps/api/src/routes/admin-audit-shred.ts`.
- Tenant isolation — RLS `ENABLE + FORCE` on every `govai.*` table; scoped by
  `current_setting('app.org_id')`; covered by
  `tests/integration/audit-events-rls.test.ts`,
  `tests/integration/workroom-rls.test.ts`.
- AuthIdentity / RBAC — `0010_api_keys_roles.sql`;
  `packages/core-identity/src/api-keys.ts`,
  `packages/core-identity/src/rbac.ts` (`hasAnyRole`).
- Capability admission and hard-deny floor — `apps/api/src/pipeline/capability-resolution.ts`
  (`assertCapabilityExecutable` rejects `status='blocked'`); preserved by
  `tests/integration/workroom-approvals-runs.test.ts`.
- Workroom container with reviewer/auditor roles — `0012_workrooms.sql`
  (`workroom_participants` with `human_reviewer`, `auditor_agent`,
  `dpo_reviewer`, `human_owner`, `human_approver`).
- Workroom encrypted message content — `0013_workroom_messages_tasks_evidence.sql`
  (`workroom_messages.content_ref` to `audit_event_payloads`).
- Workroom audit subview — `apps/api/src/routes/workroom-transcript.ts`
  (`auditor` / `admin` role gate); covered by
  `tests/integration/workroom-audit-subview.test.ts`.
- Approval loop with separation-of-duties and one-time-use — `0015_workroom_approvals.sql`
  (`workroom_approval_decisions_sod_trg`, `consumed_run_id`,
  `intended_action_hash`); `apps/api/src/routes/workroom-approvals.ts`;
  `apps/api/src/pipeline/run-orchestrator.ts` (`validateApprovalForRun`).

## Legal-sector mapping table

| Area | Source reference | Requirement / control objective | GovAI support | Status | Evidence | Gaps / next work |
|---|---|---|---|---|---|---|
| Professional secrecy | BR-SEC-09 | Preserve professional secrecy of client information. | Envelope encryption; tenant isolation; capability hard-deny; encrypted Workroom message content. | PARTIAL | `Kms.envelopeEncrypt`; RLS on every `govai.*` table; `apps/api/src/pipeline/capability-resolution.ts`; `0013_workroom_messages_tasks_evidence.sql` (encrypted `content_ref`). | Privilege/secrecy-aware classifier; matter-level isolation tag. |
| Attorney-client privileged content | BR-SEC-09; BR-SEC-08 | Apply heightened handling to privileged content. | No privilege classifier; uniform encryption applies. | GAP | `Kms.envelopeEncrypt`; `audit_event_payloads`. | Privilege-aware classifier; documented privilege-handling runbook. |
| Judicial secrecy and segredo de justiça | BR-NET-05; BR-JUD-02 | Apply heightened handling to records subject to judicial secrecy. | No judicial-secrecy classifier; uniform encryption applies. | GAP | `Kms.envelopeEncrypt`; cross-reference `05-cnj-judiciary-mapping.md`. | Judicial-secrecy classifier; matter-level isolation tag; secrecy-aware access control. |
| Human lawyer responsibility | BR-SEC-08; BR-SEC-09 | Lawyers retain final responsibility for legal work. | Approval and audit primitives record authenticated decisions; the platform does not substitute lawyer judgment. | PARTIAL | `0015_workroom_approvals.sql`; `apps/api/src/routes/workroom-approvals.ts`; `0010_api_keys_roles.sql`. | Lawyer-facing review surfaces are customer-side product responsibilities. |
| AI-assisted drafting and review | BR-SEC-08 | Use AI as assistance, not as a replacement for legal judgment. | Provider invocations are hash-bound; passthrough and governed surfaces record request and response hashes. | PARTIAL | `0002_runs_and_invocations.sql` (`provider_invocations.native_request_hash`, `native_response_hash`); `apps/api/src/pipeline/run-orchestrator.ts`; tests `governed-run-e2e`, `runs-passthrough-mode`. | Per-matter evidence bundle and lawyer-facing review workflow. |
| Client consent and transparency | BR-SEC-08; BR-DP-01 | Inform clients of AI use and obtain informed consent where applicable. | No client-consent capture feature; informed-consent capture is a customer-side responsibility. | GAP | None. | Customer-side workflow; documented client-disclosure templates. |
| Advertising and publicity risk | BR-SEC-09 | Avoid prohibited advertising or publicity in legal practice. | No advertising-control feature; out of platform scope. | GAP | None. | Customer-side process and policy. |
| Evidence preservation | BR-NET-05; BR-SEC-08 | Preserve evidence appropriately for legal review. | HMAC-chained audit; append-only triggers; per-chain advisory lock; Workroom turns anchored to real audit events. | COVERED | `0001_audit_chain.sql`; `packages/core-audit/src/append.ts`; `verify.ts`; `0012`–`0015` migrations; tests `audit-canary`, `canonical-reconstruction`, `verify-edge-cases`, `append-only-defense`. | Legal-grade evidence bundle; ICP-Brasil signature uplift; RFC 3161 timestamping — see `06-evidence-chain-custody.md`. |
| Audit trail and provenance | BR-SEC-08; BR-SEC-09; BR-NET-05 | Maintain a tamper-evident audit trail with provenance. | HMAC chain; canonical bytes; provider-native request and response hashes; Workroom audit subview. | COVERED | `0001_audit_chain.sql`; `0002_runs_and_invocations.sql`; `apps/api/src/routes/audit-events.ts`; `apps/api/src/routes/workroom-transcript.ts` (audit subview); tests `governed-run-e2e`, `runs-passthrough-mode`, `workroom-audit-subview`. | Per-matter scoping and export. |
| Access control and RBAC | BR-SEC-09; BR-DP-01 | Apply least-privilege access. | Hashed API keys with roles; per-route checks. | COVERED | `0010_api_keys_roles.sql`; `packages/core-identity/src/api-keys.ts`; `packages/core-identity/src/rbac.ts`. | Customer SSO / IdP integration; role mapping for legal-sector teams. |
| Tenant isolation | BR-SEC-09; BR-DP-01 | Logically segregate tenant data. | RLS `ENABLE + FORCE` on every `govai.*` table; scoped by `app.org_id`. | COVERED | Every `govai.*` migration; `packages/core-tenant`; `tests/integration/audit-events-rls.test.ts`; `tests/integration/workroom-rls.test.ts`. | Cross-tenant penetration tests. |
| Encryption at rest | BR-SEC-09; BR-DP-01 | Encrypt sensitive content at rest. | Envelope encryption (AES-256-GCM + wrapped DEK) of sensitive evidence payloads and provider credentials. | COVERED | `0001_audit_chain.sql` (`audit_event_payloads.encrypted_payload`, `dek_wrapped`); `Kms.envelopeEncrypt`; `0009_provider_credentials.sql`; `tests/integration/provider-credentials-plaintext-leak.test.ts`. | Key rotation cadence; CMK / BYOK options. |
| Sensitive data handling | BR-DP-01; BR-NET-05 | Handle sensitive personal and protected data appropriately. | See `07-sensitive-data-handling.md`. | PARTIAL | `07-sensitive-data-handling.md`. | Category-aware classifier; privilege/secrecy taxonomy. |
| Workroom reviewer and auditor workflow | BR-SEC-08; BR-SEC-09 | Provide reviewer and auditor workflow surfaces. | Workroom participants include reviewer, auditor, owner, approver, and DPO reviewer roles; audit subview surfaces the per-Workroom timeline. | PARTIAL | `0012_workrooms.sql` (`workroom_participants.role` values); `apps/api/src/routes/workroom-transcript.ts` audit subview; tests `workroom-participants`, `workroom-audit-subview`. | Lawyer-facing review surface; structured rationale capture. |
| Approval loop for risky actions | BR-SEC-08 | Require human approval for risky AI actions. | Workroom approval loop with separation-of-duties and one-time-use binding to exact run parameters. | COVERED | `0015_workroom_approvals.sql` (`workroom_approval_decisions_sod_trg`, `consumed_run_id`, `intended_action_hash`); `apps/api/src/routes/workroom-approvals.ts`; `apps/api/src/pipeline/run-orchestrator.ts`; `tests/integration/workroom-approvals.test.ts`, `tests/integration/workroom-approvals-runs.test.ts`. | Multi-approver and policy-driven separation-of-duties. |
| Hard-deny for exfiltration or unauthorized disclosure | BR-SEC-09; BR-SEC-08 | Deny exfiltration or disclosure outside authority. | Capability admission rejects blocked capabilities; approval cannot lower the floor. | COVERED | `apps/api/src/pipeline/capability-resolution.ts`; `tests/integration/workroom-approvals-runs.test.ts` (hard-deny preservation). | Customer-defined hard-deny rules tied to privilege and secrecy categories. |
| Legal hold and retention | BR-NET-05 | Apply retention and legal holds where applicable. | No legal-hold or retention engine. | GAP | None. | Retention policy and litigation-hold engine; matter-level retention. |
| Court export and evidence bundle | BR-NET-05 | Produce evidence material suitable for court review. | No consolidated court-grade evidence bundle today. | GAP | None — see `06-evidence-chain-custody.md` for primitives. | Legal-grade evidence bundle; chain-of-custody report. |
| Conflict-of-interest and matter isolation | BR-SEC-09 | Apply matter isolation and conflict checks. | No matter-level isolation feature beyond tenant-level RLS. | GAP | RLS scopes the tenant; per-matter isolation is not implemented. | Matter-level isolation, conflict checks, segredo-aware access control. |
| Provider and third-party responsibility | BR-SEC-08; BR-DP-01 | Maintain provider boundaries and third-party responsibility. | Shared-responsibility model is documented; provider credentials envelope-encrypted; no connectors. | PARTIAL | `16-shared-responsibility-model.md`; `0009_provider_credentials.sql`; `tests/integration/provider-credentials-plaintext-leak.test.ts`. | Per-connector responsibility cells in PR-D; provider DPA workflow is a customer responsibility. |

## Attorney-client privilege and professional secrecy

- GovAI does not determine privilege. Whether content qualifies as privileged
  under the Estatuto da Advocacia or the Código de Ética e Disciplina is for
  qualified counsel to determine, on a per-matter basis.
- The platform's encryption-at-rest and tenant-isolation primitives apply
  uniformly; privilege-aware classification is `GAP` until implemented.

## Judicial secrecy and segredo de justiça

- Segredo-de-justiça content inherits the judicial-secrecy posture in
  `05-cnj-judiciary-mapping.md`. The platform does not implement a
  judicial-secrecy classifier today; matter-level isolation tagging is `GAP`.

## Generative AI in legal practice

- CFOAB Recomendação nº 001/2024 sets soft-law guidance covering applicable
  legislation, confidentiality and privacy, ethical practice, and client
  communication on the use of generative AI in legal practice.
- The platform supports an audited, hash-bound, approval-gated path for AI
  use. It does not substitute legal judgment, advertise services, or capture
  client consent. Those remain customer-side responsibilities.

## Gaps and follow-up work

The recorded gaps include privilege-aware classifier, judicial-secrecy
classifier, matter-level legal hold, conflict-of-interest checks, court
evidence export, legal-sector-specific consent workflow, lawyer-facing review
surface, and per-matter evidence bundle. The PR-D gap register will
consolidate these with other regulatory gaps.

## Disclaimers

- This document is technical architecture mapping. It is not legal advice.
- GovAI does not practice law.
- GovAI does not provide legal advice.
- GovAI does not replace lawyers, paralegals, peritos, magistrates, or any
  other qualified legal professional.
- GovAI does not determine privilege by itself.
- GovAI does not guarantee judicial admissibility of any record.
- GovAI does not make evidence automatically admissible in court.
- GovAI does not certify OAB compliance.
- GovAI does not certify third-party providers.
- Compliance and ethical outcomes depend on customer configuration, provider
  contracts, organizational processes, legal bases, applicable sector rules,
  and qualified professional review.

## Relationship to issue #59

Relates to #59.

Relates to #33.

Umbrella tracker #33 remains active.

#59 remains open for PR-D.
