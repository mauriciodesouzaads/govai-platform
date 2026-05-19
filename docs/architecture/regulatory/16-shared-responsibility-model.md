# Shared Responsibility Model

## Purpose

Governance outcomes never depend on GovAI alone. They depend on the AI
provider, the customer, and GovAI together. This document defines the
responsibility boundaries for native GovAI usage and for future connector-based
governance, so that no actor is assumed to carry another actor's obligations.

A clear shared-responsibility model is a prerequisite for the connector
framework. It is referenced by every regulatory mapping document.

This is a technical architecture document. It is not legal advice and not a
compliance guarantee.

## Responsibility actors

- **AI provider / third-party platform** — produces model inference and
  platform-level controls; publishes its own documentation and contractual
  terms.
- **Customer / controller** — owns the tenancy, chooses legal bases, defines
  organizational process, and holds the provider contracts.
- **GovAI** — normalizes, correlates, governs, audits, and reports; generates
  independent evidence and anchors it to a verifiable chain.
- **User / operator** — the person performing the AI-assisted work; controls
  the prompt and input content.
- **DPO / compliance / legal / auditor** — defines and reviews controls,
  assesses risk, and interprets evidence within the organization.
- **External counsel / forensic expert** — provides independent legal
  assessment and forensic interpretation.

## Native GovAI mode

In native mode the customer routes AI usage through GovAI's governed and
passthrough surfaces (for example, AI used through GovAI in front of OpenAI or
Anthropic).

- The **provider** runs inference and maintains its platform controls.
- The **customer** configures the tenancy, the legal basis, and the provider
  contract.
- The **user** supplies the prompt and input content.
- **GovAI** applies governance, captures primary evidence, anchors it to the
  audit chain, and produces reporting.

Native mode is where GovAI generates the largest share of primary evidence,
because the governed and passthrough surfaces are on the request path.

## Connector mode

In connector mode the customer continues to use an enterprise AI platform
(for example, Microsoft, AWS, Azure, Google) and GovAI ingests that platform's
audit logs, events, and exports.

- The **provider** runs inference, maintains controls, and produces its own
  native audit data.
- The **customer** configures the third-party platform, grants GovAI scoped
  read access, and holds the provider contract.
- **GovAI** ingests, normalizes, correlates, and reports on the third-party
  evidence, and adds independent audit anchoring.

In connector mode GovAI's evidence depends on what the provider exposes. GovAI
does not control the third-party platform's behavior or its native logging.

## Responsibility matrix

The matrix is indicative and is refined by `13-connector-compliance-mapping.md`
and the per-provider connector work. "Shared" means responsibility is split
and must be defined per deployment.

| Area | Provider responsibility | Customer responsibility | GovAI responsibility | Notes |
|---|---|---|---|---|
| Model / platform behavior | Owns | None | None | Provider-controlled |
| Provider security controls | Owns | Verifies via contract | None | Provider documents; customer reviews |
| Legal basis | None | Owns | None | Controller decision |
| Tenant configuration | Exposes settings | Owns | Assists / records | Customer configures |
| Provider contract / DPA | Offers | Owns | None | Customer–provider agreement |
| Prompt / input content | None | Accountable | Governs / records | User supplies; customer accountable |
| Audit evidence generation | Native logs | Enables logging | Owns native-mode evidence | Shared across modes |
| Evidence ingestion | Exposes APIs/logs | Grants access | Owns ingestion | Connector mode |
| Evidence normalization | None | None | Owns | GovAI transforms to a common model |
| Independent audit anchoring | None | None | Owns | HMAC-chained, GovAI-generated |
| Data retention | Provider-side retention | Sets policy | Enforces GovAI-side policy | Shared; see limitations |
| Incident notification | Notifies per contract | Owns regulatory notification | Surfaces signals / evidence | Customer holds the legal duty |
| Access control | Provider-side IAM | Owns identities | Tenant isolation / RBAC | Shared across boundaries |
| Export / reporting | Raw exports | Requests / consumes | Produces reports | GovAI assembles, customer uses |
| Legal assessment | None | Commissions | None | Qualified professionals only |
| Forensic interpretation | None | Commissions | Provides verifiable evidence | Perito interprets; GovAI does not |

## Evidence flow model

- **Provider-generated evidence** — native logs and events from the AI
  provider or third-party platform.
- **GovAI-generated evidence** — audit events, integrity hashes, and
  governance decisions GovAI produces independently.
- **Customer-supplied context** — legal bases, configuration, organizational
  metadata that give the evidence meaning.
- **Normalized / correlated evidence** — provider and GovAI evidence
  transformed into a consistent representation and linked across sources.
- **Report / evidence bundle output** — consolidated, source-referenced output
  for review by the customer's professionals.

## Limitations

Connector-mode evidence is constrained by factors outside GovAI's control:

- provider API rate limits and access scopes;
- provider-side retention windows;
- incomplete or partial logs;
- delayed or batched audit streams;
- missing native fields;
- contractual limitations on data use;
- jurisdictional constraints on data location and transfer;
- customer misconfiguration of the third-party platform.

Every connector mapping must state which of these limitations apply. Statements
about a provider's API behavior are marked "to be verified" until confirmed
against provider documentation.

## No certification of third parties

- GovAI does not certify third-party providers.
- GovAI can ingest, normalize, and correlate evidence from third-party
  providers.
- A third-party provider's compliance posture remains subject to that
  provider's own contracts, documentation, and the customer's legal review.

## Relationship to future connectors

This model is a prerequisite for the Phase 5 and later connector framework. No
connector should be designed or implemented before its responsibility split,
evidence flow, and limitations are recorded against this model and the
connector compliance mapping.

## Relationship to issue #59

Relates to #59.

Relates to #33.

Umbrella tracker #33 remains active.
