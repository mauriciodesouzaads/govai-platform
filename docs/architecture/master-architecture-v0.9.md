> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** CANDIDATE_TARGET_ARCHITECTURE
> **ORIGINAL_SOURCE_VERSION:** v0.9-draft (2026-05-27)
> **ORIGINAL_SOURCE_ANCHOR:** owner-supplied v0.9 architecture package (package path `docs/architecture/draft/govai-ai-trust-layer-master-architecture-v0.9.md`)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D5=APPROVED_FOR_PROMULGATION)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES (byte-identical below this header)
> **SOURCE_SHA256:** `cc8ea60ce8244dd928c3a3146deef433af0763b2d61cd0d83a68ed003f241fa3` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** CANDIDATE TARGET ARCHITECTURE (D5) — a 2026-05-27 strategic target-architecture consolidation, NOT a description of the current runtime. Its "current state" cells (§2.2, §4) describe the state at the time of the 2026-05 audits and are historical: at the Foundation V1 anchor the provider-native evidence gap is closed (AuditBridge wired on the four direct routes → capture outbox → B3 sealer), the AWS KMS adapter exists, artifact hygiene/claims policy/threat model are promulgated, evidence-completeness views/metrics/read API exist; the Governance Kernel package, cockpit/UI, reporting bundles, Shadow AI/connectors, distributed rate limiting and the admin DLP/crypto-shred flows remain targets. Its market references carry their own access dates (2026-05-27) and are not refreshed here. §16 document set: items 2–6 and 9–11 are promulgated in this tree at the D9 destinations — note item 10 `docs/product/claims-policy.md` is promulgated at `docs/architecture/claims-policy.md`; items 7–8 (`aws-kms-adapter.md`, `provider-native-compatibility-harness.md`) exist in the repository in newer post-implementation versions than the v0.9 package copies (which are therefore not promoted). The §17 promotion rule is superseded by this promulgation: the document is promoted as a candidate target under the D9 destination `docs/architecture/master-architecture-v0.9.md`, not as the canonical `govai-ai-trust-layer-master-architecture.md`.
> ---

# GovAI AI Trust Layer — Master Architecture and Scope

**Status:** v0.9-draft  
**Date:** 2026-05-27  
**Canonical language:** English, with PT-BR regulatory glossary where needed  
**Draft location:** `docs/architecture/draft/govai-ai-trust-layer-master-architecture-v0.9.md`  
**Canonical target after approval:** `docs/architecture/govai-ai-trust-layer-master-architecture.md`

This is the strategic architecture and scope consolidation for GovAI. It defines doctrine, current-state boundaries, target-state architecture, release gates, build-vs-integrate boundaries, evidence requirements, claims discipline and the document set required before implementation begins. It is not a marketing document and it is not a code-level SPEC.

---

## 0. Executive decision

GovAI should proceed as a **Brazil-first, globally extensible AI Trust Layer**: a platform that enables organizations to use AI with proportional trust, safety, governance, auditability and evidence controls across provider-native usage, a governed execution API, Workroom collaboration, connectors and shadow-AI visibility.

The architecture is intentionally ambitious. The answer to adversarial review is not to shrink the product into a narrow MVP. The correct answer is to organize the ambition into planes, release gates, capability states and explicit non-claims.

**Decision:** adopt the Seven-Plane doctrine, but keep this master in draft until the linked ADRs and SPECs are accepted.

---

## 1. Positioning

### 1.1 Canonical name

**GovAI AI Trust Layer**

“GovAI GRC Platform” remains a category description. “AI Trust Layer” is the product substance: a layer that lets AI usage become controllable, auditable and evidence-producing without destroying native provider experience.

### 1.2 Positioning statement

> GovAI is the AI Trust Layer that helps organizations use AI with proportional controls, auditability, evidence and governance across native providers, APIs, external connectors, agents and Workrooms — without breaking the native experience.

### 1.3 What GovAI is not

GovAI is not a generic AI gateway, a legal-compliance oracle, a replacement for DPOs/lawyers/auditors/regulators, a model provider, or an automatic compliance system.

### 1.4 Product doctrine

