# Regulatory Core Roadmap

## Purpose

Turn known gaps and target capabilities from `18-competitive-benchmark.md`,
`19-build-vs-integrate-strategy.md`, `20-target-control-catalog.md`,
`21-regulatory-intelligence-operating-model.md`,
`22-certification-and-audit-readiness.md`,
`24-sensitive-data-operating-model.md`, and `25-cnj-sinapses-readiness.md`
into a prioritized roadmap that precedes the next heavier agent, tool,
and connector implementation phases.

This is target architecture and sequencing. It does not implement issues,
does not create GitHub issues in this PR, and does not assert any
implementation timeline.

## Why Regulatory Core precedes heavier agent, tool, and connector phases

- Without native registries, control catalog, classification, and
  evidence schemas, future agent and tool work cannot record defensible
  evidence.
- Without sensitive-data, judicial-secrecy, and privilege classifiers,
  future connectors risk ingesting or leaking protected data without
  governance.
- Without the regulatory source registry and change-monitor model, mapped
  controls drift silently and audit-readiness erodes.
- Without the evidence bundle and TSA integration, judiciary, OAB, and
  audit deliverables remain undifferentiated.
- Connector enrichment is most valuable on top of a stable native core;
  building connectors before the core multiplies normalization work.

## Roadmap principles

- BR-first regulatory posture remains the anchor.
- Native completeness comes before connector enrichment.
- No item is marked done without code, schema, evidence, and tests cited
  in framework mapping docs.
- Items move mapping status from `REQUIRED_NATIVE_CAPABILITY` toward
  `IMPLEMENTED_FOUNDATIONAL_CONTROL` and then toward `COVERED` only when
  concrete evidence exists.
- Items that depend on external services (RFC 3161, ICP-Brasil) integrate
  the dependency rather than reimplement it.

## Priority model

- P0 — Native Regulatory Core Foundations. Build the controls, registries,
  classifiers, and source-monitor groundwork that all later items depend
  on.
- P1 — Legal, Sensitive, and Evidence Workflows. Build the workflows and
  exports that make the core operational for regulated customers.
- P2 — Connector Enrichment. Integrate external systems as enrichment
  without making them prerequisites.
- P3 — Advanced AI Quality and Runtime. Build bias, fairness, drift,
  performance, runtime enforcement, and red-team evidence records, plus
  international expansion overlays.

## Dependency model

- P1 items generally depend on P0 registries, control catalog,
  classifiers, and source register.
- P2 items depend on P0 registries and the unified evidence layer; they
  enrich existing native controls.
- P3 items depend on P0 and P1 foundations and on connector evidence
  flow.
- Cross-cutting evidence requirements (audit chain, tenant isolation,
  envelope encryption) are already `IMPLEMENTED_FOUNDATIONAL_CONTROL` and
  do not block items.

## PR sequencing

- Docs-only PRs continue to refine architecture and mappings.
- Implementation PRs follow the priority order with one P0 item per PR
  where feasible.
- Each implementation PR must update the relevant framework mapping doc
  and the control state in `20-target-control-catalog.md`.
- Implementation PRs do not create new regulatory mapping claims without
  matching evidence.

## P0 — Native Regulatory Core Foundations

### Regulatory Source Registry

- Why it matters: every downstream control depends on an authoritative
  source registry with verification status and versioning.
- Native vs integration: native; optional vendor enrichment.
- Dependencies: extends `15-source-register.md`.
- Evidence produced: source records, version records, change events,
  review tasks.
- Frameworks served: all listed frameworks.
- Done when: schema, routes, evidence, and tests exist and `15-source-register.md` cites them.
- Mapping update triggered: all framework mappings that depend on the
  source.
- Tests expected: unit tests for version creation and verification status,
  integration tests for change-event emission.

### Unified Control Catalog

- Why it matters: future PRs must reference a single catalog rather than
  ad hoc mapping per framework.
- Native vs integration: native.
- Dependencies: `20-target-control-catalog.md` as the contract.
- Evidence produced: control records, mapping bindings, state-transition
  events.
- Frameworks served: all listed frameworks.
- Done when: schema, routes, evidence, and tests exist and framework
  mapping docs cite control identifiers.
- Mapping update triggered: all framework mappings.
- Tests expected: unit tests for control records, integration tests for
  state transitions.

### AI System Registry

- Why it matters: regulators expect a documented AI inventory.
- Native vs integration: native; optional CMDB enrichment.
- Dependencies: tenant isolation primitives.
- Evidence produced: registry records, lifecycle events, ownership
  history.
- Frameworks served: LGPD, ANPD, CNJ 615, ISO 42001, NIST AI RMF, EU AI
  Act, GDPR.
- Done when: schema, routes, audit events, and tests exist and framework
  mappings cite the registry.
- Mapping update triggered: control 2 in `20-target-control-catalog.md`.
- Tests expected: unit tests for registry records, integration tests for
  lifecycle events.
- Status: `IMPLEMENTED_FOUNDATIONAL_CONTROL` (PR-R2). See the PR-R2 evidence
  below. Model, agent, use-case, and provider registries remain future work.

### Model Registry

- Why it matters: model identity and version provenance are required for
  any regulator-shaped evidence.
- Native vs integration: native; optional ModelOps and provider
  enrichment.
- Dependencies: AI System Registry and Provider Registry.
- Evidence produced: model lifecycle events, approval evidence.
- Frameworks served: LGPD, ANPD, CNJ 615, ISO 42001, NIST AI RMF, EU AI
  Act.
- Done when: schema, routes, audit events, and tests exist and framework
  mappings cite the registry.
- Mapping update triggered: control 3 in `20-target-control-catalog.md`.
- Tests expected: unit tests for model records, integration tests for
  approvals.
- Status: `IMPLEMENTED_FOUNDATIONAL_CONTROL` (PR-R4) for model identity,
  version provenance, lifecycle/status transitions, approval/retirement
  evidence, provider linkage, and AI-system/model-version binding. See the
  PR-R4 evidence below. Model runtime enforcement and live ModelOps/provider
  integration remain future work.

### Agent Registry

- Why it matters: agents must be inventoried with capability bindings to
  the hard-deny floor.
- Native vs integration: native.
- Dependencies: existing capability-assertion primitive.
- Evidence produced: agent identity records, capability bindings, change
  events.
- Frameworks served: CNJ 615, ISO 42001, NIST AI RMF, EU AI Act.
- Done when: schema, routes, audit events, and tests exist.
- Mapping update triggered: control 2 and 3 in `20-target-control-catalog.md`.
- Tests expected: unit tests for agent records, integration tests for
  capability binding changes.
