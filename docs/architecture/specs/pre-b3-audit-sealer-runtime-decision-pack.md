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

## Provider-Native Compatibility Baseline before B3

- The provider-native compatibility baseline is a release gate.
- B3 must not start until the harness plan is documented.
- B3 must not be marked ready until the harness is implemented and green.
- Claude Code production compatibility cannot be waived.
- /v1/runs is not the provider-native parity surface.
- Provider-native audited/governed-native endpoints must preserve SDK/CLI behavior.
- Unknown fields/headers/events must pass through by default.
- Common-denominator schemas are forbidden in the hot path when they lose provider semantics.
- Evidence-plane degradation must not degrade low-risk provider UX.

### Compatibility harness matrix

| Surface | Must prove | Required before B3 starts | Required before B3 ready | Waiver allowed |
| --- | --- | --- | --- | --- |
| Claude Code CLI | official CLI workflow, long-running session, streaming, tool/file workflow, cancellation, provider errors/rate limits | harness plan | green harness | No for production |
| Anthropic Messages | create, stream, tool use, beta headers, prompt caching headers, errors, usage metadata | harness plan | green harness | only explicit product/security waiver, never silent downgrade |
| OpenAI Responses | create, stream, tools, model choice, max tokens, headers, errors, usage metadata | harness plan | green harness | only explicit product/security waiver, never silent downgrade |
| OpenAI Chat Completions | create, stream, tool/function calling, model choice, max tokens, headers, errors | harness plan | green harness | only explicit product/security waiver, never silent downgrade |
| Provider files/models/metadata endpoints | native behavior where supported | coverage matrix | green tests for supported endpoints | explicit coverage note only |

### Non-native surfaces

- /v1/runs is GovAI high-level execution API.
- /v1/runs does not prove provider-native parity.
- /v1/runs may intentionally simplify payloads.
- Provider-native parity must be assessed on native-shaped provider surfaces.
- Any /v1/runs cap/default must be treated as GovAI API behavior, not provider-native behavior.

### B3 hard stop conditions

- B3 hard stops if Claude Code cannot complete the compatibility harness.
- B3 hard stops if streaming latency/shape differs materially from provider native.
- B3 hard stops if tool/function calling is rewritten or dropped.
- B3 hard stops if unknown fields/headers/events are stripped by default.
- B3 hard stops if model or max token parameters are silently changed.
- B3 hard stops if provider errors/rate limits are replaced by generic GovAI errors.
- B3 hard stops if AuditSealer downtime blocks low-risk provider traffic.
- B3 hard stops if /v1/runs is used as the only proof of native parity.

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

## Final pre-B3 decisions closed by this pack

| Decision area | Final decision | B3 default | Stop condition |
| --- | --- | --- | --- |
| Provider-native UX | Native parity preserved by default; governance is additive and async | observe/capture-first, no default degradation | user feels meaningful difference without explicit high-risk policy |
| Claude Code | Production compatibility is non-waivable | must pass compatibility harness | Claude Code cannot complete the harness |
| `/v1/runs` | GovAI high-level API, not parity surface | not used as native-parity proof | /v1/runs used as the only proof of native parity |
| High-risk policy source | capability registry + org policy overlays | explicit policy + machine-readable reason | inline block from generic sealer/evidence unavailability |
| AuditSealer role/session | dedicated identity, runner-owned tx, least-privilege per phase | dedicated DB pool, max pool size 2 | sealing loop in apps/api or shared request pool |
| Stale threshold | age-based recovery in dedicated runner | 10 minutes initial default | stale recovery breaks the state machine |
| Retry policy | bounded retries with backoff | 3 attempts, exponential backoff with jitter | unbounded retries or duplicate appends |
| Duplicate append prevention | explicit B3 requirement; never process-memory-only | check state + claim under lock before append | duplicate audit append for same capture |
| Claim batch/concurrency | bounded loop, no busy loop | batch 10, max in-flight 2 | provider-path throttling or unbounded concurrency |
| Metrics format | OTel-compatible semantics | Prometheus acceptable adapter | high-cardinality/raw-payload labels |
| Health readiness | sealer readiness fails if it cannot seal | readiness validates DB + permissions + backlog | sealer readiness failure implies provider endpoints down |
| Evidence-plane degradation | evidence-plane health issue for low-risk traffic | metric/work item, no provider block | low-risk provider-native traffic blocked by sealer state |

Closure summary:

- High-risk policy source = capability registry + org policy overlays.
- Stale threshold = 10 minutes initial default.
- Retry policy = 3 attempts, exponential backoff with jitter.
- Claim batch/concurrency = batch 10, max in-flight 2.
- Metrics = OTel-compatible semantics, Prometheus acceptable adapter.
- Duplicate append prevention = explicit B3 requirement.
- Evidence-plane degradation does not block low-risk provider-native traffic.

## Non-goals

- Do not implement B3.
- Do not create `apps/audit-sealer`.
- Do not change provider integrations.
- Do not change runtime routes.
- Do not change DLP.
- Do not change migrations.
- Do not define final regulatory policy.
