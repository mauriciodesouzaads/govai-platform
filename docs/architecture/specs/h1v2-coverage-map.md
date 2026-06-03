# H1 v2 Provider-Native Compatibility Coverage Map

## Status

- **Document status:** Draft — pending review.
- **Source spec:** `docs/architecture/specs/provider-native-compatibility-harness.md`
- **Source main commit:** `5452d6d3e55285455b68447f12199b3e2d3ad157`
- **Generated from:** direct inspection of the executing tests and route source on
  the commit above (raw-body tests re-run green locally under Node 24; integration
  tests green in CI for the merge commits).
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

## Method

- Each item was mapped by inspecting the actual executing test (file, test name,
  line, concrete `expect`).
- `(covered)` labels in the spec were **not** treated as evidence.
- Hypotheses from the task prompt were **not** treated as evidence; each was
  independently confirmed against a cited assertion or marked otherwise.
- A row is "covered" only with file + test name + assertion anchor (or a cited
  static-structure / versioned-document reference).
- Known limitations and follow-ups are stated explicitly; gaps are not hidden.
- No live providers, AWS/KMS, `.env`, or secrets were used to produce this map.

## Summary table

| ID | Requirement | Status | Evidence | Blocks B3 | Notes |
|----|-------------|--------|----------|-----------|-------|
| INV-001 | Original client request bytes preserved end-to-end | covered_by_raw_body_test | RB-OAI:142, RB-ANT:143 | no | byte-for-byte over a non-canonical-whitespace fixture |
| INV-002 | Provider-captured body equals original bytes | covered_by_raw_body_test | RB-OAI:142, RB-ANT:143 | no | fake captures `cap.rawBody`; `Buffer.compare===0` |
| INV-003 | `native_request_hash == sha256(original bytes)` | covered_by_raw_body_test | RB-OAI:147-148, RB-ANT:147-148 | no | hash over sent bytes AND captured bytes |
| INV-004 | `body_forward_mode:"raw"` truthful | covered_by_raw_body_test | RB-OAI:149, RB-ANT:149 | no | asserted with `Buffer.compare===0` in the same test |
| INV-005 | No `JSON.stringify` / re-serialization | covered_by_raw_body_test | RB-OAI:130,142; RB-ANT:132,143 | no | re-serialization would change the bytes |
| INV-006 | Read-only inspection only (parse a copy, no mutation) | covered_by_raw_body_test | RB-OAI:142, RB-ANT:143 | no | see note: valid-tools pass-through byte-for-byte not separately asserted |
| INV-007 | Response status/header/body fidelity (minus hop-by-hop) | covered_by_raw_body_test | RB-OAI:195,196,349,350,354-358,363; RB-ANT:194,195,305,306,310-314,319 | no | keep-alive/transfer-encoding/content-length are runtime-managed (static-structure only) |
| INV-008 | No hidden defaults/caps/remaps in body | covered_by_raw_body_test | RB-OAI:157-159; RB-ANT:154,158 | no | OpenAI: no caps injected; Anthropic: `max_tokens` kept, no `1024` |
| INV-009 | No schema narrowing / common-denominator | covered_by_raw_body_test | RB-OAI:154; RB-ANT:155 | no | see note: valid-tools pass-through positive not separately asserted |
| STREAM-001 | Stream detection reads only top-level `stream===true` | covered_by_multiple_tests | RB-OAI:260 + INT-OAI:138; RB-ANT:218 + INT-ANT:185 | no | nested-negative + top-level-positive together |
| STREAM-002 | No regex/substring stream detection | covered_by_raw_body_test | RB-OAI:260, RB-ANT:218 | no | nested `"stream":true` substring does not stream |
| STREAM-003 | Nested `"stream":true` must NOT stream | covered_by_raw_body_test | RB-OAI:260, RB-ANT:218 | no | `is_stream===false` |
| STREAM-004 | Top-level `stream:true` → `text/event-stream` | covered_by_integration_test | INT-OAI:131, INT-ANT:175 | no | uses `app.inject` (spec-permitted for non-raw-body checks) |
| STREAM-005 | `stream_final_hash` present + `is_stream:true` | covered_by_integration_test | INT-OAI:138,141; INT-ANT:185,188 | no | presence asserted (`typeof === 'string'`); hash-over-bytes correctness not proven |
| JSON-001 | Malformed JSON forwarded unchanged byte-for-byte | covered_by_raw_body_test | RB-OAI:304, RB-ANT:260 | no | `Buffer.compare===0` on a truncated body |
| JSON-002 | GovAI does not reject at the edge on parse failure | covered_by_raw_body_test | RB-OAI:301,309; RB-ANT:257,265 | no | provider 400 relayed; fake captured the request |
| JSON-003 | Provider native 4xx relayed (status/body) | covered_by_raw_body_test | RB-OAI:301,309; RB-ANT:257,265 | no | error response headers not separately asserted |
| JSON-004 | Audit still emits hash + `body_forward_mode:"raw"` on malformed | covered_by_raw_body_test | RB-OAI:306-307; RB-ANT:262-263 | no | |
| JSON-005 | `body_parse_status` / `classification_skipped` audit field | out_of_scope_followup | spec §10, §15 | no | spec-declared follow-up; no schema field exists |
| CT-001 | `application/json` → raw Buffer | covered_by_raw_body_test | RB-OAI:142, RB-ANT:143 | no | |
| CT-002 | `application/json; charset=utf-8` → raw Buffer | covered_by_raw_body_test | RB-OAI:168,174; RB-ANT:167,173 | no | |
| CT-003 | OpenAI `multipart/form-data` byte-preserved | covered_by_raw_body_test | RB-OAI:230,236 | no | OpenAI only |
| CT-004 | Vendor JSON (`application/*+json`) unsupported (415) | covered_by_raw_body_test | RB-OAI:205,209 | no | OpenAI; not required for Anthropic by spec §9 |
| CT-005 | gzip / `Content-Encoding` policy | out_of_scope_followup | spec §12, §15 | no | spec-declared policy gap |
| EXEC-001 | `app.listen()` + real `fetch` for raw-byte proof | covered_by_static_structure | RB-OAI:111-113 + per-test `fetch(... body: sentRawBody)`; RB-ANT equivalent | no | |
| EXEC-002 | `app.inject` not used for raw-body proof | covered_by_static_structure | RB-OAI/RB-ANT use `fetch`, no `.inject(` call | no | integration uses `app.inject` for SSE/audit only |
| EXEC-003 | Node `>=24` | covered_by_static_structure | `.github/workflows/ci.yml` node 24; `package.json` engines.node `>=24.0.0` | no | |
| EXEC-004 | No live providers | covered_by_static_structure | RB fake provider loopback; INT `server-fixture` sets provider keys undefined + `GOVAI_LIVE_TESTS:false` | no | |
| EXEC-005 | No AWS/KMS | covered_by_static_structure | INT `server-fixture` uses `DevKms` (`GOVAI_KMS_PROVIDER:'dev'`) | no | |
| ANT-001 | Anthropic `max_tokens` preserved (777; never 1024) | covered_by_raw_body_test | RB-ANT:154,158 | no | |
| ANT-MP | Anthropic multipart route-level test | out_of_scope_followup | spec §9, §15 | no | spec marks as follow-up; OpenAI multipart covered |
| B3-001 | Versioned coverage map exists + maps every mandatory item | pending_review | this document | yes (until merged + reviewed) | becomes covered_by_versioned_document on merge; B3 still needs separate explicit authorization |

