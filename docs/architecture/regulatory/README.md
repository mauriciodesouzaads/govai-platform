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
