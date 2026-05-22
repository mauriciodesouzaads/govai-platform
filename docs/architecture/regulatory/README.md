# GovAI Regulatory Mapping

## Purpose

This folder contains GovAI's technical regulatory mapping: how GovAI's
implemented primitives relate to legal, regulatory, and standards requirements.
It also holds source verification, shared-responsibility guidance, and the
detailed crosswalks produced by later docs-only pull requests.

This is technical architecture documentation. It is not legal advice and not a
compliance guarantee.

## Scope

- Brazil-first regulatory mapping (LGPD/ANPD; Marco Civil; ICP-Brasil and
  digital evidence; CNJ / judiciary; sector rules).
- International reference frameworks (ISO/IEC, NIST, GDPR, EU AI Act) used for
  reference and readiness, not as automatically applicable Brazilian law.
- Connector compliance — how GovAI may ingest and correlate evidence from
  third-party AI governance systems.
- Sensitive data handling.
- Judiciary / CNJ adaptation.
- Evidence chain and chain of custody.
- Sector profiles (financial, health, legal, public sector).

## Status taxonomy

Every detailed mapped requirement, in later PRs, uses exactly one status:

- **COVERED** — an existing GovAI implementation materially supports the
  requirement, with concrete implementation and evidence references.
- **PARTIAL** — GovAI has relevant primitives, but a UI, report, export,
  configuration, policy, connector, retention workflow, operational workflow,
  or legal/compliance process is missing.
- **GAP** — GovAI does not currently implement the required control, evidence,
  report, connector, workflow, or policy.
- **NEEDS_SOURCE_VERIFICATION** — the source, requirement, legal status,
  applicability, or current text could not be confirmed from a primary source.

This PR-A foundation defines the taxonomy at the methodology level only. It
does not assign COVERED / PARTIAL / GAP to detailed requirements; that is the
work of the BR-core, judiciary/sector, and international/connector PRs.

## Evidence requirements for COVERED

A requirement may be marked `COVERED` in a later PR only when the mapping cites
all available items below:

- a repository file or migration;
- a function, schema, route, table, or event;
- an audit artifact or database evidence;
- test or validation evidence where available.

If any required item is missing, the status must be `PARTIAL` or `GAP`, not
`COVERED`. Coverage must not be inflated.

## Planned file map

The full planned structure of this folder (files marked *foundation* land in
PR-A; others land in later docs-only PRs):

- `00-philosophy-and-positioning.md` — *foundation*
- `01-lgpd-anpd-mapping.md`
- `02-iso-42001-mapping.md`
- `03-nist-ai-rmf-mapping.md`
- `04-marco-civil-mapping.md`
- `05-cnj-judiciary-mapping.md`
- `06-evidence-chain-custody.md`
- `07-sensitive-data-handling.md`
- `08-sector-financial-mapping.md`
- `09-sector-health-mapping.md`
- `10-sector-legal-mapping.md`
- `11-eu-gdpr-ai-act-reference.md`
- `12-pl-2338-readiness.md`
- `13-connector-compliance-mapping.md`
- `14-gap-register.md`
- `15-source-register.md` — *foundation*
- `16-shared-responsibility-model.md` — *foundation*
- `crosswalk-matrix.md`
- `17-judiciary-ai-profile.md` — optional future file, created only if the CNJ
  mapping outgrows file `05`.

A related document, `docs/architecture/governance-philosophy.md`, sits outside
this folder and defines the cross-cutting governance principles.

## PR sequencing

The regulatory mapping track is delivered as a sequence of docs-only PRs, per
the CP1 recommendation:

- **PR-A — foundation.** Philosophy, positioning, source register, shared
  responsibility (this PR).
- **PR-B — BR core.** LGPD/ANPD, Marco Civil, evidence chain, sensitive data.
- **PR-C — judiciary and sectors.** CNJ judiciary mapping; financial, health,
  and legal sector profiles.
- **PR-D — international, connector, crosswalk, gap register.** ISO 42001,
  NIST AI RMF, EU/GDPR reference, PL 2338 readiness, connector compliance,
  crosswalk matrix, gap register.

## Forbidden claims

GovAI documentation, product copy, dashboards, and reports must never assert
otherwise. The following statements are binding; the opposite claims are
forbidden:

- GovAI does not guarantee LGPD compliance.
- GovAI does not guarantee judicial validity.
- GovAI does not substitute legal counsel.
- GovAI does not substitute DPO review.
- GovAI does not certify third-party providers.
- GovAI does not make evidence automatically admissible in court.

## Relationship to the source register

