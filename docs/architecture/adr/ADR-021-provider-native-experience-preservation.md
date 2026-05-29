# ADR-021: Provider-Native Experience Preservation Doctrine

Status: Proposed

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

- If Claude Code breaks, B3 stops.
- If streaming is buffered, B3 stops.
- If tool calling is altered, B3 stops.
- If Anthropic or OpenAI headers are lost, B3 stops.
- If model or tokens are silently capped, B3 stops.
- If the sealer enters the provider hot path, B3 stops.
