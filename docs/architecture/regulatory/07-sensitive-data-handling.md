# Sensitive Data Handling

## Purpose

This document maps GovAI's implemented primitives against the handling of
sensitive and protected data categories that the regulatory mapping must
address.

It is technical architecture mapping. It is **not** legal advice and **not**
a data classification certification. Whether a particular piece of content
falls into a particular legal category is for qualified professionals to
determine; this document describes only what GovAI's implemented primitives
support.

Status taxonomy is defined in `README.md`; the source register is
`15-source-register.md`; provider/customer/GovAI boundaries are in
`16-shared-responsibility-model.md`.

## Sources

This mapping cites only sources recorded in `15-source-register.md`:

- **BR-DP-01** — LGPD, Lei 13.709/2018 (CONFIRMED_PRIMARY_SOURCE).
- **BR-DP-02** — Resolução CD/ANPD nº 15/2024, incident communication
  (CONFIRMED_PRIMARY_SOURCE) — used where sensitive-data incidents intersect.
- **BR-DP-03** — Resolução CD/ANPD nº 2/2022 (PARTIAL_PRIMARY_SOURCE).
- **BR-DP-04** — Resolução CD/ANPD nº 4/2023 (PARTIAL_PRIMARY_SOURCE).
- **BR-DP-05** — ANPD AI posture / sandbox / 2026-2027 priority map
  (PARTIAL_PRIMARY_SOURCE) — soft-law / supervisory context only.
- **BR-NET-01** — Marco Civil (CONFIRMED_PRIMARY_SOURCE) — where internet
  records / privacy intersects with sensitive content.
- **BR-NET-05** — CPC, Lei 13.105/2015 (CONFIRMED_PRIMARY_SOURCE) — where
  evidence context intersects with confidentiality.

Sector-specific (financial / health / legal / public) sensitive-data
treatment will be detailed in PR-C; cross-border / connector classification
in PR-D.

## Data category taxonomy

The regulatory track tracks at least the following categories. Categories
without an implemented detector are noted explicitly in the mapping table
below.

