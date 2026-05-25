# Sensitive Data Operating Model

## Purpose

Define the complete native Sensitive Data OS for GovAI. This is target
architecture for classification, redaction, encryption, retention, legal
hold, approval, hard-deny, evidence, and review across all sensitive
categories GovAI must handle.

## Current limitation

The current GovAI DLP baseline detects only four categories: cpf, cnpj,
email, and phone_br. This is sufficient for a foundational primitive but
is not a complete sensitive-data operating model.

## Target principle

GovAI must natively classify and govern sensitive and protected data even
when the customer has no Microsoft Purview, BigID, Securiti, Collibra,
Immuta, or equivalent. External DLP and data-governance systems enrich
GovAI signals but never act as prerequisites for native sensitive-data
safety.

## Operating principles

- Native first. Every category in this doc must have a native detector
  target. Connectors are enrichment.
- Conservative classification. Where uncertainty exists, the classifier
  must default to the more restrictive class.
- Cryptographic evidence. Classification, redaction, encryption, hold,
  approval, and hard-deny actions emit chained audit events.
- Tenant isolation. All operations respect RLS and tenant-scoped scopes.
- Hard-deny floor. Categories with hard-deny conditions are routed
  through the existing hard-deny primitive without exception.
- Human review for ambiguity. Borderline classifications surface review
  tasks for qualified roles.
- Professional review for legally sensitive categories. Legal counsel,
  DPO, and sector-specialist reviews are first-class artifacts.
- Cost-aware operation. Detectors are pluggable; heavy detectors run on
  configurable scopes to control cost.

## Detector strategy

- Rule-based detectors for high-precision categories (identifiers,
  credentials, secrets, court-case identifiers, banking and tax
  identifiers).
- Pattern-and-context detectors for medium-precision categories (financial
  data, health data, criminal data).
- Heuristic-and-policy detectors for context-dependent categories
  (privileged content, professional secrecy, judicial secrecy).
- ML-augmented detectors as future enhancement, framed as
  NATIVE_ENHANCEMENT_REQUIRED rather than substitutes for rule-based
  protections.
- Connector-ingested classifications normalized into the same evidence
  store with explicit provenance.

## Confidence scoring

- Each classification emits a confidence value with a rationale code.
- Thresholds drive routing: above high threshold takes automated handling;
  below high threshold but above review threshold creates a review task;
  below review threshold creates a low-confidence record kept for audit.
- High-stakes categories never auto-clear classification on confidence
  alone; they default to the more restrictive class until reviewed.

## Human review

- Borderline classifications create review tasks scoped by role (DPO,
  legal, sector specialist).
- Review tasks carry the original signal, classification rationale, and
  related evidence.
- Reviewer decisions are persisted with identity and timestamp.

## Redaction

- Redaction is reversible only with explicit approval and audit.
- Default redaction is masked-in-place with category tag.
- Court-export redaction is governed by `06-evidence-chain-custody.md` and
  by professional review.

## Encryption

- Sensitive payloads use envelope encryption with DEK wrapping (AES-256-GCM).
- Crypto-shred remains available for forget-by-erase scenarios on
  appropriate categories.
- Encryption metadata is recorded for audit but does not expose keys.

## Retention

- Retention bindings are per category and per tenant policy.
- Legal-hold overrides retention with audit trail.
- Retention decisions emit chained events.

## Legal hold

- Legal hold is enforced over retention.
- Hold artifacts include reason, scope, requester, and approval evidence.
- Hold release requires approval and audit.

## Approval and hard-deny

- Categories that require approval before processing route through the
  Workroom approval loop with SoD and one-time consumption.
- Categories that are prohibited route through the hard-deny floor.
- Connector-ingested classifications can trigger native approval or
  hard-deny outcomes.

## Connector enrichment

- External classifications are accepted as enrichment but never override
  a stricter native classification.
- Enrichment events carry provenance and source-quality information.

## Evidence artifacts

