# Provider-Native Compatibility Harness

The harness proves that GovAI's provider-native surfaces stay **indistinguishable
from calling OpenAI / Anthropic directly**, except for three explicit, documented
deviations:

1. hop-by-hop headers removed correctly (`content-length`, `connection`, …);
2. governance `beta-deny` (403) when a `*-beta` token is not allowed by policy;
3. audit/evidence captured **off the hot path**, never mutating the experience.

Any cap, default, remap, reshape, dropped field, JSON re-serialization, full
buffering of streams, or normalization of a provider-native error is a violation.

## Phases

- **H1 (this block) — passthrough foundation.** Non-streaming request/response
  fidelity for OpenAI Chat Completions and Anthropic Messages.
- **H2 — streaming.** SSE chunk order, no full buffering, abort propagation.
- **H3 — governed + boundaries.** Governed observe-vs-block assertions and an
  explicit `/v1/runs` out-of-parity test.

## How H1 works

- **Hermetic fake provider** (`fake-provider-transport.ts`): a `node:http` server
  on loopback (`127.0.0.1`). It captures the exact raw request bytes the
  passthrough route forwards upstream and returns a caller-configured raw
  response. No real provider is called; no `.env`; no secrets.
- **Test level:** the provider package's `registerOpenAIPassthrough` /
  `registerAnthropicPassthrough` on a bare Fastify app, with `upstreamBaseUrl`
  pointed at the fake provider. This exercises the real `parseAs:'buffer'` body
  parser and the real forward path.
- **Canonical proof — body byte-for-byte:** fixtures are HAND-AUTHORED raw JSON
  strings (deliberate whitespace and key order, unknown/future fields). The test
  asserts `Buffer.compare(sentRawBody, capturedRawBody) === 0` **first**. JSON is
  parsed only afterwards, for auxiliary field checks. `JSON.stringify` of an
  object is never used as the expected body — that would hide re-serialization.

## What H1 asserts

- request body forwarded byte-for-byte;
- unknown/future fields, nested vendor objects, and arrays preserved;
- no injected caps/defaults (no `max_tokens` / `max_completion_tokens` /
  `temperature`; OpenAI model unchanged; Anthropic client `max_tokens: 777`
  never rewritten to the `/v1/runs` shortcut's `1024`);
- provider status code, response body bytes, and rate-limit / request-id headers
  preserved;
- provider error status + body preserved verbatim (no GovAI error reshape);
- client `anthropic-version` preserved; default injected only when omitted
  (a required provider header, not a hidden cap);
- passthrough reaches the native endpoint, never remapped through `/v1/runs`.

## Running

```
pnpm exec vitest run tests/harness/provider-native
```

Live providers are **out of CI** — never set `GOVAI_LIVE_TESTS` for the harness.
Real-provider validation lives under `tests/live/**` and is opt-in only.
