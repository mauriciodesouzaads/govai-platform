# Provider-Native Compatibility Harness v2

> **Foundation V1 status addendum (EP-FOUNDATION-V1-M3, 2026-08-18; runtime anchor `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68`).** The body below is the H1 v2 contract as written after PR #81 and is preserved as the byte-fidelity contract. Reanchor facts: (1) this file IS tracked in git (the "currently untracked" note in §1 is historical); (2) the coverage map exists and was regenerated at the Foundation V1 anchor — `docs/architecture/specs/h1v2-coverage-map.md`; (3) **B3 is implemented** (EP-006, `apps/audit-sealer`) — every "B3 remains blocked / B3 hard stop" statement in §1, §3, §14 and the §17 checklist is HISTORICAL (those gates were satisfied before EP-006); (4) the **gzip / `Content-Encoding` policy gap** named in §5, §12, §15 and §16 is **CLOSED** by Foundation M1 (identity `accept-encoding` upstream; decoded-only drop of stale `content-encoding`/`content-length` and representation validators; executing real-TCP coverage `register-passthrough.content-encoding.test.ts` on both providers — see coverage map CT-005/FV1-ENC); (5) the Foundation V1 native contract additionally fixes the gate order (auth → path → method → floors → credential → forward), the computer-use-only validation floor, unknown-beta forwarding, raw query preservation and Anthropic `request-id` capture — see ADR-021 (Accepted) and `current-state.md` §2. Still-open items from §15: `body_parse_status`/`classification_skipped` field; Anthropic multipart route-level test. Precedence: `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail over this spec where they differ.

## 1. Status

- **Status:** Draft — post-PR #81 alignment.
- This spec **supersedes** the previous SDK-level "compatibility" framing with a
  **byte-level fidelity** contract. Provider-native parity is proven at the raw
  HTTP-byte boundary, **not** by semantic JSON equality.
- This file **must be tracked in git** (it is currently untracked).
- This spec does **NOT**, by itself, unblock B3. It defines the coverage
  contract that the H1 v2 harness must satisfy. B3 remains blocked per §3 and
  §14 and ADR-021.