Every detailed mapping document must cite `15-source-register.md`. A regulatory
requirement may not be mapped against a source that is not recorded in the
source register with a verification status. Where the register marks a source
`NEEDS_SOURCE_VERIFICATION`, dependent requirements inherit that status.

## Relationship to issue #59

Tracked under #59.

Relates to #33.

Umbrella tracker #33 remains active.

## PR-C2 target architecture

The PR-C2 docs-only set adds target-architecture and readiness layers on
top of the BR-core and judiciary mappings, ahead of heavier
implementation phases:

- `18-competitive-benchmark.md` — market benchmark and GovAI positioning.
- `19-build-vs-integrate-strategy.md` — native full-core and connector
  enrichment doctrine.
- `20-target-control-catalog.md` — target control catalog and capability
  taxonomy.
- `21-regulatory-intelligence-operating-model.md` — regulatory source
  monitoring and update operating model.
- `22-certification-and-audit-readiness.md` — readiness architecture
  without certification claims.
- `23-regulatory-core-roadmap.md` — implementation roadmap before
  heavier agent, tool, and connector phases.
- `24-sensitive-data-operating-model.md` — complete native sensitive-data
  operating model.
- `25-cnj-sinapses-readiness.md` — CNJ and Sinapses readiness target
  architecture.

## PR-R1 implementation

PR-R1 is the first implementation slice on top of the PR-C2 target
architecture. It lands the Regulatory Source Registry and the Unified Control
Catalog as `IMPLEMENTED_FOUNDATIONAL_CONTROL` foundational primitives, with
migration, validation, service, routes, tenant isolation (RLS), audit events,
and integration tests. Implementation evidence is recorded in
`23-regulatory-core-roadmap.md` (P0) and `20-target-control-catalog.md`.

This is a foundational slice, not full regulatory automation. Automated source
monitoring, the regulatory diff engine, connectors, CNJ/Sinapses readiness,
and the Sensitive Data OS remain future work; certification and legal
interpretation remain external. GovAI does not guarantee compliance, does not
provide legal advice, and does not guarantee judicial validity or evidence
admissibility.

## PR-R2 implementation

PR-R2 adds the next P0 Native Regulatory Core foundation after the source
registry and control catalog: a tenant-isolated AI System Registry, landed as
`IMPLEMENTED_FOUNDATIONAL_CONTROL` with migration, validation, service, routes,
tenant isolation (RLS), audit events (`regulatory_ai_system.created` /
`.updated` / `.lifecycle_changed`), and integration tests. Implementation
evidence is recorded in `23-regulatory-core-roadmap.md` (P0) and
`20-target-control-catalog.md` (control domain 2).

This is a foundational slice only. The model registry, agent registry,
use-case registry, provider registry, risk-classification engine, and
CNJ/Sinapses readiness remain future work; certification and legal
interpretation remain external. GovAI does not guarantee compliance, does not
provide legal advice, and does not guarantee judicial validity or evidence
admissibility.

## PR-R3 implementation

PR-R3 adds the next P0 Native Regulatory Core foundation after the source
registry, control catalog, and AI system registry: a tenant-isolated Provider
Registry, landed as `IMPLEMENTED_FOUNDATIONAL_CONTROL` with migration,
validation, service, routes, tenant isolation (RLS), audit events
(`regulatory_provider.created` / `.updated` / `.status_changed` /
`.review_status_changed`), and integration tests. Implementation evidence is
recorded in `23-regulatory-core-roadmap.md` (P0) and
`20-target-control-catalog.md` (control domains 2 and 15).

This is a foundational provider inventory/posture slice only. It stores no
credentials (no API keys, client secrets, OAuth tokens, certificates, or
passwords) and no credential vault. The model registry, agent registry,
use-case registry, risk-classification engine, connectors, live provider
integration, and CNJ/Sinapses readiness remain future work; certification and
legal interpretation remain external. GovAI does not guarantee compliance, does
not provide legal advice, and does not guarantee judicial validity or evidence
admissibility.

## PR-R4 implementation

PR-R4 adds the next P0 Native Regulatory Core foundation after the source
registry, control catalog, AI system registry, and provider registry: a
production-focused Model Registry. It lands three tables —
`govai.regulatory_models`, `govai.regulatory_model_versions`, and
`govai.regulatory_ai_system_model_links` — as `IMPLEMENTED_FOUNDATIONAL_CONTROL`
for model identity, version provenance, lifecycle/status evidence, provider
linkage, and AI-system/model-version binding, with migration, validation,
service, routes, tenant isolation (RLS with DB-enforced parent visibility and a
version-belongs-to-model guard), audit events (`regulatory_model.*`,
`regulatory_model_version.*` including `.approved` / `.retired`, and
`regulatory_ai_system_model_link.*`), and integration tests including direct DB
RLS coverage. Implementation evidence is recorded in
`23-regulatory-core-roadmap.md` (P0) and `20-target-control-catalog.md`
(control domains 2 and 3).

