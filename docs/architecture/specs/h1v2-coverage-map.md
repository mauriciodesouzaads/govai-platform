# H1 v2 Provider-Native Compatibility Coverage Map

## Status

- **Document status:** Versioned in main — **regenerated for the Foundation V1 freeze
  (EP-FOUNDATION-V1-M3, 2026-08-18)** from the executing tests and route source at the
  Foundation V1 runtime anchor. The former "pending separate B3 authorization decision"
  framing is HISTORICAL: B3 was authorized and implemented in EP-006 (`apps/audit-sealer`).
- **Source spec:** `docs/architecture/specs/provider-native-compatibility-harness.md`
  (H1 v2 byte-fidelity contract; its own B3-gating wording is historical, see its
  status addendum).
- **Source main commit:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree
  `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, main after PR #132 / M2A). Previous
  generation: `9d94fedd1ec509f127284b8542f61ea46674d018` (2026-06-03, after PR #86).
- **Generated from:** direct inspection of the executing tests and route source on the
  commit above (raw-body/response-header/content-encoding/native-contract/query-fidelity
  suites executed under Node 24 in the M1/M2A gates; CI unit + integration jobs green on
  the exact merge commit — run `31988375993`).
- **Two kinds of evidence, kept separate in this map:** (a) HERMETIC coverage — executing
  unit/route/integration tests against fake/loopback providers (this is what "covered"
  means in every table below); (b) LIVE ACCEPTANCE — the M2/M2A real-provider runs
  (recorded in the section "Live acceptance (M2/M2A)"; NOT test coverage, not
  regression-proof, executed-scope only).
- **B3 status:** IMPLEMENTED (EP-006). This map no longer gates B3.
- **Last updated:** 2026-08-18

## Scope

- This document is a **coverage map** of executing hermetic tests. (Historical: it was
  once a B3 gate; B3 is implemented.)
- Covers the OpenAI and Anthropic **provider-native passthrough** harness
  (`/passthrough/openai/*`, `/passthrough/anthropic/*`).
- Does **not** cover the governed `/v1/runs` shortcut (out of provider-native
  parity scope per the spec).
- Does **not** itself cover live providers — the M2/M2A live acceptance is summarized
  separately at the end and is not counted as coverage.
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
  - Foundation V1 suites (M1 / M2A), both providers unless noted:
    - `packages/provider-*/src/routes/register-passthrough.content-encoding.test.ts` (ENC-OAI / ENC-ANT; real TCP)
    - `packages/provider-*/src/routes/register-passthrough.native-contract.test.ts` (NC-OAI / NC-ANT; real TCP)
    - `packages/provider-*/src/routes/register-passthrough.registry-invariant.test.ts` (RI-OAI / RI-ANT)
    - `packages/provider-*/src/routes/register-passthrough.query-fidelity.test.ts` (QF-OAI / QF-ANT; real socket)
    - `packages/provider-*/src/passthrough/transport-encoding.test.ts` (TE-OAI / TE-ANT; unit)
    - `packages/provider-anthropic/src/passthrough/request-id.test.ts` (RID-ANT; unit)
    - `packages/provider-*/src/governed/register-governed.m1-contract.test.ts` (GOV-OAI / GOV-ANT; governed surface, outside raw-byte parity scope but listed for the honesty contract)
    - `packages/provider-*/src/routes/register-passthrough.stream-terminal.test.ts` (ST-OAI / ST-ANT; EP-008C)
    - integration: `tests/integration/{anthropic,openai}-passthrough.test.ts` F1-T*/F5-T* blocks, `governed-anthropic.test.ts` F1-T4, `governed-run-e2e.test.ts` F1-T5
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
  - PR #131 — Foundation M1: native/governed contract, Content-Encoding, computer-use floor, unknown-beta forward (`3e90f2fb`)
  - PR #132 — Foundation M2A: Anthropic `request-id` evidence, raw query preservation, entrypoints (`de80664a`)

### Raw-body test anchors (stable keys)

Inserting a test shifts every later line number, so the body of this map cites raw-body
evidence by a **stable alias** (`RB-OAI[alias]` / `RB-ANT[alias]`) whose durable key is the
exact `it(...)` test name below. Line numbers live **only** here and are current as of the
source commit; regenerate this index (not the body) when the test files change.

**RB-OAI** (`packages/provider-openai/src/routes/register-passthrough.raw-body.test.ts`, line numbers at `de80664a`):
- `[byte-for-byte]` — `forwards application/json byte-for-byte and hashes the ORIGINAL client bytes` (it L129; `Buffer.compare===0` L143; `native_request_hash` L148-149; `body_forward_mode:"raw"` L150; unknown/future fields L155-156; no `max_tokens`/`max_completion_tokens`/`temperature` L158-160; non-canonical fixture L131)
- `[charset]` — `preserves bytes for application/json; charset=utf-8` (it L163; `Buffer.compare===0` L175; `native_request_hash` L176)
- `[resp-fidelity]` — `preserves upstream status, headers, and response body bytes` (it L179; status 201 L196; `x-provider-custom` L197)
- `[vendor-415]` — `does NOT silently broaden vendor JSON (application/vnd.openai+json stays unsupported)` (it L202; 415 L210; not forwarded L211)
- `[multipart]` — `multipart sanity: multipart/form-data still arrives as a Buffer and forwards byte-for-byte` (it L214; `Buffer.compare===0` L237; `body_forward_mode:"raw"` L239; hash L240)
- `[nested-stream]` — `does NOT treat a nested "stream": true as streaming (reads top-level stream only)` (it L243; `Buffer.compare===0` L258; `is_stream===false` L261)
- `[tools-block]` — `classifies tools from the raw Buffer path (valid JSON with top-level tools)` (it L267; 403 L281; `tool.validation_blocked` L282; not forwarded L284; blocked v4 `body_forward_mode:"blocked"` L287, `status_code` 403 L288, `native_request_hash` over the original bytes L289) — the blocking tool is provider-hosted computer use (M1 floor)
- `[typed-unknown-forward]` (M1) — `M1: a non-function tool on Chat Completions (web_search) is typed_unknown → forwarded byte-for-byte, provider decides` (it L294; no `tool.validation_blocked` L304; `Buffer.compare===0` L306; classifier `allowed` L310)
- `[valid-tools]` — `forwards valid tools byte-for-byte after governance inspection` (it L313; no `tool.validation_blocked` L331; `Buffer.compare===0` L335; `native_request_hash` L339-340; `body_forward_mode:"raw"` L341; classifier `allowed` L351; unknown fields L360-361; no defaults L363-365)
- `[malformed]` — `forwards malformed JSON byte-for-byte instead of rejecting at the edge` (it L368; status 400 L388; `Buffer.compare===0` L391; `native_request_hash` L393; `body_forward_mode:"raw"` L394)
- `[hop-by-hop]` — `strips hop-by-hop response headers while preserving status, body, and allowed headers (INV-007)` (it L399; status 201 L436; `x-provider-custom` preserved L437; `proxy-authenticate`/`proxy-authorization`/`te`/`trailer`/`upgrade` `toBeNull` L441-445; `connection` sentinel not leaked L450)

**RB-ANT** (`packages/provider-anthropic/src/routes/register-passthrough.raw-body.test.ts`, line numbers at `de80664a`):
- `[byte-for-byte]` — `forwards application/json byte-for-byte, hashes ORIGINAL bytes, preserves max_tokens=777` (it L131; `Buffer.compare===0` L144; `native_request_hash` L148-149; `body_forward_mode:"raw"` L150; `max_tokens===777` L158; unknown/future fields L159-160; no `1024` L162; non-canonical fixture L133)
- `[charset]` — `preserves bytes for application/json; charset=utf-8` (it L165; `Buffer.compare===0` L177; `native_request_hash` L178)
- `[resp-fidelity]` — `preserves upstream status, headers, and response body bytes` (it L181; status 202 L198; `x-provider-custom` L199)
- `[nested-stream]` — `does NOT treat a nested "stream": true as streaming (reads top-level stream only)` (it L204; `Buffer.compare===0` L219; `is_stream===false` L222)
- `[tools-block]` — `classifies tools from the raw Buffer path (valid JSON with top-level tools)` (it L225; 403 L239; `tool.validation_blocked` L240; not forwarded L241; blocked v4 `body_forward_mode:"blocked"` L244, `status_code` 403 L245, `native_request_hash` L246) — the blocking tool is provider-hosted computer use (M1 floor)
- `[typed-unknown-forward]` (M1) — `M1: a tool with type:null (typed_unknown) is forwarded byte-for-byte — the provider decides` (it L250; no `tool.validation_blocked` L260; `Buffer.compare===0` L262; classifier `allowed` L266)
- `[valid-tools]` — `forwards valid tools byte-for-byte after governance inspection` (it L269; no `tool.validation_blocked` L287; `Buffer.compare===0` L291; `native_request_hash` L295-296; `body_forward_mode:"raw"` L297; classifier `allowed` L307; unknown fields L317-318; `max_tokens===777` L319; no `1024` L321)
- `[malformed]` — `forwards malformed JSON byte-for-byte instead of rejecting at the edge` (it L324; status 400 L343; `Buffer.compare===0` L346; `native_request_hash` L348; `body_forward_mode:"raw"` L349)
- `[hop-by-hop]` — `strips hop-by-hop response headers while preserving status, body, and allowed headers (INV-007)` (it L354; status 202 L391; `x-provider-custom` preserved L392; `proxy-authenticate`/`proxy-authorization`/`te`/`trailer`/`upgrade` `toBeNull` L396-400; `connection` sentinel not leaked L405)

**RH-OAI / RH-ANT** (`packages/provider-*/src/routes/response-headers.test.ts`, at `de80664a`): `removes every hop-by-hop header, including the runtime-managed ones` (it L30; `keep-alive`/`transfer-encoding`/`content-length` L44-46; allowed `x-request-id`/`x-provider-custom` preserved L50-51), `detects hop-by-hop headers case-insensitively` (L57), `does not mutate its input` (L76), `returns an empty object when every header is hop-by-hop` (L88). `HOP_BY_HOP` sets: REG-OAI L69 / REG-ANT L70; `filterResponseHeaders` REG-OAI L118 / REG-ANT L120.

**INT-OAI / INT-ANT stream anchors** (at `de80664a`): INT-OAI `POST /v1/responses with stream:true → 200 + Content-Type text/event-stream + is_stream audit` (it L122; `text/event-stream` L141; `is_stream` L148; `stream_final_hash` presence L151); INT-ANT `POST /v1/messages with stream:true → …` (it L279; `text/event-stream` L303; `is_stream` L313; `stream_final_hash` presence L316).

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
| INV-007 | Response status/header/body fidelity (minus hop-by-hop) | covered_by_multiple_tests | RB-OAI[resp-fidelity] + RB-OAI[hop-by-hop]; RB-ANT[resp-fidelity] + RB-ANT[hop-by-hop]; RH-OAI L30-88; RH-ANT L30-88; ENC-* `ENC-11` | no | downstream raw-body tests cover the HTTP-observable stripping incl. the `connection` sentinel; RH-OAI/RH-ANT add executing **pre-normalization** unit coverage of the full hop-by-hop filter incl. keep-alive/transfer-encoding/content-length — these three are no longer static-structure only |
| INV-008 | No hidden defaults/caps/remaps in body | covered_by_raw_body_test | RB-OAI[byte-for-byte]; RB-ANT[byte-for-byte] | no | OpenAI: no caps injected; Anthropic: `max_tokens` kept, no `1024` |
| INV-009 | No schema narrowing / common-denominator | covered_by_raw_body_test | RB-OAI[byte-for-byte] + RB-OAI[valid-tools]; RB-ANT[byte-for-byte] + RB-ANT[valid-tools] | no | unknown/future fields survive on the allowed-tools path too (RB-OAI[valid-tools] / RB-ANT[valid-tools]) |
| STREAM-001 | Stream detection reads only top-level `stream===true` | covered_by_multiple_tests | RB-OAI[nested-stream] + INT-OAI L148; RB-ANT[nested-stream] + INT-ANT L313 | no | nested-negative + top-level-positive together |
| STREAM-002 | No regex/substring stream detection | covered_by_raw_body_test | RB-OAI[nested-stream], RB-ANT[nested-stream] | no | nested `"stream":true` substring does not stream |
| STREAM-003 | Nested `"stream":true` must NOT stream | covered_by_raw_body_test | RB-OAI[nested-stream], RB-ANT[nested-stream] | no | `is_stream===false` |
| STREAM-004 | Top-level `stream:true` → `text/event-stream` | covered_by_integration_test | INT-OAI L141, INT-ANT L303 | no | uses `app.inject` (spec-permitted for non-raw-body checks) |
| STREAM-005 | `stream_final_hash` present + `is_stream:true` | covered_by_multiple_tests | presence: INT-OAI L148,151 / INT-ANT L313,316; **hash-over-bytes correctness:** ENC-OAI/ENC-ANT `ENC-03/10` (`stream_final_hash === sha256(<emitted SSE bytes>)`, real TCP) + ST-OAI/ST-ANT `(1) clean stream → … full hash` | no | Foundation V1: presence AND correctness over the actual emitted bytes are both executing-test-proven (was presence-only at 9d94fedd) |
| JSON-001 | Malformed JSON forwarded unchanged byte-for-byte | covered_by_raw_body_test | RB-OAI[malformed], RB-ANT[malformed] | no | `Buffer.compare===0` on a truncated body |
| JSON-002 | GovAI does not reject at the edge on parse failure | covered_by_raw_body_test | RB-OAI[malformed], RB-ANT[malformed] | no | provider 400 relayed; fake captured the request |
| JSON-003 | Provider native 4xx relayed (status/body) | covered_by_raw_body_test | RB-OAI[malformed], RB-ANT[malformed] | no | error response headers not separately asserted |
| JSON-004 | Audit still emits hash + `body_forward_mode:"raw"` on malformed | covered_by_raw_body_test | RB-OAI[malformed], RB-ANT[malformed] | no | |
| JSON-005 | `body_parse_status` / `classification_skipped` audit field | out_of_scope_followup | spec §10, §15 | no | spec-declared follow-up; no schema field exists |
| CT-001 | `application/json` → raw Buffer | covered_by_raw_body_test | RB-OAI[byte-for-byte], RB-ANT[byte-for-byte] | no | |
| CT-002 | `application/json; charset=utf-8` → raw Buffer | covered_by_raw_body_test | RB-OAI[charset]; RB-ANT[charset] | no | |
| CT-003 | OpenAI `multipart/form-data` byte-preserved | covered_by_raw_body_test | RB-OAI[multipart] | no | OpenAI only |
| CT-004 | Vendor JSON (`application/*+json`) unsupported (415) | covered_by_raw_body_test | RB-OAI[vendor-415] | no | OpenAI; not required for Anthropic by spec §9 |
| CT-005 | gzip / `Content-Encoding` policy | covered_by_multiple_tests | ENC-OAI / ENC-ANT (10 tests each, real TCP): request hop `accept-encoding: identity` upstream; gzip/deflate/br non-stream and gzip SSE stream relayed DECODED with no stale `content-encoding`/`content-length`, hashes over the delivered bytes; provider 4xx compressed error body relayed decoded; representation validators (`content-digest`/strong `etag`/`content-md5`) dropped only when decoded, weak `etag` kept; identity response relayed unchanged; unknown coding (`x-custom`) relayed RAW with its truthful `content-encoding`; hop-by-hop still stripped. Unit: TE-OAI / TE-ANT (`withIdentityAcceptEncoding`, `fetchDecodedBody`, `normalizeFetchResponseHeaders`) | no | Foundation V1 (M1, FB-3): implemented + executing coverage; the former "spec-declared policy gap" is CLOSED — `CONTENT_ENCODING_DECISION=identity_upstream + defense_in_depth_drop_when_decoded` |
| EXEC-001 | `app.listen()` + real `fetch` for raw-byte proof | covered_by_static_structure | RB-OAI/RB-ANT `beforeAll` `app.listen` (L111-113, before any `it`) + per-test `fetch(... body: sentRawBody)` | no | |
| EXEC-002 | `app.inject` not used for raw-body proof | covered_by_static_structure | RB-OAI/RB-ANT use `fetch`, no `.inject(` call | no | integration uses `app.inject` for SSE/audit only |
| EXEC-003 | Node `>=24` + pnpm `>=10.33.2` | covered_by_static_structure | node: `.github/workflows/ci.yml:20,59` (`node-version: 24`), `package.json:8` (engines.node `>=24.0.0`); pnpm: `package.json:6` (packageManager `pnpm@10.33.2`), `package.json:9` (engines.pnpm `>=10.33.2`), `.github/workflows/ci.yml:21-22,60-61` (`pnpm/action-setup@v4` version 10.33.2), `.github/workflows/ci.yml:23,62` (`pnpm install --frozen-lockfile`) | no | spec §7 requires `Node >=24; pnpm >=10.33.2` — both conditions mapped (unit + integration jobs) |
| EXEC-004 | No live providers | covered_by_static_structure | RB fake provider loopback; INT `server-fixture` sets provider keys undefined + `GOVAI_LIVE_TESTS:false` | no | |
| EXEC-005 | No AWS/KMS | covered_by_static_structure | INT `server-fixture` uses `DevKms` (`GOVAI_KMS_PROVIDER:'dev'`) | no | |
| ANT-001 | Anthropic `max_tokens` preserved (777; never 1024) | covered_by_raw_body_test | RB-ANT[byte-for-byte] | no | `max_tokens===777` + forwarded bytes contain no `1024` |
| ANT-MP | Anthropic multipart route-level test | out_of_scope_followup | spec §9, §15 | no | spec marks as follow-up; OpenAI multipart covered |
| B3-001 | Versioned coverage map exists + maps every mandatory item | covered_by_versioned_document | this document (versioned since PR #87 lineage; regenerated at `de80664a`) | no (historical gate — B3 implemented in EP-006) | the "Blocks B3" column is retained for history only |
| FV1-ENC | Content-Encoding truth on both hops (request identity; decoded-only header drop) | covered_by_multiple_tests | ENC-OAI/ENC-ANT (real TCP) + TE-OAI/TE-ANT (unit) | n/a | see CT-005; Foundation V1 M1 FB-3 |
| FV1-BETA | Native beta contract: unknown/unresolved tokens forwarded byte-intact + hashed marker evidence; only `hard_denied` (computer-use) → explicit 403 + durable blocked v4; raw token never stored | covered_by_multiple_tests | NC-ANT `BETA-01..08` (real `ANTHROPIC_BETA_POLICY`), NC-OAI `BETA-01..08` incl. `BETA-05` deprecation-only tokens forwarded; `DENY-01` | n/a | Foundation V1 M1 FB-1 (OD-1=A); the pre-M1 default-deny is gone |
| FV1-TOOLS | Non-computer tools classified + forwarded; provider-hosted computer use is the ONLY validation floor (403 + `tool.validation_blocked` diagnostic + durable blocked v4 with classifications + taxonomy v3); streaming pre-provider block is truthful (`stream_final_hash=SHA256(empty)`, no `stream_outcome`) | covered_by_multiple_tests | NC-* `TOOLS`/`DENY-02`/`DENY-03`; RB-*[typed-unknown-forward]; RB-*[tools-block] | n/a | Foundation V1 M1 FB-2 |
| FV1-ROUTE | Gate order: auth (401, no registry disclosure) → path (404) → method (405 + truthful `Allow`, never 500) → floors → credential (502 `provider_credential_unresolvable`) → forward; genuine registry inconsistency stays a loud 500 | covered_by_multiple_tests | NC-* `ROUTE-01/01b/02/03/03b`; RI-* `ROUTE-04`; `apps/api/src/pipeline/provider-credentials.pool-acquire.test.ts` (502 mapping incl. DB-unavailable) | n/a | Foundation V1 M1 |
| FV1-QUERY | Raw request query preserved on both passthroughs (order, duplicates, empties, `%2F`, `%252F`, `+`, `?beta=true`); routing stays pathname-only; no query bypasses auth/405/404; `native_endpoint` stays the template | covered_by_multiple_tests | QF-ANT `F5-T3/T4/T8/T8b/T5-T7-T9` + control; QF-OAI `F5-T1/T2/T5-T7-T9` + control (real socket); INT-ANT `F5-T8`, `F5-T3/T5`, `F5-T6/T7/T9` (L422,449,469); INT-OAI `F5-T1/T2`, `F5-T6` (L430,454) | n/a | Foundation V1 M2A F5; the query is NOT a first-class field of the sealed v4 event (registered residual R1) |
| FV1-REQID | Anthropic provider request id read from the REAL `request-id` header (legacy names isolated fallbacks; OpenAI `x-request-id` unaffected; provider-aware run dispatcher) | covered_by_multiple_tests | RID-ANT (5 unit); `packages/provider-anthropic/src/passthrough/stream-forward.test.ts` primary case; `apps/api/src/pipeline/provider-invoke.test.ts` provider-aware + adversarial; INT-ANT `F1-T1/T2/T3` (L362,375,395); `tests/integration/governed-anthropic.test.ts` `F1-T4` (L298); `tests/integration/governed-run-e2e.test.ts` `F1-T5` (L492); INT-OAI `F1-T6` (L407) — the hermetic fixture emits `request-id` ONLY on the Anthropic happy path | n/a | Foundation V1 M2A F1 |
| FV1-GOV | Governed surface (outside raw-byte parity scope): original bytes held (no re-serialization), malformed JSON not rejected by GovAI, top-level-only stream detection, recommendation vs applied honesty (`x-govai-enforcement-decision` = matrix recommendation; `x-govai-enforcement-applied` = `forwarded`/`blocked`; 403 carries `enforcement_applied` + `block_trigger`), truthful streaming pre-provider block | covered_by_multiple_tests | GOV-ANT / GOV-OAI (`F2-01..03`, `FB-2`, `H-2`, `§11.4`) | n/a | Foundation V1 M1 (F2 HTTP honesty; ask/sandbox primitives NOT implemented) |
| FV1-STREAM-TERM | Terminal `PassthroughInvoked` on every stream termination path (`stream_outcome` complete / upstream_error / client_disconnect; never-throw; no orphan upstream) | covered_by_multiple_tests | ST-OAI / ST-ANT (6 cases each) | n/a | EP-008C (pre-Foundation), listed because it carries the stream hash truth |

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
- **Evidence (pre-normalization filter — PR #86):** PR #86 extracted the inline response hop-by-hop filtering into a pure, exported `filterResponseHeaders` helper (REG-OAI L118 / REG-ANT L120 at `de80664a`, each using its own file-local `HOP_BY_HOP` set — REG-OAI L69 / REG-ANT L70 — via `HOP_BY_HOP.has(k.toLowerCase())`) and added executing unit tests (RH-OAI / RH-ANT) that call it directly, **before** Node/Fastify response normalization:
  - every hop-by-hop header removed across the full set — `host`, `connection`, `content-length`, `keep-alive`, `transfer-encoding`, `upgrade`, `proxy-authorization`, `proxy-authenticate`, `te`, `trailer` (RH-OAI L30-41 / RH-ANT L30-41), with `keep-alive`/`transfer-encoding`/`content-length` asserted explicitly (RH-OAI L44-46 / RH-ANT L44-46);
  - allowed headers preserved with exact key+value — `content-type`, `x-request-id`, `x-provider-custom` (RH-OAI L50-52 / RH-ANT L50-52);
  - case-insensitive detection (RH-OAI L57 / RH-ANT L57);
  - input not mutated (RH-OAI L76 / RH-ANT L76).
- **How this addresses the Codex P2 (INV-007):** the three runtime-managed headers — `keep-alive`, `transfer-encoding`, `content-length` — now have **executing** unit-test coverage of the route's hop-by-hop filter (RH-OAI/RH-ANT), not merely static-structure evidence. The P2 was addressed by adding an executing test, not by rewording. **Scope of the proof:** RH-OAI/RH-ANT prove the filter step **before** Node/Fastify normalization; they do **not** assert these three headers on the final downstream HTTP response, because Node/Fastify owns and recomputes them on GovAI's own outgoing response. That downstream surface remains runtime-owned and is intentionally not claimed for these three — it is a property of the runtime, not a missing test.
- **Notes:** the downstream raw-body tests (RB-OAI/RB-ANT) cover the HTTP-observable subset (including the `connection` sentinel); the pre-normalization unit tests (RH-OAI/RH-ANT) cover the full hop-by-hop policy including the runtime-managed three. Together they map INV-007 to executing coverage. The `HOP_BY_HOP` sets are at REG-OAI L69 / REG-ANT L70 (`de80664a`).
- **B3 impact:** historical — B3 is implemented (EP-006).

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
- `stream:true` positive → INT-OAI L141,148,151 (STREAM-004/005); hash correctness → ENC-OAI `ENC-03/10`.
- (Foundation V1) unknown-beta forward / computer-use floor / gate order / query fidelity / Content-Encoding → NC-OAI, RI-OAI, QF-OAI, ENC-OAI (see FV1-* rows).

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
- `stream:true` positive → INT-ANT L303,313,316 (STREAM-004/005); hash correctness → ENC-ANT `ENC-03/10`.
- (Foundation V1) unknown-beta forward / computer-use floor / gate order / query fidelity / `request-id` / Content-Encoding → NC-ANT, RI-ANT, QF-ANT, RID-ANT, ENC-ANT (see FV1-* rows).
- **Anthropic multipart route-level** → out_of_scope_followup (spec §9, §15); no executing test.

## Stream/SSE matrix (spec §11)

- Top-level `stream===true` only → covered_by_multiple_tests: nested-negative (RB-OAI[nested-stream] / RB-ANT[nested-stream]) + top-level-positive (INT-OAI L148 / INT-ANT L313); governed: GOV-* `H-2`.
- No regex/substring → RB-OAI[nested-stream] / RB-ANT[nested-stream] (nested substring does not stream).
- Nested must not stream → RB-OAI[nested-stream] / RB-ANT[nested-stream].
- `text/event-stream` preserved → INT-OAI L141 / INT-ANT L303.
- `stream_final_hash` required + `is_stream:true` → presence: INT-OAI L148,151 / INT-ANT L313,316. **Correctness over the actual emitted bytes** (Foundation V1): ENC-OAI/ENC-ANT `ENC-03/10` assert `stream_final_hash === sha256(<emitted SSE bytes>)` over real TCP; ST-* `(1)` asserts the full hash on a clean stream. The former presence-only limitation is closed.

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
- gzip / `Content-Encoding` → **covered (Foundation V1 M1)**: ENC-OAI / ENC-ANT + TE-OAI / TE-ANT (see CT-005 / FV1-ENC).

## Execution model matrix (spec §7)

- `app.listen()` + real `fetch` for raw-byte proof → RB-OAI/RB-ANT `beforeAll` calls `app.listen({ port: 0, host: '127.0.0.1' })` and each test uses `fetch(..., { body: sentRawBody })` (covered_by_static_structure).
- `app.inject` not used for raw-byte proof → the raw-body files contain no `.inject(` call (only a header comment); integration tests use `app.inject` for SSE/audit checks, which the spec permits.
- Node `>=24` + pnpm `>=10.33.2` (spec §7) → covered_by_static_structure:
  - Node: `.github/workflows/ci.yml:20,59` (`node-version: 24`, unit + integration jobs) + `package.json:8` (`engines.node >=24.0.0`).
  - pnpm: `package.json:6` (`packageManager: pnpm@10.33.2`) + `package.json:9` (`engines.pnpm >=10.33.2`) + `.github/workflows/ci.yml:21-22,60-61` (`pnpm/action-setup@v4`, `version: 10.33.2`) + `.github/workflows/ci.yml:23,62` (`pnpm install --frozen-lockfile`).
- No live providers → loopback fake provider (raw-body); `tests/integration/helpers/server-fixture.ts` sets `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` undefined, `GOVAI_LIVE_TESTS:false`, and points `GOVAI_PROVIDER_BASE_URL` at the hermetic fixture.
- No AWS/KMS → the integration fixture uses `DevKms` (`GOVAI_KMS_PROVIDER:'dev'`), not real AWS KMS.

## Follow-ups (Foundation V1 view)

- **`body_parse_status` / `classification_skipped` audit field** — still open: spec §10/§15 explicitly defers it; no schema field exists (a v5 evidence-schema item; see the anti-evaporation clause in `docs/architecture/foundation-v1-freeze.md`).
- **gzip / `Content-Encoding` policy** — **CLOSED (M1, FB-3):** implemented and executing-test-covered (CT-005 / FV1-ENC).
- **Anthropic multipart route-level test** — still open: spec §9 marks it a follow-up; OpenAI multipart sanity is covered; no Anthropic `/v1/files` multipart byte-for-byte test exists (registered under R10 broader parity in the freeze record).
- **`stream_final_hash` hash-over-bytes correctness** — **CLOSED:** asserted over the actual emitted bytes (ENC-* `ENC-03/10`, ST-* `(1)`).
- **`keep-alive` / `transfer-encoding` / `content-length` pre-normalization filter** — covered since PR #86 (RH-OAI/RH-ANT); the downstream HTTP assertion for these three remains runtime-owned (Node/Fastify recomputes them) and is intentionally not claimed. Foundation V1 adds the truthful `content-length` handling when the runtime decoded a compressed upstream body (ENC-*).
- **Valid-tools pass-through positive byte-for-byte (INV-006 / INV-009)** — closed (RB-*[valid-tools]) and extended by RB-*[typed-unknown-forward] (M1).
- **Query request-target as first-class sealed evidence** — NOT present in v4 (the query is forwarded verbatim; `native_endpoint` stays the registry template) — registered residual R1.
- **Typed unknown-beta provenance / applied-vs-recommended provenance in sealed v4** — NOT present (hashed markers / HTTP headers are the schema-neutral compromise) — registered residuals R2/R3.

## Blocking items

No `uncovered_blocking` or `ambiguous_blocking` items remain for H1 v2 provider-native compatibility coverage at `de80664a`, based on the evidence listed above.

Historical note: at `9d94fedd` this section also gated B3 on a process decision; B3 was subsequently authorized and implemented (EP-006). This map no longer gates anything; it records coverage.

## Live acceptance (M2/M2A) — separate from hermetic coverage

The Foundation V1 M2 (base `3e90f2fb`, 2026-08-16/17) and M2A (head `7cdde191`, tree `0174a5c5` == the tree at `de80664a`, 2026-08-17) missions exercised the provider-native surfaces against the REAL Anthropic and OpenAI APIs over real TCP with the official SDKs (`@anthropic-ai/sdk` 0.117.1, `openai` 7.4.0), Claude Code 2.1.233 and Codex CLI 0.140.0-alpha.2, with provider keys held only by GovAI (KMS-envelope tenant credentials). Executed-scope results (records: `EP-FOUNDATION-V1-M2-MISSION-RECORD-REV2.md`, `EP-FOUNDATION-V1-M2A-MISSION-RECORD-REV2.md`, external audit artifacts, hash-verified): Native/Audited + Governed × non-stream + stream = 8/8 PASS on both providers; Chat Completions smoke PASS; provider 4xx relayed truthfully (Anthropic 404, OpenAI 400); synthetic unknown beta forwarded and rejected by the provider (`PASS_PROVIDER_REJECTED_AS_EXPECTED`, hashed marker durable, raw token nowhere); real current Anthropic beta accepted; client-defined tools reached both providers; computer-use blocked pre-provider on 4/4 surfaces (dispatch count 0); FB-3 real-socket header truth (no `content-encoding`, `content-length == delivered bytes`); `/v1/runs` real durable runs + idempotent replay; AuditBridge captures with recomputed `payload_hash`/`capture_id` (21/21, 6/6); one bounded seal; Anthropic `request-id` captured (M2A); raw query reached both providers verbatim (M2A); Claude Code and Codex CLI answered through GovAI; zero provider-secret leakage. **This is acceptance evidence for the executed lanes only — it is not regression-proof coverage and claims nothing about endpoints, models, SDK versions, betas or CLI workflows outside those lanes.**

## B3 decision

Historical: this document did not start or authorize B3. B3 was authorized and implemented separately (EP-006, `apps/audit-sealer`); see `docs/architecture/current-state.md` §3.
