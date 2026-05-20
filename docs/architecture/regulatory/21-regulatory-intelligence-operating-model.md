# Regulatory Intelligence Operating Model

## Purpose

Define how GovAI will keep its regulatory knowledge current and operational
over time. This is a target architecture for the regulatory-intelligence
layer that future implementation PRs will build on top of
`15-source-register.md` and the framework mappings.

This doc is target architecture only. No scheduler, crawler, or job is
implemented here.

## Non-goals

- No implementation of a scheduler, crawler, change detector, diff engine,
  or notification system in this PR.
- No assertion that GovAI delivers automatic compliance.
- No assertion that GovAI substitutes legal interpretation or qualified
  professional review.
- No assertion of guaranteed source freshness; the model defines the
  intended operating cadence and failure modes.
- No automatic re-interpretation of regulatory text without human review.

## Principles

- GovAI must operate with a clearly defined source registry, versioning,
  change detection, diff records, and review queues. None of these may
  rely on an external system as a prerequisite.
- Regulatory interpretation belongs to qualified humans. GovAI may detect
  and propose changes, but it does not decide whether a control mapping is
  satisfied by new regulatory text.
- All regulatory updates that propagate into mapped controls must leave an
  audit trail.
- Source records must record verification status and source-quality label
  and must update them on change.
- Where customer profiles differ (judiciary, financial, health, legal,
  public sector, international), regulatory intelligence must be filtered
  to that profile.

## Architecture

The regulatory intelligence layer has the following components:

- Source registry — extends `15-source-register.md` from a static index
  into a versioned, monitored store. Each record carries authority,
  jurisdiction, source-quality label, version identifier, current hash,
  prior hashes, verification status, and assignment of human reviewers.
- Source ingestion — native ingestion of regulator and standards
  publications, plus connector-based ingestion when customers operate
  external regulatory-intelligence platforms.
- Change detection — native detector that compares current and prior
  versions and emits change events when text, status, or applicability
  diverges. Change events are persisted as evidence.
- Regulatory diff — structured diff records that classify the type of
  change (clarification, expansion, restriction, recission, deferral,
  consolidation, or unknown) and link to affected controls.
- Relevance scoring — engine that weighs change-event impact against the
  customer's profile, active controls, and jurisdiction.
- Affected-controls propagation — every diff record links to a list of
  affected control definitions in `20-target-control-catalog.md` and a
  list of affected mapping docs.
- Affected product capabilities — diff records link to product capabilities
  that may require new evidence, schemas, routes, or workflows.
- Human review queue — every relevant change is added to a review queue
  scoped by reviewer role (legal, DPO, compliance, security,
  sector-specific). Review decisions are persisted.
- Legal and professional review boundary — final regulatory
  interpretation, including changes to control state, must include a
  qualified-reviewer decision. GovAI never decides interpretation alone.
- Customer-specific regulatory profile — each customer has a profile that
  selects jurisdictions, sectors, and frameworks. The profile shapes which
  change events are surfaced and which controls re-review fires.
- Audit trail and evidence for source changes — change events, diff
  records, review tasks, and review decisions all generate audit events.

## Source versioning and verification

- Each source record carries a version identifier and a content hash.
- Each version carries a verification status:
  - `CONFIRMED_PRIMARY_SOURCE` when verified against the official
    publication.
  - `PARTIAL_PRIMARY_SOURCE` when an official source exists but specific
    fields could not be verified.
  - `NEEDS_SOURCE_VERIFICATION` when a primary source could not be
    verified.
- Version transitions create version records that are immutable for audit
  purposes.

## Change detection model

- Pull-based monitoring of regulator and standards pages with configurable
  frequencies.
- Connector-based ingestion when customers use regulatory-intelligence
  vendors.
- Detection is functional comparison of normalized content, not literal
  byte comparison; structural diffs handle whitespace, footnotes, and
  metadata.
- Detected changes are persisted as change events with the source version,
  prior version, change type, and a human-friendly summary.

## Regulatory diff schema

- Source identifier and version range.
- Change type: clarification, expansion, restriction, recission,
  deferral, consolidation, unknown.
- Affected controls: list of control identifiers in `20-target-control-catalog.md`.
- Affected mapping docs: list of paths.
- Affected capabilities: list of product capabilities and likely impact
  level.
- Suggested reviewer role.
- Status: `pending`, `under_review`, `decided`, `archived`.

## Relevance scoring

- Inputs: customer profile, active sector overlays, jurisdiction, active
  controls, prior incident history.
- Output: priority class (P0 critical, P1 important, P2 routine, P3
  informational) per customer.
