# GovAI Governance Philosophy

## Purpose

This document defines the architectural principles that govern GovAI's
governance behavior. It is written before the tool-invocation and connector
framework work (Workroom Phase 5 and later) so those phases inherit an
explicit, stable set of principles rather than deriving them ad hoc.

This is a technical architecture document. It is not legal advice and not a
compliance guarantee. See the disclaimer section.

## Core principles

- **Integrate, do not compete.** GovAI is not positioned against enterprise AI
  platforms. It governs, audits, normalizes, correlates, and reports across
  native GovAI usage and third-party AI systems.
- **Evidence is mandatory; friction is proportional.** Every governed action
  produces evidence. Friction (blocking, approvals, prompts) is applied in
  proportion to assessed risk, not uniformly.
- **Hard-deny floor is always on.** A minimum set of denials is invariant
  across every operating mode and cannot be lowered by configuration or
  approval.
- **Approval is the exception, not the default.** Human approval gates a small
  set of risk-bearing actions. It is not a routine tax on ordinary work.
- **Visibility without interruption.** Observability and evidence capture do
  not require interrupting the operator. Interruption is reserved for cases
  where risk justifies it.
- **Professional review is supported, not replaced.** GovAI produces material
  that lawyers, DPOs, auditors, compliance officers, and forensic experts can
  review. It does not perform their professional judgment for them.
- **Evidence does not mean plaintext.** Evidence is captured as hashes,
  envelope-encrypted payloads, and redaction metadata. Capturing evidence does
  not require storing sensitive content in the clear.
- **Legal-grade evidence requires chain context and professional review.**
  Hash-chained audit records are necessary but not sufficient. Legal-grade use
  also depends on source verification, chain-of-custody context, retention
  discipline, and qualified professional interpretation.

## Friction profiles

GovAI describes governance intensity through four conceptual friction
profiles. The hard-deny floor and evidence capture are constant; what varies
is the intensity of policy blocking, approvals, and reporting.

| Control | Audit-only | Governed standard | Regulated | Legal-grade |
|---|---|---|---|---|
| Hard-deny floor | Always on | Always on | Always on | Always on |
| Evidence capture | On | On | On | On |
| Policy blocking | Minimal | Proportional | Strong | Strong |
| Approvals | Rare/advisory | Selective | Common | Strict |
| Reports | Basic | Full | Full | Forensic/legal-grade |

These profiles are an architectural model. The current platform realizes the
`audit_only` and `governance_active` Workroom governance modes and the Phase 4
approval loop; the `regulated` and `legal-grade` profiles describe intended
direction and are elaborated by later regulatory mapping and reporting work.

## Native and connector modes

GovAI governs in two complementary modes:

- **Native GovAI governance.** A customer routes AI usage through GovAI's
  governed and passthrough surfaces. GovAI generates the primary evidence.
- **Third-party governance aggregation (connector mode).** A customer keeps
  using an enterprise AI platform; GovAI ingests that platform's audit logs,
  events, and exports.

In both modes GovAI **preserves provider-native behavior** and adds
normalization, correlation, independent evidence anchoring, and reporting.
GovAI does not replace the third-party platform's own controls.

## Hard-deny floor

The hard-deny floor is the set of denials that apply in every mode and that
configuration or approval cannot override. It is invariant by design.

Representative categories (not an exhaustive list):

- secret exfiltration;
- credential leakage;
- destructive actions outside granted authority;
- malware or abuse facilitation;
- regulated-data leakage beyond the applicable policy ceiling;
- weakening of the audit or evidence chain.

The floor is a minimum. Individual modes and policies may deny more; none may
deny less.

## Approval policy

- Approval is **risk-proportional**: it gates specific risk-bearing actions,
  not ordinary work.
- Approval is **not default friction**: most governed actions proceed without
  a human gate while still being recorded as evidence.
- The **Workroom Phase 4 approval loop** is the concrete realization: an
  approval request is bound to exact action parameters, decided by an
  authorized human under separation of duties, consumed once, and audited.
- Approvals **cannot override the hard-deny floor.** A granted approval may
  authorize an in-policy exception (for example, a mode override); it can
  never authorize a hard-denied action.

## Evidence principles

GovAI evidence is built from the existing audit primitives:

- **Audit trails** — append-only `audit_events` recording governed actions.
- **Payload hashes** — `payload_hash` over canonical content so integrity is
  verifiable without exposing content.
- **Encrypted payloads** — sensitive content is envelope-encrypted at rest in
  `audit_event_payloads`; the data encryption key is wrapped, never stored in
  the clear.
- **Redaction metadata** — safe, non-sensitive descriptors travel with events
  so evidence is reviewable without revealing protected content.
- **Chain integrity** — events are HMAC-chained (`previous_hmac` to `hmac`)
  with stored canonical bytes, so tampering is detectable.
- **Workroom turns** — `workroom_turns` anchor governance events to a
  per-Workroom timeline for review and the audit subview.
- **Evidence bundles** — consolidated, source-verified evidence packages are
  future work, tracked by the regulatory mapping initiative.

## Legal and compliance disclaimer

- This document is technical architecture, not legal advice.
- GovAI does not guarantee legal or regulatory compliance.
- GovAI does not guarantee judicial admissibility of any record.
- GovAI does not replace lawyers, DPOs, auditors, compliance officers, or
  forensic experts (peritos).
- Compliance outcomes depend on customer configuration, provider contracts,
  organizational processes, legal bases, applicable sector rules, and
  qualified professional review.

## Relationship to issue #59

Relates to #59.

Relates to #33.

Umbrella tracker #33 remains active.
