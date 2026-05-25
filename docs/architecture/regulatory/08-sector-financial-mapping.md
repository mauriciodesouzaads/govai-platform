# Financial Sector Regulatory Profile

## Purpose

This document maps GovAI's implemented primitives against the technical
control objectives associated with the Brazilian financial sector's
cybersecurity, outsourcing, governance, and suitability regulation.

It is technical architecture mapping. It is **not** legal advice and **not**
a compliance guarantee. Applicability of any specific Bacen, CVM, or SUSEP
obligation depends on the customer's regulated activity and operational
context and must be reviewed by qualified professionals.

Status taxonomy is defined in `README.md`; the source register is
`15-source-register.md`; provider/customer/GovAI boundaries are in
`16-shared-responsibility-model.md`. Cross-cutting LGPD/ANPD posture is in
`01-lgpd-anpd-mapping.md`; evidence-chain primitives are in
`06-evidence-chain-custody.md`; sensitive-data semantics are in
`07-sensitive-data-handling.md`.

## Scope and non-goals

- In scope: technical mapping of GovAI primitives against financial-sector
  cybersecurity, outsourcing, governance, and suitability themes.
- Out of scope: regulator-specific reports, outsourcing registers,
  region/provider transfer registries, financial-data classifiers,
  suitability workflows, business-continuity tooling, and any
  customer-facing financial advice.
- GovAI is not a financial institution. GovAI does not provide financial
  advice. GovAI does not certify Bacen, CVM, or SUSEP compliance.
- PL 2338/2023 is not used as binding authority in this profile; detailed
  readiness treatment is deferred to PR-D.

## Sources

This mapping cites only sources recorded in `15-source-register.md`:

- **BR-SEC-01** — Resolução CMN nº 4.893/2021 (PARTIAL_PRIMARY_SOURCE).
- **BR-SEC-02** — Resolução BCB nº 85/2021 (PARTIAL_PRIMARY_SOURCE).
- **BR-SEC-03** — Resolução CVM nº 35/2021 (PARTIAL_PRIMARY_SOURCE).
- **BR-SEC-04** — Circular SUSEP nº 638/2021 (PARTIAL_PRIMARY_SOURCE).
- **BR-DP-01** — LGPD, Lei 13.709/2018 (CONFIRMED_PRIMARY_SOURCE) — used where
  data-protection obligations intersect.
- **BR-DP-02** — Resolução CD/ANPD nº 15/2024 (CONFIRMED_PRIMARY_SOURCE) —
  used where incident communication intersects.
- **BR-NET-01** — Marco Civil da Internet (CONFIRMED_PRIMARY_SOURCE) — used
  where internet records and privacy intersect.

PARTIAL sources mean an official source exists and is identified but some
detail (exact instrument URL or current consolidated text) is not fully
confirmed; cells citing them inherit that limitation.

## Sector context

The four financial-sector instruments above set cybersecurity, cloud,
outsourcing, suitability, and governance expectations for regulated entities.
Applicability is entity- and activity-specific: a customer's classification
(financial institution, asset manager, insurer) and the activity in which AI
is used determine which obligations attach. This mapping describes only what
GovAI's primitives provide technically; it does not claim a particular
customer satisfies any particular obligation.

## GovAI primitives considered

Each primitive cited is implemented in the repository:

- HMAC-chained audit events, append-only triggers, canonical bytes — `0001_audit_chain.sql`;
  `packages/core-audit/src/append.ts`; `packages/core-audit/src/verify.ts`;
  tests `audit-canary`, `canonical-reconstruction`, `verify-edge-cases`,
  `append-only-defense`.
- Envelope encryption at rest — `audit_event_payloads.encrypted_payload` plus
  `dek_wrapped`; `packages/core-identity/src/kms/index.ts`
  (`Kms.envelopeEncrypt`, AES-256-GCM).
- Tenant isolation — RLS `ENABLE + FORCE` on every `govai.*` table; scoped by
  `current_setting('app.org_id')` via `packages/core-tenant`; covered by
  `tests/integration/audit-events-rls.test.ts`,
  `tests/integration/workroom-rls.test.ts`.
- AuthIdentity / RBAC — `0010_api_keys_roles.sql`;
  `packages/core-identity/src/api-keys.ts`,
  `packages/core-identity/src/rbac.ts` (`hasAnyRole`).
- Provider credential envelope encryption — `0009_provider_credentials.sql`
  (`dek_wrapped`); covered by `tests/integration/provider-credentials-plaintext-leak.test.ts`.
- Capability admission and hard-deny floor — `apps/api/src/pipeline/capability-resolution.ts`
  (`assertCapabilityExecutable` rejects `status='blocked'`); preserved across
  the approval path by `tests/integration/workroom-approvals-runs.test.ts`.
- Approval loop with separation-of-duties and one-time-use — `0015_workroom_approvals.sql`;
  `apps/api/src/routes/workroom-approvals.ts`;
  `apps/api/src/pipeline/run-orchestrator.ts` (`intendedActionHash`,
  `validateApprovalForRun`).