1. **Native experience preserved.** Provider-native SDKs and workflows must remain usable with minimal adaptation.
2. **Friction proportional to risk.** Observe, warn, ask, redact, sandbox, approve or block based on risk.
3. **Evidence independently verifiable.** HMAC chain is the floor; Merkle/TSA/ICP-Brasil anchoring is future evidence grade.
4. **Source honesty and anti-overclaim.** Every regulatory or market claim is tied to source, capability status and limitations.
5. **Standalone and integrated.** GovAI must be valuable alone and more powerful when connected to Purview, OneTrust, Securiti, BigID, M365, Google Workspace, SIEM/SOAR, ServiceNow/Jira, provider logs and other systems.
6. **Brazil-first, global-ready.** LGPD/ANPD/CNJ/Bacen/CVM/SUSEP/health/legal vocabulary is a differentiator; EU AI Act, NIST AI RMF, ISO/IEC 42001 and OWASP are alignment references, not fake certification claims.
7. **Trust is operational.** If a surface is used for AI execution, it must eventually produce complete evidence, not just logs.

---

## 2. Current-state summary from audits

### 2.1 Strong foundations already present

Current audits found a serious technical foundation: Fastify API, audit chain, RLS FORCE, API keys, provider credentials envelope encryption, DLP-BR detectors, provider-native Anthropic/OpenAI packages, `/v1/runs`, Workroom phases, Regulatory Core R1-R9, CI/test discipline and strong security posture where implemented.

### 2.2 Critical gaps

| Gap | Current state | Target state | Severity |
|---|---|---|---|
| Provider-native evidence | `/governed/*` and `/passthrough/*` emit audit events to app logs, not HMAC chain | All critical surfaces use Audit Bridge and Evidence Plane | P0 technical / P0 commercial |
| Production KMS | DevKms exists; production KMS fails closed | AWS KMS adapter first, then GCP/Azure/sovereign options | P0 technical / P1 commercial |
| Governance Kernel | Decision logic is dispersed | Single kernel called by all surfaces | P0 architectural |
| DLP RT-bridge | Rich findings are mostly advisory | Tenant policy binding maps sensitive classes to warn/redact/block/ask | P1 technical / P0 for security wedge |
| Cockpit/reporting | No UI/export pipeline | Read-only Cockpit Alpha and Reporting v1 evidence bundle | P0 commercial / P2 technical |
| Shadow AI/connectors | Mostly doctrine/schema reserved | Privacy-by-design ingestion + connector SDK | P1 strategic / P0 narrative |
| Artifact hygiene | `.env.local` was present in a shared ZIP artifact | Safe package script + secret scan before sharing | P0 operational |
| Rate limiting | Per-process memory rate limit reported | Redis/distributed rate limiting for multi-instance production | P1 security/scale |
| Admin DLP/crypto-shred routes | Authenticated 501 placeholders | Operational flows with audit + RBAC + DSR/legal-hold handling | P1/P2 depending claim |

---

## 3. Market and competitive context

### 3.1 Market direction

AI governance and trust vendors are converging toward AI inventory, ownership, risk classification, approvals, runtime enforcement, sensitive-data masking/redaction, continuous monitoring, audit outputs and agent/MCP governance. This confirms that GovAI’s Seven-Plane model is not gratuitous overengineering; it is a disciplined way to cover a real market convergence while preserving GovAI’s Brazil-first evidence and runtime differentiation.

### 3.2 Cited public references

- OneTrust AI Governance publicly positions AI governance from policy to runtime and lists capabilities such as AI inventory, risk tiering, approval workflows, automated evidence/audit outputs, continuous monitoring, policy violations, prompt/output filtering, block/allow actions by policy, sensitive-data masking/redaction, runtime guardrails and agent/MCP policy enforcement. Source: https://www.onetrust.com/solutions/ai-governance/ — accessed 2026-05-27.
- NIST AI RMF is a voluntary AI risk-management framework intended to help incorporate trustworthiness considerations into AI systems. Source: https://www.nist.gov/itl/ai-risk-management-framework — accessed 2026-05-27.
- OWASP Top 10 for LLMs and GenAI Applications 2025 includes prompt injection, sensitive information disclosure, supply chain, excessive agency and other GenAI/LLM risks. Source: https://genai.owasp.org/llm-top-10/ — accessed 2026-05-27.
- ISO/IEC 42001:2023 is an AI management system standard. Source: https://www.iso.org/standard/42001 — accessed 2026-05-27.
- EU AI Act / Regulation (EU) 2024/1689 is the EU legal act laying down harmonised rules on AI. Source: https://eur-lex.europa.eu/eli/reg/2024/1689/oj — accessed 2026-05-27.

