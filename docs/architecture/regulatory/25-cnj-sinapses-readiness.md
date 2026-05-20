# CNJ and Sinapses Readiness

## Purpose

Define target architecture for CNJ and Sinapses readiness for judiciary
and tribunal use. The document complements `05-cnj-judiciary-mapping.md`
by capturing GovAI's intended capabilities, current primitives, external
and professional dependencies, and readiness artifacts that any judiciary
deployment would rely on.

This document is target architecture and readiness mapping only.

## Non-goals

- Not a claim of CNJ certification or acceptance by any tribunal.
- Not a claim that GovAI is endorsed by any tribunal.
- Not a claim that any GovAI-generated artifact is automatically
  admissible in court.
- Not a claim that GovAI replaces magistrates, court staff, lawyers, or
  peritos.
- Not a claim that GovAI determines the outcome of a case.
- Not an assertion of CNJ certification.
- Not an assertion that GovAI substitutes legal interpretation.
- Not an assertion of judicial validity for any record.

## CNJ and Sinapses readiness concept

CNJ and Sinapses readiness means GovAI prepares the native registries,
classifications, evidence, workflows, and reports that a tribunal or
judiciary customer would expect when adopting an AI governance posture
aligned to CNJ's current judiciary AI baseline. Readiness is a property of
GovAI's product and customer artifacts; it is not a regulatory or
judicial decision.

Acceptance of any specific GovAI deployment by a tribunal, court, or
authority occurs through processes external to GovAI and requires
professional and judicial review.

## Judiciary customer profiles

- Tribunal — a court or tribunal that operates AI-supported tools and is
  subject to CNJ atos and judiciary-specific governance expectations.
- Court technology team — internal teams that design, deploy, and
  monitor AI-supported services for the tribunal.
- Judicial support AI — internal or contracted AI products used to
  support judicial workflows. GovAI's role is governance over those
  products, not decision-making.
- Legal department — corporate or public-sector legal teams that interact
  with judicial processes and judicial data.
- Regulated law firm — law firms that handle judicial proceedings and
  judicial-secrecy data under OAB norms.
- Public-sector body — agencies, ministries, and public-sector entities
  that interact with judicial data.

## Current GovAI primitives relevant to CNJ and Sinapses readiness

These primitives are `IMPLEMENTED_FOUNDATIONAL_CONTROL` today, with the
caveat that judiciary product capabilities depend on the broader work in
`20-target-control-catalog.md` and `23-regulatory-core-roadmap.md`.

- HMAC-chained audit events, canonical bytes, sequence-numbered chain,
  append-only triggers, payload hashes.
- Envelope encryption with DEK wrapping (AES-256-GCM) and crypto-shred
  primitive.
- Tenant isolation via RLS and tenant-scoped scopes.
- API-key-based RBAC with `hasAnyRole`.
- Provider credential storage with envelope encryption.
- Workroom approval loop with separation of duties, intended-action
  hashing, semantic-expiry filtering, and one-time consumption.
- Hard-deny floor with capability assertion.
- Provider-native governed surfaces and passthrough surfaces.
- `audit_only` and `governance_active` modes for staged enablement.

## Required native GovAI capabilities for judiciary readiness

The following capabilities are `REQUIRED_NATIVE_CAPABILITY` or
`NATIVE_ENHANCEMENT_REQUIRED` for judiciary use. Their evidence path is
defined in `23-regulatory-core-roadmap.md`.

- AI system registry with judiciary fields.
- Model registry with provider, version, and approval evidence.
- Model version registry tied to lifecycle events.
- Use-case registry with intended purpose, owner, and review cadence.
- Agent registry with capability bindings.
- CNJ and Sinapses registration fields on registries.
- Risk classification engine with judiciary-aware rules and rationale.
- High-risk workflow with judiciary-specific approval evidence.
- Prohibited-use workflow including judiciary-specific prohibited uses.
- Algorithmic impact assessment workflow.
- Human supervision evidence captured through Workroom artifacts.
- Magistrate or human reviewer evidence model with explicit role and
  identity.
- Public transparency summary generation for permitted disclosures.
- Judicial secrecy classifier and access-control posture per
  `24-sensitive-data-operating-model.md`.
- Segredo de justiça access-control posture with strict default-deny.
- Sensitive-data category controls for judiciary data, including
  criminal, biometric, and personal categories.
- Adverse-event and incident workflow with judiciary-relevant severity
  classes.
- Audit and monitoring package per
  `22-certification-and-audit-readiness.md`.
- Evidence bundle and court export generation per
  `06-evidence-chain-custody.md`.
- Court-export package with optional RFC 3161 timestamp and ICP-Brasil
  signature binding.
- Significant-change review workflow.
- Periodic review workflow.
- CNIAJ-style monitoring readiness.
- Connector readiness for judiciary systems, without implementing
  connectors here.

## External and professional dependencies

- Tribunal or CNJ adoption process for any deployment.
- Qualified counsel review for legal mapping and judicial-secrecy
  decisions.
