# Health Sector Regulatory Profile

## Purpose

This document maps GovAI's implemented primitives against the technical
control objectives associated with the Brazilian health sector's
data-protection, telemedicine, and AI-related expectations.

It is technical architecture mapping. It is **not** legal advice and **not**
clinical advice. It does not perform the professional work of physicians,
nurses, pharmacists, health-data officers, or any other qualified health
professional.

Status taxonomy is defined in `README.md`; the source register is
`15-source-register.md`; provider/customer/GovAI boundaries are in
`16-shared-responsibility-model.md`. Sensitive-data semantics are in
`07-sensitive-data-handling.md`; data-protection posture is in
`01-lgpd-anpd-mapping.md`.

## Scope and non-goals

- In scope: technical mapping of GovAI primitives against health-sector
  data-protection, telemedicine, and AI-related governance themes.
- Out of scope: implementation of medical-record systems, telemedicine
  platforms, clinical decision support, health-data classifiers, consent
  registries, retention engines, and any patient-facing or clinician-facing
  product.
- GovAI is not a medical device. GovAI is not a health-record system. GovAI
  is not a telemedicine platform. GovAI is not a clinical decision maker.
- The reference treatment of any pending AI bill belongs to PR-D.

## Sources

This mapping cites only sources recorded in `15-source-register.md`:

- **BR-SEC-05** — Resolução CFM nº 2.314/2022 (CONFIRMED_PRIMARY_SOURCE) —
  telemedicine.
- **BR-SEC-06** — CFM AI-specific norm — NEEDS_SOURCE_VERIFICATION; no
  binding AI-specific CFM norm is treated as confirmed in this mapping.
- **BR-SEC-07** — ANS — NEEDS_SOURCE_VERIFICATION; relevant ANS scope is not
  treated as confirmed in this mapping.
- **BR-DP-01** — LGPD, Lei 13.709/2018 (CONFIRMED_PRIMARY_SOURCE) — used for
  sensitive health-data treatment.
- **BR-DP-02** — Resolução CD/ANPD nº 15/2024 (CONFIRMED_PRIMARY_SOURCE) —
  used where incident communication intersects.
- **BR-NET-01** — Marco Civil da Internet (CONFIRMED_PRIMARY_SOURCE) — used
  where internet records and privacy intersect.

Where a source is marked NEEDS_SOURCE_VERIFICATION, dependent mapping rows
inherit that uncertainty and are honestly reflected as `GAP` or
`NEEDS_SOURCE_VERIFICATION`.

## Health-data context

Health data is sensitive personal data under LGPD. The mapping below describes
only what GovAI's implemented primitives provide technically. A particular
customer's clinical, telemedicine, health-plan, or insurer obligations are for
that customer's qualified counsel and clinical leadership to determine. The
mapping does not assert that any specific obligation is met by the platform
alone.

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
- Workroom approval loop with separation-of-duties — `0015_workroom_approvals.sql`;
  `apps/api/src/routes/workroom-approvals.ts`;
  `apps/api/src/pipeline/run-orchestrator.ts` (`intendedActionHash`,
  `validateApprovalForRun`).
- Workroom audit subview — `apps/api/src/routes/workroom-transcript.ts`
  (`auditor` / `admin` role gate); covered by
  `tests/integration/workroom-audit-subview.test.ts`.

## Health-sector mapping table

