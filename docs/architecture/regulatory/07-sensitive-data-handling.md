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
  via `packages/dlp-br/src/custom-detectors.ts`. The baseline detector set is
  intentionally narrow and is **not** a full sensitive-category classifier.
  The `cnpj` detector recognizes BOTH the legacy numeric CNPJ and the IN RFB
  2.229/2024 **alphanumeric** CNPJ (12 base positions `[0-9A-Z]`, 2 numeric check
  digits; DV = mod-11 over `ASCII − 48`). The checksum is verified identical to the
  official Serpro/RFB validator; detection is uppercase-only by design (a lowercase
  alphanumeric candidate is not surfaced). Numeric CNPJs remain a strict subset
  (zero regression), and the detector still maps to the `pii_strong` signal class.
- **Sensitive Data OS foundation (PR-SD1)** — `packages/dlp-br/src/sensitive-taxonomy.ts`
  (typed categories, advisory action vocabulary, review-flag taxonomy),
  `packages/dlp-br/src/sensitive-provenance.ts` (origin / source-surface /
  source-quality vocabulary; native primary cannot be downgraded by
  connector or external evidence), `packages/dlp-br/src/sensitive-findings.ts`
  (`SensitiveDataFinding`, `matchHash`, `redactPreview`,
  `confidenceBandForScore`, baseline ↔ rich adapters,
  `strictestFinding`, `mergeFindingsWithPrecedence`),
  `packages/dlp-br/src/secret-detectors.ts` (credentials/secrets detector
  family: `private_key_pem`, `bearer_token`, `generic_api_key_contextual`,
  `aws_access_key_id_candidate`, `github_token_candidate`,
  `openai_api_key_candidate`, `anthropic_api_key_candidate`),
  `packages/dlp-br/src/court-detectors.ts` (`cnj_case_number` — format and
  mod-97 verification digits only; not a process-existence check, not a
  legal conclusion, not a segredo-de-justiça classifier),
  `packages/dlp-br/src/scan-sensitive.ts` (`scanSensitiveData`
  orchestrator). PR-SD1 does **not** implement classification persistence,
  routes, UI, connector ingestion, segredo-de-justiça /
  attorney-client / professional-secrecy classifiers, or a runtime PR-R9
  hard-deny bridge. `SensitiveDataFinding.recommended_action` is **advisory
  metadata** in SD1 — it does not alter `highestAction`, does not change
  `decidePolicy`, and does not implement runtime blocking.
- **Sensitive Data OS foundational financial detectors (PR-SD2A)** —
  `packages/dlp-br/src/financial-detectors.ts` (`payment_card_luhn_candidate`
  with Luhn checksum, `iban_candidate` with ISO 13616 mod-97 validation,
  `br_boleto_linha_digitavel_candidate` as a context-required candidate
  with **no** módulo 10/11 validation, `br_bank_account_context_candidate`
  requiring paired agência + conta context). Each emits a rich
  `SensitiveDataFinding` with `match_hash` and redacted preview only — no
  raw value is retained. SD2A financial detectors do **not** classify a
  full financial-data ontology, do **not** prove account/card/payment
  existence, do **not** provide financial / investment / credit advice,
  and do **not** assert Bacen / CVM / SUSEP / PCI / ISO compliance.
- **Sensitive Data OS foundational health detectors (PR-SD2A)** —
  `packages/dlp-br/src/health-detectors.ts` (`cid10_code_candidate`,
  `medical_record_identifier_candidate`, `prescription_context_candidate`,
  `lab_result_context_candidate`). All four require explicit medical
  context; each emits a rich `SensitiveDataFinding` with `match_hash` and
  redacted preview only. SD2A health detectors are STRICTLY non-clinical:
  they do **not** infer, store, or imply what any CID/ICD code clinically
  means; they do **not** infer diagnosis, triage, prognosis, treatment, or
  prescription correctness; they do **not** interpret lab values as
  normal/abnormal; they do **not** claim to be a medical device,
  health-record system, telemedicine platform, or clinical decision
  support tool; and they do **not** assert ANS / CFM / ANVISA / sector
  certification. `recommended_action` on every SD2A finding is advisory
  metadata only — it does not alter `highestAction`, does not change
  `decidePolicy`, and does not implement runtime blocking.