### 3.3 GovAI differentiation

GovAI should not try to beat global incumbents as a generic AI governance suite. It should differentiate through Brazil-first regulatory/sensitive-data vocabulary, runtime plus evidence, provider-native preservation, standalone and integrated deployment, SMB/mid-market accessibility, and no fake compliance.

---

## 4. The Seven Planes

Each plane must keep **current state**, **target state** and **gap** explicit.

### Plane 1 — Native Experience / Data Plane

**Responsibility:** Receive AI traffic, preserve provider-native shape, support `/governed/{provider}/*`, `/passthrough/{provider}/*`, `/v1/runs`, streaming and tool/function calling.

**Current state:** Anthropic/OpenAI provider-native surfaces exist. `/v1/runs` exists. Streaming exists in provider packages. Direct provider-native routes do not persist evidence to the HMAC chain.

**Target state:** Every surface calls Governance Kernel and Audit Bridge; native SDK compatibility remains first-class; `/v1/runs` remains the Governed Execution API; provider identity evolves beyond hardcoded Anthropic/OpenAI where appropriate.

**Gap:** Audit Bridge, Kernel extraction, compatibility harness, streaming terminal evidence.

### Plane 2 — Governance Kernel / Policy Plane

**Responsibility:** Central decision point for capability, risk, DLP, policy binding, friction mode and hard-deny floor.

**Current state:** Decision logic is dispersed across orchestrator, policy.ts, provider handlers, governed-native resolver and regulatory service.

**Target state:** `packages/governance-kernel` exposes a pure decision interface consumed by all surfaces.

**Gap:** Kernel extraction, PolicyPort, CapabilityPort, DlpPort, EnforcementPort, policy bindings, RT-bridge.

### Plane 3 — Evidence Plane

**Responsibility:** Capture, seal, verify and export evidence.

**Current state:** `core-audit` and `audit_append_locked` are strong where used. `/v1/runs` persists chain evidence. Direct provider-native routes are log-only. No outbox/sealer/completeness verifier yet.

**Target state:** Durable outbox, chain state, sealer, strict/best_effort posture, capture refs, completeness verifier, future Merkle/TSA/ICP-Brasil anchoring and exportable evidence bundles.

**Gap:** SPEC v2.1 implementation, DB hardening, completeness dashboard/read models.

### Plane 4 — Identity / Secrets / KMS Plane

**Responsibility:** Human/machine identity, API keys, SSO/SCIM future, RBAC/ABAC, provider credentials, KMS/BYOK, crypto-shred primitives.

**Current state:** API keys, JWT/RBAC, tenant context, provider_credentials envelope encryption and DevKms exist. Production KMS intentionally fails closed.

**Target state:** AWS KMS adapter first, rotation procedure, HMAC key version verification, BYOK, dedicated/sovereign cells later.

**Gap:** AWS KMS SPEC and implementation, key rotation runbooks, sealer role threat model, credential monitoring.

### Plane 5 — Integration / Shadow AI Plane

**Responsibility:** Ingest external signals, discover shadow AI, normalize connectors, correlate identity/source quality, support privacy-by-design.

**Current state:** Schema reserves `shadow`; provenance vocabulary exists. Connector runtime and Shadow AI ingestion are planned.

**Target state:** Metadata-first ingestion, source quality precedence, connector SDK, external telemetry, acceptance/attestation flows.

**Gap:** Shadow AI SPEC, connector threat model, privacy rules, identity correlation, ingestion API.

### Plane 6 — Regulatory Intelligence / Update Plane

**Responsibility:** Regulatory mapping, control catalog, source register, signed policy/detector/regulatory/provider/connector/report packs.

**Current state:** Regulatory Core R1-R9 exists as foundational/advisory. Update plane does not exist beyond direct overrides.

**Target state:** Pull-based signed packs, canary/beta/stable channels, review/promotion workflow, audit events for pack activation, rollback.