- personal data;
- sensitive personal data (LGPD Art. 11);
- children and adolescents data (LGPD Art. 14);
- health data;
- biometric data;
- genetic data;
- financial data;
- criminal / penal data;
- employment / labor data;
- authentication credentials;
- secrets / API keys;
- attorney-client privileged content;
- judicial secrecy content;
- trade secrets;
- confidential business data;
- public-sector restricted data;
- provider credentials / model keys (GovAI-specific category for the assets
  the platform itself handles in the customer's name).

This taxonomy is a working set; new categories may be added if subsequent
docs or product work surface them.

## Mapping method

- `COVERED` requires concrete repository evidence and tests, and the support
  cited must be category-specific. A platform-wide primitive that applies
  uniformly to all payloads is not by itself category-specific evidence.
- `PARTIAL` means relevant primitives exist but classification, workflow,
  policy, retention, or operational process is missing or generic.
- `GAP` means no implementation exists for the category.
- `NEEDS_SOURCE_VERIFICATION` is reserved for cases where the legal source or
  applicability of a category cannot be confirmed from a primary source.

## GovAI primitives considered

Each primitive cited is implemented in the repository:

- **DLP detectors (BR-only, limited set)** — `packages/dlp-br/src/baseline-detectors.ts`
  (`detectAllBaseline`: `cpf`, `cnpj`, `email`, `phone_br`); custom detectors
  via `packages/dlp-br/src/custom-detectors.ts`. The current detector set is
  intentionally narrow and is **not** a full sensitive-category classifier.
- **DLP pipeline** — `apps/api/src/pipeline/dlp.ts` (`dlpPreScan`,
  `redactFindings`), wired into `executeGovernedRun`
  (`apps/api/src/pipeline/run-orchestrator.ts`).
- **DLP findings persistence** — `govai.dlp_findings` (signal class metadata)
  in the runs/governed pipeline.
- **Redaction metadata** — `audit_events.redaction_metadata` (`jsonb`) is
  the safe-metadata surface attached to each audit event.
- **Envelope encryption at rest** — `audit_event_payloads.encrypted_payload`
  + `dek_wrapped` (`0001_audit_chain.sql`), written through
  `Kms.envelopeEncrypt` (AES-256-GCM, wrapped DEK,
  `packages/core-identity/src/kms/index.ts`).
- **Provider credentials at rest** —
  `0009_provider_credentials.sql` with `dek_wrapped`; covered by
  `tests/integration/provider-credentials-plaintext-leak.test.ts`.
- **Crypto-shred** — `audit_event_payloads.status='crypto_shredded'`;
  `apps/api/src/routes/admin-audit-shred.ts`.
- **Tenant isolation** — RLS on every `govai.*` table; `app.org_id` scope;
  covered by `audit-events-rls`, `workroom-rls`.
- **RBAC / AuthIdentity** — `0010_api_keys_roles.sql`,
  `packages/core-identity/src/api-keys.ts`,
  `packages/core-identity/src/rbac.ts` (`hasAnyRole`).
- **Capability admission and hard-deny** — `capability_overrides.status_override='blocked'`
  in `0003_capabilities_overrides.sql`; enforcement in
  `apps/api/src/pipeline/capability-resolution.ts`
  (`assertCapabilityExecutable`); hard-deny preservation tested by
  `tests/integration/workroom-approvals-runs.test.ts`.
- **Workroom approval loop (Phase 4)** — `0015_workroom_approvals.sql`,
  `apps/api/src/routes/workroom-approvals.ts`,
  `apps/api/src/pipeline/run-orchestrator.ts` (`intendedActionHash`,
  `validateApprovalForRun`); approval is risk-proportional, with one-time use
  and separation of duties.
- **Workroom governance modes** — `workrooms.governance_mode`
  (`governance_active|audit_only`), immutable; `0012_workrooms.sql`.

Only primitives that exist in the repo are cited. Other capabilities,
including classification UI, data catalog, legal-basis registry, and
sector-specific classifiers, are not implemented and are noted as gaps.

## Sensitive data handling matrix

| Category | Source reference | Detection support | Redaction / minimization support | Encryption / evidence support | Approval / hard-deny considerations | Status | Gaps / next work |
|---|---|---|---|---|---|---|---|
| Personal data | BR-DP-01 | Limited (`cpf`, `cnpj`, `email`, `phone_br` only). | Generic `redaction_metadata`; not category-driven. | Envelope-encrypted in `audit_event_payloads`. | Approval loop available as a general governance control. | PARTIAL | Broader detectors; category-aware redaction; data catalog. |
| Sensitive personal data (LGPD Art. 11) | BR-DP-01 | None category-specific; baseline detectors apply uniformly. | Generic; not driven by sensitive-category flag. | Same uniform envelope encryption. | No category-specific approval ceiling. | PARTIAL | Sensitive-category classifier; per-category policy ceiling; per-category retention. |
| Children and adolescents (LGPD Art. 14) | BR-DP-01 | None. | None. | Same uniform envelope encryption. | None category-specific. | GAP | Age-bracket detection; consent capture; special-case policy. |
| Health data | BR-DP-01 | None. | None. | Same uniform envelope encryption. | None category-specific. | GAP | Health-data classifier; sector profile (PR-C). |
| Biometric data | BR-DP-01 | None. | None. | Same uniform envelope encryption (applies if such data lands in evidence payloads). | None category-specific. | GAP | Biometric classifier; per-category policy. |
| Genetic data | BR-DP-01 | None. | None. | Same uniform envelope encryption. | None category-specific. | GAP | Genetic-data classifier; per-category policy. |
| Financial data | BR-DP-01; BR-NET-01 | Indirect — `cpf` / `cnpj` are common financial-identity tokens but are not the same as financial-data classification. | Generic. | Same uniform envelope encryption. | Sector approval/escalation is a future concern. | PARTIAL | Financial-data classifier; sector profile (PR-C). |
| Criminal / penal data | BR-DP-01 | None. | None. | Same uniform envelope encryption. | None category-specific. | GAP | Criminal-data classifier; per-category policy. |
| Employment / labor data | BR-DP-01 | None. | None. | Same uniform envelope encryption. | None category-specific. | GAP | Employment-data classifier; per-category policy. |
| Authentication credentials | BR-DP-01 Art. 46 | None as audit-payload classifier; out-of-band credentials never enter audit content by design. | None category-specific. | Provider credentials at rest are envelope-encrypted (`provider_credentials.dek_wrapped`). | Hard-deny floor: credential exfiltration is a reserved hard-deny example in `governance-philosophy.md`. | PARTIAL | In-payload credential pattern detection; documented credential-handling runbook. |
| Secrets / API keys | BR-DP-01 Art. 46 | None as audit-payload classifier. | None category-specific. | Provider credentials at rest are envelope-encrypted; payloads carrying secrets benefit from uniform envelope encryption. | Hard-deny floor: secret exfiltration is a reserved hard-deny example. | PARTIAL | Secret pattern detection; explicit secret-hardening posture. |
| Attorney-client privileged content | BR-NET-05 | None. | None category-specific. | Same uniform envelope encryption. | Privilege-aware policy is a future concern. | GAP | Privilege-aware classification; legal-sector profile (PR-C). |
| Judicial secrecy content (segredo de justiça) | BR-NET-05 | None. | None. | Same uniform envelope encryption. | Stricter handling required where applicable. | GAP | Judicial-secrecy classification; CNJ mapping (PR-C). |
| Trade secrets | BR-DP-01; BR-NET-01 | None. | None. | Same uniform envelope encryption. | Hard-deny floor: exfiltration outside granted authority is a reserved example. | GAP | Trade-secret marking; per-customer policy. |
| Confidential business data | BR-DP-01; BR-NET-01 | None. | None. | Same uniform envelope encryption. | Same as trade secrets. | GAP | Customer-defined sensitivity policy. |
| Public-sector restricted data | BR-DP-01; BR-NET-01 | None. | None. | Same uniform envelope encryption. | Sector profile is a future concern. | GAP | Public-sector profile (PR-C); access-to-information rules. |
| Provider credentials / model keys (GovAI-specific) | BR-DP-01 Art. 46 | None at content level; out-of-band storage is dedicated. | None category-specific at content level. | Provider credential storage is covered as an encrypted storage primitive (`provider_credentials.dek_wrapped` and `tests/integration/provider-credentials-plaintext-leak.test.ts`), but lifecycle governance remains partial. | Operationally tenant-isolated; covered by RLS plus `0009_provider_credentials.sql` admin route guard. | PARTIAL | Rotation cadence; per-tenant CMK / BYOK; lifecycle policy. |

Coverage is honestly skewed toward `PARTIAL` and `GAP`. The implemented
primitives — envelope encryption, RLS, append-only audit, redaction metadata,
hard-deny floor, the approval loop — apply uniformly across content. They are
not yet category-aware. A category-aware sensitive-data classifier is one of
the named gaps for the regulatory track.

## Incident and breach considerations

- An incident involving sensitive data may trigger ANPD notification under
  Resolução CD/ANPD nº 15/2024 (BR-DP-02), within 3 business days for
  controllers (doubled for small processing agents under BR-DP-03).
- GovAI captures evidence of governed actions through the HMAC-chained audit
  events, Workroom turns, and Workroom evidence artifacts.
- GovAI does **not** currently implement an ANPD-format notification workflow,
  per `01-lgpd-anpd-mapping.md`.
- Sensitive-category-aware incident routing (for example, automatic DPO
  routing when `pii_strong` content is involved) is a future capability.

The mapping does not claim automatic ANPD compliance for any sensitive-data
incident. The customer remains responsible for the legal duty to notify; see
`16-shared-responsibility-model.md`.

## Connector implications

PR-B does not implement connectors. A future connector mapping must, for each
provider, distinguish:

- provider-side classification (what the provider's platform tags or marks);
- customer configuration (what the customer has chosen to classify);
- GovAI ingestion (which fields GovAI consumes);
- GovAI normalization (how GovAI represents categories in its own schema);
- GovAI-independent evidence (audit anchoring over the ingested view).

GovAI does not certify any provider's classification.

## Missing capabilities

Honest gaps the regulatory track must address:

- A category-aware sensitive-data classifier with documented coverage and
  precision/recall posture.
- A data catalog and per-tenant sensitivity policy.
- A legal-basis registry tied to processing operations.
- DSR endpoints (Art. 18 LGPD).
- Retention and litigation hold engine; documented deletion runbook.
- ANPD-format incident notification workflow.
- Connector evidence ingestion with per-provider classification provenance.
- Provider credential / model key vault policy (rotation, CMK / BYOK).
- Sector-specific sensitive-data classifiers (financial, health, legal,
  public sector — PR-C).
- Judicial-secrecy and privilege-aware classification (PR-C).

## Disclaimers

- This document is technical architecture mapping. It is not legal advice.
- GovAI does not guarantee LGPD compliance for any sensitive-data processing.
- GovAI does not guarantee judicial admissibility of any sensitive-data
  record.
- GovAI does not substitute legal counsel, DPO review, auditors, compliance
  officers, or forensic experts.
- GovAI does not certify third-party providers' sensitive-data handling.
- Whether content qualifies as sensitive under LGPD or any other regime is a
  professional judgment, not a platform classification.

## Relationship to issue #59

Relates to #59.

Relates to #33.

Umbrella tracker #33 remains active.

#59 remains open for PR-C and PR-D.