- Classification events.
- Redaction events.
- Encryption metadata.
- Retention decisions and events.
- Legal-hold artifacts.
- Approval requests and decisions.
- Hard-deny events.
- Review tasks and decisions.

## False-positive and false-negative handling

- False-positive handling: documented reviewer override with rationale
  emits a counter-evidence record. The original classification is
  preserved for audit.
- False-negative handling: incident-style escalation, including
  retrospective re-classification of affected records and a review task
  for the operating team.

## Auditability

- Every classification, redaction, encryption, retention, legal-hold,
  approval, hard-deny, and review event participates in the existing
  HMAC-chained audit chain.
- Audit views can be filtered by category, by tenant, by reviewer, and
  by time.

## Legal and professional review boundary

- DPO review for LGPD sensitive categories.
- Legal counsel review for privilege, judicial-secrecy, and
  professional-secrecy categories.
- Sector specialist review for health, financial, and public-procurement
  categories.
- Reviewer identity, role, and decision are persisted; GovAI does not
  generate the legal interpretation.

## Category taxonomy

The native Sensitive Data OS covers the following categories. The two
tables below split per-category operating attributes for readability. All
categories require native detector targets; connector enrichment never
substitutes a native detector.

### Table A — Detection, redaction, encryption, retention

| Category | Native detector target | Classification strategy | Redaction strategy | Encryption requirement | Retention requirement |
|---|---|---|---|---|---|
| Personal data under LGPD | Rule and context detectors covering identifiers and personal attributes | Conservative classification with reviewer override | Masked-in-place with category tag | Envelope encryption for stored payloads | Bound to LGPD-aligned retention policy |
| Sensitive personal data under LGPD | Context detectors for race, ethnicity, religion, political, union, philosophical, sex life | Conservative classification with reviewer override | Strong redaction by default | Envelope encryption mandatory | Stricter retention with legal-hold respect |
| Children and adolescents data | Context detectors with age-bracket heuristics | Conservative classification with reviewer override | Strong redaction with restricted access | Envelope encryption mandatory | Stricter retention with parental and legal review |
| Health data | Context detectors for clinical terms, ICD-style codes, prescription patterns | Conservative classification with reviewer override | Strong redaction with restricted access | Envelope encryption mandatory | Bound to ANS and CFM retention expectations |
| Biometric data | Pattern and metadata detectors | Conservative classification with reviewer override | Strong redaction with restricted access | Envelope encryption mandatory, no plaintext export | Tight retention with explicit approval for retention extension |
| Genetic data | Pattern and metadata detectors | Conservative classification with reviewer override | Strong redaction with restricted access | Envelope encryption mandatory | Tight retention with explicit approval |
| Financial data | Rule and context detectors for account numbers, transaction patterns, statements | Conservative classification with reviewer override | Strong redaction with restricted access | Envelope encryption mandatory | Bound to Bacen, CVM, SUSEP retention expectations |
| Criminal and penal data | Context detectors for case identifiers and judicial language | Conservative classification with reviewer override | Strong redaction with restricted access | Envelope encryption mandatory | Strict retention with legal review |
| Employment and labor data | Context detectors for employment identifiers and contracts | Conservative classification with reviewer override | Masked-in-place with category tag | Envelope encryption | Bound to labor regulations and customer policy |
| Authentication credentials | Pattern and entropy detectors | Conservative classification with reviewer override | Full redaction; no plaintext display | Envelope encryption mandatory; ephemeral handling preferred | Tight retention; rotation policy enforced |
| Secrets and API keys | Pattern, entropy, and known-format detectors | Conservative classification with reviewer override | Full redaction; no plaintext display | Envelope encryption mandatory | Tight retention; rotation policy enforced |
| Attorney-client privileged content | Context detectors with legal-language heuristics | Conservative classification with reviewer override | Strong redaction with restricted access | Envelope encryption mandatory | Bound to OAB-aware retention with legal hold |
| Professional secrecy content | Context detectors with profession-tagged heuristics | Conservative classification with reviewer override | Strong redaction with restricted access | Envelope encryption mandatory | Bound to professional norms and customer policy |
| Judicial secrecy or segredo de justiça | Context detectors with judicial-procedure tags | Conservative classification with reviewer override | Strong redaction with restricted access | Envelope encryption mandatory | Bound to court-driven retention with legal hold |
| Court-case identifiers | Rule detectors for CNJ-formatted identifiers | High-precision classification | Masked-in-place with category tag | Envelope encryption when bound to sensitive content | Bound to judicial retention policies |
| Medical-record identifiers | Rule and context detectors for clinical identifiers | High-precision classification | Strong redaction with restricted access | Envelope encryption mandatory | Bound to health-sector retention policy |
| Banking identifiers | Rule detectors for IBAN-style and BR-banking patterns | High-precision classification | Strong redaction | Envelope encryption mandatory | Bound to financial-sector retention |
| Insurance identifiers | Rule detectors for SUSEP-related identifiers | High-precision classification | Strong redaction | Envelope encryption mandatory | Bound to SUSEP retention |
| Tax identifiers | Rule detectors for tax-administration identifiers | High-precision classification | Strong redaction | Envelope encryption mandatory | Bound to tax-related retention |
| Trade secrets | Context detectors with confidentiality tags | Conservative classification with reviewer override | Strong redaction with restricted access | Envelope encryption mandatory | Bound to customer policy and contract |
| Confidential business data | Context detectors with confidentiality tags | Conservative classification with reviewer override | Strong redaction with restricted access | Envelope encryption mandatory | Bound to customer policy and contract |
| Public-sector restricted data | Context detectors with public-sector classification tags | Conservative classification with reviewer override | Strong redaction with restricted access | Envelope encryption mandatory | Bound to public-sector regulation |
| Public procurement sensitive data | Context detectors for procurement-process identifiers | Conservative classification with reviewer override | Strong redaction with restricted access | Envelope encryption mandatory | Bound to procurement-process retention |
| Regulatory investigation content | Context detectors for investigation language and identifiers | Conservative classification with reviewer override | Strong redaction with restricted access | Envelope encryption mandatory | Bound to investigation-driven retention with legal hold |
| Whistleblower content | Context detectors for reporting language and identifiers | Conservative classification with reviewer override | Strong redaction with strict restricted access | Envelope encryption mandatory | Tight retention with legal hold |
| Model and provider credentials | Pattern, format, and known-prefix detectors | High-precision classification | Full redaction; no plaintext display | Envelope encryption mandatory | Tight retention with rotation policy |
| Prompt-injection and exfiltration indicators | Pattern and context detectors for adversarial payloads | High-precision classification | Tagged-in-place for review | Envelope encryption for stored payloads | Tight retention with security review |