**Gap:** Policy pack loader, signing and transparency strategy, update governance, pack schema.

### Plane 7 — Cockpit / Workroom / Reporting Plane

**Responsibility:** Make value visible to DPO, legal, CISO, auditors, owners and operators. Workroom supports human/multi-agent governance. Reporting produces evidence bundles.

**Current state:** Workroom is strong in backend. Cockpit/UI and reporting/export are absent.

**Target state:** Read-only Cockpit Alpha, evidence completeness view, runs/policy/DLP/audit status, Reporting v1 HTML/CSV/JSON bundle, Workroom extensions later.

**Gap:** Cockpit SPEC, read models, reporting pipeline, claim-gated UI wording.

---

## 5. Build vs Integrate

### Build natively

Build the trust substrate: Governance Kernel, Evidence Plane/Audit Bridge, DLP-BR and policy binding, provider-native governance wiring, Workroom, Brazil-first regulatory mapping, claims control and shadow-AI core semantics.

### Integrate first

Integrate cloud KMS/HSM, SSO/OIDC/SCIM, SIEM/SOAR, Purview/OneTrust/Securiti/BigID/Immuta/Collibra, ServiceNow/Jira/GitHub/GitLab, M365/Google Workspace/Slack/Teams, TSA/ICP-Brasil, cloud/provider audit logs and mature customer systems of record.

### Decision rule

Build when the capability preserves GovAI’s trust/evidence/kernel differentiation. Integrate when the capability is mature external infrastructure or system of record.

---

## 6. Foundation Release

Foundation Release is not an MVP. It is the first coherent release that makes GovAI true enough to sell as a controlled pilot without misleading customers.

### 6.1 Pre-conditions before implementation

1. Threat model.
2. Claims policy tied to capability status.
3. Artifact hygiene control and safe packaging script.
4. ADR-016, ADR-017, ADR-018, ADR-019 drafted or accepted.
5. SPEC v2.1 accepted with DB/role/security hardening.

### 6.2 Deliverables and Definition of Done

| Deliverable | Definition of Done |
|---|---|
| AWS KMS adapter | AWS adapter implements required operations; production boot passes only with non-dev KMS; tests cover KMS failure; no plaintext provider key leaks |
| Governance Kernel | Package exists; `/v1/runs` and provider-native supported paths call it; tests prove no local bypass |
| Audit Bridge + Evidence Outbox | Outbox/chain state/capture refs/sealer exist; `/governed/*`, `/passthrough/*`, `/v1/runs` persist evidence; no raw audit-event logs |
| Provider-native compatibility harness | Anthropic `messages.create` and OpenAI `responses.create`, with streaming/tools where supported; request shape preserved; audit capture verified |
| DLP RT-bridge | At least one non-baseline class can be policy-bound to warn/redact/block; raw match text never persisted |
| Cockpit Alpha | Read-only dashboards for runs, audit completeness, DLP counts, policy decisions and invocation status; no risky legal wording |
| Reporting v1 | HTML/CSV/JSON evidence bundle without TSA; marked technical evidence bundle, not certification |
| Distributed rate limiting | Multi-instance safe rate limiting backed by Redis or equivalent |
| README/status update | README reflects supported/foundational/planned/501 states |

### 6.3 Suggested implementation order

Artifact hygiene → threat model/claims policy → AWS KMS → SPEC v2.1 DB hardening → Governance Kernel → Audit Bridge/sealer → provider-native rewiring → `/v1/runs` refactor → compatibility harness → Cockpit Alpha/Reporting v1 → DLP RT-bridge.

---

## 7. Roadmap after Foundation

**Release 2:** signed policy/update packs, Shadow AI alpha, connector SDK v0, Workroom agent-review primitives only if scheduled, TSA anchoring, more KMS adapters.

**Release 3:** DSR/LGPD workflows, retention/legal hold, backup/DR maturity, ICP-Brasil optional anchoring, BYOC/self-hosted/sovereign deployment, persona-specific Cockpit, priority connectors.

---

## 8. Evidence completeness

Evidence integrity is not enough. GovAI must prove completeness.

