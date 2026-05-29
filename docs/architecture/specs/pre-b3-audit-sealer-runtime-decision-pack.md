# Pre-B3 AuditSealer Runtime Decision Pack

Status: Proposed

## Why this pack exists

Before any B3 runner implementation, GovAI must lock down two things as
non-negotiable:

1. The provider-native experience must be preserved end to end.
2. The AuditSealer must run as a dedicated, asynchronous process outside the
   provider request hot path.

This pack is documentation-only. It does not implement B3, does not create
`apps/audit-sealer`, and does not change any provider integration.

## Relationship to B0/B1/B2

- **B0** added the audit capture outbox foundation (tables, SECURITY DEFINER
  functions, RLS, roles/grants).
- **B1** added the `captureAuditEvent` adapter over the outbox.
- **B2** added the reusable AuditSealer core library (claim, build, seal, fail,
  `sealNextAuditCapture`, `withSealerPhaseRole`) plus ADR-020.

B0, B1, and B2 are merged into `main`. This pack governs what B3 is allowed to
do.

## Relationship to ADR-020

ADR-020 already decided that production sealing runs as a dedicated
process/deploy unit and that `apps/api` must not run the production sealing
loop. This pack extends ADR-020 with the role model (ADR-022), stale recovery
(ADR-023), backpressure (ADR-024), observability (ADR-025), and deploy-unit
lifecycle (ADR-026), and places all of them under the superior requirement of
ADR-021.

## ADR-021 as the superior requirement

ADR-021 (Provider-Native Experience Preservation) is the superior, blocking
requirement of this pack. All other decisions are subordinate to it:

- The user must not feel a meaningful difference between native provider usage and governed usage unless a risk-proportional governance intervention is explicitly triggered.
- Claude Code compatibility is a release blocker.
- GovAI must not reduce OpenAI or Anthropic to a lowest-common-denominator interface.
- AuditSealer is evidence infrastructure, not a provider gateway.
- Sealing failures are evidence-plane health issues, not provider-native UX failures, unless policy explicitly requires a high-risk interruption.

Native parity covers streaming, tool/function calling, provider-specific
headers, prompt caching and beta features, model choice, token limits, error
semantics, and usage metadata.

## ADR-022..026 as decisions required before B3

- ADR-022: AuditSealer runtime role model.
- ADR-023: stale sealing recovery strategy.
- ADR-024: backpressure and claim-loop control.
- ADR-025: health checks, metrics, and observability.
- ADR-026: dedicated deploy-unit lifecycle.

Each of these ADRs includes an explicit "Provider-native impact" section
confirming it does not degrade OpenAI, Anthropic, or Claude Code.

## B3 acceptance criteria matrix

- B3 is implemented as a dedicated asynchronous process.
- B3 keeps OpenAI native compatibility.
- B3 keeps Anthropic native compatibility.
- B3 keeps Claude Code working 100%.
- B3 keeps streaming pass-through by default.
- B3 keeps tool/function calling intact.
- B3 keeps provider headers intact.
- B3 keeps prompt caching and beta features intact.
- B3 keeps model choice and token limits unaltered by default.
- B3 keeps the sealer off the provider hot path.
- B3 implements bounded backpressure, stale recovery, health checks, and
  metrics per ADR-023..025.

## "Must not happen" matrix

- No silent model downgrade.
- No silent token cap.
- No default stream buffering.
- No removal of tool/function calling.
- No removal of provider headers.
- No common-denominator transformation of OpenAI/Anthropic.
- No sealer on the provider hot path.
- No `apps/api` production sealing loop.
- No provider SDK traffic inside the AuditSealer.
- No raw prompt/response/secret logging.
- No Claude Code breakage.

## B3 requirement / stop-condition table

| Area | Requirement | B3 implication | Stop condition |
| --- | --- | --- | --- |
| Claude Code | Works 100% without a mandatory wrapper | B3 must prove Claude Code end-to-end | Claude Code breaks |
| Anthropic Messages API | Native parity preserved | B3 must not transform Messages requests/responses | Anthropic native behavior changes |
| OpenAI SDK/API | Native parity preserved | B3 must not transform OpenAI requests/responses | OpenAI native behavior changes |
| Streaming | Pass-through by default | B3 must not buffer streams by default | Streaming is buffered by default |
| Tool/function calling | Preserved exactly | B3 must not rewrite tool/function calls | Tool/function calling is altered |
| Provider headers | Preserved | B3 must forward provider/beta/rate-limit headers | Provider headers are lost |
| Prompt caching/beta features | Preserved | B3 must not strip prompt caching or beta headers | Prompt caching/beta features break |
| Model choice | Unaltered | B3 must not remap model names | Model is silently changed |
| Token limits | Unaltered by default | B3 must not cap max_tokens by default | Tokens are silently capped |
| AuditSealer runner | Dedicated async process | B3 builds `apps/audit-sealer` off the hot path | Sealer enters provider hot path |
| Sealer backlog | Bounded, evidence-side only | B3 applies backpressure to sealing throughput | Backlog throttles provider requests |
| Stale sealing | Recoverable, transactional | B3 implements age-based recovery + metrics | Stale recovery breaks state machine |
| Health metrics | Separate sealer vs provider SLO | B3 exposes sealer health + metrics | Sealer metrics hide provider latency |
| Logs | Sanitized, no raw payloads | B3 logs structured, redacted events | Raw prompts/responses/secrets logged |
| apps/api separation | Sealer independent of apps/api | B3 keeps deploy units separate | apps/api runs the production sealing loop |

## Non-goals

- Do not implement B3.
- Do not create `apps/audit-sealer`.
- Do not change provider integrations.
- Do not change runtime routes.
- Do not change DLP.
- Do not change migrations.
- Do not define final regulatory policy.