- Status: `IMPLEMENTED_FOUNDATIONAL_CONTROL` (PR-R5) for agent identity,
  version/config provenance, lifecycle/status and approval/retirement evidence,
  capability bindings, and hard-deny-floor expectation tracking as registry
  evidence. See the PR-R5 evidence below. The `hard_deny_floor_expected` field
  is a declared governance expectation only; runtime hard-deny enforcement,
  live tool invocation, and gateway-level denial remain future work.

### Use-case Registry

- Why it matters: regulators require documented intended purpose and
  ownership.
- Native vs integration: native; optional GRC enrichment.
- Dependencies: AI System Registry and Risk Engine.
- Evidence produced: use-case records, periodic-review events.
- Frameworks served: LGPD, ANPD, CNJ 615, ISO 42001, NIST AI RMF, EU AI
  Act.
- Done when: schema, routes, evidence, and tests exist.
- Mapping update triggered: control 4 in `20-target-control-catalog.md`.
- Tests expected: unit and integration tests for use-case lifecycle and
  review.
- Status: `IMPLEMENTED_FOUNDATIONAL_CONTROL` (PR-R6) for use-case identity,
  intended purpose, ownership/accountability, jurisdiction/regulatory-basis
  evidence, AI-system/asset linkage, lifecycle/status evidence, and
  periodic-review evidence. See the PR-R6 evidence below. The Risk Engine
  dependency is intentionally not pulled in: PR-R6 records review evidence, not
  a risk engine or review workflow engine, and risk classification, high-risk
  approval workflow, prohibited-use enforcement, and runtime enforcement remain
  future work.

### Provider Registry

- Why it matters: provider posture must be tracked and tied to
  shared-responsibility decisions.
- Native vs integration: native; optional vendor-side enrichment.
- Dependencies: provider credential storage with envelope encryption.
- Evidence produced: provider records, credential lifecycle events,
  posture attestations.
- Frameworks served: LGPD, ANPD, Marco Civil, CNJ 615, sector overlays.
- Done when: schema, routes, evidence, and tests exist.
- Mapping update triggered: control 15 in `20-target-control-catalog.md`.
- Tests expected: unit and integration tests for posture records.
- Status: `IMPLEMENTED_FOUNDATIONAL_CONTROL` (PR-R3) for the posture/inventory
  layer; see the PR-R3 evidence below. Provider credential storage with
  envelope encryption is intentionally out of scope and remains future work.

### Risk Classification Engine

- Why it matters: high-risk, prohibited-use, and Workroom triggers all
  depend on classification.
- Native vs integration: native; optional external scoring enrichment.
- Dependencies: AI System, Model, Use-case registries.
- Evidence produced: classification records, rationales, re-classification
  events.
- Frameworks served: LGPD, ANPD, CNJ 615, ISO 42001, NIST AI RMF, EU AI
  Act.
- Done when: engine, schema, routes, evidence, and tests exist.
- Mapping update triggered: control 5 in `20-target-control-catalog.md`.
- Tests expected: rule and scoring tests, integration tests for
  re-classification triggers.
- Status: `IMPLEMENTED_FOUNDATIONAL_CONTROL` (PR-R7) for the deterministic
  technical classifier, factor-evidence rows, and reclassification-trigger
  evidence; see the PR-R7 evidence below. In PR-R7 the residual risk tier and
  score always mirror the inherent risk tier and score (DB-enforced);
  mitigation_strength is recorded as an evidence-only factor and does not
  downgrade tier or score, because no methodology PR has yet defined and tested
  bounded downgrade rules. The review flags `requires_high_risk_review` and
  `requires_prohibited_use_review` are evidence flags that record that review
  attention is required — they do not create review workflows, assign reviewers,
  block execution, or enforce runtime decisions; a future PR is required before
  any approval workflow, hard-deny, or runtime enforcement may rely on them.
  High-risk and prohibited-use workflows, runtime enforcement, mitigation-
  weighted downgrading, legal advice, and connectors remain future work.

### High-risk workflow

- Why it matters: high-risk classification must produce approval and
  evidence records.
- Native vs integration: native; ITSM enrichment.
- Dependencies: Risk Engine and Workroom approval loop.
- Evidence produced: high-risk approval records, supporting evidence,
  audit events.
- Frameworks served: ANPD, CNJ 615, ISO 42001, EU AI Act.
- Done when: workflow, schema, evidence, and tests exist.
- Mapping update triggered: control 6 in `20-target-control-catalog.md`.
- Tests expected: workflow tests for approval, SoD, expiry, and one-time
  consumption.
- Status: `IMPLEMENTED_FOUNDATIONAL_CONTROL` (PR-R8) for high-risk review
  cases, evidence records, reviewer assignments, append-only decisions,
  deterministic lifecycle transitions, separation-of-duties (service + DB
  trigger), terminal-state backstops, and tenant RLS; see the PR-R8 evidence
  below. APPROVED in PR-R8 means the high-risk governance review case has an
  approval decision recorded as governance evidence only; it does not mean
  legal approval; it does not mean compliance certification; it does not mean
  safety certification; and it does not authorize runtime execution.
  High-risk review approval does not mutate the underlying risk
  classification, does not authorize runtime execution, does not bypass
  hard-deny controls, and does not make the AI system legally compliant. Prohibited-use workflow, hard-deny enforcement, runtime
  blocking, ITSM connector enrichment, expiry-based one-time-consumption
  binding, and CNJ/Sinapses submission remain future work.

### Prohibited-use workflow

- Why it matters: prohibited-use registry must drive hard-deny outcomes
  with full audit.
- Native vs integration: native; optional gateway and AI-security
  enrichment.
- Dependencies: existing hard-deny floor and capability assertion.
- Evidence produced: prohibited-use registry, hard-deny events.
- Frameworks served: LGPD, ANPD, CNJ 615, EU AI Act.
- Done when: registry, workflow, evidence, and tests exist.
- Mapping update triggered: control 6 in `20-target-control-catalog.md`.
- Tests expected: registry tests, hard-deny integration tests.

### CNJ and Sinapses data model

- Why it matters: judiciary deployment requires schema fields that match
  CNJ atos and Sinapses expectations as defined in
  `25-cnj-sinapses-readiness.md`.
- Native vs integration: native.
- Dependencies: AI System, Model, Use-case, Agent registries; Risk
  Engine; sensitive-data classifiers.
- Evidence produced: judiciary AI records, risk classifications,
  human-supervision evidence.
- Frameworks served: CNJ 615.
- Done when: schema, evidence, and tests exist and are cited in
  `05-cnj-judiciary-mapping.md` and `25-cnj-sinapses-readiness.md`.
