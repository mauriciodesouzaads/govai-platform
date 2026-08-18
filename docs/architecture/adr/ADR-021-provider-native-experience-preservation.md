# ADR-021: Provider-Native Experience Preservation Doctrine

Status: Accepted (owner adjudication `ADR021_FINAL_STATUS=ACCEPTED`, EP-FOUNDATION-V1-M3, 2026-08-18; originally Proposed, 2026-05/06). Accepted as **doctrine**; the currently proven scope is recorded in "Implementation and validation" below and in `docs/architecture/current-state.md` — acceptance of the doctrine is not a claim of universal provider parity.

## Acceptance note (M3, 2026-08-18) — doctrine vs proven scope

- **NORMATIVE DOCTRINE (accepted):** preserve provider-specific semantics;
  provider-native default pass-through; unknown/future semantics (fields,
  headers, beta flags, streaming events, usage/error fields) pass or are
  observed by default; explicit high-risk intervention only, never disguised
  as a provider error; evidence asynchronous / off the hot path; no
  common-denominator semantic downgrade; provider error truth preserved;
  supported SDK/CLI compatibility is a release gate.
- **CURRENT PROVEN SCOPE (Foundation V1 anchor `de80664a`):** exactly the
  registered and tested lanes — Anthropic `POST /v1/messages` (±stream),
  `count_tokens`, `GET /v1/models`, `/v1/files`; OpenAI `POST /v1/responses`
  (±stream), `POST /v1/chat/completions` (±stream), `/v1/models`,
  `/v1/embeddings`, `/v1/files`, `/v1/vector_stores` — as registered in
  `packages/provider-*/src/capabilities/`; the governed `/v1/messages`,
  `/v1/responses`, `/v1/chat/completions` handlers; the hermetic H1 v2 +
  M1 suites; and the live M2/M2A acceptance (official `@anthropic-ai/sdk`
  0.117.1 and `openai` 7.4.0, Claude Code 2.1.233, Codex CLI 0.140.0-alpha.2,
  real Anthropic + OpenAI, non-stream + stream, tools forwarded, unknown beta
  forwarded, provider 4xx relayed).
- **NOT CLAIMED:** universal parity; every endpoint; every model; every SDK
  version; every future beta; every CLI workflow; exactly-once provider
  execution.
- The B3-gating wording in "Provider-native compatibility baseline" and
  "Stop conditions for B3" below is **historical**: B3 was implemented in
  EP-006 (`apps/audit-sealer`) after the H1 v2 harness and coverage map
  existed and passed; those gates were satisfied and are retained as the
  original rationale.

## Context

- GovAI must preserve the native experience of the providers it governs.
- Governance must not turn OpenAI or Anthropic into a crippled gateway.
- Users and developers must be able to use the official SDKs, CLIs, and tools
  with minimal or no perceptible difference.
- Claude Code is a critical case: it must work 100%.
- Native provider experience is simultaneously a product principle, an
  architecture principle, and a go-to-market principle.
- GovAI must be able to govern without breaking streaming, tool-calling,
  function-calling, headers, beta features, model choice, prompt caching,
  long-running CLI sessions, or error semantics.
- Governance must be proportional to risk, not a default bottleneck.
- The AuditSealer (B2 core / B3 runner) is evidence infrastructure. It must
  never sit on the synchronous provider request hot path.

## Decision

Provider-native parity is a **blocking requirement** for B3 and for all future
provider integrations.

- OpenAI and Anthropic must keep **feature parity per provider**, not a
  common-denominator abstraction.
- Claude Code compatibility is an **explicit acceptance criterion** and a
  release blocker.
- GovAI must not silently alter any of the following:
  - model names;
  - max_tokens;
  - temperature / top_p;
  - tool schemas;
  - function / tool calls;
  - system / developer messages;
  - streaming event order;
  - provider headers;
  - beta headers;
  - prompt caching headers;
  - rate-limit headers;
  - error codes;
  - usage metadata.
- Streaming must be **pass-through / stream-through by default**, never buffered
  by default.
- Any governance intervention must be:
  - explicit;
  - auditable;
  - proportional to risk;
  - accompanied by a clear reason;
  - never disguised as a provider error.
- The AuditSealer does not sit on the provider request hot path.
- Sealing is asynchronous and must never block OpenAI, Anthropic, or Claude
  Code calls.
- B3 must not introduce a bottleneck in the provider path.
- If an asynchronous evidence component fails, the provider-native experience
  must not degrade for low-risk traffic; the system must record a
  gap / metric / work item per policy.