## Mandatory invariants

### INV-001 — Original client bytes preserved end-to-end
- **Requirement:** the client's original request bytes are preserved end-to-end.
- **Status:** covered_by_raw_body_test
- **Evidence:** RB-OAI it `forwards application/json byte-for-byte and hashes the ORIGINAL client bytes` (L128) → `expect(Buffer.compare(cap.rawBody, sentRawBody)).toBe(0)` (L142). RB-ANT it `forwards application/json byte-for-byte, hashes ORIGINAL bytes, preserves max_tokens=777` (L130) → L143.
- **Notes:** the fixture (RB-OAI:130 / RB-ANT:132) uses deliberate non-canonical whitespace, so byte equality cannot be satisfied by a re-serialized body.
- **B3 impact:** does not block.

### INV-002 — Provider-captured body equals original bytes
- **Status:** covered_by_raw_body_test
- **Evidence:** the loopback fake provider records `cap.rawBody` via `Buffer.concat` of request chunks; the same tests assert `Buffer.compare(cap.rawBody, sentRawBody)===0` (RB-OAI:142, RB-ANT:143), and again for charset (RB-OAI:174 / RB-ANT:173), multipart (RB-OAI:236), and malformed (RB-OAI:304 / RB-ANT:260).
- **B3 impact:** does not block.