| Area | Source reference | Requirement / control objective | GovAI support | Status | Evidence | Gaps / next work |
|---|---|---|---|---|---|---|
| Health data as sensitive personal data | BR-DP-01 | Apply heightened protection to health data as a sensitive category. | Uniform envelope encryption of evidence payloads; no health-category classifier. | PARTIAL | `0001_audit_chain.sql` (`audit_event_payloads`); `Kms.envelopeEncrypt`; see `07-sensitive-data-handling.md`. | Health-data classifier; sector-specific policy ceiling. |
| Health-data classifier | BR-DP-01 | Detect and label health data. | Baseline DLP detects `cpf`, `cnpj`, `email`, and `phone_br` only; no clinical, biometric, genetic, or diagnostic detectors. | GAP | `packages/dlp-br/src/baseline-detectors.ts`; `apps/api/src/pipeline/dlp.ts`. | Clinical-data classifier with documented coverage and precision and recall posture. |
| Biometric, genetic, and clinical data handling | BR-DP-01 | Apply protection to biometric, genetic, and clinical data. | Uniform envelope encryption applies if such data lands in evidence payloads; no category-specific tagging. | GAP | `Kms.envelopeEncrypt`; `audit_event_payloads`. | Category-aware classification, retention, and policy tooling. |
| Telemedicine context and professional responsibility | BR-SEC-05 | Telemedicine operates under defined professional responsibility and conditions. | GovAI is not a telemedicine platform; mapping is contextual only. | NEEDS_SOURCE_VERIFICATION | Customer's telemedicine context is out of platform scope. | Customer-specific integration with telemedicine workflow if and when applicable; do not implement clinical decision making in the platform. |
| Human clinical review | BR-SEC-05 | Clinical decisions remain a human professional responsibility. | Approval primitive can record a human decision generically; it is not a clinical review workflow. | PARTIAL | `0015_workroom_approvals.sql`; `apps/api/src/routes/workroom-approvals.ts`. | Clinical-review workflow is a customer responsibility; not a GovAI feature. |
| Patient confidentiality | BR-SEC-05; BR-DP-01 | Preserve patient confidentiality. | Envelope encryption; tenant isolation; RBAC; capability hard-deny. | PARTIAL | `Kms.envelopeEncrypt`; RLS on every `govai.*` table; `0010_api_keys_roles.sql`; `apps/api/src/pipeline/capability-resolution.ts`. | Confidentiality-aware classifier; clinical-context access control. |
| Consent and legal-basis registry | BR-DP-01 | Record lawful basis or patient consent where required. | No legal-basis or consent registry feature. | GAP | None. | Legal-basis registry per processing operation; patient-consent capture is a customer responsibility. |
| Audit trail for health AI use | BR-SEC-05; BR-DP-01 | Maintain a tamper-evident audit trail of AI-assisted health activity. | HMAC chain over canonical bytes; append-only triggers; provider invocation hashes. | COVERED | `0001_audit_chain.sql`; `packages/core-audit/src/append.ts`; `verify.ts`; `0002_runs_and_invocations.sql` (`provider_invocations.native_request_hash`, `native_response_hash`); tests `audit-canary`, `canonical-reconstruction`, `verify-edge-cases`, `append-only-defense`. | Health-context evidence bundle aligned with clinical retention. |
| Access control and least privilege | BR-SEC-05; BR-DP-01 | Apply least-privilege access to health data. | Hashed API keys with roles; per-route checks. | COVERED | `0010_api_keys_roles.sql`; `packages/core-identity/src/api-keys.ts`; `packages/core-identity/src/rbac.ts`. | Customer SSO / IdP integration; clinical-role mapping. |
| Encryption at rest | BR-DP-01 | Encrypt sensitive health data at rest where stored. | Envelope encryption (AES-256-GCM + wrapped DEK) of sensitive evidence payloads. | COVERED | `0001_audit_chain.sql` (`audit_event_payloads.encrypted_payload`, `dek_wrapped`); `Kms.envelopeEncrypt`. | Key rotation and lifecycle policy; CMK / BYOK options. |
| Tenant isolation | BR-DP-01 | Logically segregate tenant data. | RLS `ENABLE + FORCE` on every `govai.*` table; scoped by `app.org_id`. | COVERED | Every `govai.*` migration; `packages/core-tenant`; `tests/integration/audit-events-rls.test.ts`; `tests/integration/workroom-rls.test.ts`. | Cross-tenant penetration tests. |
| Incident evidence and notification support | BR-DP-02 | Provide evidence and support for incident communication where required. | Audit chain records governed-action events; no ANPD-format incident notification workflow. | PARTIAL | `0001_audit_chain.sql`; `apps/api/src/routes/audit-events.ts`. | ANPD-format incident workflow; clinical-incident routing. |
| Data subject rights and deletion | BR-DP-01 | Support data-subject rights including deletion. | Crypto-shred destroys the wrapped DEK while the hash chain remains intact; no DSR endpoint. | PARTIAL | `audit_event_payloads.status` values; `apps/api/src/routes/admin-audit-shred.ts`. | DSR endpoints; documented deletion runbook. |
| Retention and medical-record lifecycle | BR-DP-01 | Apply retention appropriate to medical-record context. | No retention or lifecycle engine. | GAP | None. | Retention engine, litigation hold, clinical retention windows. |
| Clinical decision support guardrails | BR-SEC-06 | Apply guardrails to AI clinical decision support. | GovAI is not a clinical decision system; approval primitive can gate risk-bearing actions generically. | NEEDS_SOURCE_VERIFICATION | `0015_workroom_approvals.sql`. | A binding CFM AI-specific norm has not been verified; await primary-source verification before adding requirements. |
| Provider and model key protection | BR-DP-01 | Protect AI provider and model keys. | Provider credentials are envelope-encrypted with `dek_wrapped`. | COVERED | `0009_provider_credentials.sql`; `tests/integration/provider-credentials-plaintext-leak.test.ts`. | Rotation cadence and CMK / BYOK. |
| Health-sector reporting and export | BR-SEC-07 | Produce sector-facing reports where required. | Authenticated, RLS-scoped audit and Workroom queries exist; no health-regulator-format export. | NEEDS_SOURCE_VERIFICATION | `apps/api/src/routes/audit-events.ts`; `apps/api/src/routes/workroom-transcript.ts` (audit subview). | Confirm relevant ANS scope; design sector-format reports only after source verification. |
| ANS and CFM AI-specific verification | BR-SEC-06; BR-SEC-07 | Identify and map any binding ANS or CFM AI-specific rule. | Sources remain NEEDS_SOURCE_VERIFICATION; no mapping rows depend on unverified authority. | NEEDS_SOURCE_VERIFICATION | Source register entries BR-SEC-06 and BR-SEC-07. | Primary-source verification before any binding mapping is asserted; track in source-register updates. |
| Bias and non-discrimination | BR-DP-01 | Detect and mitigate bias risks in health-related AI. | No bias-evaluation tooling in the platform. | GAP | None. | Bias evaluation, monitoring, and reporting tooling. |