- Mapping update triggered: judiciary controls in
  `20-target-control-catalog.md`.
- Tests expected: schema tests and integration tests for judiciary
  workflow.

### Native sensitive-data expanded taxonomy

- Why it matters: the current baseline detects cpf, cnpj, email, and
  phone_br only; the target taxonomy in
  `24-sensitive-data-operating-model.md` is much broader.
- Native vs integration: native; optional DLP enrichment.
- Dependencies: detector framework.
- Evidence produced: classification events, redaction events.
- Frameworks served: LGPD, ANPD, CNJ 615, GDPR, sector overlays.
- Done when: detectors per category exist with tests and citation in
  `24-sensitive-data-operating-model.md`.
- Mapping update triggered: control 8 in `20-target-control-catalog.md`.
- Tests expected: per-category detector tests.

### Segredo de justiça classifier

- Why it matters: the judiciary mapping is incomplete without segredo de
  justiça handling.
- Native vs integration: native; optional court-system connector.
- Dependencies: sensitive-data framework and access control posture.
- Evidence produced: classification events, restricted-access decisions.
- Frameworks served: CNJ 615, Marco Civil, OAB sector.
- Done when: classifier, access posture, and tests exist.
- Mapping update triggered: control 9 in `20-target-control-catalog.md`.
- Tests expected: classifier tests and access posture tests.

### Attorney-client privilege classifier

- Why it matters: privilege protection is non-optional for legal-sector
  customers.
- Native vs integration: native; optional legal-tech connector.
- Dependencies: sensitive-data framework and access control posture.
- Evidence produced: classification events, handling decisions.
- Frameworks served: OAB sector, LGPD.
- Done when: classifier, handling rules, and tests exist.
- Mapping update triggered: control 9 in `20-target-control-catalog.md`.
- Tests expected: classifier tests and handling tests.

### PR-R1 implementation evidence (foundational slice)

PR-R1 delivers the foundational persistence, validation, tenant-safe access,
and audit layer for the Regulatory Source Registry and the Unified Control
Catalog. This is a PR-R1 foundational implementation, not full regulatory
automation.

Status:

- Regulatory Source Registry: IMPLEMENTED_FOUNDATIONAL_CONTROL
- Unified Control Catalog: IMPLEMENTED_FOUNDATIONAL_CONTROL

Implementation evidence:

- Migration: `apps/api/src/db/migrations/0016_regulatory_source_control_catalog.sql`
- Validation: `apps/api/src/regulatory/validation.ts`
- Service: `apps/api/src/regulatory/service.ts`
- Routes: `apps/api/src/routes/regulatory.ts`
- Server wiring: `apps/api/src/server.ts`
- Tests: `tests/integration/regulatory-routes.test.ts`,
  `tests/integration/regulatory-rls.test.ts`,
  `tests/integration/regulatory-catalog.test.ts`

Audit events emitted:

- `regulatory_source.created`
- `regulatory_source.updated`
- `regulatory_source.version_created`
- `regulatory_source.relationship_created`
- `regulatory_control.created`
- `regulatory_control.updated`
- `regulatory_control.source_link_created`
- `regulatory_control.framework_mapping_created`

Limitations (remain future work or external):

- Automated source monitoring remains future work.
- Regulatory diff engine remains future work.
- Connectors remain future work.
- CNJ/Sinapses readiness remains future work.
- Sensitive Data OS remains future work.
- Certification/legal interpretation remains external.
- GovAI does not guarantee compliance.
- GovAI does not provide legal advice.
- GovAI does not guarantee judicial validity or evidence admissibility.

### PR-R2 implementation evidence (foundational slice)

PR-R2 delivers the next P0 foundation after the source registry and control
catalog: a tenant-isolated AI System Registry. This is a PR-R2 foundational
implementation slice only — not the full AI inventory program.

Status:

- AI System Registry: IMPLEMENTED_FOUNDATIONAL_CONTROL

Implementation evidence:

- Migration: `apps/api/src/db/migrations/0017_regulatory_ai_system_registry.sql`
  (`govai.regulatory_ai_systems`; tenant-only, RLS ENABLE + FORCE, optional
  visibility-checked references to the source registry / control catalog).
- Validation / service / routes: `apps/api/src/regulatory/validation.ts`,
  `apps/api/src/regulatory/service.ts`, `apps/api/src/routes/regulatory.ts`
  (`POST/GET/GET:id/PATCH /v1/regulatory/ai-systems`; no delete).
- Tests: `tests/integration/regulatory-ai-systems.test.ts`.

Audit events emitted:

- `regulatory_ai_system.created`
- `regulatory_ai_system.updated`
- `regulatory_ai_system.lifecycle_changed`

Limitations (remain future work or external):

- Model registry remains future work.
- Agent registry remains future work.
- Use-case registry remains future work.
- Provider registry remains future work (an `external_provider_id` column is
  reserved for forward compatibility only; no provider registry ships here).
- Risk-classification engine remains future work.
- CNJ/Sinapses readiness remains future work.
- Certification/legal interpretation remains external.
- GovAI does not guarantee compliance.
- GovAI does not provide legal advice.
- GovAI does not guarantee judicial validity or evidence admissibility.

### PR-R3 implementation evidence (foundational slice)

PR-R3 delivers the Provider Registry, the next P0 foundation after the source
registry, control catalog, and AI system registry (the Model Registry depends
on both the AI System Registry and the Provider Registry, so the Provider
Registry lands first). This is a PR-R3 foundational implementation slice only —
a tenant-owned provider inventory and governance-posture record.

Status:

- Provider Registry: IMPLEMENTED_FOUNDATIONAL_CONTROL

Implementation evidence:

- Migration: `apps/api/src/db/migrations/0018_regulatory_provider_registry.sql`
  (`govai.regulatory_providers`; tenant-only, RLS ENABLE + FORCE, optional
  visibility-checked references to the source registry / control catalog).
- Validation / service / routes: `apps/api/src/regulatory/validation.ts`,
  `apps/api/src/regulatory/service.ts`, `apps/api/src/routes/regulatory.ts`
  (`POST/GET/GET:id/PATCH /v1/regulatory/providers`; no delete).
- Tests: `tests/integration/regulatory-providers.test.ts`.

Audit events emitted:

- `regulatory_provider.created`
- `regulatory_provider.updated`
- `regulatory_provider.status_changed`
- `regulatory_provider.review_status_changed`

Limitations (remain future work or external):

- Posture/inventory only — no credential vault; no API keys, client secrets,
  OAuth tokens, certificates, or passwords are stored.