- Priority is advisory; final reviewer triage takes precedence.

## Human review queue

- Review tasks created per change event with assigned roles.
- Task records include the proposed control impact, the reviewer's
  decision, and the evidence supporting the decision.
- Stale tasks generate alerts.

## Legal and professional review boundary

- The system does not produce binding legal interpretation.
- A control state change (for example, from `COVERED` to `PARTIAL`)
  requires a reviewer decision tied to a regulatory diff.
- Reviewer identity, role, and decision rationale are persisted.

## Customer-specific regulatory profile

- Customers select active jurisdictions, sectors, and frameworks during
  onboarding.
- The profile constrains which sources are monitored, which control
  re-reviews fire, and which review tasks are created.
- Profiles can be updated; profile updates create audit events.

## Update frequencies

### Daily

The following sources are checked daily:

- CNJ atos.
- ANPD.
- Planalto.
- Senado and Câmara, including the readiness reference for PL 2338 and
  successor bills.
- Bacen and CMN.
- CVM.
- SUSEP.
- ANS.
- CFM.
- CFOAB and OAB.
- EUR-Lex and EU AI Office.
- NIST.
- ISO metadata and catalogue listings where publicly accessible.
- High-priority vendor governance documentation, limited to vendors
  binding to a customer's active connectors.

### Weekly

The following operations run weekly:

- Regulatory diff summary across all daily sources.
- Source freshness report.
- Affected-controls report.
- Affected customer profiles report.
- Review tasks for legal and compliance for pending diffs.
- Stale source detection.
- Lower-priority vendor documentation checks.

### Monthly

The following operations run monthly:

- Regulatory posture report.
- Gap aging analysis across all customer profiles.
- Certification-readiness score updates per
  `22-certification-and-audit-readiness.md`.
- CNJ and Sinapses readiness score updates per
  `25-cnj-sinapses-readiness.md`.
- EU AI Act readiness score updates.
- ISO 42001 readiness score updates.
- Source register quality review (verification labels, link health,
  freshness).
- Vendor documentation inventory review.

### Emergency

The following triggers an emergency update path:

- Critical legal or regulatory change.
- Incident-driven regulatory update.
- CNJ, ANPD, Bacen, CVM, SUSEP, ANS, CFM, or OAB urgent update.
- EU AI Act delegated or implementing act with product impact.
- Security or AI-safety emergency that changes risk posture.

Emergency events bypass the normal review queue cadence and route to a
dedicated rapid-response queue with mandatory professional review.

## Architecture table

The table below summarizes the operating model per source type. Each row
identifies the authority, jurisdiction, expected frequency, native
monitoring approach, connector option, human review need, evidence
generated, and the failure mode if monitoring breaks.