### Table B — Hold, approval, hard-deny, connector enrichment, evidence, review

| Category | Legal hold relevance | Approval requirement | Hard-deny condition | Connector enrichment | Evidence required | Professional review needed |
|---|---|---|---|---|---|---|
| Personal data under LGPD | Relevant when bound to investigation, dispute, or DSR | Approval required for restricted operations | Hard-deny on prohibited use | DLP and discovery enrichment | Classification, retention, and access events | DPO review on uncertain or borderline classifications |
| Sensitive personal data under LGPD | Relevant when bound to investigation or dispute | Approval required for export and cross-border transfer | Hard-deny on prohibited use and on cross-border without legal basis | DLP and discovery enrichment | Classification and access events with rationale | DPO and qualified-counsel review |
| Children and adolescents data | Relevant on parental, custody, or investigation matters | Approval required for collection beyond minimum scope | Hard-deny on prohibited use targeting minors | DLP and discovery enrichment | Classification and access events with rationale | DPO and qualified-counsel review |
| Health data | Relevant on clinical, ANS, or CFM matters | Approval required for export and cross-border | Hard-deny on clinical-decision-making attempts | DLP, health-system, and discovery enrichment | Classification and access events with rationale | Medical professional and DPO review |
| Biometric data | Relevant on investigation, identity, or dispute matters | Approval required for collection, storage, and export | Hard-deny on unauthorized identification flows | DLP enrichment | Classification and access events with rationale | DPO and qualified-counsel review |
| Genetic data | Relevant on health and identity matters | Approval required for collection, storage, and export | Hard-deny on unauthorized identification or discriminatory profiling | DLP enrichment | Classification and access events with rationale | DPO and medical-professional review |
| Financial data | Relevant on dispute, AML, fraud, audit matters | Approval required for export and cross-border | Hard-deny on prohibited financial-advice or unauthorized credit-decisioning flows | DLP and discovery enrichment | Classification and access events with rationale | Financial compliance specialist and DPO review |
| Criminal and penal data | Relevant on investigation and litigation | Approval required for restricted operations | Hard-deny on prohibited use such as profiling | DLP enrichment | Classification and access events with rationale | Qualified-counsel review |
| Employment and labor data | Relevant on labor dispute or investigation | Approval required for restricted operations | Hard-deny on prohibited discriminatory use | DLP enrichment | Classification and access events | DPO and HR-compliance review |
| Authentication credentials | Relevant on incident and forensic matters | Approval required for any plaintext access | Hard-deny on plaintext export | DLP and secrets-management enrichment | Classification, rotation, and access events | Security review |
| Secrets and API keys | Relevant on incident and forensic matters | Approval required for any plaintext access | Hard-deny on plaintext export | DLP and secrets-management enrichment | Classification, rotation, and access events | Security review |
| Attorney-client privileged content | Relevant on litigation and audit | Approval required for any export | Hard-deny on disclosure without authorization | Legal-tech connector enrichment | Classification and access events with rationale | Qualified-counsel review |
| Professional secrecy content | Relevant on professional or audit matters | Approval required for restricted operations | Hard-deny on unauthorized disclosure | Sector-specific connector enrichment | Classification and access events | Sector professional review |
| Judicial secrecy or segredo de justiça | Relevant on judicial matters | Approval required for any export | Hard-deny on unauthorized disclosure | Court-system connector enrichment when feasible | Classification and access events with rationale | Qualified-counsel review |
| Court-case identifiers | Relevant on judicial matters | Approval required for restricted operations | Hard-deny on disclosure that would breach segredo de justiça | Court-system connector enrichment | Classification and access events | Qualified-counsel review |
| Medical-record identifiers | Relevant on clinical, ANS, or CFM matters | Approval required for export | Hard-deny on unauthorized disclosure | Health-system connector enrichment | Classification and access events | Medical professional review |
| Banking identifiers | Relevant on financial-dispute and audit matters | Approval required for restricted operations | Hard-deny on unauthorized disclosure | Financial-system connector enrichment | Classification and access events | Financial compliance specialist review |
| Insurance identifiers | Relevant on insurance-dispute and audit matters | Approval required for restricted operations | Hard-deny on unauthorized disclosure | Insurance-system connector enrichment | Classification and access events | Financial compliance specialist review |
| Tax identifiers | Relevant on tax investigation matters | Approval required for restricted operations | Hard-deny on unauthorized disclosure | Tax-system connector enrichment | Classification and access events | DPO and tax-specialist review |
| Trade secrets | Relevant on litigation and dispute | Approval required for export | Hard-deny on unauthorized disclosure | DLP and discovery enrichment | Classification and access events | Qualified-counsel review |
| Confidential business data | Relevant on litigation and audit | Approval required for export | Hard-deny on unauthorized disclosure | DLP and discovery enrichment | Classification and access events | Sector specialist review |
| Public-sector restricted data | Relevant on public-records and investigation matters | Approval required for restricted operations | Hard-deny on unauthorized disclosure | Public-sector connector enrichment | Classification and access events | Public-sector counsel review |
| Public procurement sensitive data | Relevant on procurement disputes | Approval required for export | Hard-deny on unauthorized disclosure | Public-procurement connector enrichment | Classification and access events | Public-sector counsel review |
| Regulatory investigation content | Relevant by definition | Approval required for any disclosure | Hard-deny on unauthorized disclosure | ITSM and ticketing connector enrichment | Classification and access events with rationale | Qualified-counsel review |
| Whistleblower content | Relevant by definition | Approval required for any disclosure | Hard-deny on unauthorized disclosure | Ticketing and ITSM connector enrichment | Classification and restricted-access events | Qualified-counsel review |
| Model and provider credentials | Relevant on incident and forensic matters | Approval required for any plaintext access | Hard-deny on plaintext export | Provider posture connector enrichment | Classification, rotation, and access events | Security review |
| Prompt-injection and exfiltration indicators | Relevant on incident matters | Approval required for review and forensic access | Hard-deny on exfiltration attempts | AI-security connector enrichment | Detection events, evidence preserved | Security review |