This is a foundational, production-focused slice within its declared scope. It
stores provenance/metadata only — no model artifact bytes, training data,
evaluation datasets, or credentials. The agent registry and use-case registry
(so control domain 2 is **not** complete and not `COVERED`), the
risk-classification engine, model runtime enforcement, live provider/ModelOps
integration, connectors, and CNJ/Sinapses readiness remain future work;
certification and legal interpretation remain external. GovAI does not guarantee
compliance, does not provide legal advice, and does not guarantee judicial
validity or evidence admissibility.

## PR-R5 implementation

PR-R5 adds the next P0 Native Regulatory Core foundation after the source
registry, control catalog, AI system registry, provider registry, and model
registry: a production-focused Agent Registry. It lands three tables —
`govai.regulatory_agents`, `govai.regulatory_agent_versions`, and
`govai.regulatory_agent_capability_bindings` — as
`IMPLEMENTED_FOUNDATIONAL_CONTROL` for agent identity, version/config
provenance, lifecycle/status and approval/retirement evidence, capability
bindings, and hard-deny-floor expectation tracking as registry evidence, with
optional linkage to AI systems, models, model versions, and providers, plus
migration, validation, service, routes, tenant isolation (RLS with DB-enforced
parent visibility, a version-requires-model CHECK, and version-belongs-to-model
/ agent-version-belongs-to-agent guards), audit events (`regulatory_agent.*`,
`regulatory_agent_version.*` including `.approved` / `.retired`, and
`regulatory_agent_capability_binding.*` including `.risk_posture_changed`), and
integration tests including direct DB RLS coverage. Implementation evidence is
recorded in `23-regulatory-core-roadmap.md` (P0) and
`20-target-control-catalog.md` (control domains 2 and 3).

Agent capability bindings record declared governance expectations, including
whether the hard-deny floor is expected to apply, but PR-R5 does not implement
runtime enforcement, live tool invocation blocking, or gateway-level denial
behavior. This is a foundational registry-evidence slice only — it stores no
prompts, tool-manifest bodies, or credentials. The use-case registry (so
control domain 2 remains **not** `COVERED`), the risk-classification engine,
runtime agent enforcement, live tool invocation, connectors, and CNJ/Sinapses
readiness remain future work; certification and legal interpretation remain
external. GovAI does not guarantee compliance, does not provide legal advice,
and does not guarantee judicial validity or evidence admissibility.

## PR-R6 implementation

PR-R6 adds the final P0 Native Regulatory Core registry category after the
source registry, control catalog, AI system registry, provider registry, model
registry, and agent registry: a production-focused Use-case Registry. It lands
three tables — `govai.regulatory_use_cases`,
`govai.regulatory_use_case_asset_links`, and
`govai.regulatory_use_case_reviews` — as `IMPLEMENTED_FOUNDATIONAL_CONTROL` for
use-case identity, intended purpose, prohibited/restricted-use boundaries,
ownership/accountability, jurisdiction and regulatory/legal-basis evidence,
AI-system plus optional model/model-version/agent/agent-version linkage,
lifecycle/status evidence, and periodic-review evidence, with migration,
validation, service, routes, tenant isolation (RLS with DB-enforced parent
visibility, version-requires-parent CHECKs, table-qualified
version-belongs-to-parent guards, and partial unique indexes for nullable
version columns), audit events (`regulatory_use_case.*`,
`regulatory_use_case_asset_link.*`, and `regulatory_use_case_review.*`), and
integration tests including direct DB RLS coverage. Implementation evidence is
recorded in `23-regulatory-core-roadmap.md` (P0) and
`20-target-control-catalog.md` (control domains 2 and 4).

Use-case records and reviews capture governance evidence about intended purpose,
ownership, jurisdiction, regulatory/legal-basis summaries, and review cadence,
but PR-R6 does not implement risk classification, high-risk approval workflow,
prohibited-use hard-deny workflow, legal advice, or runtime enforcement. All
five domain-2 registry categories now have foundational implementations, but
control domain 2 remains **not** `COVERED` (COVERED requires per-requirement
framework-mapping citations), and domains 4, 5, and 6 are **not** `COVERED`. The
risk-classification engine, high-risk and prohibited-use workflows, review
workflow engine, legal-basis automation, runtime enforcement, connectors, and
CNJ/Sinapses readiness remain future work; certification and legal interpretation
remain external. GovAI does not guarantee compliance, does not provide legal
advice, and does not guarantee judicial validity or evidence admissibility.