Minimum metrics: captured count, sealed count, failed count, pending age, seal lag, unknown_after_dispatch, stream orphan, provider_invocation_without_audit_event, audit_event_without_provider_invocation.

Cockpit Alpha must expose captured/sealed/failed/pending/seal-lag/unknown states.

---

## 9. Provider-native compatibility

Foundation scope: Anthropic `messages.create` and OpenAI `responses.create`; streaming/tools where supported; baseURL override; GovAI API key header; provider credential resolution; error/timeout behavior; no raw sensitive payload in logs.

Release 2+ extends to files, multipart, chat-completions, Codex/Claude Code-like flows and model-specific metadata.

---

## 10. Friction budget

Initial targets are provisional and must be measured, not promised commercially.

| Path | Target overhead |
|---|---|
| Passthrough low-risk best_effort | p95 < 50 ms excluding provider latency |
| Governed native low-risk | p95 < 100 ms excluding provider latency |
| DLP scan/redaction | p95 < 250 ms for normal prompt sizes |
| Strict evidence seal | p95 < 750 ms initially |
| Approval required | Human workflow; no low-latency promise |

---

## 11. Shadow AI privacy-by-design

Shadow AI is future-release capability, but doctrine is fixed: metadata-first, content only by explicit tenant policy and admin attestation, redaction/hashing by default, source quality tracked, and warnings designed as guidance/protection rather than punishment.

Detailed design belongs in `docs/architecture/specs/future/shadow-ai-privacy.md`.

---

## 12. Agentic Action Governance

Agentic governance is a future capability under design, not a Foundation deliverable. The master only reserves the principle: any future action that mutates external state must carry intended-action hash, risk class, least-privilege scope, policy decision, approval when required and post-action evidence.

Detailed taxonomy belongs in `docs/architecture/specs/future/agentic-action-governance.md`. No commercial claim may mention agentic governance until a roadmap release includes it and the capability is supported.

---

## 13. Claims control

Claims are gated by capability status.

Allowed now: building a Brazil-first AI Trust Layer; technical evidence where supported; configurable policies where implemented; governance readiness support with limitations.

Qualified: forensic review only after Audit Bridge covers the relevant surface; LGPD workflows only for implemented workflows; compliance readiness only as readiness/evidence support; Shadow AI only after ingestion exists.

Prohibited: guarantees compliance; makes AI use legal; replaces DPO/lawyer/auditor/regulator; prevents all leakage; eliminates AI risk; certified by ISO/EU/LGPD unless certification exists.

---

## 14. Deployment models

| Tier | Model | KMS | Notes |
|---|---|---|---|
| Starter/Business | SaaS pooled with RLS FORCE | managed | accessible deployment |
| Enterprise | pooled or dedicated cell | tenant-managed option | stronger isolation |
| Regulated | dedicated cell | BYOK recommended/required | stricter evidence posture |
| Sovereign | BYOC/self-hosted | customer HSM/KMS | judiciary/public-sector path |

---

## 15. Open decisions before v1.0

Team/bus-factor; pricing/packaging; certification roadmap; backup/DR/RPO/RTO; HMAC key rotation; provider identity model; governance-as-API external contract; EU AI Act commercial position for Brazil-based multinationals; architecture review cadence.

---

## 16. Document set

1. This master architecture.
2. `docs/architecture/adr/ADR-016-governance-kernel.md`
3. `docs/architecture/adr/ADR-017-audit-bridge-evidence-plane.md`
4. `docs/architecture/adr/ADR-018-seven-planes-ai-trust-layer.md`
5. `docs/architecture/adr/ADR-019-provider-identity-model.md`
6. `docs/architecture/specs/spec-v2.1-governance-kernel-audit-bridge.md`
7. `docs/architecture/specs/aws-kms-adapter.md`
8. `docs/architecture/specs/provider-native-compatibility-harness.md`
9. `docs/security/threat-model.md`
10. `docs/product/claims-policy.md`
11. `docs/operations/artifact-hygiene.md`

---

## 17. Promotion rule

This v0.9 document may be saved under `docs/architecture/draft/`. Promote to canonical only after ADR-016/017/018/019 and SPEC v2.1 are accepted, claims policy and threat model exist, current/target state wording remains intact, and external competitor/framework statements keep source/date references.