- No live provider integration or connector.
- Model registry remains future work.
- Agent registry remains future work.
- Use-case registry remains future work.
- Risk-classification engine remains future work.
- CNJ/Sinapses readiness remains future work.
- Certification/legal interpretation remains external.
- GovAI does not guarantee compliance.
- GovAI does not provide legal advice.
- GovAI does not guarantee judicial validity or evidence admissibility.

### PR-R4 implementation evidence (foundational slice)

PR-R4 delivers the Model Registry, the next P0 foundation after the source
registry, control catalog, AI system registry, and provider registry (the
Model Registry depends on both the AI System Registry and the Provider
Registry, both now in place). It is a production-focused PR-R4 foundational
slice — model identity, version provenance, and AI-system/model-version
bindings — not the full AI inventory program.

Status:

- Model Registry: IMPLEMENTED_FOUNDATIONAL_CONTROL for model identity, version
  provenance, lifecycle/status evidence, provider linkage, and
  AI-system/model-version binding.

Implementation evidence:

- Migration: `apps/api/src/db/migrations/0019_regulatory_model_registry.sql`
  (`govai.regulatory_models`, `govai.regulatory_model_versions`,
  `govai.regulatory_ai_system_model_links`; tenant-only, RLS ENABLE + FORCE,
  DB-enforced parent visibility + version-belongs-to-model guards).
- Validation / service / routes: `apps/api/src/regulatory/validation.ts`,
  `apps/api/src/regulatory/service.ts`, `apps/api/src/routes/regulatory.ts`
  (model, model-version, and ai-system-model-link endpoints; no delete).
- Tests: `tests/integration/regulatory-models.test.ts`.

Audit events emitted:

- `regulatory_model.created` / `.updated` / `.status_changed`
- `regulatory_model_version.created` / `.updated` / `.status_changed` /
  `.approved` / `.retired`
- `regulatory_ai_system_model_link.created` / `.updated` / `.status_changed`

Limitations (remain future work or external):

- Provenance/metadata only — no model artifact bytes, training data, evaluation
  datasets, credentials, API keys, secrets, tokens, or certificates are stored.
- Agent registry remains future work.
- Use-case registry remains future work.
- Risk-classification engine remains future work.
- No model runtime enforcement.
- No live provider integration or connector.
- CNJ/Sinapses readiness remains future work.
- Certification/legal interpretation remains external.
- GovAI does not guarantee compliance.
- GovAI does not provide legal advice.
- GovAI does not guarantee judicial validity or evidence admissibility.

### PR-R5 implementation evidence (foundational slice)

PR-R5 delivers the Agent Registry, the next P0 foundation after the source
registry, control catalog, AI system registry, provider registry, and model
registry. It is a production-focused PR-R5 foundational slice — agent identity,
agent version/config provenance, and agent capability bindings — not the full
AI inventory program.

Status:

- Agent Registry: IMPLEMENTED_FOUNDATIONAL_CONTROL for agent identity,
  version/config provenance, lifecycle/status evidence, capability bindings,
  hard-deny-floor expectation tracking as registry evidence, and optional
  linkage to AI systems, models, model versions, and providers.

Agent capability bindings record declared governance expectations, including
whether the hard-deny floor is expected to apply, but PR-R5 does not implement
runtime enforcement, live tool invocation blocking, or gateway-level denial
behavior.

Implementation evidence:

- Migration: `apps/api/src/db/migrations/0020_regulatory_agent_registry.sql`
  (`govai.regulatory_agents`, `govai.regulatory_agent_versions`,
  `govai.regulatory_agent_capability_bindings`; tenant-only, RLS ENABLE + FORCE,
  DB-enforced parent visibility, version-requires-model CHECK, and
  version-belongs-to-model / agent-version-belongs-to-agent guards).
- Validation / service / routes: `apps/api/src/regulatory/validation.ts`,
  `apps/api/src/regulatory/service.ts`, `apps/api/src/routes/regulatory.ts`
  (agent, agent-version, and agent-capability-binding endpoints; no delete).
- Tests: `tests/integration/regulatory-agents.test.ts`.

Audit events emitted:

- `regulatory_agent.created` / `.updated` / `.status_changed`
- `regulatory_agent_version.created` / `.updated` / `.status_changed` /
  `.approved` / `.retired`
- `regulatory_agent_capability_binding.created` / `.updated` /
  `.status_changed` / `.risk_posture_changed`

Limitations (remain future work or external):

- Registry evidence / provenance only — no prompts, tool-manifest bodies,
  model artifacts, training data, credentials, API keys, secrets, tokens, or
  certificates are stored.
- `hard_deny_floor_expected` is a declared governance expectation only; runtime
  hard-deny enforcement, live tool invocation, and gateway-level denial remain
  future work.
- Use-case registry remains future work.
- Risk-classification engine remains future work.
- CNJ/Sinapses readiness remains future work.
- Certification/legal interpretation remains external.
- GovAI does not guarantee compliance.
- GovAI does not provide legal advice.
- GovAI does not guarantee judicial validity or evidence admissibility.

### PR-R6 implementation evidence (foundational slice)

PR-R6 delivers the Use-case Registry, the final registry category of the P0
Native Regulatory Core foundations (after the source registry, control catalog,
AI system registry, provider registry, model registry, and agent registry). It
is a production-focused PR-R6 foundational slice — use-case identity and
governance evidence, use-case ↔ asset links, and periodic review evidence — not
a risk engine or workflow engine.

Status:

- Use-case Registry: IMPLEMENTED_FOUNDATIONAL_CONTROL for use-case identity,
  intended purpose, ownership/accountability, jurisdiction/regulatory-basis
  evidence, AI-system/asset linkage, lifecycle/status evidence, and
  periodic-review evidence.

Use-case records and reviews capture governance evidence about intended purpose,
ownership, jurisdiction, regulatory/legal-basis summaries, and review cadence,
but PR-R6 does not implement risk classification, high-risk approval workflow,
prohibited-use hard-deny workflow, legal advice, or runtime enforcement.

Implementation evidence:

- Migration: `apps/api/src/db/migrations/0021_regulatory_use_case_registry.sql`
  (`govai.regulatory_use_cases`, `govai.regulatory_use_case_asset_links`,
  `govai.regulatory_use_case_reviews`; tenant-only, RLS ENABLE + FORCE,
  DB-enforced parent visibility, version-requires-parent CHECKs, table-qualified
  version-belongs-to-parent guards, partial unique indexes for nullable versions).
- Validation / service / routes: `apps/api/src/regulatory/validation.ts`,
  `apps/api/src/regulatory/service.ts`, `apps/api/src/routes/regulatory.ts`
  (use-case, asset-link, and review endpoints; no delete).