## State of the Sensitive Data OS

- The baseline of cpf, cnpj, email, and phone_br is
  `IMPLEMENTED_FOUNDATIONAL_CONTROL`.
- PR-SD1 adds the typed Sensitive Data OS finding/taxonomy/provenance
  foundation as `IMPLEMENTED_FOUNDATIONAL_CONTROL`, plus deterministic
  detector families for credentials/secrets
  (`private_key_pem`, `bearer_token`, `generic_api_key_contextual`,
  `aws_access_key_id_candidate`, `github_token_candidate`,
  `openai_api_key_candidate`, `anthropic_api_key_candidate`) and CNJ
  court-case identifiers (`cnj_case_number` — CNJ format and mod-97
  verification digits only; not a process-existence check, not a legal
  conclusion, not a segredo-de-justiça classification). PR-SD1 does NOT
  implement classification persistence, routes, UI, connector ingestion,
  the segredo-de-justiça classifier, the attorney-client privilege
  classifier, or the professional-secrecy classifier — those remain
  `NATIVE_ENHANCEMENT_REQUIRED` and are scoped for SD2/SD3/SD4/SD5.
- PR-SD1 `recommended_action` on a rich finding is ADVISORY/PREPARATORY
  metadata only. It does NOT alter `DlpScanResult.highestAction`, does
  NOT change `decidePolicy`, and does NOT implement runtime blocking.
  Existing baseline detect/redact/deny per-tenant configuration remains
  the sole enforcement input.