- Inline blocking is only permitted for an explicit high-risk policy decision,
  never for generic unavailability of the sealer.

## Acceptance criteria

- Claude Code works without a mandatory wrapper.
- Claude Code streaming stays interactive.
- Claude Code tool/file workflow is not truncated or transformed.
- OpenAI SDKs remain compatible.
- Anthropic SDKs remain compatible.
- SSE streaming is preserved.
- Tool calling / function calling is preserved.
- Provider-specific fields are preserved.
- Provider-specific headers are preserved.
- There is no silent model downgrade.
- There is no artificial token cap by default.
- There is no stream buffering by default.
- There is no transformation to a common denominator.
- Any governance interruption is explicit and testable.

## Provider-native compatibility baseline

*(Historical framing — the "B3 must not start" gates below were satisfied before EP-006; see the M3 acceptance note.)*

- Provider-native compatibility is a release gate, not an aspiration.
- B3 must not start until this baseline is specified.
- B3 must not be marked ready until the compatibility harness exists and passes.
- Claude Code production compatibility cannot be waived.
- OpenAI and Anthropic parity waivers require explicit documented product/security approval and cannot permit silent downgrade, silent token caps, default stream buffering, tool/function loss, or header loss.
- /v1/runs is a GovAI high-level governed execution API, not the provider-native parity surface.
- Provider-native audited/governed-native endpoints are the surfaces that must preserve official SDK/CLI behavior.
- Unknown provider fields, headers, streaming events, beta flags, usage metadata, and error fields must pass through by default unless an explicit high-risk policy blocks the request.
- Common-denominator schemas must not be used on the hot path if they lose provider-specific semantics.
- Sealer/evidence degradation is an evidence-plane issue for low-risk traffic, not a provider UX failure.

### Claude Code baseline

- Claude Code must run through the compatible provider-native path without a mandatory GovAI wrapper.
- Long-running sessions must remain interactive.
- Streaming must remain responsive.
- Tool/file workflows must not be truncated, rewritten, or blocked by default.
- Cancellation/interruption behavior must be preserved.
- Provider errors, rate limits, and authentication failures must not be disguised as generic GovAI errors.
- Claude Code must not be blocked by AuditSealer downtime, stale sealing, or evidence backlog for low-risk traffic.
- Claude Code production compatibility is a non-waivable release blocker.

### Anthropic baseline

- Messages create and Messages stream must preserve native request/response semantics.
- Tool use must be preserved.
- Provider-specific headers must be preserved.
- `anthropic-beta` and prompt caching headers must be preserved unless an explicit high-risk policy blocks them.
- Files, models, and count_tokens behavior must be preserved where supported.
- Error semantics, rate-limit behavior, request IDs, and usage metadata must be preserved.
- Unknown Anthropic fields and future-compatible fields must pass through by default.

### OpenAI baseline

- Responses create/stream must preserve native semantics.
- Chat Completions create/stream must preserve native semantics.
- Tool/function calling must be preserved.
- Model choice and max token parameters must not be silently rewritten or capped.
- Provider-specific headers, request IDs, rate-limit headers, errors, and usage metadata must be preserved.
- Files, vector stores, embeddings, and models behavior must be preserved where supported.
- Unknown OpenAI fields and future-compatible fields must pass through by default.

### Explicit non-native surface

- /v1/runs is useful and strategic, but it is not the provider-native parity surface.
- /v1/runs may provide simplified governed execution semantics.
- /v1/runs must not be used as evidence that Claude Code/OpenAI/Anthropic native parity is complete.
- Any cap/default in /v1/runs, including generated request defaults, does not satisfy provider-native parity.
- Provider-native parity must be proven on native-shaped provider surfaces.

## Risk-proportional intervention model

- Risk-proportional intervention means governance action must be justified by a concrete policy source and risk signal.
- Low-risk/default traffic must prefer observe/capture/audit over interruption.
- Inline blocking is allowed only for explicit high-risk policy.
- Generic evidence-plane or sealer unavailability is not high-risk policy.
- High-risk policy lives in the capability registry plus organization policy overlays, not in ad-hoc runner code.
- High-risk policy changes require explicit product/security review.
- High-risk decisions must emit a machine-readable reason.
- User/provider errors must not be disguised as governance errors, and governance errors must not be disguised as provider errors.

### Canonical intervention scenarios

1. Low-risk normal prompt:
   - allow/observe/capture;
   - no user-visible degradation.

2. PII finding in low-risk mode:
   - warn/audit or policy-specific redaction only if explicitly configured;
   - no default provider block.

3. Disallowed/destructive tool:
   - block only if tool classifier/capability policy says high-risk block.