### INV-003 — native_request_hash == sha256(original bytes)
- **Status:** covered_by_raw_body_test
- **Evidence:** RB-OAI:147 `expect(ev['native_request_hash']).toBe(sha256(sentRawBody))` and L148 `...toBe(sha256(cap.rawBody))`. RB-ANT:147-148.
- **Notes:** asserts the hash equals sha256 of the original sent bytes (not merely that a hash exists).
- **B3 impact:** does not block.

### INV-004 — body_forward_mode:"raw" truthful
- **Status:** covered_by_raw_body_test
- **Evidence:** RB-OAI:149 `expect(ev['body_forward_mode']).toBe('raw')`, asserted together with `Buffer.compare===0` (L142) in the same test. RB-ANT:149.
- **B3 impact:** does not block.

### INV-005 — No JSON.stringify / re-serialization
- **Status:** covered_by_raw_body_test
- **Evidence:** the byte-for-byte assertion over a non-canonical-whitespace fixture (RB-OAI:130,142 / RB-ANT:132,143). Any `JSON.stringify` round-trip would normalize whitespace and break `Buffer.compare===0`.
- **B3 impact:** does not block.

### INV-006 — Read-only inspection only (parse a copy, no mutation)
- **Status:** covered_by_raw_body_test
- **Evidence:** the byte-for-byte test (RB-OAI:128 / RB-ANT:130) drives a `/v1/chat/completions` (resp. `/v1/messages`) request through the route's inspection peeks (the stream-detection and tool-classifier `JSON.parse(req.body.toString())` of a copy) and still asserts the forwarded body is byte-identical (RB-OAI:142 / RB-ANT:143). A mutation/reassignment of the original Buffer during inspection would break that equality.
- **Notes / sub-gap:** there is **no** test where a body carrying **valid (allowed)** tools passes classification and is then forwarded byte-for-byte — the tools tests (RB-OAI:263 / RB-ANT:221) block at 403 before forwarding. The core invariant (parse a copy, no mutation) is proven for the inspection-then-forward path on the no-tools body, but the valid-tools pass-through byte-for-byte case is not separately asserted. Listed as a non-blocking follow-up.
- **B3 impact:** does not block (mandatory invariant proven; the extra valid-tools-forward case is robustness, not a spec-matrix item).