- Perito review for forensic and court-bound evidence packages.
- Magistrate authority for case-specific decisions; GovAI is not a
  magistrate and does not determine case outcomes.
- RFC 3161 TSA provider as an external service when timestamp binding is
  used.
- ICP-Brasil providers as external services when signature binding is
  used.
- Customer-side judicial counsel for OAB-norm-aware policies in legal-
  department and law-firm profiles.

## Mapping to existing judiciary docs

- `05-cnj-judiciary-mapping.md` records the requirement-level mapping for
  CNJ judiciary AI governance.
- `10-sector-legal-mapping.md` records OAB-aware controls relevant to
  law-firm and legal-department judiciary touchpoints.
- `06-evidence-chain-custody.md` records evidence-chain primitives that
  bundle and export workflows rely on.
- `15-source-register.md` records the underlying CNJ and judicial sources
  and their verification statuses.

## Readiness artifacts

- Judiciary AI registry records with intended purpose, owner, and risk
  classification.
- Risk classification records and rationales per judiciary AI system.
- Algorithmic impact assessment records.
- Human supervision and reviewer evidence per Workroom approval loop.
- Public transparency summaries where disclosure is permitted.
- Judicial secrecy and segredo de justiça access-control evidence.
- Sensitive-data classification events for judiciary data.
- Incident and adverse-event records.
- Evidence bundles for export, including optional RFC 3161 tokens and
  optional ICP-Brasil signature artifacts.
- Periodic review and significant-change records.
- Source verification records for CNJ and adjacent authorities.

## CNJ and Sinapses readiness table

The table below summarizes readiness per domain. The current state column
uses the taxonomy from `20-target-control-catalog.md`. The
"Turns ready when" column states the concrete future condition that would
allow GovAI to claim readiness for that domain. Acceptance by an external
authority is not implied.