- Tests: `tests/integration/regulatory-use-cases.test.ts`.

Audit events emitted:

- `regulatory_use_case.created` / `.updated` / `.status_changed` / `.review_due_changed`
- `regulatory_use_case_asset_link.created` / `.updated` / `.status_changed` / `.retired`
- `regulatory_use_case_review.created` / `.updated` / `.status_changed` /
  `.completed` / `.outcome_changed`

Limitations (remain future work or external):

- Governance evidence only — no prompts, credentials, legal opinions, medical
  records, or raw sensitive data are stored.
- Risk-classification engine remains future work.
- High-risk approval and prohibited-use hard-deny workflows remain future work.
- Review evidence only — no workflow engine, no legal sign-off workflow, no
  legal-basis automation.
- Runtime enforcement remains future work.
- CNJ/Sinapses readiness remains future work.
- Certification/legal interpretation remains external.
- GovAI does not guarantee compliance.
- GovAI does not provide legal advice.
- GovAI does not guarantee judicial validity or evidence admissibility.

### PR-R7 implementation evidence (foundational slice)

PR-R7 delivers the deterministic technical Risk Classification Engine, the next
P0 Native Regulatory Core foundation after the source registry, control catalog,
AI-system registry, provider registry, model registry, agent registry, and
use-case registry. It is a production-focused PR-R7 foundational slice — risk
methodology evidence, deterministic per-subject classification, per-factor
evidence rows, and reclassification-trigger evidence — not a high-risk approval
workflow, prohibited-use hard-deny workflow, runtime enforcement engine, or
mitigation-weighted scoring engine.

Status:

- Risk Classification Engine: IMPLEMENTED_FOUNDATIONAL_CONTROL for risk
  methodology evidence, deterministic per-subject classification (tier + score +
  per-factor evidence rows), and reclassification-trigger evidence.

In PR-R7 the residual risk tier and score always mirror the inherent risk tier
and score (DB-enforced); mitigation_strength is recorded as an evidence-only
factor and does not downgrade tier or score, because no methodology PR has yet
defined and tested bounded downgrade rules. The review flags
`requires_high_risk_review` and `requires_prohibited_use_review` are evidence
flags that record that review attention is required — they do not create review
workflows, assign reviewers, block execution, or enforce runtime decisions; a
future PR is required before any approval workflow, hard-deny, or runtime
enforcement may rely on them.

Implementation evidence:

- Migration: `apps/api/src/db/migrations/0022_regulatory_risk_classification_engine.sql`
  (`govai.regulatory_risk_methods`, `govai.regulatory_risk_classifications`,
  `govai.regulatory_risk_classification_factors`,
  `govai.regulatory_reclassification_triggers`; tenant-only; RLS ENABLE + FORCE;
  DB-enforced parent visibility, asset-link consistency,
  version-belongs-to-parent guards, table-qualified outer references;
  DB-enforced residual-equals-inherent, residual-score-equals-risk-score,
  PROHIBITED-implies-both-flags, HIGH-or-PROHIBITED-implies-high-review, and
  version-requires-parent CHECK invariants; factors table grants SELECT + INSERT
  only).
- Engine, validation, service, routes: `apps/api/src/regulatory/service.ts`
  (`classifyRisk`), `apps/api/src/regulatory/validation.ts`,
  `apps/api/src/routes/regulatory.ts` (risk-method, risk-classification,
  classification-factor read endpoints, evaluate-only preview endpoint, and
  reclassification-trigger endpoints; no delete).
- Tests: `tests/integration/regulatory-risk-classifications.test.ts`.

Audit events emitted:

- `regulatory_risk_method.created` / `.updated` / `.status_changed`
- `regulatory_risk_classification.created` / `.updated` / `.status_changed` /
  `.risk_tier_assigned` / `.superseded`
- `regulatory_risk_classification_factor.created` (factor rows are append-only;
  no `.updated` audit)
- `regulatory_reclassification_trigger.created` / `.updated` / `.status_changed` /
  `.resolved`

Limitations (remain future work or external):

- Governance evidence only — no prompts, credentials, legal opinions, medical
  records, raw sensitive data, or financial advice outputs are stored.
- Residual risk mirrors inherent risk and mitigation does not downgrade score
  or tier in PR-R7 — a future methodology PR is required to define and test any
  bounded downgrade rules.
- Review flags are evidence only — no approval workflow, no reviewer
  assignment, no execution blocking, no runtime enforcement.
- High-risk approval workflow and prohibited-use hard-deny workflow remain
  future work.
- Runtime enforcement, live tool invocation, and gateway-level denial remain
  future work.
- Sensitive-data operating model, connectors, and CNJ/Sinapses readiness
  remain future work.
- Certification/legal interpretation remains external.
- GovAI does not guarantee compliance.
- GovAI does not provide legal advice.
- GovAI does not guarantee judicial validity or evidence admissibility.

### PR-R8 implementation evidence (foundational slice)

PR-R8 delivers the High-risk Review Workflow, the next P0 foundation after the
Risk Classification Engine. It is a production-focused foundational slice —
high-risk review case records, evidence records, reviewer assignment records,
append-only decisions, deterministic lifecycle transitions, separation-of-duties
backstops, terminal-state backstops, audit events, tenant RLS, and semantic
DDL comments — not a prohibited-use hard-deny workflow, not runtime
enforcement, not a connector, and not a legal-advice engine.

Status:

- High-risk Review Workflow: IMPLEMENTED_FOUNDATIONAL_CONTROL for high-risk
  review cases, evidence records, reviewer assignments, append-only
  decisions, deterministic lifecycle transitions (OPEN → IN_REVIEW /
  CHANGES_REQUESTED → APPROVED / REJECTED / CANCELLED / SUPERSEDED), service
  + DB-trigger separation-of-duties, terminal-state backstops, and tenant
  RLS.

PR-R8 implements high-risk review case, evidence, assignment, decision, SoD,
audit, and tenant-isolation primitives; it does not implement prohibited-use
workflow, hard-deny enforcement, runtime blocking, legal advice, compliance
certification, or CNJ/Sinapses submission.

APPROVED in PR-R8 means the high-risk governance review case has an approval
decision recorded as governance evidence only. It does not mean legal
approval; it does not mean compliance certification; it does not mean safety
certification; and it does not authorize runtime execution.

High-risk review approval is governance evidence only; it does not mutate the
underlying risk classification, does not authorize runtime execution, and
does not make the AI system legally compliant.

Implementation evidence:

- Migration: `apps/api/src/db/migrations/0023_regulatory_high_risk_review_workflow.sql`
  (`govai.regulatory_high_risk_reviews`,
  `govai.regulatory_high_risk_review_evidence`,
  `govai.regulatory_high_risk_review_assignments`,
  `govai.regulatory_high_risk_review_decisions`; tenant-only; RLS ENABLE +
  FORCE; DB-enforced parent visibility and table-qualified guards on the
  risk-classification snapshot (`residual_risk_tier = inherent_risk_tier =
  HIGH`, `requires_high_risk_review = true`,
  `requires_prohibited_use_review = false`, and copied
  risk_method_id/use_case_id/ai_system_id/asset/model/version/agent/version
  fields matching the classification); partial unique indexes for "one
  non-terminal review per classification", "one active assignment per
  review+role+assignee", and "one final APPROVE/REJECT decision per review";
  guarded-update triggers on reviews / evidence / assignments freezing
  identity and risk snapshot; append-only trigger on decisions; SoD trigger
  blocking decisions whose decider equals the review requester; terminal-
  state trigger blocking evidence/assignment/decision inserts after
  APPROVED / REJECTED / CANCELLED / SUPERSEDED; semantic DDL comments
  binding APPROVED/APPROVE to governance evidence only on the reviews and
  decisions tables and on their `review_status` and `decision` columns).
- Validation / service / routes: `apps/api/src/regulatory/validation.ts`,
  `apps/api/src/regulatory/service.ts`,
  `apps/api/src/routes/regulatory.ts` (high-risk review CRUD-without-delete
  + submit/cancel + evidence + assignments + append-only decisions, with
  service-level SoD and terminal-state checks; risk snapshot is copied from
  the PR-R7 classification by the service and never accepted from the
  client; client-supplied tier/score/snapshot fields are stripped).
- Tests: `tests/integration/regulatory-high-risk-reviews.test.ts`.

Audit events emitted:

- `regulatory_high_risk_review.created` / `.submitted` / `.updated` /
  `.status_changed` / `.cancelled` / `.approved` / `.rejected` /
  `.changes_requested`
- `regulatory_high_risk_review_evidence.created` / `.updated` /
  `.status_changed`
- `regulatory_high_risk_review_assignment.created` / `.updated` /
  `.status_changed`
- `regulatory_high_risk_review_decision.created` (decisions are append-only)

Limitations (remain future work or external):

- Governance evidence only — no prompts, credentials, legal opinions,
  medical records, raw sensitive data samples, or financial advice outputs
  are stored.
- Domain 6 is **not** `COVERED`: PR-R8 ships the high-risk workflow portion
  as `IMPLEMENTED_FOUNDATIONAL_CONTROL`; the prohibited-use registry and
  hard-deny workflow remain `REQUIRED_NATIVE_CAPABILITY` / future work, and
  `COVERED` requires per-requirement framework-mapping citations.
- Prohibited-use workflow and prohibited-use registry remain future work.
- Hard-deny enforcement, runtime enforcement, gateway-level blocking, and
  live tool invocation remain future work.
- ITSM connector enrichment, expiry-based one-time-consumption binding to a
  runtime invocation, and mitigation-weighted downgrading remain future
  work.
- CNJ/Sinapses submission model remains future work.
- Certification/legal interpretation remains external.
- GovAI does not guarantee compliance.
- GovAI does not provide legal advice.
- GovAI does not guarantee judicial validity or evidence admissibility.

## P1 — Legal, Sensitive, and Evidence Workflows

### DSR workflow

- Why it matters: LGPD and GDPR require operational DSR handling with
  evidence.
- Native vs integration: native; CRM, identity, and ITSM enrichment.
- Dependencies: AI System and Use-case registries; sensitive-data
  classifiers.
- Evidence produced: DSR request records, decisions, exports.
- Frameworks served: LGPD, ANPD, GDPR.
- Done when: workflow, schema, evidence, and tests exist.
- Mapping update triggered: control 10 in `20-target-control-catalog.md`.
- Tests expected: workflow tests and evidence tests.

### RIPD, DPIA, AIA workflow

- Why it matters: impact assessments are key to ANPD and EU AI Act
  posture.
- Native vs integration: native; GRC and AI-governance enrichment.
- Dependencies: AI System, Use-case registries, Risk Engine.
- Evidence produced: assessment records, version history, approval
  events.
- Frameworks served: LGPD, ANPD, GDPR, EU AI Act, CNJ 615.
- Done when: workflow, schema, evidence, and tests exist.
- Mapping update triggered: control 11 in `20-target-control-catalog.md`.
- Tests expected: workflow tests and versioning tests.

### Incident and adverse-event workflow

- Why it matters: regulators expect documented incidents and timely
  notifications.
- Native vs integration: native; SIEM and ITSM enrichment.
- Dependencies: AI System and Provider registries.
- Evidence produced: incident records, timelines, notifications.
- Frameworks served: LGPD, ANPD, CNJ 615, sector overlays.
- Done when: workflow, schema, evidence, and tests exist.
- Mapping update triggered: control 12 in `20-target-control-catalog.md`.
- Tests expected: workflow tests and notification tests.

### Retention engine

- Why it matters: retention bound to sensitive categories supports LGPD
  and sector overlays.
- Native vs integration: native; storage and DLP enrichment.
- Dependencies: sensitive-data framework, control catalog.
- Evidence produced: retention decisions, retention events.
- Frameworks served: LGPD, ANPD, Marco Civil, sector overlays.
- Done when: engine, schema, evidence, and tests exist.
- Mapping update triggered: control 14 in `20-target-control-catalog.md`.
- Tests expected: engine tests and decision tests.

### Legal hold engine

- Why it matters: legal hold must override retention with audit.
- Native vs integration: native; ITSM and storage enrichment.
- Dependencies: Retention engine and audit chain.
- Evidence produced: hold artifacts, override events.
- Frameworks served: Marco Civil, OAB sector, sector overlays.
- Done when: engine, schema, evidence, and tests exist.
- Mapping update triggered: control 14 in `20-target-control-catalog.md`.
- Tests expected: hold lifecycle and override tests.

### Evidence bundle and court export

- Why it matters: native bundle generation differentiates GovAI for
  judiciary and legal customers.
- Native vs integration: native; RFC 3161 and ICP-Brasil external
  services.
- Dependencies: audit chain, control catalog, retention, legal hold.
- Evidence produced: evidence bundles, integrity proofs, exports.
- Frameworks served: Marco Civil, CNJ 615, OAB sector.
- Done when: bundle and export generation, schema, evidence, and tests
  exist.