- Provider-native request and response hashes — `provider_invocations.native_request_hash`,
  `native_response_hash` (`0002_runs_and_invocations.sql`).
- Crypto-shred — `audit_event_payloads.status` values `active`,
  `crypto_shredded`, and `tombstoned`; `apps/api/src/routes/admin-audit-shred.ts`.

## Financial-sector mapping table

| Area | Source reference | Requirement / control objective | GovAI support | Status | Evidence | Gaps / next work |
|---|---|---|---|---|---|---|
| Cybersecurity policy and governance | BR-SEC-01; BR-SEC-02 | Maintain a documented cybersecurity governance program. | Workroom governance container, audit chain, encryption, RLS provide evidence material. | PARTIAL | `0012_workrooms.sql`; `0001_audit_chain.sql`; `Kms.envelopeEncrypt`; `apps/api/src/routes/workroom-transcript.ts` (audit subview). | Bacen-format governance report; customer-side policy artifacts. |
| Incident evidence and security events | BR-SEC-01; BR-SEC-02; BR-DP-02 | Capture and notify on security incidents. | Audit chain records governed-action events; no Bacen / ANPD-format notification workflow. | PARTIAL | `0001_audit_chain.sql`; `apps/api/src/routes/audit-events.ts`. | Notification workflow aligned with ANPD Res. 15/2024 and any Bacen-specific reporting. |
| Audit log retention and evidence chain | BR-SEC-01; BR-SEC-02; BR-NET-01 | Preserve tamper-evident logs over required retention windows. | HMAC chain over canonical bytes; append-only triggers; per-chain advisory lock. | COVERED | `0001_audit_chain.sql`; `packages/core-audit/src/append.ts`; `verify.ts`; tests `audit-canary`, `canonical-reconstruction`, `verify-edge-cases`, `append-only-defense`. | Customer-facing retention policy engine; sector-specific retention windows. |
| Access control and RBAC | BR-SEC-01; BR-SEC-02 | Apply least-privilege access. | Hashed API keys with roles; per-route checks. | COVERED | `0010_api_keys_roles.sql`; `packages/core-identity/src/api-keys.ts`; `packages/core-identity/src/rbac.ts`; route-level role gates. | Customer SSO / IdP integration; segment-of-duty workflows. |
| Tenant isolation | BR-SEC-01; BR-SEC-02 | Logically segregate tenant data. | RLS `ENABLE + FORCE` on every `govai.*` table; scoped by `app.org_id`. | COVERED | `0001_audit_chain.sql`; `0012`–`0015` migrations; `packages/core-tenant`; `tests/integration/audit-events-rls.test.ts`; `tests/integration/workroom-rls.test.ts`. | Cross-tenant penetration tests; customer-runbook attestation. |
| Encryption at rest | BR-SEC-01; BR-SEC-02 | Encrypt sensitive data at rest. | Envelope encryption (AES-256-GCM + wrapped DEK) of sensitive evidence payloads and provider credentials. | COVERED | `0001_audit_chain.sql` (`audit_event_payloads.encrypted_payload`, `dek_wrapped`); `Kms.envelopeEncrypt`; `0009_provider_credentials.sql`; `tests/integration/provider-credentials-plaintext-leak.test.ts`. | Key rotation cadence and lifecycle policy; CMK / BYOK; HSM production hardening. |
| Provider credential protection | BR-SEC-01; BR-SEC-02 | Protect third-party AI provider credentials. | Provider credentials are envelope-encrypted with `dek_wrapped`. | COVERED | `0009_provider_credentials.sql`; `tests/integration/provider-credentials-plaintext-leak.test.ts`. | Rotation cadence and lifecycle policy; CMK / BYOK. |
| Cloud and outsourcing evidence | BR-SEC-01; BR-SEC-02 | Provide evidence supporting cloud/outsourcing governance. | Workroom audit subview and the audit chain produce per-tenant evidence; no per-region or per-provider outsourcing registry. | PARTIAL | `apps/api/src/routes/workroom-transcript.ts` (audit subview). | Per-region/per-provider outsourcing registry; sector report generation. |
| Third-party AI provider evidence ingestion | BR-SEC-01; BR-SEC-02 | Ingest and correlate evidence from third-party AI providers. | No connectors implemented today; native primitives only. | GAP | None. | Connector framework and per-provider ingestion; defined in PR-D `13-connector-compliance-mapping.md`. |
| Financial-data classification | BR-DP-01; BR-SEC-03 | Identify and protect financial data appropriately. | Baseline DLP detectors include `cpf` and `cnpj` (commonly present in financial flows). PR-SD2A adds a conservative detector foundation in the `financial_data` category: `payment_card_luhn_candidate` (Luhn checksum), `iban_candidate` (ISO 13616 mod-97 validated format), `br_boleto_linha_digitavel_candidate` (context-required, **no** módulo 10/11 validation), and `br_bank_account_context_candidate` (paired agência + conta context). Findings are advisory rich metadata only: match-hash and redacted preview, no raw value, no enforcement coupling. They are candidate/validated-format signals — they do **not** prove the existence of any real account, card, payment, or customer financial relationship; they are **not** a full financial-data classifier; they do **not** provide financial / investment / credit advice; they do **not** drive suitability classification or AML conclusions; and they do **not** assert Bacen / CVM / SUSEP / PCI / ISO compliance. | PARTIAL | `packages/dlp-br/src/baseline-detectors.ts`; `packages/dlp-br/src/financial-detectors.ts`; `apps/api/src/pipeline/dlp.ts`. | Persisted financial-data classification; sector taxonomy; Bacen / CVM / SUSEP alignment work. |
| Suitability and customer-impact context | BR-SEC-03 | Apply suitability standards for customer-impacting actions. | No suitability workflow; the approval primitive can gate risk-bearing actions generically. | GAP | None — approval primitive is generic, not suitability-specific. | Suitability-aware policy and workflow; aligned with CVM Resolução nº 35/2021 once detail is verified. |
| Human approval for high-risk financial action | BR-SEC-01; BR-SEC-02; BR-SEC-03 | Require human approval for high-risk action. | Workroom approval loop with separation-of-duties and one-time-use. | PARTIAL | `0015_workroom_approvals.sql` (`workroom_approval_decisions_sod_trg`, `consumed_run_id`); `apps/api/src/routes/workroom-approvals.ts`; `apps/api/src/pipeline/run-orchestrator.ts` (`intendedActionHash`); `tests/integration/workroom-approvals.test.ts`, `tests/integration/workroom-approvals-runs.test.ts`. | Risk-class-driven approval policy; multi-approver and policy-driven separation-of-duties. |
| Hard-deny floor for exfiltration or unauthorized action | BR-SEC-01; BR-SEC-02 | Deny classes of action regardless of configuration or approval. | Capability admission rejects blocked capabilities; approval cannot lower the floor. | COVERED | `apps/api/src/pipeline/capability-resolution.ts`; `tests/integration/workroom-approvals-runs.test.ts` (hard-deny preservation). | Customer-defined hard-deny rules tied to sector taxonomy; documented prohibited categories. |
| Change management and accountability | BR-SEC-01 | Maintain accountability for changes and decisions. | Audit chain and Workroom turns anchor decisions to authenticated actors. | PARTIAL | `0001_audit_chain.sql`; `0012`–`0015` migrations; `tests/integration/workroom-turn-ordering.test.ts`. | Customer-facing change-management report; auditor-grade export. |
| Reporting and regulator export | BR-SEC-01; BR-SEC-02; BR-SEC-03; BR-SEC-04 | Produce regulator-facing reports as required. | Authenticated, RLS-scoped audit and Workroom queries exist; no regulator-format export. | GAP | None — `apps/api/src/routes/audit-events.ts` returns chain rows only. | Regulator-format report generation; date-range and per-subject scoping. |
| Business continuity and resilience evidence | BR-SEC-01; BR-SEC-02 | Provide evidence supporting resilience controls. | Native CI evidence exists; no platform-level business-continuity tooling. | GAP | None — operational continuity belongs to deployment, not the mapping primitives. | Customer-side business-continuity evidence integration. |
| Outsourcing register | BR-SEC-01; BR-SEC-02 | Maintain an outsourcing register where required. | No outsourcing register feature. | GAP | None. | Outsourcing register; per-provider record. |