- **DLP pipeline** — `apps/api/src/pipeline/dlp.ts` (`dlpPreScan`,
  `redactFindings`), wired into `executeGovernedRun`
  (`apps/api/src/pipeline/run-orchestrator.ts`). PR-SD1 exposes rich
  findings via the optional additive `DlpScanResult.sensitiveFindings`
  field; the legacy `findings / configByDetector / highestAction` triple
  remains the sole enforcement input.
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
| Health data | BR-DP-01 | PR-SD2A adds conservative `cid10_code_candidate` (CID/ICD format + explicit context), `medical_record_identifier_candidate`, `prescription_context_candidate`, and `lab_result_context_candidate` rich findings (match-hash + redacted preview only). SD2A is **not** a full clinical classifier and does **not** infer disease, diagnosis, triage, prognosis, treatment, prescription correctness, or lab-value interpretation. | None category-specific. PR-SD2A emits redaction hints as metadata only. | Same uniform envelope encryption. | None category-specific. PR-SD2A `recommended_action` is advisory metadata only and does not drive enforcement. | PARTIAL | Persisted clinical-data classification; sector profile; ANS / CFM / ANVISA alignment work. |
| Biometric data | BR-DP-01 | None. | None. | Same uniform envelope encryption (applies if such data lands in evidence payloads). | None category-specific. | GAP | Biometric classifier; per-category policy. |
| Genetic data | BR-DP-01 | None. | None. | Same uniform envelope encryption. | None category-specific. | GAP | Genetic-data classifier; per-category policy. |
| Financial data | BR-DP-01; BR-NET-01 | Indirect via `cpf` / `cnpj`; PR-SD2A adds `payment_card_luhn_candidate` (Luhn checksum), `iban_candidate` (ISO 13616 mod-97 validated format), `br_boleto_linha_digitavel_candidate` (context-required, **no** módulo 10/11 validation), and `br_bank_account_context_candidate` (paired agência + conta context). Rich findings carry match-hash + redacted preview only. SD2A does **not** prove account/card/payment existence, does **not** provide financial / investment / credit advice, and does **not** assert Bacen / CVM / SUSEP / PCI / ISO compliance. | Generic. PR-SD2A emits redaction hints as metadata only. | Same uniform envelope encryption. | Sector approval/escalation is a future concern. PR-SD2A `recommended_action` is advisory metadata only and does not drive enforcement. | PARTIAL | Persisted financial-data classification; sector profile; Bacen / CVM / SUSEP alignment work. |
| Criminal / penal data | BR-DP-01 | None. | None. | Same uniform envelope encryption. | None category-specific. | GAP | Criminal-data classifier; per-category policy. |
| Employment / labor data | BR-DP-01 | None. | None. | Same uniform envelope encryption. | None category-specific. | GAP | Employment-data classifier; per-category policy. |
| Authentication credentials | BR-DP-01 Art. 46 | PR-SD1 detects `private_key_pem` and `bearer_token` payload candidates (rich findings with match-hash and redacted preview only); out-of-band credentials never enter audit content by design. | None category-specific in enforcement; PR-SD1 emits redaction hints as metadata only. | Provider credentials at rest are envelope-encrypted (`provider_credentials.dek_wrapped`). | Hard-deny floor: credential exfiltration is a reserved hard-deny example in `governance-philosophy.md`. PR-SD1 `recommended_action` is advisory metadata only and does not drive enforcement. | PARTIAL | Persisted classification records; per-tenant policy bindings; runtime bridge to PR-R9. |
| Secrets / API keys | BR-DP-01 Art. 46 | PR-SD1 detects `aws_access_key_id_candidate`, `github_token_candidate`, `openai_api_key_candidate`, `anthropic_api_key_candidate`, and `generic_api_key_contextual` (contextual term required). | None category-specific in enforcement; PR-SD1 emits redaction hints as metadata only. | Provider credentials at rest are envelope-encrypted; payloads carrying secrets benefit from uniform envelope encryption. | Hard-deny floor: secret exfiltration is a reserved hard-deny example. PR-SD1 `recommended_action` is advisory metadata only and does not drive enforcement. | PARTIAL | Persisted classification records; secret-hardening posture; runtime bridge to PR-R9. |
| Attorney-client privileged content | BR-NET-05 | None. PR-SD1 introduces the typed `attorney_client_privilege_signal` taxonomy token but does **not** classify content under it. | None category-specific. | Same uniform envelope encryption. | Privilege-aware policy is a future concern. | GAP | Privilege-aware classification (SD3/SD4); legal-sector profile. |
| Judicial secrecy content (segredo de justiça) | BR-NET-05 | None. PR-SD1 introduces the typed `judicial_secrecy_signal` taxonomy token but does **not** classify content under it. PR-SD1's `cnj_case_number` detector matches CNJ-format process numbers and is a **format identifier only** — it makes no segredo-de-justiça determination. | None. | Same uniform envelope encryption. | Stricter handling required where applicable. | GAP | Judicial-secrecy classifier (SD3); CNJ mapping. |
| Trade secrets | BR-DP-01; BR-NET-01 | None. | None. | Same uniform envelope encryption. | Hard-deny floor: exfiltration outside granted authority is a reserved example. | GAP | Trade-secret marking; per-customer policy. |
| Confidential business data | BR-DP-01; BR-NET-01 | None. | None. | Same uniform envelope encryption. | Same as trade secrets. | GAP | Customer-defined sensitivity policy. |
| Public-sector restricted data | BR-DP-01; BR-NET-01 | None. | None. | Same uniform envelope encryption. | Sector profile is a future concern. | GAP | Public-sector profile (PR-C); access-to-information rules. |
| Provider credentials / model keys (GovAI-specific) | BR-DP-01 Art. 46 | PR-SD1 detects `openai_api_key_candidate` and `anthropic_api_key_candidate` in audit payload content as `model_provider_credentials`-category rich findings (match-hash and redacted preview only). Out-of-band provider-credential storage remains the canonical credential store. | None category-specific at content level; PR-SD1 emits redaction hints as metadata only. | Provider credential storage is covered as an encrypted storage primitive (`provider_credentials.dek_wrapped` and `tests/integration/provider-credentials-plaintext-leak.test.ts`), but lifecycle governance remains partial. | Operationally tenant-isolated; covered by RLS plus `0009_provider_credentials.sql` admin route guard. PR-SD1 `recommended_action` is advisory metadata only. | PARTIAL | Rotation cadence; per-tenant CMK / BYOK; lifecycle policy. |
| Court-case identifiers (CNJ-format) | BR-NET-05 | PR-SD1 detects `cnj_case_number` as a `court_case_identifier`-category rich finding (CNJ-format and mod-97 verification digits only — no process-existence claim, no legal meaning, no segredo-de-justiça determination). | None category-specific in enforcement; PR-SD1 emits redaction hints as metadata only. | Same uniform envelope encryption. | None category-specific. PR-SD1 `recommended_action` is advisory metadata only. | PARTIAL | Process-existence / segredo-de-justiça classifier (SD3); court-system connector enrichment. |

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