| Source type | Authority | Jurisdiction | Frequency | Native monitor | Connector option | Human review needed | Evidence generated | Failure mode |
|---|---|---|---|---|---|---|---|---|
| LGPD primary text and amendments | Planalto | BR | Daily | Native pull and diff against Planalto | Connector enrichment via regulatory-intelligence vendor | Required for any control-state change | Source version, content hash, diff record, review task | Manual catch-up on next cycle, profile-wide review task |
| ANPD acts and guidance | ANPD | BR | Daily | Native pull and diff against ANPD acts | Connector enrichment via regulatory-intelligence vendor | Required for control-state change | Source version, content hash, diff record, review task | Manual catch-up, ANPD-bound controls flagged |
| Marco Civil text | Planalto | BR | Daily | Native pull and diff against Planalto | Connector enrichment via regulatory-intelligence vendor | Required for evidence-chain controls | Source version, diff record, review task | Manual catch-up, evidence controls flagged |
| CNJ atos and judiciary acts | CNJ | BR | Daily | Native pull and diff against CNJ atos | Connector enrichment via legal-tech vendor | Required for any judiciary control change | Source version, diff record, review task | Manual catch-up, judiciary controls flagged |
| Bacen and CMN normative acts | Bacen and CMN | BR | Daily | Native pull and diff against Bacen and CMN | Connector enrichment via regulatory-intelligence vendor | Required for financial-sector controls | Source version, diff record, review task | Manual catch-up, financial controls flagged |
| CVM normative acts | CVM | BR | Daily | Native pull and diff against CVM | Connector enrichment via vendor | Required for financial-sector controls | Source version, diff record, review task | Manual catch-up, financial controls flagged |
| SUSEP normative acts | SUSEP | BR | Daily | Native pull and diff against SUSEP | Connector enrichment via vendor | Required for insurance and financial controls | Source version, diff record, review task | Manual catch-up, financial controls flagged |
| ANS normative acts | ANS | BR | Daily | Native pull and diff against ANS | Connector enrichment via vendor | Required for health-sector controls | Source version, diff record, review task | Manual catch-up, health controls flagged |
| CFM normative acts | CFM | BR | Daily | Native pull and diff against CFM | Connector enrichment via vendor | Required for health-sector controls | Source version, diff record, review task | Manual catch-up, health controls flagged |
| CFOAB and OAB resolutions | CFOAB and OAB | BR | Daily | Native pull and diff against CFOAB and OAB | Connector enrichment via legal-tech vendor | Required for legal-sector controls | Source version, diff record, review task | Manual catch-up, legal controls flagged |
| Senado and Câmara bills, including PL 2338 readiness | Congresso Nacional | BR | Daily | Native pull and diff against Senado and Câmara feeds | Connector enrichment via regulatory-intelligence vendor | Required only for readiness adjustments | Source version, diff record, readiness note | Manual catch-up, PL 2338 readiness reference only |
| EU AI Act and EU AI Office | EU | EU and EEA | Daily | Native pull and diff against EUR-Lex and EU AI Office | Connector enrichment via international regulatory vendor | Required for EU readiness | Source version, diff record, review task | Manual catch-up, EU overlay controls flagged |
| EUR-Lex GDPR and delegated acts | EU | EU and EEA | Daily | Native pull and diff against EUR-Lex | Connector enrichment via vendor | Required for GDPR readiness | Source version, diff record, review task | Manual catch-up, GDPR overlay controls flagged |
| NIST AI RMF and 600-1 | NIST | US and international reference | Daily | Native pull and diff against NIST publications | Connector enrichment via vendor | Required for NIST readiness | Source version, diff record, review task | Manual catch-up, NIST overlay controls flagged |
| ISO 42001 and adjacent standards metadata | ISO | International reference | Daily metadata, ad hoc deep review | Native metadata check only where publicly accessible | Connector enrichment via vendor | Required when standard text changes | Metadata snapshot, review task | Manual catch-up, ISO overlay controls flagged |
| High-priority vendor governance docs | Vendors | Multi-jurisdiction | Daily | Native pull and diff for vendors bound to active connectors | Connector enrichment via vendor-specific APIs | Required when vendor changes affect controls | Vendor snapshot, diff record, review task | Manual catch-up, connector evidence flagged |
| Lower-priority vendor documentation | Vendors | Multi-jurisdiction | Weekly | Native pull and diff | Connector enrichment via vendor-specific APIs | Required only on material change | Vendor snapshot, diff record, review task | Manual catch-up, vendor signals flagged |

## Connector vs native source ingestion

- Native ingestion is mandatory for all `PRIMARY_REGULATORY_SOURCE` and
  `PRIMARY_OFFICIAL_SOURCE` records, so customers remain safe without a
  regulatory-intelligence vendor.
- Connector ingestion is supplementary. It enriches signal, fills coverage
  gaps, and offers customers their preferred curation when they already
  buy a regulatory-intelligence service.

## Cost and prioritization notes

- Daily pulls of regulator and standards pages have low cost per source
  and high regulatory value.
- High-priority vendor documentation is filtered to vendors bound to
  customer connectors to avoid cost from documentation that no customer
  uses.
- Lower-priority vendor documentation is monitored weekly to preserve
  cost while keeping integration drift visible.
- Monthly posture reports amortize the read cost of regulator pages by
  reading from internal source records, not by re-pulling sources.
- Emergency-path budget is intentionally separate from routine budget so
  that emergencies do not throttle routine monitoring.

## Audit trail and evidence

- Source registry mutations produce audit events.
- Change events, diff records, review tasks, and review decisions all
  produce audit events.
- Customer-profile updates produce audit events.
- All records are tenant-isolated and follow the existing audit chain
  primitives.

## Forbidden framings

- The system does not provide automatic compliance.
- The system does not provide legal interpretation.
- The system does not certify customers, providers, or vendors.
- The system does not guarantee judicial validity or admissibility.
- The system does not assert any regulator has accepted GovAI's mapping.

## Relationship to other docs

- `15-source-register.md` is the authoritative source register today and
  the foundation for this operating model.
- `20-target-control-catalog.md` defines the controls affected by
  regulatory change.
- `22-certification-and-audit-readiness.md` consumes monthly readiness
  outputs.
- `23-regulatory-core-roadmap.md` orders the implementation of the
  monitor, diff, review, and reporting pieces.

## Relationship to issues

Relates to #59.

Relates to #33.

#59 remains open for implementation follow-up.

Umbrella tracker #33 remains active.