## Outsourcing, cloud, and provider considerations

- The mapping above does not represent or replace any specific Bacen, CVM, or
  SUSEP outsourcing review obligation.
- Connector-mode evidence is constrained by provider API and contractual
  limitations; see `16-shared-responsibility-model.md`.
- A future connector framework must, for each financial-context provider,
  distinguish provider-produced logs, customer-granted access scopes,
  GovAI-ingested evidence, GovAI-normalized evidence, and GovAI-independent
  audit anchoring.

## AI usage and suitability caveats

- GovAI's approval primitive can gate risk-bearing AI actions but is not a
  suitability framework. Suitability is a regulated discipline that
  qualified financial professionals operate under.
- Customer-impact decisions remain the responsibility of the regulated
  customer; GovAI provides audit and approval primitives, not financial
  judgment.

## Gaps and follow-up work

The recorded gaps include sector classifier hardening, regulator-format
reports, outsourcing register, suitability-aware workflow, business-continuity
integration, and connector evidence ingestion. The PR-D gap register will
consolidate them with other regulatory gaps.

## Disclaimers

- This document is technical architecture mapping. It is not legal advice.
- GovAI is not a financial institution and does not provide financial advice.
- GovAI does not certify Bacen, CVM, or SUSEP compliance.
- GovAI does not substitute legal counsel, DPO review, auditors, compliance
  officers, financial advisors, or any regulated financial professional.
- GovAI does not certify third-party providers.
- Compliance outcomes depend on customer configuration, provider contracts,
  organizational processes, legal bases, applicable sector rules, and
  qualified professional review.

## Relationship to issue #59

Relates to #59.

Relates to #33.

Umbrella tracker #33 remains active.

#59 remains open for PR-D.