- The full Sensitive Data OS described above (the broader per-category
  detector set, classifiers, redaction, encryption, retention,
  legal-hold, approval, and hard-deny bindings) is
  `NATIVE_ENHANCEMENT_REQUIRED` and `REQUIRED_NATIVE_CAPABILITY` for the
  categories not yet implemented.
- External DLP integrations are `CONNECTOR_ENRICHMENT`. They do not
  replace native protections. PR-SD1 introduces a typed provenance
  precedence rule (`primary_govai_evidence` cannot be downgraded by
  connector or external evidence) so future connector-ingested
  classifications normalize cleanly into the same vocabulary.
- PR-SD1 preserves stricter external/connector signals as `escalation`
  metadata alongside the authoritative native finding via
  `decideSourcePrecedence` /
  `mergeFindingsWithPrecedenceDecisions`. The native finding remains
  selected; the external signal is surfaced for later review-routing
  consumers. `escalation` is metadata only in SD1 — it does NOT alter
  `DlpScanResult.highestAction`, does NOT change `decidePolicy`, and
  does NOT trigger runtime blocking. Connector ingestion that would
  produce real escalation entries is not implemented in SD1.

## Relationship to other docs

- `01-lgpd-anpd-mapping.md` and `09-sector-health-mapping.md` for LGPD
  sensitive categories and health-data overlay.
- `07-sensitive-data-handling.md` for the existing baseline.
- `08-sector-financial-mapping.md` and `10-sector-legal-mapping.md` for
  sector overlays.
- `20-target-control-catalog.md` for control identifiers.
- `06-evidence-chain-custody.md` for evidence integrity and export.

## Relationship to issues

Relates to #59.

Relates to #33.

#59 remains open for implementation follow-up.

Umbrella tracker #33 remains active.
