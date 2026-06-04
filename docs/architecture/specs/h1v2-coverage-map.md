# H1 v2 Provider-Native Compatibility Coverage Map

## Status

- **Document status:** Versioned in main — pending separate B3 authorization decision.
- **Source spec:** `docs/architecture/specs/provider-native-compatibility-harness.md`
- **Source main commit:** `9d94fedd1ec509f127284b8542f61ea46674d018` (main after the
  PR #86 merge). The raw-body and integration anchors below are unchanged from
  `5452d6d3e55285455b68447f12199b3e2d3ad157`; PR #86 added the response-header unit
  tests (RH-OAI / RH-ANT) and the `filterResponseHeaders` helper without touching the
  raw-body tests, and did not shift the cited `HOP_BY_HOP` set anchors.
- **Generated from:** direct inspection of the executing tests and route source on
  the commit above (raw-body tests re-run green locally under Node 24; the response
  hop-by-hop unit tests pass in CI on the PR #86 merge; integration tests green in CI
  for the merge commits).
- **B3 status:** B3 is still blocked pending review of this coverage map and a
  separate explicit authorization decision.
- **Last updated:** 2026-06-03

## Scope

- This document is a **coverage map**. It is **not** an authorization for B3.
- B3 remains blocked until this document is explicitly reviewed and a separate
  explicit B3 authorization decision is made.
- Covers the OpenAI and Anthropic **provider-native passthrough** harness
  (`/passthrough/openai/*`, `/passthrough/anthropic/*`).
- Does **not** cover the governed `/v1/runs` shortcut (out of provider-native
  parity scope per the spec).
- Does **not** cover live providers.
- Does **not** cover AWS/KMS.

## Source inputs

- Spec: `docs/architecture/specs/provider-native-compatibility-harness.md`
- Tests:
  - `packages/provider-openai/src/routes/register-passthrough.raw-body.test.ts` (RB-OAI)
  - `packages/provider-anthropic/src/routes/register-passthrough.raw-body.test.ts` (RB-ANT)
  - `packages/provider-openai/src/routes/response-headers.test.ts` (RH-OAI)
  - `packages/provider-anthropic/src/routes/response-headers.test.ts` (RH-ANT)
  - `tests/integration/openai-passthrough.test.ts` (INT-OAI)
  - `tests/integration/anthropic-passthrough.test.ts` (INT-ANT)
- Route source (for static-structure checks):
  - `packages/provider-openai/src/routes/register-passthrough.ts` (REG-OAI)
  - `packages/provider-anthropic/src/routes/register-passthrough.ts` (REG-ANT)
- CI: `.github/workflows/ci.yml`
- Merged PRs:
  - PR #81 — raw JSON body preservation + audit hash (`3573dfc`)
  - PR #82 — H1 v2 provider-native compatibility harness spec (`ac94a8e`)
  - PR #83 — response hop-by-hop header fidelity tests (`4331dc7`)
  - PR #84 — observable `connection` header stripping via sentinel (`5452d6d`)
  - PR #86 — response hop-by-hop header filter executing unit coverage (`9d94fed`)

### Raw-body test anchors (stable keys)

Inserting a test shifts every later line number, so the body of this map cites raw-body
evidence by a **stable alias** (`RB-OAI[alias]` / `RB-ANT[alias]`) whose durable key is the
exact `it(...)` test name below. Line numbers live **only** here and are current as of the
source commit; regenerate this index (not the body) when the test files change.

**RB-OAI** (`packages/provider-openai/src/routes/register-passthrough.raw-body.test.ts`):
- `[byte-for-byte]` — `forwards application/json byte-for-byte and hashes the ORIGINAL client bytes` (it L128; `Buffer.compare===0` L142; `native_request_hash` L147-148; `body_forward_mode:"raw"` L149; no `max_tokens`/`max_completion_tokens`/`temperature` L157-159; non-canonical fixture L130)
- `[charset]` — `preserves bytes for application/json; charset=utf-8` (it L162; `Buffer.compare===0` L174; `native_request_hash` L175)
- `[resp-fidelity]` — `preserves upstream status, headers, and response body bytes` (it L178; status 201 L195; `x-provider-custom` L196; body bytes L198)
- `[vendor-415]` — `does NOT silently broaden vendor JSON (application/vnd.openai+json stays unsupported)` (it L201; 415 L209; not forwarded L210)
- `[multipart]` — `multipart sanity: multipart/form-data still arrives as a Buffer and forwards byte-for-byte` (it L213; `Buffer.compare===0` L236; `body_forward_mode:"raw"` L238)
- `[nested-stream]` — `does NOT treat a nested "stream": true as streaming (reads top-level stream only)` (it L242; `Buffer.compare===0` L257; `is_stream===false` L260)
- `[tools-block]` — `classifies tools from the raw Buffer path (valid JSON with top-level tools)` (it L263; 403 L275; `tool.validation_blocked` L276; not forwarded L278)
- `[valid-tools]` — `forwards valid tools byte-for-byte after governance inspection` (it L281; no `tool.validation_blocked` L299; `Buffer.compare===0` L303; `native_request_hash` L307-308; `body_forward_mode:"raw"` L309; classifier `allowed` L317-319; unknown fields L328-329; no defaults L331-333)
- `[malformed]` — `forwards malformed JSON byte-for-byte instead of rejecting at the edge` (it L336; status 400 L356; `Buffer.compare===0` L359; `native_request_hash` L361; `body_forward_mode:"raw"` L362; provider body relayed L364)
- `[hop-by-hop]` — `strips hop-by-hop response headers while preserving status, body, and allowed headers (INV-007)` (it L367; status 201 L404; `x-provider-custom` preserved L405; `proxy-authenticate`/`proxy-authorization`/`te`/`trailer`/`upgrade` `toBeNull` L409-413; `connection` sentinel not leaked L418)

**RB-ANT** (`packages/provider-anthropic/src/routes/register-passthrough.raw-body.test.ts`):
- `[byte-for-byte]` — `forwards application/json byte-for-byte, hashes ORIGINAL bytes, preserves max_tokens=777` (it L130; `Buffer.compare===0` L143; `native_request_hash` L147-148; `body_forward_mode:"raw"` L149; `max_tokens===777` L154; no `1024` L158; non-canonical fixture L132)
- `[charset]` — `preserves bytes for application/json; charset=utf-8` (it L161; `Buffer.compare===0` L173; `native_request_hash` L174)
- `[resp-fidelity]` — `preserves upstream status, headers, and response body bytes` (it L177; status 202 L194; `x-provider-custom` L195; body bytes L197)
- `[nested-stream]` — `does NOT treat a nested "stream": true as streaming (reads top-level stream only)` (it L200; `Buffer.compare===0` L215; `is_stream===false` L218)
- `[tools-block]` — `classifies tools from the raw Buffer path (valid JSON with top-level tools)` (it L221; 403 L233; `tool.validation_blocked` L234; not forwarded L235)
- `[valid-tools]` — `forwards valid tools byte-for-byte after governance inspection` (it L238; no `tool.validation_blocked` L256; `Buffer.compare===0` L260; `native_request_hash` L264-265; `body_forward_mode:"raw"` L266; classifier `allowed` L274-276; `max_tokens===777` L288; no `1024` L290)
- `[malformed]` — `forwards malformed JSON byte-for-byte instead of rejecting at the edge` (it L293; status 400 L312; `Buffer.compare===0` L315; `native_request_hash` L317; `body_forward_mode:"raw"` L318; provider body relayed L320)
- `[hop-by-hop]` — `strips hop-by-hop response headers while preserving status, body, and allowed headers (INV-007)` (it L323; status 202 L360; `x-provider-custom` preserved L361; `proxy-authenticate`/`proxy-authorization`/`te`/`trailer`/`upgrade` `toBeNull` L365-369; `connection` sentinel not leaked L374)

## Method

- Each item was mapped by inspecting the actual executing test (file, test name,
  line, concrete `expect`).
- `(covered)` labels in the spec were **not** treated as evidence.
- Hypotheses from the task prompt were **not** treated as evidence; each was
  independently confirmed against a cited assertion or marked otherwise.
- A row is "covered" only with file + test name + assertion anchor (or a cited
  static-structure / versioned-document reference).
- Raw-body evidence is cited by the **stable alias** defined in *Raw-body test anchors*
  (`RB-OAI[alias]` / `RB-ANT[alias]`); the `it(...)` test name is the durable key and the
  current line numbers are kept in that index only, not inline, so test insertions cannot
  silently shift the body's anchors.
- Known limitations and follow-ups are stated explicitly; gaps are not hidden.
- No live providers, AWS/KMS, `.env`, or secrets were used to produce this map.

## Summary table

| ID | Requirement | Status | Evidence | Blocks B3 | Notes |
|----|-------------|--------|----------|-----------|-------|
| INV-001 | Original client request bytes preserved end-to-end | covered_by_raw_body_test | RB-OAI[byte-for-byte], RB-ANT[byte-for-byte] | no | byte-for-byte over a non-canonical-whitespace fixture |
| INV-002 | Provider-captured body equals original bytes | covered_by_raw_body_test | RB-OAI[byte-for-byte], RB-ANT[byte-for-byte] | no | fake captures `cap.rawBody`; `Buffer.compare===0` |
| INV-003 | `native_request_hash == sha256(original bytes)` | covered_by_raw_body_test | RB-OAI[byte-for-byte], RB-ANT[byte-for-byte] | no | hash over sent bytes AND captured bytes |
| INV-004 | `body_forward_mode:"raw"` truthful | covered_by_raw_body_test | RB-OAI[byte-for-byte], RB-ANT[byte-for-byte] | no | asserted with `Buffer.compare===0` in the same test |
| INV-005 | No `JSON.stringify` / re-serialization | covered_by_raw_body_test | RB-OAI[byte-for-byte], RB-ANT[byte-for-byte] | no | re-serialization would change the bytes |
| INV-006 | Read-only inspection only (parse a copy, no mutation) | covered_by_raw_body_test | RB-OAI[byte-for-byte] + RB-OAI[valid-tools]; RB-ANT[byte-for-byte] + RB-ANT[valid-tools] | no | valid-tools pass-through positive now asserted byte-for-byte (RB-OAI[valid-tools] / RB-ANT[valid-tools]) |
| INV-007 | Response status/header/body fidelity (minus hop-by-hop) | covered_by_multiple_tests | RB-OAI[resp-fidelity] + RB-OAI[hop-by-hop]; RB-ANT[resp-fidelity] + RB-ANT[hop-by-hop]; RH-OAI:40-86; RH-ANT:40-86 | no | downstream raw-body tests cover the HTTP-observable stripping incl. the `connection` sentinel; RH-OAI/RH-ANT add executing **pre-normalization** unit coverage of the full hop-by-hop filter incl. keep-alive/transfer-encoding/content-length — these three are no longer static-structure only |
| INV-008 | No hidden defaults/caps/remaps in body | covered_by_raw_body_test | RB-OAI[byte-for-byte]; RB-ANT[byte-for-byte] | no | OpenAI: no caps injected; Anthropic: `max_tokens` kept, no `1024` |
| INV-009 | No schema narrowing / common-denominator | covered_by_raw_body_test | RB-OAI[byte-for-byte] + RB-OAI[valid-tools]; RB-ANT[byte-for-byte] + RB-ANT[valid-tools] | no | unknown/future fields survive on the allowed-tools path too (RB-OAI[valid-tools] / RB-ANT[valid-tools]) |
| STREAM-001 | Stream detection reads only top-level `stream===true` | covered_by_multiple_tests | RB-OAI[nested-stream] + INT-OAI:138; RB-ANT[nested-stream] + INT-ANT:185 | no | nested-negative + top-level-positive together |
| STREAM-002 | No regex/substring stream detection | covered_by_raw_body_test | RB-OAI[nested-stream], RB-ANT[nested-stream] | no | nested `"stream":true` substring does not stream |
| STREAM-003 | Nested `"stream":true` must NOT stream | covered_by_raw_body_test | RB-OAI[nested-stream], RB-ANT[nested-stream] | no | `is_stream===false` |
| STREAM-004 | Top-level `stream:true` → `text/event-stream` | covered_by_integration_test | INT-OAI:131, INT-ANT:175 | no | uses `app.inject` (spec-permitted for non-raw-body checks) |
| STREAM-005 | `stream_final_hash` present + `is_stream:true` | covered_by_integration_test | INT-OAI:138,141; INT-ANT:185,188 | no | presence asserted (`typeof === 'string'`); hash-over-bytes correctness not proven |
| JSON-001 | Malformed JSON forwarded unchanged byte-for-byte | covered_by_raw_body_test | RB-OAI[malformed], RB-ANT[malformed] | no | `Buffer.compare===0` on a truncated body |
| JSON-002 | GovAI does not reject at the edge on parse failure | covered_by_raw_body_test | RB-OAI[malformed], RB-ANT[malformed] | no | provider 400 relayed; fake captured the request |
| JSON-003 | Provider native 4xx relayed (status/body) | covered_by_raw_body_test | RB-OAI[malformed], RB-ANT[malformed] | no | error response headers not separately asserted |
| JSON-004 | Audit still emits hash + `body_forward_mode:"raw"` on malformed | covered_by_raw_body_test | RB-OAI[malformed], RB-ANT[malformed] | no | |
| JSON-005 | `body_parse_status` / `classification_skipped` audit field | out_of_scope_followup | spec §10, §15 | no | spec-declared follow-up; no schema field exists |
| CT-001 | `application/json` → raw Buffer | covered_by_raw_body_test | RB-OAI[byte-for-byte], RB-ANT[byte-for-byte] | no | |
| CT-002 | `application/json; charset=utf-8` → raw Buffer | covered_by_raw_body_test | RB-OAI[charset]; RB-ANT[charset] | no | |
| CT-003 | OpenAI `multipart/form-data` byte-preserved | covered_by_raw_body_test | RB-OAI[multipart] | no | OpenAI only |
| CT-004 | Vendor JSON (`application/*+json`) unsupported (415) | covered_by_raw_body_test | RB-OAI[vendor-415] | no | OpenAI; not required for Anthropic by spec §9 |
| CT-005 | gzip / `Content-Encoding` policy | out_of_scope_followup | spec §12, §15 | no | spec-declared policy gap |
| EXEC-001 | `app.listen()` + real `fetch` for raw-byte proof | covered_by_static_structure | RB-OAI/RB-ANT `beforeAll` `app.listen` (L111-113, before any `it`) + per-test `fetch(... body: sentRawBody)` | no | |
| EXEC-002 | `app.inject` not used for raw-body proof | covered_by_static_structure | RB-OAI/RB-ANT use `fetch`, no `.inject(` call | no | integration uses `app.inject` for SSE/audit only |
| EXEC-003 | Node `>=24` + pnpm `>=10.33.2` | covered_by_static_structure | node: `.github/workflows/ci.yml:18` (node 24), `package.json:8` (engines.node `>=24.0.0`); pnpm: `package.json:6` (packageManager `pnpm@10.33.2`), `package.json:9` (engines.pnpm `>=10.33.2`), `.github/workflows/ci.yml:19-20` (`pnpm/action-setup@v4` version 10.33.2), `.github/workflows/ci.yml:21` (`pnpm install --frozen-lockfile`) | no | spec §7 requires `Node >=24; pnpm >=10.33.2` — both conditions now mapped |
| EXEC-004 | No live providers | covered_by_static_structure | RB fake provider loopback; INT `server-fixture` sets provider keys undefined + `GOVAI_LIVE_TESTS:false` | no | |
| EXEC-005 | No AWS/KMS | covered_by_static_structure | INT `server-fixture` uses `DevKms` (`GOVAI_KMS_PROVIDER:'dev'`) | no | |
| ANT-001 | Anthropic `max_tokens` preserved (777; never 1024) | covered_by_raw_body_test | RB-ANT[byte-for-byte] | no | `max_tokens===777` + forwarded bytes contain no `1024` |
| ANT-MP | Anthropic multipart route-level test | out_of_scope_followup | spec §9, §15 | no | spec marks as follow-up; OpenAI multipart covered |
| B3-001 | Versioned coverage map exists + maps every mandatory item | pending_review | this document | yes (until merged + reviewed) | becomes covered_by_versioned_document on merge; B3 still needs separate explicit authorization |

## Mandatory invariants

### INV-001 — Original client bytes preserved end-to-end
- **Requirement:** the client's original request bytes are preserved end-to-end.
- **Status:** covered_by_raw_body_test
- **Evidence:** RB-OAI[byte-for-byte] and RB-ANT[byte-for-byte] each assert `expect(Buffer.compare(cap.rawBody, sentRawBody)).toBe(0)`.
- **Notes:** the `[byte-for-byte]` fixture uses deliberate non-canonical whitespace, so byte equality cannot be satisfied by a re-serialized body.
- **B3 impact:** does not block.

### INV-002 — Provider-captured body equals original bytes
- **Status:** covered_by_raw_body_test
- **Evidence:** the loopback fake provider records `cap.rawBody` via `Buffer.concat` of request chunks; `Buffer.compare(cap.rawBody, sentRawBody)===0` is asserted in RB-OAI[byte-for-byte] / RB-ANT[byte-for-byte], and again in RB-OAI[charset] / RB-ANT[charset], RB-OAI[multipart], and RB-OAI[malformed] / RB-ANT[malformed].
- **B3 impact:** does not block.

### INV-003 — native_request_hash == sha256(original bytes)
- **Status:** covered_by_raw_body_test
- **Evidence:** RB-OAI[byte-for-byte] asserts `expect(ev['native_request_hash']).toBe(sha256(sentRawBody))` and `...toBe(sha256(cap.rawBody))`; RB-ANT[byte-for-byte] likewise.
- **Notes:** asserts the hash equals sha256 of the original sent bytes (not merely that a hash exists).
- **B3 impact:** does not block.

### INV-004 — body_forward_mode:"raw" truthful
- **Status:** covered_by_raw_body_test
- **Evidence:** RB-OAI[byte-for-byte] asserts `expect(ev['body_forward_mode']).toBe('raw')` together with `Buffer.compare===0` in the same test; RB-ANT[byte-for-byte] likewise.
- **B3 impact:** does not block.

### INV-005 — No JSON.stringify / re-serialization
- **Status:** covered_by_raw_body_test
- **Evidence:** the byte-for-byte assertion over a non-canonical-whitespace fixture (RB-OAI[byte-for-byte] / RB-ANT[byte-for-byte]). Any `JSON.stringify` round-trip would normalize whitespace and break `Buffer.compare===0`.
- **B3 impact:** does not block.

### INV-006 — Read-only inspection only (parse a copy, no mutation)
- **Status:** covered_by_raw_body_test
- **Evidence:** RB-OAI[byte-for-byte] / RB-ANT[byte-for-byte] drive a `/v1/chat/completions` (resp. `/v1/messages`) request through the route's inspection peeks (the stream-detection and tool-classifier `JSON.parse(req.body.toString())` of a copy) and still assert the forwarded body is byte-identical (`Buffer.compare===0`). A mutation/reassignment of the original Buffer during inspection would break that equality.
- **Valid-tools pass-through (closed):** the positive case is now asserted — a body carrying a **valid (allowed)** tool passes classification and is forwarded byte-for-byte. RB-OAI[valid-tools]: a `type:"function"` tool is allowed (no 403; `tool.validation_blocked` absent; classifier decision `allowed`) and the provider receives the exact bytes (`Buffer.compare===0`; `native_request_hash` over the original bytes; `body_forward_mode:"raw"`). RB-ANT[valid-tools] proves the same for a client-defined Anthropic tool (allowed; bytes; hash; raw). The earlier no-tools inspection-then-forward path (RB-OAI[byte-for-byte] / RB-ANT[byte-for-byte]) remains covered, and the tool **block** path (RB-OAI[tools-block] / RB-ANT[tools-block]) is unchanged.
- **B3 impact:** does not block (mandatory invariant proven; the extra valid-tools-forward case is robustness, not a spec-matrix item).

### INV-007 — Response status/header/body fidelity (minus hop-by-hop)
- **Status:** covered_by_multiple_tests
- **Evidence (downstream HTTP-observable — PR #83 / PR #84):**
  - status preserved: RB-OAI[resp-fidelity] (201) and RB-OAI[hop-by-hop] (201); RB-ANT[resp-fidelity] (202) and RB-ANT[hop-by-hop] (202).
  - allowed custom header preserved: RB-OAI[resp-fidelity] (`x-provider-custom: v1`) and RB-OAI[hop-by-hop] (`preserved`); RB-ANT[resp-fidelity] (`a1`) and RB-ANT[hop-by-hop] (`preserved`).
  - body bytes preserved: RB-OAI[resp-fidelity] and RB-OAI[hop-by-hop]; RB-ANT[resp-fidelity] and RB-ANT[hop-by-hop].
  - `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `upgrade` absent: RB-OAI[hop-by-hop] (`toBeNull`); RB-ANT[hop-by-hop].
  - `connection` not leaked: RB-OAI[hop-by-hop] / RB-ANT[hop-by-hop] send a sentinel `connection: x-govai-hop-by-hop-sentinel` and assert the client `Connection` header does not contain it. Per PR #84, this is observable because Node never emits that value on its own.
- **Evidence (pre-normalization filter — PR #86):** PR #86 extracted the inline response hop-by-hop filtering into a pure, exported `filterResponseHeaders` helper (REG-OAI:103-112 / REG-ANT:94-103, each using its own file-local `HOP_BY_HOP` set via `HOP_BY_HOP.has(k.toLowerCase())`) and added executing unit tests (RH-OAI / RH-ANT) that call it directly, **before** Node/Fastify response normalization:
  - every hop-by-hop header removed across the full set — `host`, `connection`, `content-length`, `keep-alive`, `transfer-encoding`, `upgrade`, `proxy-authorization`, `proxy-authenticate`, `te`, `trailer` (RH-OAI:40-42 / RH-ANT:40-42), with `keep-alive`/`transfer-encoding`/`content-length` asserted explicitly (RH-OAI:44-46 / RH-ANT:44-46);
  - allowed headers preserved with exact key+value — `content-type`, `x-request-id`, `x-provider-custom` (RH-OAI:49-54 / RH-ANT:49-54);
  - case-insensitive detection (RH-OAI:57-74 / RH-ANT:57-74);
  - input not mutated (RH-OAI:76-86 / RH-ANT:76-86).
- **How this addresses the Codex P2 (INV-007):** the three runtime-managed headers — `keep-alive`, `transfer-encoding`, `content-length` — now have **executing** unit-test coverage of the route's hop-by-hop filter (RH-OAI/RH-ANT), not merely static-structure evidence. The P2 was addressed by adding an executing test, not by rewording. **Scope of the proof:** RH-OAI/RH-ANT prove the filter step **before** Node/Fastify normalization; they do **not** assert these three headers on the final downstream HTTP response, because Node/Fastify owns and recomputes them on GovAI's own outgoing response. That downstream surface remains runtime-owned and is intentionally not claimed for these three — it is a property of the runtime, not a missing test.
- **Notes:** the downstream raw-body tests (RB-OAI/RB-ANT) cover the HTTP-observable subset (including the `connection` sentinel); the pre-normalization unit tests (RH-OAI/RH-ANT) cover the full hop-by-hop policy including the runtime-managed three. Together they map INV-007 to executing coverage. The `HOP_BY_HOP` sets remain at REG-OAI:56-67 / REG-ANT:46-57.
- **B3 impact:** does not block. This executing coverage does not by itself authorize B3; the process gate (review of this map + a separate explicit decision) still applies.

### INV-008 — No hidden defaults/caps/remaps in body
- **Status:** covered_by_raw_body_test
- **Evidence:** RB-OAI[byte-for-byte] asserts `max_tokens`, `max_completion_tokens`, and `temperature` are absent from the captured body when the client did not send them. RB-ANT[byte-for-byte] asserts `max_tokens===777` and that the forwarded bytes do not contain `1024`.
- **B3 impact:** does not block.

### INV-009 — No schema narrowing / common-denominator
- **Status:** covered_by_raw_body_test
- **Evidence:** RB-OAI[byte-for-byte] asserts `z_unknown_field` survives (and `experimental_array`), alongside byte-for-byte equality. RB-ANT[byte-for-byte] likewise.
- **Notes:** the valid-tools pass-through positive is now asserted (see INV-006). RB-OAI[valid-tools] / RB-ANT[valid-tools] carry a valid tool **plus** an unknown/future field (`z_unknown_field`) and a nested array (`experimental_array`) and assert both survive byte-for-byte, so no schema narrowing or common-denominator reduction is applied even on the allowed-tools path. The byte-for-byte equality plus preserved unknown/future fields demonstrates no narrowing of the request body generally.
- **B3 impact:** does not block.

## OpenAI matrix (spec §8)

Each required §8 case maps to a cited assertion:

- `application/json` byte-for-byte → RB-OAI[byte-for-byte] (INV-001).
- `application/json; charset=utf-8` byte-for-byte → RB-OAI[charset] (CT-002).
- `native_request_hash == sha256(original)` → RB-OAI[byte-for-byte] (INV-003).
- `body_forward_mode:"raw"` → RB-OAI[byte-for-byte] (INV-004).
- status/headers/body fidelity → RB-OAI[resp-fidelity] + RB-OAI[hop-by-hop] (INV-007).
- vendor JSON 415 → RB-OAI[vendor-415] (CT-004).
- multipart `/v1/files` sanity → RB-OAI[multipart] (CT-003).
- nested `"stream":true` false-positive → RB-OAI[nested-stream] (STREAM-003).
- tools from Buffer (block event) → RB-OAI[tools-block] (`tool.validation_blocked` defined; 403).
- valid tools pass-through (allowed) → RB-OAI[valid-tools] (byte-for-byte forward; classifier decision `allowed`; INV-006/INV-009).
- malformed JSON forwarded → RB-OAI[malformed] (JSON-001).
- `stream:true` positive → INT-OAI:131,138,141 (STREAM-004/005).

## Anthropic matrix (spec §9)

- `application/json` byte-for-byte → RB-ANT[byte-for-byte] (INV-001).
- `application/json; charset=utf-8` byte-for-byte → RB-ANT[charset] (CT-002).
- `native_request_hash == sha256(original)` → RB-ANT[byte-for-byte] (INV-003).
- `body_forward_mode:"raw"` → RB-ANT[byte-for-byte] (INV-004).
- `max_tokens` preserved (777; never 1024) → RB-ANT[byte-for-byte] (ANT-001).
- status/headers/body fidelity → RB-ANT[resp-fidelity] + RB-ANT[hop-by-hop] (INV-007).
- nested `"stream":true` false-positive → RB-ANT[nested-stream] (STREAM-003).
- tools from Buffer (block event) → RB-ANT[tools-block] (`tool.validation_blocked` defined; 403).
- valid tools pass-through (allowed) → RB-ANT[valid-tools] (byte-for-byte forward; classifier decision `allowed`; INV-006/INV-009).
- malformed JSON forwarded → RB-ANT[malformed] (JSON-001).
- `stream:true` positive → INT-ANT:175,185,188 (STREAM-004/005).
- **Anthropic multipart route-level** → out_of_scope_followup (spec §9, §15); no executing test.

## Stream/SSE matrix (spec §11)

- Top-level `stream===true` only → covered_by_multiple_tests: nested-negative (RB-OAI[nested-stream] / RB-ANT[nested-stream]) + top-level-positive (INT-OAI:138 / INT-ANT:185).
- No regex/substring → RB-OAI[nested-stream] / RB-ANT[nested-stream] (nested substring does not stream).
- Nested must not stream → RB-OAI[nested-stream] / RB-ANT[nested-stream].
- `text/event-stream` preserved → INT-OAI:131 / INT-ANT:175.
- `stream_final_hash` required + `is_stream:true` → INT-OAI:138,141 / INT-ANT:185,188. **Limitation:** `stream_final_hash` is asserted as `typeof === 'string'` (presence). Hash-over-bytes correctness is not proven (follow-up).

## Malformed JSON matrix (spec §10)

- Forwarded unchanged byte-for-byte → RB-OAI[malformed] / RB-ANT[malformed].
- GovAI does not reject at the edge → provider 400 is relayed and the fake captured the request (RB-OAI[malformed] / RB-ANT[malformed]).
- Provider native 4xx relayed (status/body) → RB-OAI[malformed] / RB-ANT[malformed]. Error-response headers are not separately asserted.
- Audit still emits hash + `body_forward_mode:"raw"` → RB-OAI[malformed] / RB-ANT[malformed].
- `body_parse_status` / `classification_skipped` → out_of_scope_followup (spec §10, §15).

## Content-Type matrix (spec §12)

- `application/json` raw Buffer → RB-OAI[byte-for-byte] / RB-ANT[byte-for-byte].
- `application/json; charset=utf-8` raw Buffer → RB-OAI[charset] / RB-ANT[charset].
- OpenAI multipart byte-preserved → RB-OAI[multipart].
- Vendor JSON 415 → RB-OAI[vendor-415].
- gzip / `Content-Encoding` → out_of_scope_followup (spec §12, §15).

## Execution model matrix (spec §7)

- `app.listen()` + real `fetch` for raw-byte proof → RB-OAI/RB-ANT `beforeAll` calls `app.listen({ port: 0, host: '127.0.0.1' })` and each test uses `fetch(..., { body: sentRawBody })` (covered_by_static_structure).
- `app.inject` not used for raw-byte proof → the raw-body files contain no `.inject(` call (only a header comment); integration tests use `app.inject` for SSE/audit checks, which the spec permits.
- Node `>=24` + pnpm `>=10.33.2` (spec §7) → covered_by_static_structure:
  - Node: `.github/workflows/ci.yml:18` (`node-version: 24`) + `package.json:8` (`engines.node >=24.0.0`).
  - pnpm: `package.json:6` (`packageManager: pnpm@10.33.2`) + `package.json:9` (`engines.pnpm >=10.33.2`) + `.github/workflows/ci.yml:19-20` (`pnpm/action-setup@v4`, `version: 10.33.2`) + `.github/workflows/ci.yml:21` (`pnpm install --frozen-lockfile`).
- No live providers → loopback fake provider (raw-body); `tests/integration/helpers/server-fixture.ts` sets `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` undefined, `GOVAI_LIVE_TESTS:false`, and points `GOVAI_PROVIDER_BASE_URL` at the hermetic fixture.
- No AWS/KMS → the integration fixture uses `DevKms` (`GOVAI_KMS_PROVIDER:'dev'`), not real AWS KMS.

## Follow-ups not blocking H1 v2 / B3 unless promoted

- **`body_parse_status` / `classification_skipped` audit field** — why not blocking: spec §10/§15 explicitly defers it; no schema field exists. What would close it: add the field in `@govai/core-events` and assert it on the malformed path. Consider: after B3.
- **gzip / `Content-Encoding` policy** — why not blocking: spec §12/§15 marks it a policy gap, out of scope. What would close it: an explicit content-encoding policy + tests. Consider: separate decision; not before B3 on the strength of the spec.
- **Anthropic multipart route-level test** — why not blocking: spec §9 marks it a follow-up; OpenAI multipart sanity is covered. What would close it: an Anthropic `/v1/files` multipart byte-for-byte test. Consider: before or after B3, at maintainer discretion.
- **`stream_final_hash` hash-over-bytes correctness** — why not blocking: spec §11 requires the field be present (asserted); correctness-over-bytes is not a spec requirement. What would close it: assert `stream_final_hash` equals a known hash of the streamed bytes. Consider: optional hardening.
- **`keep-alive` / `transfer-encoding` / `content-length` — pre-normalization filter now covered (PR #86):** the required executing coverage exists — RH-OAI/RH-ANT assert the route's hop-by-hop filter removes these three **before** Node/Fastify normalization (RH-OAI:44-46 / RH-ANT:44-46). This is **no longer an open coverage gap**. Residual, non-blocking note: a **downstream** HTTP assertion of these three remains runtime-owned (Node/Fastify recomputes/re-emits them on GovAI's own response) and is intentionally not claimed; that is a property of the runtime, not missing coverage. The pre-normalization unit test does **not** prove the final HTTP response for these three.
- **Valid-tools pass-through positive byte-for-byte (INV-006 / INV-009) — CLOSED:** a body with an allowed tool is now asserted to forward byte-for-byte with unknown/future fields intact (RB-OAI[valid-tools] / RB-ANT[valid-tools]). This is no longer an open follow-up.

## Blocking items

No `uncovered_blocking` or `ambiguous_blocking` items remain for H1 v2 provider-native compatibility coverage, based on the evidence listed above — including the INV-007 pre-normalization hop-by-hop coverage now provided by RH-OAI/RH-ANT (PR #86) and the EXEC-003 pnpm `>=10.33.2` evidence (`package.json` + `.github/workflows/ci.yml`).

The absence of test-coverage blockers does **not** authorize B3. The remaining gate is process: this coverage map (B3-001) must be reviewed and merged, and a separate explicit B3 authorization decision must still be made. Until then, **B3 remains blocked.**

## B3 decision

- This document does not start B3.
- This document does not by itself authorize B3 implementation.
- A separate explicit B3 authorization decision is required after this coverage
  map is reviewed.