### INV-007 — Response status/header/body fidelity (minus hop-by-hop)
- **Status:** covered_by_raw_body_test
- **Evidence:**
  - status preserved: RB-OAI:195 (201) and L349 (201); RB-ANT:194 (202) and L305 (202).
  - allowed custom header preserved: RB-OAI:196 (`x-provider-custom: v1`) and L350 (`preserved`); RB-ANT:195 (`a1`) and L306 (`preserved`).
  - body bytes preserved: RB-OAI it `preserves upstream status, headers, and response body bytes` (L178) and it `strips hop-by-hop...` (L312); RB-ANT L177 and L268.
  - `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `upgrade` absent: RB-OAI:354-358 (`toBeNull`); RB-ANT:310-314.
  - `connection` not leaked: the fake sends a sentinel `connection: x-govai-hop-by-hop-sentinel` (RB-OAI:330 / RB-ANT:286) and the test asserts the client `Connection` header does not contain it (RB-OAI:363 / RB-ANT:319). Per PR #84, this is observable because Node never emits that value on its own.
- **Notes:** `keep-alive`, `transfer-encoding`, and `content-length` are managed or recomputed by Node/Fastify on GovAI's own response and therefore are **not** asserted by a downstream response test. Their membership in the route's hop-by-hop policy is verifiable by static structure (the `HOP_BY_HOP` set in REG-OAI:56-67 / REG-ANT:46-57), but downstream-response coverage for these three is intentionally not claimed.
- **B3 impact:** does not block.

### INV-008 — No hidden defaults/caps/remaps in body
- **Status:** covered_by_raw_body_test
- **Evidence:** RB-OAI:157-159 assert `max_tokens`, `max_completion_tokens`, and `temperature` are absent from the captured body when the client did not send them. RB-ANT:154 asserts `max_tokens===777` and L158 asserts the forwarded bytes do not contain `1024`.
- **B3 impact:** does not block.

### INV-009 — No schema narrowing / common-denominator
- **Status:** covered_by_raw_body_test
- **Evidence:** RB-OAI:154 asserts `z_unknown_field` survives (and `experimental_array`), alongside byte-for-byte equality (L142). RB-ANT:155.
- **Notes / sub-gap:** as with INV-006, valid-tools pass-through (vs. block) is not separately asserted. The byte-for-byte equality plus preserved unknown/future fields demonstrates no narrowing of the request body generally.
- **B3 impact:** does not block.

## OpenAI matrix (spec §8)

Each required §8 case maps to a cited assertion:

- `application/json` byte-for-byte → RB-OAI:142 (INV-001).
- `application/json; charset=utf-8` byte-for-byte → RB-OAI:168,174 (CT-002).
- `native_request_hash == sha256(original)` → RB-OAI:147 (INV-003).
- `body_forward_mode:"raw"` → RB-OAI:149 (INV-004).
- status/headers/body fidelity → RB-OAI:178 + 312 (INV-007).
- vendor JSON 415 → RB-OAI:209 (CT-004).
- multipart `/v1/files` sanity → RB-OAI:236 (CT-003).
- nested `"stream":true` false-positive → RB-OAI:260 (STREAM-003).
- tools from Buffer (block event) → RB-OAI:276 (`tool.validation_blocked` defined; 403 at L275).
- malformed JSON forwarded → RB-OAI:304 (JSON-001).
- `stream:true` positive → INT-OAI:131,138,141 (STREAM-004/005).

## Anthropic matrix (spec §9)

- `application/json` byte-for-byte → RB-ANT:143 (INV-001).
- `application/json; charset=utf-8` byte-for-byte → RB-ANT:167,173 (CT-002).
- `native_request_hash == sha256(original)` → RB-ANT:147 (INV-003).
- `body_forward_mode:"raw"` → RB-ANT:149 (INV-004).
- `max_tokens` preserved (777; never 1024) → RB-ANT:154,158 (ANT-001).
- status/headers/body fidelity → RB-ANT:177 + 268 (INV-007).
- nested `"stream":true` false-positive → RB-ANT:218 (STREAM-003).
- tools from Buffer (block event) → RB-ANT:234 (`tool.validation_blocked` defined; 403 at L233).
- malformed JSON forwarded → RB-ANT:260 (JSON-001).
- `stream:true` positive → INT-ANT:175,185,188 (STREAM-004/005).
- **Anthropic multipart route-level** → out_of_scope_followup (spec §9, §15); no executing test.

## Stream/SSE matrix (spec §11)

- Top-level `stream===true` only → covered_by_multiple_tests: nested-negative (RB-OAI:260 / RB-ANT:218) + top-level-positive (INT-OAI:138 / INT-ANT:185).
- No regex/substring → RB-OAI:260 / RB-ANT:218 (nested substring does not stream).
- Nested must not stream → RB-OAI:260 / RB-ANT:218.
- `text/event-stream` preserved → INT-OAI:131 / INT-ANT:175.
- `stream_final_hash` required + `is_stream:true` → INT-OAI:138,141 / INT-ANT:185,188. **Limitation:** `stream_final_hash` is asserted as `typeof === 'string'` (presence). Hash-over-bytes correctness is not proven (follow-up).

## Malformed JSON matrix (spec §10)

- Forwarded unchanged byte-for-byte → RB-OAI:304 / RB-ANT:260.
- GovAI does not reject at the edge → provider 400 is relayed and the fake captured the request (RB-OAI:301,309 / RB-ANT:257,265).
- Provider native 4xx relayed (status/body) → RB-OAI:301,309 / RB-ANT:257,265. Error-response headers are not separately asserted.
- Audit still emits hash + `body_forward_mode:"raw"` → RB-OAI:306-307 / RB-ANT:262-263.
- `body_parse_status` / `classification_skipped` → out_of_scope_followup (spec §10, §15).

## Content-Type matrix (spec §12)

- `application/json` raw Buffer → RB-OAI:142 / RB-ANT:143.
- `application/json; charset=utf-8` raw Buffer → RB-OAI:174 / RB-ANT:173.
- OpenAI multipart byte-preserved → RB-OAI:236.
- Vendor JSON 415 → RB-OAI:209.
- gzip / `Content-Encoding` → out_of_scope_followup (spec §12, §15).

## Execution model matrix (spec §7)

- `app.listen()` + real `fetch` for raw-byte proof → RB-OAI/RB-ANT `beforeAll` calls `app.listen({ port: 0, host: '127.0.0.1' })` and each test uses `fetch(..., { body: sentRawBody })` (covered_by_static_structure).
- `app.inject` not used for raw-byte proof → the raw-body files contain no `.inject(` call (only a header comment); integration tests use `app.inject` for SSE/audit checks, which the spec permits.
- Node `>=24` → CI (`.github/workflows/ci.yml`, node 24) + `package.json` engines (covered_by_static_structure).
- No live providers → loopback fake provider (raw-body); `tests/integration/helpers/server-fixture.ts` sets `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` undefined, `GOVAI_LIVE_TESTS:false`, and points `GOVAI_PROVIDER_BASE_URL` at the hermetic fixture.
- No AWS/KMS → the integration fixture uses `DevKms` (`GOVAI_KMS_PROVIDER:'dev'`), not real AWS KMS.

## Follow-ups not blocking H1 v2 / B3 unless promoted

- **`body_parse_status` / `classification_skipped` audit field** — why not blocking: spec §10/§15 explicitly defers it; no schema field exists. What would close it: add the field in `@govai/core-events` and assert it on the malformed path. Consider: after B3.
- **gzip / `Content-Encoding` policy** — why not blocking: spec §12/§15 marks it a policy gap, out of scope. What would close it: an explicit content-encoding policy + tests. Consider: separate decision; not before B3 on the strength of the spec.
- **Anthropic multipart route-level test** — why not blocking: spec §9 marks it a follow-up; OpenAI multipart sanity is covered. What would close it: an Anthropic `/v1/files` multipart byte-for-byte test. Consider: before or after B3, at maintainer discretion.
- **`stream_final_hash` hash-over-bytes correctness** — why not blocking: spec §11 requires the field be present (asserted); correctness-over-bytes is not a spec requirement. What would close it: assert `stream_final_hash` equals a known hash of the streamed bytes. Consider: optional hardening.
- **`keep-alive` / `transfer-encoding` / `content-length` downstream stripping** — why not blocking: these are runtime-managed/recomputed by Node/Fastify on GovAI's own response, so they cannot be asserted downstream; their membership in the hop-by-hop policy is verifiable by static structure. What would close it: a unit test of the header-filter step before HTTP normalization. Consider: optional hardening.
- **Valid-tools pass-through positive byte-for-byte (INV-006 / INV-009 sub-note)** — why not blocking: the spec matrix requires the tool **block** event (covered); the no-mutation/no-narrowing invariants are proven by the general byte-for-byte test. What would close it: a test that sends a body with an allowed tool and asserts byte-for-byte forwarding. Consider: optional hardening.

## Blocking items

No `uncovered_blocking` or `ambiguous_blocking` items remain for H1 v2 provider-native compatibility coverage, based on the evidence listed above.

The absence of test-coverage blockers does **not** authorize B3. The remaining gate is process: this coverage map (B3-001) must be reviewed and merged, and a separate explicit B3 authorization decision must still be made. Until then, **B3 remains blocked.**

## B3 decision

- This document does not start B3.
- This document does not by itself authorize B3 implementation.
- A separate explicit B3 authorization decision is required after this coverage
  map is reviewed.