- Canonical baseline: `main` `3573dfcfd0394f34bb8e92476ef40c38c16b8096`
  (PR #81 merged). Node v24.15.0, pnpm 10.33.2.

## 2. Context

- PR #81 fixed a provider-native audit-integrity bug in the OpenAI and Anthropic
  passthrough routes.
- **Before PR #81**, Fastify's built-in exact `application/json` parser shadowed
  the intended buffer parser: request bodies were parsed into objects and
  **re-serialized via `JSON.stringify`** before forwarding, so
  `native_request_hash` attested a transformed body — not the client's original
  bytes. **Provider-native passthrough was NOT byte-perfect.** The harness must
  not assume it ever was.
- **After PR #81**, the OpenAI and Anthropic passthrough plugins
  `removeContentTypeParser('application/json')` in their (encapsulated) scope, so
  `application/json` arrives as a raw `Buffer` and is forwarded/hashed unchanged.
- The H1 v2 harness exists to make this a **permanent, regression-proof**
  contract.
- The existing raw-body tests (14) and passthrough integration tests (18) are
  important post-PR #81 evidence and currently pass under Node 24, but they must
  be **explicitly mapped against this spec (a coverage map)** before B3. They are
  **partial evidence**, not automatic completion of the H1 v2 harness.

## 3. Product Doctrine

- **Provider-native passthrough** (`/passthrough/openai/*`,
  `/passthrough/anthropic/*`) is the parity + audit surface: it must preserve the
  client's original bytes.
- **Governed / native** surfaces may intervene, but only **explicitly**,
  **auditably**, and proportionally to risk (ADR-021); never silently mutating
  the body, never disguised as a provider error.
- **`/v1/runs`** is a GovAI high-level shortcut execution API — **NOT** a
  provider-native parity surface. Its caps/defaults/remaps do not satisfy parity.
- **B3 is blocked** until the complete H1 v2 harness (per §6–§12) exists, is
  tracked, has a **coverage map** against this spec, and passes.

## 4. Surfaces Under Test

- **OpenAI passthrough** — `/passthrough/openai/*` (provider-native parity).
- **Anthropic passthrough** — `/passthrough/anthropic/*` (provider-native parity).
- **Governed / native** — `/governed/*` (explicit governance permitted; outside
  the raw-byte parity scope, but must not silently mutate).
- **`/v1/runs`** — explicitly **out of provider-native parity scope**.

## 5. Non-goals

- No real providers (hermetic loopback fake provider only).
- No AWS/KMS (integration uses a local `DevKms`).
- No `.env` / secrets read.
- No `tests/live`.
- No gzip / Content-Encoding policy implementation.
- No new audit schema fields (e.g. `body_parse_status`).
- No B3 implementation.
- No `app.inject` for raw-body proof.
- No claim that the existing PR #81 regression tests **alone** complete the
  H1 v2 harness.

## 6. Mandatory Invariants

- Original client request bytes are preserved end-to-end.
- The provider-captured request body **equals** the original client bytes.
- `native_request_hash` **equals** `sha256(original client bytes)`.
- `body_forward_mode:"raw"` is **truthful** (the forwarded bytes are exactly the
  received bytes).
- No `JSON.stringify` / re-serialization anywhere on the forward or hash path.
- Read-only inspection only: parsing happens on a **copy**; the original `Buffer`
  is never mutated or reassigned.
- Response **status / header / body** fidelity (headers minus hop-by-hop).
- No hidden defaults / caps / remaps injected into the body.
- No schema narrowing / common-denominator transformation.

## 7. Harness Execution Model

- Fastify `app.listen({ port: 0, host: '127.0.0.1' })`.
- Real Node `fetch` over loopback (client → GovAI), body passed as the exact
  `Buffer` (`body: sentRawBody`), never a string.
- A loopback `node:http` **fake provider** as the upstream.
- The fake provider captures raw request bytes (`Buffer.concat` of `data`
  chunks); it uses no JSON/express/fastify parser.
- `Buffer.compare(sentRawBody, capturedRawBody) === 0` is the **canonical proof**.
- `app.inject` is allowed **only** for non-raw-body integration checks
  (audit/governance/status assertions); it is **not** sufficient as raw-byte
  proof.
- Node `>=24`; pnpm `>=10.33.2`.
- Docker / testcontainers only where an integration test needs Postgres.
- No provider credentials; a fake, non-secret provider key.

## 8. OpenAI Test Matrix

Required cases (with current evidence pointer):

- `application/json` byte-for-byte — raw-body test *(covered)*.
- `application/json; charset=utf-8` byte-for-byte — raw-body *(covered)*.
- `native_request_hash == sha256(original client bytes)` — raw-body *(covered)*.
- `body_forward_mode:"raw"` truthful — raw-body *(covered)*.
- Response status / headers / body fidelity — raw-body *(covered)*.
- Vendor JSON (`application/vnd.openai+json`) unsupported (415, not forwarded,
  not silently broadened) — raw-body *(covered)*.
- Multipart `/v1/files` sanity (byte-preserved) — raw-body *(covered)*.
- Nested `"stream": true` false-positive (must NOT stream) — raw-body *(covered)*.
- Tools classified from the **Buffer** path (explicit block event) — raw-body
  *(covered)*.
- Malformed JSON forwarded byte-for-byte — raw-body *(covered)*.
- `stream:true` positive path: `text/event-stream`, `is_stream:true`,
  `stream_final_hash` — passthrough **integration** *(covered)*.

## 9. Anthropic Test Matrix

Required cases (with current evidence pointer):

- `application/json` byte-for-byte — raw-body *(covered)*.
- `application/json; charset=utf-8` byte-for-byte — raw-body *(covered)*.
- `native_request_hash == sha256(original client bytes)` — raw-body *(covered)*.
- `body_forward_mode:"raw"` truthful — raw-body *(covered)*.
- `max_tokens` preserved (e.g. `777`; never coerced to `1024`) — raw-body
  *(covered)*.
- Response status / headers / body fidelity — raw-body *(covered)*.
- Nested `"stream": true` false-positive (must NOT stream) — raw-body *(covered)*.
- Tools classified from the **Buffer** path — raw-body *(covered)*.
- Malformed JSON forwarded byte-for-byte — raw-body *(covered)*.
- `stream:true` positive path: `text/event-stream`, `is_stream:true`,
  `stream_final_hash` — passthrough **integration** *(covered)*.
- **Anthropic multipart route-level** — follow-up (§15), **not** a current
  required gate.

## 10. Invalid JSON Decision

- Malformed JSON is **forwarded unchanged** (byte-for-byte) to the provider.
- GovAI **does not reject at the edge** on parse failure; a parse failure only
  skips the read-only inspection (stream/tools/purpose peeks).
- The provider returns its native `4xx`, which GovAI **relays**
  (status/body/headers) — not a GovAI-shaped error.
- The audit event still emits `native_request_hash` (over the original bytes)
  and `body_forward_mode:"raw"`.
- The absence of an explicit `body_parse_status` / `classification_skipped`
  audit field is a known **follow-up** (§15), deliberately not solved here.

## 11. Stream / SSE Requirements

- Stream detection must read **only** the top-level `stream === true`
  (`JSON.parse` of a copy).
- **No regex / substring** detection on the body.
- A nested `"stream": true` (e.g. inside message content) must **NOT** trigger
  streaming.
- A top-level `stream:true` request must produce an SSE response preserving
  `text/event-stream`.
- `stream_final_hash` is required in the audit event for streamed responses, with
  `is_stream:true`.

## 12. Content-Type Boundaries

- `application/json` — raw `Buffer`.
- `application/json; charset=utf-8` — raw `Buffer`.
- `multipart/form-data` (OpenAI) — raw `Buffer`, byte-preserved (parser
  unchanged by PR #81).
- Vendor JSON (`application/*+json`) — **unsupported (415)** unless explicitly
  added later; must **not** be silently broadened.
- gzip / `Content-Encoding` — explicit **policy gap**, out of scope (§15); not
  improvised inside the harness.

## 13. CI and Local Execution

- `pnpm test` (= `vitest run`) includes `packages/*/src/**/*.test.ts` and
  `tests/integration/**/*.test.ts`.
- `tests/live/**` is excluded.
- CI (`.github/workflows/ci.yml`) runs **Node 24**: `pnpm install
  --frozen-lockfile`, `typecheck`, `lint`, `test`, `re2 smoke`, `gitleaks`.
- Local **Node 24** required (`engines.node >=24.0.0`).
- The `re2` native ABI must match Node 24 (ABI 137); a Node-version mismatch
  raises `ERR_DLOPEN_FAILED` — an **environment requirement only**, not a code
  change.

Documented commands:

```
pnpm exec vitest run packages/provider-openai/src/routes/register-passthrough.raw-body.test.ts packages/provider-anthropic/src/routes/register-passthrough.raw-body.test.ts --reporter=verbose
pnpm exec vitest run tests/integration/openai-passthrough.test.ts tests/integration/anthropic-passthrough.test.ts --reporter=verbose
pnpm test
```

## 14. B3 Hard Stop

- B3 cannot start until the H1 v2 harness, as specified in sections 6–12 of this
  spec, **exists, is tracked, and passes**.
- Existing raw-body tests and existing integration tests cover part of the
  H1 v2 scope and currently pass under Node 24.
- Those existing tests are **necessary evidence, but they are not by themselves
  sufficient** to declare the harness complete.
- Before B3, a separate verification must **map every mandatory invariant and
  every required test-matrix case** in this spec to an executing test.
- Any mandatory invariant without executing test coverage **blocks B3**.
- Any failing harness test **blocks B3**.
- **"Passing" means full spec coverage is green**, not merely that the PR #81
  regression tests are green.
- The harness **coverage map** must distinguish:
  - already-covered by raw-body tests;
  - already-covered by integration tests;
  - covered by future dedicated harness tests;
  - not yet covered / blocking.
- Harness failure, uncovered mandatory spec items, or ambiguous coverage
  **blocks B3**.

## 15. Follow-ups Out of Scope

- `body_parse_status` / `classification_skipped` audit field (touches
  `@govai/core-events`).
- gzip / `Content-Encoding` policy.
- Anthropic multipart route-level test.
- Optional dedicated `tests/harness/` location and `vitest` `include` update if
  chosen later.
- Branch cleanup for `fix/provider-native-raw-body-preservation`.
- Retention / deletion decision for the old
  `h1/provider-native-passthrough-harness` evidence branch.

## 16. Acceptance Criteria

- [ ] This spec is tracked in git.
- [ ] Raw-body tests pass.
- [ ] Integration tests pass.
- [ ] CI passes (Node 24).
- [ ] No live tests / provider credentials used.
- [ ] No AWS/KMS used.
- [ ] PR #80 untouched.
- [ ] B3 remains blocked until explicit authorization.
- [ ] A coverage map exists before B3.
- [ ] Every mandatory invariant in §6–§12 is mapped to an executing test before
      B3.
- [ ] Existing tests are classified as **partial evidence** unless/until the
      coverage map proves full coverage.
- [ ] The existing PR #81 regression tests **alone** are **not** sufficient to
      declare H1 v2 complete.