- Mapping update triggered: control 13 in `20-target-control-catalog.md`.
- Tests expected: bundle generation tests and integrity tests.

### RFC 3161 TSA integration

- Why it matters: timestamp authority strengthens evidence and supports
  court-bound bundles.
- Native vs integration: external service integrated by GovAI.
- Dependencies: Evidence bundle.
- Evidence produced: timestamp tokens linked to bundles.
- Frameworks served: Marco Civil, CNJ 615.
- Done when: integration, schema, evidence, and tests exist.
- Mapping update triggered: control 13 in `20-target-control-catalog.md`.
- Tests expected: integration tests and token validation tests.

### ICP-Brasil signature readiness

- Why it matters: ICP-Brasil signatures support BR-specific evidence
  acceptance contexts.
- Native vs integration: external service integrated by GovAI.
- Dependencies: Evidence bundle and provider connectivity.
- Evidence produced: signature artifacts and chain-of-trust evidence.
- Frameworks served: Marco Civil, CNJ 615.
- Done when: integration, schema, evidence, and tests exist.
- Mapping update triggered: control 13 in `20-target-control-catalog.md`.
- Tests expected: integration tests and trust chain tests.

### Native reports and dashboards

- Why it matters: customers, auditors, and reviewers need consumable
  views over the control catalog.
- Native vs integration: native; external BI enrichment optional.
- Dependencies: Unified Control Catalog and control evidence.
- Evidence produced: report snapshots and dashboard configurations.
- Frameworks served: all listed frameworks.
- Done when: schema, routes, and tests exist.
- Mapping update triggered: control 18 in `20-target-control-catalog.md`.
- Tests expected: snapshot and rendering tests.

### Certification-readiness dossier

- Why it matters: external auditors and certification bodies expect a
  structured dossier.
- Native vs integration: native.
- Dependencies: Native reports and dashboards, control catalog, evidence
  bundle.
- Evidence produced: readiness dossiers and supporting evidence.
- Frameworks served: all listed frameworks.
- Done when: dossier generator, schema, and tests exist.
- Mapping update triggered: control 18 in `20-target-control-catalog.md`.
- Tests expected: dossier generation and content tests.

## P2 — Connector Enrichment

### Microsoft connector family

- Why it matters: many enterprise customers operate on M365 and Azure.
- Native vs integration: connector enrichment, not native control.
- Dependencies: connector framework and provenance schema.
- Evidence produced: ingested signals normalized into the unified
  evidence layer.
- Frameworks served: LGPD, ANPD, ISO 42001.
- Done when: connectors with provenance and tests exist and graceful
  degradation is verified.
- Mapping update triggered: control 16 in `20-target-control-catalog.md`.
- Tests expected: ingestion and graceful-degradation tests.

### AWS connector family

- Why it matters: hyperscaler audit and guardrail signals add depth in
  AWS-resident estates.
- Native vs integration: connector enrichment.
- Dependencies: connector framework.
- Evidence produced: ingested signals normalized into the unified
  evidence layer.
- Frameworks served: LGPD, ANPD, ISO 42001, NIST AI RMF.
- Done when: connectors with provenance and tests exist.
- Mapping update triggered: control 16 in `20-target-control-catalog.md`.
- Tests expected: ingestion and graceful-degradation tests.

### Google connector family

- Why it matters: Google-resident workloads gain coverage via Vertex,
  Gemini Enterprise, Cloud Logging, and Model Armor signals.
- Native vs integration: connector enrichment.
- Dependencies: connector framework.
- Evidence produced: ingested signals normalized into the unified
  evidence layer.
- Frameworks served: LGPD, ANPD, ISO 42001.
- Done when: connectors with provenance and tests exist.
- Mapping update triggered: control 16 in `20-target-control-catalog.md`.
- Tests expected: ingestion and graceful-degradation tests.

### ServiceNow connector

- Why it matters: ServiceNow is a common ITSM and GRC system of record.
- Native vs integration: connector enrichment.
- Dependencies: connector framework.
- Evidence produced: tickets, attestations, CMDB records.
- Frameworks served: ISO 42001, NIST AI RMF.
- Done when: connector with provenance and tests exists.
- Mapping update triggered: control 16 in `20-target-control-catalog.md`.
- Tests expected: ingestion tests.

### GitHub, GitLab, Jira, Slack, Teams connectors

- Why it matters: workflow and collaboration evidence captures real human
  oversight signals.
- Native vs integration: connector enrichment.
- Dependencies: connector framework.
- Evidence produced: workflow and conversation evidence.
- Frameworks served: cross-framework workflow evidence.
- Done when: connectors with provenance and tests exist.
- Mapping update triggered: control 16 in `20-target-control-catalog.md`.
- Tests expected: ingestion tests.

### OneTrust, IBM, Vanta, Drata optional connectors

- Why it matters: customers that already run these systems can route
  evidence into GovAI's unified layer.
- Native vs integration: connector enrichment.
- Dependencies: connector framework.
- Evidence produced: attestations and assessment artifacts.
- Frameworks served: ISO 42001, NIST AI RMF.
- Done when: connectors with provenance and tests exist.
- Mapping update triggered: control 16 in `20-target-control-catalog.md`.
- Tests expected: ingestion tests.

### BigID, Securiti, Collibra optional connectors

- Why it matters: external sensitive-data discovery may complement native
  detectors.
- Native vs integration: connector enrichment.
- Dependencies: connector framework and sensitive-data normalization.
- Evidence produced: external classification signals.
- Frameworks served: LGPD, ANPD, GDPR.
- Done when: connectors with provenance and tests exist.
- Mapping update triggered: control 16 in `20-target-control-catalog.md`.
- Tests expected: ingestion tests.

### Fiddler, Arize, WhyLabs, Arthur optional connectors

- Why it matters: external model-monitoring drift and quality signals
  enrich AI quality controls.
- Native vs integration: connector enrichment.
- Dependencies: connector framework.
- Evidence produced: drift and quality signals.
- Frameworks served: NIST AI RMF, EU AI Act.
- Done when: connectors with provenance and tests exist.
- Mapping update triggered: control 16 and 20 in `20-target-control-catalog.md`.
- Tests expected: ingestion tests.

### Lakera, Protect AI, Robust Intelligence optional connectors

- Why it matters: AI-security signal ingestion complements GovAI runtime
  posture.
- Native vs integration: connector enrichment.
- Dependencies: connector framework.
- Evidence produced: detection events.
- Frameworks served: NIST AI RMF, EU AI Act.
- Done when: connectors with provenance and tests exist.
- Mapping update triggered: control 16 in `20-target-control-catalog.md`.
- Tests expected: ingestion tests.