## Telemedicine and clinical-responsibility considerations

- GovAI does not perform clinical work. Telemedicine and clinical decision
  making are the responsibility of qualified physicians and operate under
  rules outside the platform's scope.
- The mapping above does not claim GovAI satisfies CFM Resolução nº 2.314/2022
  for any particular customer; it describes only what GovAI's primitives
  technically support.
- Any AI-specific CFM or ANS norm that may apply must be verified against a
  primary source before being treated as authoritative in later docs.

## Sensitive health data handling

- Health, biometric, and genetic data inherit the sensitive-data posture in
  `07-sensitive-data-handling.md`. Detection is currently limited to four
  baseline BR identifiers; health-category detection is `GAP`.
- Encryption at rest applies uniformly to evidence payloads, but a
  category-aware classifier is not implemented.
- Patient-facing transparency, consent capture, and DSR workflows are
  customer-side responsibilities; the platform does not implement them today.

## Gaps and follow-up work

The recorded gaps include health-data classifier, clinical-context access
control, consent / legal-basis registry, retention and lifecycle engine,
clinical-incident routing, sector-format reports, and bias evaluation. ANS
and CFM AI-specific verification are explicitly tracked as
NEEDS_SOURCE_VERIFICATION. The PR-D gap register will consolidate these with
other regulatory gaps.

## Disclaimers

- This document is technical architecture mapping. It is not legal advice and
  not clinical advice.
- GovAI does not provide medical advice.
- GovAI does not replace physicians, nurses, pharmacists, health-data
  officers, or any other qualified health professional.
- GovAI is not a medical device.
- GovAI is not a health-record system.
- GovAI is not a telemedicine platform.
- GovAI is not a clinical decision maker.
- GovAI does not certify CFM or ANS compliance.
- GovAI does not guarantee compliance with any health-data obligation.
- GovAI does not certify third-party providers' health-data handling.
- Compliance outcomes depend on customer configuration, provider contracts,
  organizational processes, legal bases, applicable sector rules, and
  qualified professional review.

## Relationship to issue #59

Relates to #59.

Relates to #33.

Umbrella tracker #33 remains active.

#59 remains open for PR-D.