4. Sealer down/backlog:
   - mark evidence-plane degraded;
   - emit metric/work item;
   - do not block low-risk provider-native traffic.

5. Unknown provider beta/header/field:
   - pass through by default;
   - block only with explicit high-risk policy.

## Non-goals

- Do not implement a provider proxy in this ADR.
- Do not implement runtime enforcement.
- Do not implement B3.
- Do not define final DLP policy.
- Do not replace the official SDKs.

## Consequences

- B3 must be designed as a dedicated asynchronous process.
- Future provider-native integrations require a compatibility harness.
- Any PR that touches OpenAI, Anthropic, or Claude Code must prove native
  parity.
- The governance kernel must prefer asynchronous capture/evidence and
  risk-proportional interventions.

## Provider-native impact

This ADR exists specifically to protect provider-native experience. The net
impact is: OpenAI, Anthropic, and Claude Code keep native behavior — streaming,
tool/function calling, headers, prompt caching and beta features, model choice,
and token limits are preserved by default. Governance is additive and
asynchronous, not a synchronous tax on the provider path.

## Stop conditions for B3

*(Historical — B3 is implemented (EP-006); these conditions were the pre-implementation stop rules and remain the intent for any future evidence component on the provider path.)*

- If Claude Code breaks, B3 stops.
- If streaming is buffered, B3 stops.
- If tool calling is altered, B3 stops.
- If Anthropic or OpenAI headers are lost, B3 stops.
- If model or tokens are silently capped, B3 stops.
- If the sealer enters the provider hot path, B3 stops.

## Implementation and validation (Foundation V1, 2026-08-18)

Source-verified at the Foundation V1 runtime anchor
`de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (see `docs/architecture/current-state.md`
§2 and `docs/architecture/specs/h1v2-coverage-map.md`):

- **Byte-level fidelity (H1 v2):** original client bytes forwarded and hashed
  (`native_request_hash` over the original bytes, `body_forward_mode:"raw"`),
  no re-serialization, no hidden defaults/caps, unknown/future fields
  preserved, hop-by-hop response filtering, malformed JSON forwarded, nested
  `"stream":true` not treated as streaming — executing raw-body/response-header
  tests on both providers.
- **Native/Audited contract (M1, PR #131 — owner decision OD-1=A):**
  pass-and-observe by default; unknown/unresolved beta tokens forwarded
  byte-intact and observed via bounded hashed markers; non-computer tools
  classified and forwarded; the ONLY hard floor is provider-hosted computer
  use (explicit 403 + durable blocked v4 capture); Content-Encoding handled
  truthfully (identity upstream; stale `content-encoding`/`content-length`
  and representation validators dropped only when the runtime decoded);
  gate order auth → path (404) → method (405 + truthful `Allow`) → tool floor
  → beta floor → credential (502 `provider_credential_unresolvable`) → forward.
- **Governed contract (M1):** the governed surface holds original bytes,
  applies only the `blocked` outcome of the enforcement matrix, and exposes
  recommendation vs applied additively (`x-govai-enforcement-decision`,
  `x-govai-enforcement-applied`, `block_trigger` on 403) — Phase 5
  ask/sandbox/enforce primitives are NOT implemented.
- **Provider truth (M2A, PR #132):** the raw request query is preserved on
  both passthroughs; the real Anthropic `request-id` header is captured in
  evidence; the executable entrypoints run from any checkout path.
- **Live acceptance (M2 at `3e90f2fb`, M2A at tree `0174a5c5` = this anchor):**
  real Anthropic + OpenAI through official SDKs over real TCP, Native/Audited
  and Governed, non-stream and stream, provider 4xx relayed truthfully,
  synthetic unknown beta forwarded (provider rejected it), real current beta
  accepted, client-defined tools reached both providers, computer-use blocked
  pre-provider (dispatch count 0), `/v1/runs` with idempotent replay,
  AuditBridge captures with recomputed hashes, one bounded seal, Claude Code
  and Codex CLI answered through GovAI, zero provider-secret leakage.
- **Current limitations (not claimed):** universal endpoint/provider parity;
  Anthropic multipart route-level test; typed first-class provenance for
  unknown betas / applied-vs-recommended / query request-target in the
  sealed v4 event (registered evidence-granularity residuals — see
  `docs/architecture/foundation-v1-freeze.md`); beta snapshot freshness;
  Claude Code's auxiliary `HEAD <base>/api/hello` probe answers 401/404
  (non-fatal); the `X-GovAI-Request-Id` echo does not reach direct streaming
  responses.