| CNJ and Sinapses readiness domain | Native GovAI target capability | Current state | Required evidence | Professional or external dependency | Turns ready when | Related docs |
|---|---|---|---|---|---|---|
| Judiciary AI registry | Tenant-scoped registry with judiciary fields, intended purpose, owner, and risk ties | REQUIRED_NATIVE_CAPABILITY | Registry records, change events, ownership history | Qualified counsel for policy framing; tribunal adoption process | Registry schema, routes, audit events, and tests exist and are cited in `05-cnj-judiciary-mapping.md` | `05-cnj-judiciary-mapping.md`, `20-target-control-catalog.md`, `23-regulatory-core-roadmap.md` |
| Model and model-version registry | Native registry tied to provider records, lifecycle states, and approvals | REQUIRED_NATIVE_CAPABILITY | Lifecycle events, version provenance, approvals | Qualified counsel for governance policy | Schema, routes, audit events, and tests exist and are cited | `05-cnj-judiciary-mapping.md`, `20-target-control-catalog.md` |
| Use-case registry | Native registry with intended purpose, owner, review cadence | REQUIRED_NATIVE_CAPABILITY | Use-case records, periodic-review events | Qualified counsel; tribunal review | Schema, routes, evidence, and tests exist and are cited | `05-cnj-judiciary-mapping.md`, `20-target-control-catalog.md` |
| Agent registry | Native registry with capability bindings tied to hard-deny floor | REQUIRED_NATIVE_CAPABILITY | Agent identity records, capability bindings, change events | Qualified counsel for prohibited-use definitions | Schema, routes, audit events, and tests exist and are cited | `20-target-control-catalog.md` |
| CNJ and Sinapses registration fields | Native registration fields on judiciary AI records | REQUIRED_NATIVE_CAPABILITY | Registration records, evidence of completeness | Tribunal-driven scope; qualified-counsel review | Field schema and tests exist and are cited | `05-cnj-judiciary-mapping.md` |
| Risk classification | Engine with judiciary-aware rules and rationale | REQUIRED_NATIVE_CAPABILITY | Classification records, rationales | Qualified counsel for risk rules | Engine, schema, evidence, and tests exist and are cited | `20-target-control-catalog.md` |
| High-risk workflow | Native workflow with judiciary-specific approval evidence | REQUIRED_NATIVE_CAPABILITY | Approval records, supporting evidence | Qualified-counsel and tribunal review | Workflow, schema, evidence, and tests exist and are cited | `20-target-control-catalog.md`, `23-regulatory-core-roadmap.md` |
| Prohibited-use workflow | Native registry and hard-deny enforcement for judiciary prohibited uses | NATIVE_ENHANCEMENT_REQUIRED | Prohibited-use records, hard-deny events | Qualified-counsel definition of prohibited uses | Registry, hard-deny integration, and tests exist and are cited | `05-cnj-judiciary-mapping.md`, `20-target-control-catalog.md` |
| Algorithmic impact assessment | Native AIA workflow with versioning and approvals | REQUIRED_NATIVE_CAPABILITY | Assessment records, version history, approvals | DPO and qualified-counsel review | Workflow, schema, evidence, and tests exist and are cited | `21-regulatory-intelligence-operating-model.md`, `23-regulatory-core-roadmap.md` |
| Human supervision evidence | Workroom-mediated evidence with role, identity, and decision | IMPLEMENTED_FOUNDATIONAL_CONTROL for the Workroom loop; NATIVE_ENHANCEMENT_REQUIRED for judiciary case-management | Workroom artifacts and decisions | Magistrate or qualified human reviewer | Case-management extension, schema, and tests exist and are cited | `05-cnj-judiciary-mapping.md`, `20-target-control-catalog.md` |
| Magistrate or human reviewer evidence model | Native reviewer-evidence schema bound to role and identity | REQUIRED_NATIVE_CAPABILITY | Reviewer records and decisions | Magistrate or court staff identity; qualified-counsel review | Schema, evidence, and tests exist and are cited | `05-cnj-judiciary-mapping.md` |
| Public transparency summary | Native generator for permitted disclosures | REQUIRED_NATIVE_CAPABILITY | Generated summaries, disclosure records | Tribunal authorization for any disclosure | Generator, schema, and tests exist and are cited | `05-cnj-judiciary-mapping.md`, `22-certification-and-audit-readiness.md` |
| Judicial secrecy classifier | Native classifier with strict default-deny posture | REQUIRED_NATIVE_CAPABILITY | Classification events, restricted-access decisions | Qualified-counsel review of borderline cases | Classifier, access posture, and tests exist and are cited | `24-sensitive-data-operating-model.md`, `05-cnj-judiciary-mapping.md` |
| Segredo de justiça access-control posture | Native access posture with explicit allow lists and audit | REQUIRED_NATIVE_CAPABILITY | Access decisions and audit events | Qualified-counsel governance | Posture, schema, and tests exist and are cited | `24-sensitive-data-operating-model.md` |
| Sensitive-data category controls | Native controls per judiciary-relevant categories | NATIVE_ENHANCEMENT_REQUIRED | Classification, redaction, encryption events | DPO and qualified-counsel review | Per-category detectors, schema, and tests exist and are cited | `24-sensitive-data-operating-model.md` |
| Adverse-event and incident workflow | Native workflow with judiciary-aware severity | REQUIRED_NATIVE_CAPABILITY | Incident records, timelines, notifications | Qualified-counsel review for notifications | Workflow, schema, evidence, and tests exist and are cited | `20-target-control-catalog.md`, `23-regulatory-core-roadmap.md` |
| Audit and monitoring package | Native audit views and monitoring filtered by judiciary scope | NATIVE_ENHANCEMENT_REQUIRED | Audit dashboards, monitoring records | Audit and perito review | Dashboards, schema, and tests exist and are cited | `22-certification-and-audit-readiness.md` |
| Evidence bundle and court export | Native bundle generation with optional TSA and ICP-Brasil binding | NATIVE_ENHANCEMENT_REQUIRED | Bundles, integrity proofs, exports, optional timestamp tokens, optional signatures | RFC 3161 TSA and ICP-Brasil providers; qualified counsel | Bundle generator, export routes, integration points, and tests exist and are cited | `06-evidence-chain-custody.md`, `22-certification-and-audit-readiness.md` |
| Significant-change review | Native workflow that re-fires AIA and risk review on significant change | REQUIRED_NATIVE_CAPABILITY | Significant-change records and decisions | DPO and qualified-counsel review | Workflow, schema, and tests exist and are cited | `21-regulatory-intelligence-operating-model.md` |
| Periodic review | Native cadence-driven review per use case | REQUIRED_NATIVE_CAPABILITY | Review records and decisions | DPO and qualified-counsel review | Workflow, schema, and tests exist and are cited | `21-regulatory-intelligence-operating-model.md` |
| CNIAJ-style monitoring readiness | Native monitoring posture aligned with CNIAJ-style expectations | REQUIRED_NATIVE_CAPABILITY | Monitoring records, posture attestations | Tribunal adoption process | Monitoring schema, posture, and tests exist and are cited | `05-cnj-judiciary-mapping.md`, `21-regulatory-intelligence-operating-model.md` |
| Connector readiness for judiciary systems | Native connector framework that supports future judiciary connectors | CONNECTOR_ENRICHMENT; connector framework itself is REQUIRED_NATIVE_CAPABILITY | Provenance and ingestion records | Tribunal cooperation and IT-team agreements | Connector framework, schema, and tests exist and are cited | `23-regulatory-core-roadmap.md` |

## Wording and forbidden framings

- Use "readiness", "target architecture", "future implementation",
  "external authority", "court or tribunal adoption process", and
  "professional and legal review".
- Do not write that GovAI holds CNJ certification or that any tribunal
  has accepted GovAI.
- Do not assert court admissibility, judicial validity, or guaranteed
  acceptance of any GovAI artifact.
- Do not assert that GovAI replaces magistrates, court staff, lawyers,
  peritos, or other qualified professionals.
- Do not assert that GovAI determines case outcomes.

## Relationship to issues

Relates to #59.

Relates to #33.

#59 remains open for implementation follow-up.

Umbrella tracker #33 remains active.