## P3 — Advanced AI Quality and Runtime

### Bias and fairness evaluation

- Why it matters: bias evaluation is expected by NIST AI RMF and the EU
  AI Act.
- Native vs integration: native; external enrichment from monitoring
  vendors.
- Dependencies: model registry, evaluation framework.
- Evidence produced: evaluation records and decisions.
- Frameworks served: NIST AI RMF, EU AI Act.
- Done when: evaluation schema, records, and tests exist.
- Mapping update triggered: control 20 in `20-target-control-catalog.md`.
- Tests expected: evaluation tests.

### Drift and performance monitoring

- Why it matters: drift detection supports periodic re-review of
  high-risk systems.
- Native vs integration: native; external enrichment from monitoring
  vendors.
- Dependencies: model registry and evaluation framework.
- Evidence produced: drift records and performance reports.
- Frameworks served: ISO 42001, NIST AI RMF, EU AI Act.
- Done when: drift records, schema, and tests exist.
- Mapping update triggered: control 20 in `20-target-control-catalog.md`.
- Tests expected: drift detection tests.

### Runtime enforcement gateway

- Why it matters: inline enforcement layers complement the hard-deny
  floor for tool, prompt, and output policies.
- Native vs integration: native enforcement, optional connector to
  gateway products.
- Dependencies: policy pack engine and capability assertion.
- Evidence produced: enforcement events.
- Frameworks served: ISO 42001, NIST AI RMF, EU AI Act.
- Done when: enforcement engine, schema, and tests exist.
- Mapping update triggered: control 6 and 19 in `20-target-control-catalog.md`.
- Tests expected: enforcement tests.

### AI gateway policy enforcement

- Why it matters: where customers already run gateway products,
  GovAI must integrate their policy signal.
- Native vs integration: connector enrichment.
- Dependencies: connector framework and policy engine.
- Evidence produced: integrated enforcement events.
- Frameworks served: ISO 42001, NIST AI RMF, EU AI Act.
- Done when: integration and tests exist.
- Mapping update triggered: control 16 and 19 in `20-target-control-catalog.md`.
- Tests expected: integration tests.

### Advanced risk scoring

- Why it matters: expanded risk scoring builds on the P0 risk engine and
  improves prioritization across customer profiles.
- Native vs integration: native; optional external scoring.
- Dependencies: P0 Risk Engine and AI System registry.
- Evidence produced: advanced risk records and rationales.
- Frameworks served: ISO 42001, NIST AI RMF, EU AI Act, CNJ 615.
- Done when: advanced scoring schema and tests exist.
- Mapping update triggered: control 5 in `20-target-control-catalog.md`.
- Tests expected: scoring tests.

### Red-team evidence records

- Why it matters: red-team activity should produce defensible, structured
  evidence linked to models and use cases.
- Native vs integration: native; external red-team and AI-security
  signal enrichment.
- Dependencies: model registry and evaluation framework.
- Evidence produced: red-team session records, findings, evidence.
- Frameworks served: NIST AI RMF, EU AI Act.
- Done when: schema, records, and tests exist.
- Mapping update triggered: control 20 in `20-target-control-catalog.md`.
- Tests expected: red-team records tests.

### International expansion overlays

- Why it matters: customers that operate across jurisdictions need GDPR
  and EU AI Act overlays before further expansion.
- Native vs integration: native overlays; optional regulatory-intelligence
  connector enrichment.
- Dependencies: P0 source registry and control catalog.
- Evidence produced: overlay records and mapped obligations.
- Frameworks served: GDPR, EU AI Act, future jurisdictions.
- Done when: overlay schema, mapping references, and tests exist.
- Mapping update triggered: control 21 in `20-target-control-catalog.md`.
- Tests expected: overlay tests.

## Proposed future issues

The following are proposed future implementation issues listed as text
only. No issues are created in this PR.

- Native AI System Registry.
- Native Model Registry.
- Native Agent Registry.
- Native Use-case Registry.
- Native Provider Registry.
- Risk Classification Engine.
- High-risk workflow.
- Prohibited-use workflow.
- CNJ and Sinapses data model.
- Sensitive-data taxonomy expansion.
- Segredo de justiça classifier.
- Attorney-client privilege classifier.
- DSR workflow.
- RIPD, DPIA, AIA workflow.
- Incident and adverse-event workflow.
- Retention engine.
- Legal hold engine.
- Evidence bundle and court export.
- RFC 3161 integration.
- ICP-Brasil integration.
- Reports and dashboards.
- Certification-readiness dossier.
- Microsoft connector family.
- AWS connector family.
- Google connector family.
- ServiceNow connector.
- GitHub, GitLab, Jira, Slack, Teams connectors.
- OneTrust, IBM, Vanta, Drata optional connectors.
- BigID, Securiti, Collibra optional connectors.
- Fiddler, Arize, WhyLabs, Arthur optional connectors.
- Lakera, Protect AI, Robust Intelligence optional connectors.
- Bias and fairness evaluation.
- Drift and performance monitoring.
- Runtime enforcement gateway.
- AI gateway policy enforcement.
- Advanced risk scoring.
- Red-team evidence records.
- International expansion overlays.

## Acceptance criteria

- Each implementation PR must update the corresponding control state
  according to its capability type:
  - `REQUIRED_NATIVE_CAPABILITY` and `NATIVE_ENHANCEMENT_REQUIRED` items
    may move to `IMPLEMENTED_FOUNDATIONAL_CONTROL` only when GovAI ships
    concrete native implementation evidence.
  - `CONNECTOR_ENRICHMENT` items remain connector-enrichment capabilities
    and should move to implemented connector evidence only after
    connector code, ingestion evidence, tests, and mapping updates exist.
  - `EXTERNAL_SERVICE_REQUIRED` items remain externally dependent and
    may move only to readiness or integration-supported evidence, not to
    native foundational control.
  - `CUSTOMER_PROCESS_REQUIRED` and `PROFESSIONAL_REVIEW_REQUIRED` items
    may become supported workflows or evidence packages, but GovAI must
    not present the external decision, customer process, or professional
    judgment as a GovAI-controlled implementation.
  - `SOURCE_VERIFICATION_REQUIRED` items may be reclassified only after
    primary-source verification.
- Mapping docs may move to `COVERED` only when concrete code, schema,
  route, audit event, evidence artifact, and test evidence support the
  claim.
- Each implementation PR must cite code, schema, routes, audit events,
  and tests where applicable.
- Each implementation PR must update relevant mapping docs.

## Relationship to issues

Relates to #59.

Relates to #33.

#59 remains open for implementation follow-up.

Umbrella tracker #33 remains active.
