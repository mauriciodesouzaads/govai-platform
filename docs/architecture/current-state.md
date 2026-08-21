# GovAI Current State

## Status

- **Evidence-first source of truth** for the current implementation state of GovAI. Generated from repository **source manifests in this tree**, anchored on the **Foundation V1 runtime anchor** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, squash of PR #132 / M2A, 2026-08-17) and re-derived from the **current repository tree, including all post-freeze movements present in this tree**, not from memory (the mechanically derivable portion is generated and CI-verified — see §*Source manifests*). The Foundation V1 baseline, its executed-scope acceptance, its residual register and its explicit non-claims are recorded in [foundation-v1-freeze.md](./foundation-v1-freeze.md); this document and that record prevail over every plan/target/historical document under `docs/`.
- **B3 (the AuditSealer runner) is authorized and implemented (EP-006).** `apps/audit-sealer` ships the dedicated runner (deployable bundle, EP-SEALER-DEPLOY); it consumes no provider traffic and runs outside the request hot path (see §3 and §7). Live continuous operation remains a separate operational authorization.
- **Backend Foundation V1 runtime is complete and real-provider accepted (executed scope):** M1 (PR #131, `3e90f2fb`) restored the low-friction Native/Audited contract and the governed honesty contract; M2 (read-only at `3e90f2fb`) exercised the runtime against the real Anthropic and OpenAI APIs with official SDKs, Claude Code and Codex CLI; M2A (PR #132, `de80664a`) closed the three narrow M2 gaps (Anthropic `request-id` evidence, entrypoint canonical-path guard, raw query preservation) and was live re-accepted at the merged tree. `FOUNDATION_V1_KNOWN_RUNTIME_BLOCKERS=0`. See §2 (provider-native contract) and §8 (canonical states).
- **P0 "Truth and Integrity" program — all seven items dispositioned:** P0.1 (F5+F6, PR #118, `ed18736a`), P0.2 (F1+C-2, PR #119, `19bcb452`), F4 preventive hardening (PR #120, `719fefc2`), P0.3-A (F3 durable provider dispatch, PR #123, `165291d9`), P0.3-C (cross-request run execution idempotency, PR #129, `f381d3fa`), and **F2 CLOSED as an evidence-granularity residual** (`F2_CLASSIFICATION=EVIDENCE_GRANULARITY_GAP`, `F2_RUNTIME_DEFECT=NO`, `F2_FALSE_EVIDENCE=NO`, `F2_FOUNDATION_BLOCKER=NO`, no schema v5 — freeze record §5). The **P0.3 runtime lane is COMPLETE**; the program's remaining documentary item — **PR-0/D9 repository promulgation — is COMPLETE in this tree** (see §"D9 / PR-0 promulgation state" in §8). See §8 for the canonical F1–F6 + C-2 matrix.
- **EP-11 / ADR-032 provider-truth runtime correction is merged and the ADR file is reconciled:** PR #126 squash `01c05fd6` (runtime), ADR-032 `IMPLEMENTATION_STATUS=COMPLETE` (reconciled by M3; the promulgation-era `PENDING` pointer is historical). See §8 *EP-11 / PR #126 canonical state*.
- **Provider-native doctrine ACCEPTED (ADR-021)** with an explicit separation between normative doctrine and the currently proven scope; unknown provider semantics pass or are observed by default; the only Native hard floor is provider-hosted computer-use; Phase 5 ask/sandbox/enforce primitives are NOT implemented (recommendation vs applied is honest over HTTP). No universal provider parity is claimed.
- **Runtime route existence does not imply runtime evidence capture.** See §3 *Runtime-to-evidence wiring* (wired for the four direct routes; `/v1/runs` chain-authoritative).
- **The `UI_UX_V1_FOUNDATION` product lane has STARTED, and its first milestone — U1, the evidence cockpit — is implemented in this tree** (`apps/ui`, EP-UIUX-V1-U1). It is a read-only static SPA over the three existing read surfaces (`/v1/evidence/*`, `/v1/audit-events`, `/v1/capabilities`); it changes NO backend behaviour (the Foundation V1 runtime anchor is unchanged) and it makes no capability claim the runtime does not support. See §1 *Interface layer*. **EP-UIUX-V1-B2 (this tree) adds the one backend surface U1 was missing: `GET /v1/me`** — a read-only projection of the identity `authenticateApiKey` already resolves — and wires it into the session, so the shell now shows the server-supplied operational mode, principal type and roles instead of correctly showing none. Production human auth/session/API-key lifecycle is still absent (residual R14) — `principal_type` is the literal `api_key` precisely so nothing presents a controlled-pilot org credential as a human login. **EP-UIUX-V1-U1.5 (this tree) adds the AI Console at `/ai`** — a provider-native conversational surface over the six already-registered direct provider routes (OpenAI Responses / Chat Completions and Anthropic Messages, each in Native/Audited and Governed mode). It adds **no route, no migration and no event schema**, and it changes no governance semantics. U2 (Workroom) is not started, and there is no governance-settings, Phase-5-enforcement, Workroom, regulatory or admin UI. **The two backend findings the AI Console's live acceptance produced were owner-adjudicated and are FIXED in this tree** (`EP-UIUX-V1-U1.5-AI-CONSOLE-CLOSEOUT-02`): `AI-CONSOLE-ORIGIN-RELAY-01` — the direct routes relayed the browser's `Origin` header upstream and Anthropic answered 401, making the Anthropic surface unusable from a browser; the server→provider hop now strips it class-wide (both providers, Native/Audited and Governed, streaming and non-streaming) — and `AI-CONSOLE-RESPONSES-DLP-GAP-01` — the governed Responses DLP pre-scan skipped role-shaped `input[]` items; all five accepted message spellings now extract identically. These are the only backend runtime changes this milestone makes, and both are live/wire-proven. Two residuals are OPEN and deliberately unfixed, both `packages/provider-*` route behaviour that the owner adjudicates per finding: `PROVIDER-INBOUND-HOP-HEADER-RESIDUAL-01` (`referer` / `cookie` describe the inbound hop by the same reasoning as `origin`, and only `origin` is in `STRIP_INBOUND_BROWSER_HOP` — so the server-side outbound header builders **would relay an inbound `cookie`**, and `referer` **is** relayed today. Stated precisely: the official console's `ApiClient` issues every request with `credentials: 'omit'`, so the browser attaches **no** cookie to GovAI calls and none reaches the builders to relay — the measured 6 cookies / 229 bytes on the acceptance origin quantify what a `credentials: 'include'` caller, or any future cookie-based human auth (R14), would hand upstream; that risk is MATERIAL and the residual stays OPEN) and `PROVIDER-NONSTREAM-FORWARD-UNBOUNDED-01` (the non-stream forward calls `forwardRaw` with no `signal` and awaits an unbounded `res.arrayBuffer()`; pre-existing, made routinely reachable by the console's model discovery, streaming forward unaffected). See [stale-docs-register.md](./stale-docs-register.md).

### Status vocabulary (every IMPLEMENTED_* row must cite source; SOURCE_AND_TEST also cites a test)

- `IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED`
- `IMPLEMENTED_RUNTIME_SOURCE_VERIFIED_TESTS_NOT_LOCATED`
- `IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED`
- `IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_VERIFIED_TESTS_NOT_LOCATED`
- `IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE`
- `DOCUMENTED_TARGET_ONLY`
- `STALE_DOC_NEEDS_UPDATE`
- `NEEDS_SOURCE_VERIFICATION`
- `PLANNED`
- `BLOCKED_BY_DECISION`

## Source manifests

The block below is **generated from the repository tree** (tracked files + the vitest collectors) by `pnpm docs:manifest:write` and **CI-verified** by `pnpm docs:manifest:check` in the `unit` job — a PR that changes tests, routes, migrations or the enumerated document structure without reconciling it fails CI. The machine-readable mirror is [generated/source-manifest.json](./generated/source-manifest.json). Exact counts live ONLY here; other sections reference this manifest instead of repeating numbers (finding `AI-CONSOLE-CLOSEOUT-CANONICAL-MANIFEST-01`: hand-maintained copies of these counts went stale twice — U1's 244→281 and the AI Console's 708→753 / 129→136 / 1463→1517 — so hand-maintained copies are no longer the mechanism).

<!-- BEGIN GENERATED SOURCE MANIFEST -->
<!--
  GENERATED — DO NOT EDIT MANUALLY.
  Source: pnpm docs:manifest:write   (derives every value below from the repository tree)
  Verification: pnpm docs:manifest:check   (CI `unit` job — a drifted block fails the build)
-->

Machine-derived from the current repository tree — tracked files plus the vitest
collectors — mirrored in [generated/source-manifest.json](./generated/source-manifest.json) (schema_version 1).
A test count is the number of collected test cases (skipped tests included); a "file"
is one collected test module.

| Structure | Source pattern | Count |
|---|---|---|
| Architecture docs | `docs/architecture/**/*.md` | 104 |
| Regulatory docs | `docs/architecture/regulatory/*.md` | 20 |
| ADR decision records | `docs/architecture/adr/ADR-[0-9][0-9][0-9]-*.md` (excludes `ADR-INDEX.md`) | 31 |
| Workspace apps | `apps/*` | 3 — `apps/api`, `apps/audit-sealer`, `apps/ui` |
| Workspace packages | `packages/*` | 13 |
| Other workspace members | literal entries in `pnpm-workspace.yaml` | `scripts`, `tests` |
| API route files | `apps/api/src/routes/*.ts` | 19 |
| DB migrations | `apps/api/src/db/migrations/*.sql` | 29 |

| Test category | Execution | Files | Tests |
|---|---|---|---|
| Root unit | `pnpm test` (no `GOVAI_INTEGRATION`) | 137 | 1549 |
| Root integration-only | the identities `GOVAI_INTEGRATION=1` adds (proved set difference, all under `tests/integration/`) | 77 | 1122 |
| Root full integration gate | `pnpm test:integration` (unit + integration; the CI `integration` job) | 214 | 2671 |
| UI (`@govai/ui`) | `pnpm --filter @govai/ui test` (own jsdom config; excluded from the root config) | 33 | 753 |
| Live-gated | `pnpm test:live` (never in CI) | 5 | files only — see manifest `reason` |

Acceptance harnesses (NOT vitest suites): `tests/acceptance/ai-console` —
operator-driven harnesses, not vitest suites; excluded from every vitest config.
<!-- END GENERATED SOURCE MANIFEST -->

Durable qualitative notes the generator does not derive (kept prose, count-free):

- Regulatory docs: the 18–25 series is present; no 26–30 files exist.
- ADR decision records: ADR-015 is reserved/cancelled; the generated `adr/ADR-INDEX.md` is not a decision record and is excluded from the count (status per file: [adr/ADR-INDEX.md](./adr/ADR-INDEX.md)).
- DB migrations: the numbered sequence has one historical gap (**no** 0006).
- API route files include the `_not-implemented.ts` helper alongside the registered routes.
- The default `pnpm test` is **unit-only** since the PR #116 `GOVAI_INTEGRATION` config gate; `pnpm test:integration` is the full gate (unit + integration) that the CI `integration` job runs. Live-gated tests never run in CI.
- **U1.5 history, stated precisely:** the initial AI Console implementation was UI-first, but the final merged PR #137 tree is **not** UI-only — `EP-UIUX-V1-U1.5-AI-CONSOLE-CLOSEOUT-02` carried two owner-adjudicated backend fixes in `packages/provider-*` and the review rounds added root test suites for them (the wire-level `*.inbound-hop-headers.test.ts` pair, `extract-text` and DLP-equivalence coverage). The earlier claim "U1.5 adds no root test file: it is UI-only" was true only of the pre-closeout intermediate head and is corrected by this manifest.
- The acceptance harness `tests/acceptance/ai-console/**` is operator-driven (real Postgres + real Fastify + real credential/KMS stack, provider-protocol loopback via `pnpm acceptance:ai-console` or the REAL providers via `pnpm acceptance:ai-console:live`); it is not a vitest suite and appears in the manifest as a harness path only.

---

## 1. Runtime surfaces

All surfaces registered in `apps/api/src/server.ts:163-184` (the direct-route identity hook registers at `:178`; the P0.3-A dispatch-recovery worker starts at `:194`; the M2A `isMainModule` entry guard is at `:257`). Line anchors re-derived **in this tree**: EP-B2 registers `routes/me.ts` at `:165`, which shifts every later register — and the two boot anchors above — by one and by two respectively. The Foundation V1 runtime anchor for provider/evidence behaviour is unchanged (`de80664a`); this is a read-only additive surface. Status reflects **runtime execution**; audit-evidence capture is a separate axis (§3).

| Surface | Status | Route/entrypoint | Handler/service | Tests | Limitations | Next step |
|---|---|---|---|---|---|---|
| Health | IMPLEMENTED_RUNTIME_SOURCE_VERIFIED_TESTS_NOT_LOCATED | `routes/health.ts` (`server.ts:163`) | inline | dedicated route test not located in this review | liveness/readiness | — |
| Capabilities | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/capabilities.ts` (`:164`) | `@govai/core-governance` | `tests/integration/capabilities-by-org.test.ts` | per-org view; default-deny | — |
| Authenticated principal (`/v1/me`) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED (EP-UIUX-V1-B2) | `routes/me.ts` (`:165`) | projection of `pipeline/auth.ts` `AuthIdentity` — no new query, no new state, no transaction, no tenant context | `tests/integration/me-route.test.ts` (17), `apps/api/src/pipeline/auth.test.ts` (10) | read-only; returns exactly `principal_type` (literal `api_key`), `org_id`, `user_id`, `roles`, `tier`, `operational_mode`; NEVER the raw key, the argon2 hash, `api_key_prefix` or any provider credential; 401 discloses nothing about org existence, roles, tier, mode or provider configuration; `principal_type` exists so a controlled-pilot org credential is never presented as a production human login (residual **R14** — human auth/session/API-key lifecycle still absent) | — |
| `/v1/runs` | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/runs.ts` (`:166`) | `pipeline/run-orchestrator.ts` + the P0.3-A durable dispatch layer (`run-dispatch-config.ts`, `run-dispatch-state.ts`, `run-dispatch-recovery.ts`) + the P0.3-C execution-idempotency layer (`pipeline/run-idempotency.ts`) | `tests/integration/governed-run-e2e.test.ts`, `runs-passthrough-mode.test.ts`, the `run-dispatch-*.test.ts` suites, `runs-status-endpoint.test.ts`, `run-idempotency.test.ts` (P0.3-C) | governed+passthrough; run-lifecycle chain evidence via the durable dispatch layer (§3); tenant-isolated status polling `GET /v1/runs/:run_id` (`routes/runs.ts:224`); optional `X-GovAI-Run-Idempotency-Key` — tenant-scoped execution-idempotency binding with canonical semantic-intent correspondence: a matching replay returns the current durable run (200 + `X-GovAI-Run-Idempotent-Replay`), a divergent same-key intent is 409 `idempotency_key_conflict` (distinct from the AuditBridge `X-GovAI-Idempotency-Key`, which stays direct-route evidence identity) | — |
| Audit events | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/audit-events.ts` (`:167`) | reads HMAC chain | `audit-events-rls.test.ts`, `audit-events-pagination.test.ts` | read-only | — |
| Admin audit crypto-shred | PLANNED | `routes/admin-audit-shred.ts:41` (`sendNotImplemented … 'PR3'`) | stub | n/a | not-implemented stub; `crypto_shredded` state + ADR-011 exist in schema | implement later |
| Admin DLP detector CRUD | PLANNED | `routes/admin-dlp.ts:40` (`sendNotImplemented … 'PR3'`) | stub | n/a | admin CRUD stub; DLP pre-scan itself runs in governed surfaces | implement later |
| Passthrough Anthropic (Native/Audited) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED + IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE + LIVE_ACCEPTED (M2/M2A, executed scope) | `routes/passthrough-anthropic.ts` (`:171`) | `@govai/provider-anthropic` | `tests/integration/anthropic-passthrough.test.ts` (+ F1-T*/F5-T*), raw-body, content-encoding, native-contract, registry-invariant, query-fidelity, request-id suites | audit emission: logger + AuditBridge → B1 capture outbox (PR-B, §3); Foundation V1 native contract (§2): auth → 404 → 405 → computer-use floor → `hard_denied` beta floor → credential (502) → forward; unknown betas / non-computer tools forwarded + observed; raw query preserved; `request-id` captured; Content-Encoding truth; scoped 502 `provider_credential_unresolvable` | — |
| Passthrough OpenAI (Native/Audited) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED + IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE + LIVE_ACCEPTED (M2/M2A, executed scope) | `routes/passthrough-openai.ts` (`:172`) | `@govai/provider-openai` | `tests/integration/openai-passthrough.test.ts` (+ F1-T6/F5-T*), raw-body, content-encoding, native-contract, registry-invariant, query-fidelity suites | audit emission: logger + AuditBridge → B1 capture outbox (PR-B, §3); Foundation V1 native contract as for Anthropic (§2); the retired GovAI-local Files `purpose=assistants` date policy (local deny/warning) was removed by EP-11 (PR #126) — Files requests follow the normal provider-forwarding/result-evidence path (a narrow claim; not a broader OpenAI compatibility guarantee); OpenAI historical beta entries (`assistants=v2`, `realtime=v1`) are `denied_until_decision` → forwarded + observed (`openai-beta-policy@2026-08-16`) | — |
| Governed Anthropic | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED + LIVE_ACCEPTED (M2, executed scope) | `routes/governed-anthropic.ts` (`:173`) | `@govai/provider-anthropic/governed` | `tests/integration/governed-anthropic.test.ts` (+ F1-T4), `register-governed.m1-contract.test.ts` | direct governed-native audit emission: `app.log.info` + AuditBridge → B1 capture outbox (PR-B, §3); M1: original bytes held (no re-serialization), top-level-only stream detection, non-computer tools reach the matrix, only `blocked` blocks, recommendation vs applied honest over HTTP (`x-govai-enforcement-decision` / `x-govai-enforcement-applied`, 403 `block_trigger`), truthful streaming pre-provider block | — |
| Governed OpenAI | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED + LIVE_ACCEPTED (M2, executed scope) | `routes/governed-openai.ts` (`:174`) | `@govai/provider-openai/governed` | `tests/integration/governed-openai.test.ts`, `register-governed.m1-contract.test.ts` | as Governed Anthropic (M1 honesty contract); under OD-1=A the OpenAI Chat Completions governed path has no reachable pre-provider block (documented, not a defect) | — |
| Admin provider credentials | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | `routes/admin-provider-credentials.ts` (`:179`) | KMS envelope; `auditAppend` (`:165,289`) | `admin-provider-credentials-*.test.ts` (6 files) | SET/GET/REVOKE; no rotation policy | — |
| Workrooms (Phase 1) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workrooms.ts` (`:180`) | inline; migration 0012 | `tests/integration/workroom-participants.test.ts` (+ ~20 workroom tests) | partial runtime (Phase 1) | — |
| Workroom transcript (Phase 2) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workroom-transcript.ts` (`:181`) | migration 0013 | `workroom-messages.test.ts`, `workroom-audit-subview.test.ts` | partial runtime (Phase 2) | — |
| Workroom runs (Phase 3) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workroom-runs.ts` (`:182`) | `run-orchestrator.ts` `WorkroomRunContext`; migration 0014 | `workroom-runs.test.ts`, `workroom-runs-mode.test.ts`, `workroom-run-idempotency.test.ts` (P0.3-C) | partial runtime (Phase 3); P0.3-C covers `POST /v1/workrooms/:id/runs` — current membership authorization stays mandatory (key knowledge is never an authorization capability), a matching replay does not consume the approval twice, approval provenance participates in the semantic-intent correspondence, and an in-progress replay does not fabricate a `run_event` turn | — |
| Workroom approvals (Phase 4) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workroom-approvals.ts` (`:183`) | migration 0015 | `workroom-approvals.test.ts`, `workroom-approvals-runs.test.ts` | partial runtime (Phase 4); SoD/TOCTOU | — |
| Regulatory | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | `routes/regulatory.ts` (`:184`) | `regulatory/service.ts`; migrations 0016–0024 | `regulatory-*.test.ts` (11 files) | **evidence only, not runtime enforcement** (§4/§5) | — |
| Evidence read API (`/v1/evidence`) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED (EP-008D) | `routes/evidence.ts` (`:168`) | `pipeline/evidence-reports.ts` (EC summary + gap lists) | `tests/integration/evidence-reports.test.ts`, `evidence-cockpit.test.ts` | read-only, RLS-scoped (the auditor IS the tenant — per-org view, no cross-tenant operator role); `/gaps` enum `ec1\|ec2\|ec3seal\|ec3drop\|ec4`; EC-5 deferred | real EC-5 (separate Option-A EP) |

Workroom Phases 5 (tool invocations), 6 (UI), 7 (external autonomous agents) are `DOCUMENTED_TARGET_ONLY`. Workroom is **not complete**.

### Interface layer (`apps/ui`) — UI/UX V1, milestones U1 + U1.5 (+ EP-B2 identity)

| Item | Status | Evidence / note |
|---|---|---|
| `apps/ui` — static React+TS+Vite SPA, no BFF, no SSR | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED (EP-UIUX-V1-U1) | consumes the Fastify API directly on the same origin (`base: '/app/'`); `apps/ui/README.md`; test files/counts: see the generated §*Source manifests* (`pnpm --filter @govai/ui test`); CI `ui` job (typecheck, lint, test, build, bundle secret scan) |
| U1 surfaces | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `/enter`, `/` (cockpit), `/evidence/gaps/:invariant` (`ec1\|ec2\|ec3seal\|ec3drop\|ec4`), `/audit-events`, `/capabilities` — read-only over the surfaces already listed above. U1 itself was **zero backend change**; EP-B2 is the one backend addition of this lane so far (`GET /v1/me`, read-only, additive, no migration) and adds **no UI route** — the `/enter` probe simply becomes `GET /v1/me` |
| **U1.5 — AI Console (`/ai`)** | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED (EP-UIUX-V1-U1.5) — **no new route, no migration, no event schema** (the final merged tree is not backend-untouched: the two CLOSEOUT-02 provider fixes are backend changes — see the findings row) | a provider-native conversational surface over the SIX already-registered direct routes: `POST /{passthrough\|governed}/openai/v1/responses`, `.../openai/v1/chat/completions`, `.../anthropic/v1/messages`. Streaming via `fetch` + `ReadableStream` + `eventsource-parser`; each adapter builds the PROVIDER's own body and reads the PROVIDER's own events — there is **no normalized GovAI chat schema and no new GovAI chat route**. Model discovery reads the providers' own `GET /v1/models` through the audited native route; the console ships **no hardcoded model id** and sends a typed id verbatim |
| U1.5 conversation state | `MEMORY_ONLY_BY_CONSTRUCTION` | the transcript is `useReducer` state inside the `/ai` route component; the feature performs **no** storage write at all, so a reload, a route change or sign-out destroys it. Verified in a real browser: after a full session only `govai.ui.locale` is in localStorage, sessionStorage is empty, the URL carries nothing and no IndexedDB database exists |
| U1.5 provider-POST retry policy | `NO_AUTOMATIC_RETRY` | a conversation POST is issued **exactly once** — not retried on 429, 5xx, network fault or stream fault, because the provider may have executed and billed a request whose result the browser never saw. The bounded 429 retry stays GET-only (model discovery). Pinned by unit tests and observed in the browser network log across the whole acceptance |
| U1.5 Interaction Receipt | IMPLEMENTED_WITH_HONEST_LIMITS | carries only what the browser can prove: values it sent, statuses it received, headers it read, a clock it ran. **Recommendation and Applied are two separate rows** (`ask`+`forwarded` means nobody was asked); the Native/Audited surface returns no per-request governance and the receipt says exactly that rather than printing what the internals record. It contains **no audit event id, no "evidence captured" and no provider/backend latency** — no response on these six routes exposes any of them — and states plainly that exact turn↔audit correlation is not available (follow-up **EP-AI-CONSOLE-TURN-EVIDENCE-CORRELATION**) |
| U1.5 non-goals (deliberate) | `NOT_IMPLEMENTED` | provider tools, function calling, web search, file search, uploads, images, vision, audio, MCP, computer use, code execution, artifacts, RAG, agent loops, a system-prompt field, persistent chat history, and any Workroom responsibility. The providers support several of these; exposing them introduces governance surfaces this delivery was not scoped to open |
| U1.5 findings (backend) | `FIXED` | **`AI-CONSOLE-ORIGIN-RELAY-01`** — the direct routes forwarded the browser's `Origin` header upstream (`origin` was in neither `HOP_BY_HOP` nor `STRIP_INBOUND_AUTH` in either provider package), and Anthropic answers `401 authentication_error: "CORS requests must set 'anthropic-dangerous-direct-browser-access' header"`. No UI fix exists (a page cannot remove its own `Origin`) and the console must not assert that beta header, which would claim a direct browser access that is not happening. **Fixed on the server→provider hop**: `packages/provider-{openai,anthropic}/src/outbound-header-policy.ts` owns `STRIP_INBOUND_BROWSER_HOP` per package, applied by every outbound header builder (Native/Audited route, governed handler, both OpenAI governed surfaces, streaming and non-streaming) and by the legacy exported `rewritePassthroughHeaders`. Deliberately not a browser-header purge — `user-agent`, `referer` and the `sec-*` families still forward. **`AI-CONSOLE-RESPONSES-DLP-GAP-01`** — `extractOpenAIResponsesText` descended only into `input[]` items carrying an explicit `type`, so role-shaped items were never DLP-scanned. **Fixed**: the role-shaped `EasyInputMessage` and string `content` are recognized, `output_text` parts included, coverage only — no risk matrix, decision table, enforcement semantics, event schema or AuditBridge posture changed. Both wire-proven by test; the Origin fix live-reaccepted against real Anthropic. Residual `PROVIDER-INBOUND-HOP-HEADER-RESIDUAL-01` (`referer` / `cookie`) OPEN. See [stale-docs-register.md](./stale-docs-register.md) |
| Honesty vocabulary (`src/lib/honesty.ts`, `src/lib/vocab.ts`) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | table-driven and tested BEFORE any screen consumes it: EC-6 `pending` never renders as verified; EC-3.drop `observed:false` never renders as "no loss"; a `coverage_ratio` of 1.0 over an empty population renders as out-of-scope, not as full coverage; "blocked" appears if and only if a request returned 403 |
| Internationalisation | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | pt-BR (default + fallback), en-US, es; catalogs typed `Record<MessageKey, string>` (a missing key is a compile error) plus runtime parity tests and a test that no translation turns a forwarded decision into a blocked/applied/protected one |
| Session model | `DEVELOPMENT_CONTROLLED_PILOT_FOUNDATION` — **NOT production human auth** | the org API key is validated by a real authenticated read and held in ONE in-memory variable; never in localStorage/sessionStorage/IndexedDB/cookie/URL/router state/query key/log/DOM; a tab reload ends the session; sign-out also clears the query cache **and the principal**. EP-B2 changed only WHICH read validates it — `GET /v1/me` instead of an evidence aggregate — so sign-in now also learns the identity; the identity is React state for rendering and never an authority (every route re-derives it server-side per request). Residual **R14** (human auth/session/API-key lifecycle) is unchanged |
| UI shell identity display | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED (EP-UIUX-V1-B2) — read-only, and only what a response carries | the header shows the server-supplied **operational mode**, the **principal type** and the key's **roles** (a chip only when the key actually has any); the **account/details** affordance in the footer adds user id and **tier**, explicitly qualified as commercial/account context and carrying the note that a plan is not a security level, governance profile, policy strictness or enforcement mode (residual **R13** — tier is deliberately absent from the header cluster for exactly that reason). Values render verbatim in monospace; `principal_type` is the one value resolved through `vocab.ts`, so an unrecognised principal degrades to an explicit unknown rather than inheriting API-key copy. No admin, role-editing, org-switching or user-management control exists. `tests/identity.test.tsx` (24) |
| Not in U1 | `NOT_STARTED` | no workroom, regulatory, admin, run-playground, governance-settings or user-management route — not even a disabled navigation item. EP-B2 adds no route and no navigation item |

Explicit non-claims of this layer: it does not represent `ask` as a human having been asked, `sandbox_required` as a sandbox having been created, or any recommendation as an applied block (Phase 5 primitives do not exist — residual R12); it does not present the regulatory record as runtime enforcement; it does not render EC-6 `pending` as verified; it does not present metadata/hash evidence as plaintext content; and it makes no certification or compliance claim (`claims-policy.md`).

---

## 2. Provider-native layer

`IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE`, proven by the H1 v2 harness/coverage map (versioned; PRs #81/#82/#83/#84/#86/#87), extended by the Foundation V1 M1/M2A suites, and — separately — LIVE-ACCEPTED in the executed M2/M2A scope (real Anthropic + OpenAI, official SDKs, Claude Code, Codex CLI; see [foundation-v1-freeze.md](./foundation-v1-freeze.md) §4). Hermetic coverage and live acceptance are kept distinct in [specs/h1v2-coverage-map.md](./specs/h1v2-coverage-map.md) (regenerated at `de80664a`). This is **byte/parity + contract evidence**, not evidence-plane dispatch (see §3). Doctrine: ADR-021 (Accepted); no universal provider/endpoint parity is claimed — the proven scope is exactly the registered capabilities and executed lanes.

| Capability | Status | Evidence | Remaining follow-ups |
|---|---|---|---|
| OpenAI raw-body preservation | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | RB-OAI[byte-for-byte] | — |
| Anthropic raw-body preservation | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | RB-ANT[byte-for-byte] | — |
| `native_request_hash` over original bytes | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | RB-OAI/RB-ANT hash | — |
| `body_forward_mode:"raw"` | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | byte equality | — |
| Valid-tools pass-through | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | PR #87 RB-OAI/RB-ANT[valid-tools] | — |
| Non-computer tools forwarded (typed_unknown, custom, hosted non-computer) — M1 | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | RB-*[typed-unknown-forward]; native-contract `TOOLS`; governed m1-contract `FB-2` | dedicated enums for new provider tool types (deferred; taxonomy v3) |
| Provider-hosted computer-use hard floor (only validation block; 403 + durable blocked v4; streaming block truthful) — M1 | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | RB-*[tools-block]; native-contract `DENY-02/03`; governed `§11.4` | — |
| Unknown / unresolved beta tokens forwarded byte-intact + hashed marker evidence; only `hard_denied` fails closed (403 + durable blocked v4) — M1 | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | native-contract `BETA-01..08`, `DENY-01` (both providers) | typed unknown-beta provenance (residual R3); beta snapshot freshness (R6) |
| Unknown/future fields preserved | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | RB[byte-for-byte] + [valid-tools] | — |
| Response hop-by-hop filter | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | PR #86 RH-OAI/RH-ANT + RB[hop-by-hop] | downstream keep-alive/transfer-encoding/content-length is runtime-owned (non-blocking) |
| Malformed JSON forwarded | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | RB[malformed]; governed m1-contract | — |
| Streaming detection (top-level only) | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | RB[nested-stream]; governed `H-2` | — |
| gzip / `Content-Encoding` transport truth (identity upstream; decoded-only drop of stale `content-encoding`/`content-length` + representation validators; unknown coding relayed raw) — M1 FB-3 | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | `register-passthrough.content-encoding.test.ts` ×2 (real TCP), `transport-encoding.test.ts` ×2; live FB-3 header truth (M2) | — (was PLANNED at `f381d3fa`) |
| Gate order auth → path 404 → method 405 (+`Allow`) → floors → credential 502 → forward; auth before registry disclosure — M1 | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | native-contract `ROUTE-01..03b`; registry-invariant `ROUTE-04`; `provider-credentials.pool-acquire.test.ts` | — |
| Raw query preserved on both passthroughs (routing pathname-only) — M2A F5 | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | `register-passthrough.query-fidelity.test.ts` ×2 (real socket); integration F5-T*; live M2A | query not first-class in sealed v4 (residual R1) |
| Anthropic `request-id` captured in evidence (provider-aware dispatcher) — M2A F1 | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | `request-id.test.ts`, `provider-invoke.test.ts`, integration F1-T1..T6; live M2A 3/3 | — |
| Anthropic multipart route-level | PLANNED | spec §9/§15 | non-blocking (R10) |
| `stream_final_hash` hash-over-bytes | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | content-encoding `ENC-03/10` (`stream_final_hash === sha256(<emitted bytes>)`); stream-terminal `(1)`; EP-008C `stream_outcome` | — (was presence-only) |
| Executable entrypoints from any checkout path (`isMainModule`) — M2A F2 | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `apps/api/src/main-module.test.ts`; real spaced-path `run migrate` / `run dev` (M2A) | — |

## 3. Audit and Evidence Plane

| Item | Status | Evidence |
|---|---|---|
| Audit chain baseline (HMAC, append-only) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `packages/core-audit/src/append.ts`; migration 0001; `audit-events-*.test.ts`; ADR-009 |
| Crypto-shred / right-to-erasure | IMPLEMENTED_FOUNDATIONAL_CONTROL (state+ADR) / PLANNED (admin route) | ADR-011; `crypto_shredded` state in migration 0001; admin route is a stub (`admin-audit-shred.ts:41`) |
| B0 — capture outbox foundation | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0025; `tests/integration/audit-capture-outbox-foundation.test.ts` |
| B1 — `captureAuditEvent` adapter | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | `packages/core-audit/src/capture.ts`; `audit-capture-bridge.test.ts` (titled "B1 integration tests for the captureAuditEvent adapter"), `capture.test.ts` — **tested as a primitive; see §3 wiring** |
| B2 — sealer **library** | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | `packages/core-audit/src/sealer.ts`; `audit-sealer-core.test.ts`, `sealer.test.ts` — one-shot primitives, no loop/process/`SET ROLE` |
| B3 — sealer **runner** | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED (EP-006) | `apps/audit-sealer` — a dedicated deploy unit consuming `@govai/core-audit` verbatim: Shape-S per-seal tx (claim→append→mark_sealed via `withSealerPhaseRole`), the SEPARATE stale-recovery path (`loadSealingCaptureForRecovery` → idempotent re-append + mark_sealed; recoverable rows ADVANCED never failed; terminal stall surfaced via `terminal_failure` metric, not silently retried), startup readiness probe, bounded claim loop, OTel metrics. Integration-tested S0–S11 (`tests/integration/audit-sealer-runner.test.ts`) incl. the §8.3 no-duplicate byte-identical recovery proof. ADR-022–026 Accepted; ADR-023 Option A(b) impl/tested PR #92; Phase 2.5 wired PR-B #98. B3 authorized + implemented (EP-006); see `specs/audit-sealer-b3-technical-plan.md` |
| Append/seal idempotency | capture: SOLVED; mark_sealed same-event: PARTIAL; **append→mark_sealed partial-failure: Option A(b) IMPLEMENTED/TESTED (PR #92)** | ADR-023 Option A(b) implemented/tested in PR #92 — deterministic `audit_event_id` = UUIDv5(org_id+capture_id) in `packages/core-audit/` (`auditAppend(eventId?)` lookup-after-lock + correspondence/payload-presence guards); `audit_events.id` is PK so no migration was needed. These former B3 preconditions are now satisfied — Phase 2.5/AuditBridge wiring (PR-B / EP-004) and the B3 runner (EP-006) are implemented and tested; ADR-028 accepted/merged |
| Stale-sealing recovery | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED (EP-006) | ADR-023; implemented as the SEPARATE stale-recovery path in `apps/audit-sealer/src/stale-recovery.ts` (reconstructs via the EP-005.5 `loadSealingCaptureForRecovery`, idempotent re-append + mark_sealed; recoverable rows advanced, unrecoverable/divergent rows terminal-failed + alerted). Tested S3/S5/S6 |
| Evidence completeness (counts, provider-without-audit) | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED (EP-008A/B/C) | EP-008A migration `0027` ships three read-only `security_invoker` evidence views — `govai.evidence_capture_completeness` (EC-1.a), `govai.evidence_chain_backlog` (EC-1.b), `govai.evidence_provider_without_audit` (EC-3a); EP-008B adds the best-effort EC-3b drop/capture OTel counters (`govai_audit_bridge_drops_total` / `govai_audit_bridge_captures_total`, cardinality-safe, observe-only) in `apps/api/src/pipeline/audit-bridge-metrics.ts`; EP-008C adds stream-terminal completeness (the terminal `PassthroughInvoked` fires on every stream termination via `@govai/provider-stream-http`, with `stream_outcome` in the envelope + the capture projection); the OTel MeterProvider exporting the counters is the shared `@govai/observability` bootstrap (EP-OBS-REFACTOR). The reporting/metrics layer EXISTS, and the read surface shipped after this row was first written: EP-008D (PR #113, main `8eb1eab`) added the EC reports (`pipeline/evidence-reports.ts`), the RLS-scoped `/v1/evidence` read API (`routes/evidence.ts` — the auditor IS the tenant; per-org accumulation, no cross-tenant operator role) and EC-4 run-lifecycle coverage; EP-OBS-COLLECTOR (PR #114, `d2fef204`) added the OTLP collector/Prometheus/Grafana stack; EP-EVIDENCE-GAUGE-WIRING (PR #115, `2f620b47`, migration `0028`) wired the `govai_evidence_*` gauges into `apps/api` boot behind the least-privilege `govai_evidence_enumerator` role (INV-1: no single DB identity holds enumerate+read). Real EC-5 remains deferred to a separate Option-A EP. Tests: `tests/integration/evidence-completeness.test.ts` (EP-008A views + tenant isolation + security_invoker catalog guard); the `@govai/provider-stream-http` helper unit tests (`packages/provider-stream-http/src/index.test.ts`) + the four per-surface stream-terminal e2e (`packages/provider-{anthropic,openai}/src/{routes,governed}/register-*.stream-terminal.test.ts`) (EP-008C); the EC-3b counter coverage in `apps/api/src/pipeline/audit-bridge-metrics.test.ts` (EP-008B) |

### Runtime-to-evidence wiring (WIRED — PR-B / EP-004, source + integration verified)

This was the loose thread between runtime and the evidence plane; **PR-B (EP-004) wires it.** **Source-verified on the EP-004 branch (base main `d2c2785`); integration-tested against real Postgres:**

1. **Direct governed-native and passthrough routes now dispatch into the B0/B1 capture outbox.** Each route's `emitAuditEvent` closure keeps its existing `app.log.info(...)` line AND appends `await auditBridge(event, requestIdentityAls.getStore())`, where `auditBridge = makeAuditBridge({ pool: app.govai.pool, log: app.log })` — in all four of `routes/governed-openai.ts`, `routes/governed-anthropic.ts`, `routes/passthrough-openai.ts`, `routes/passthrough-anthropic.ts`.
2. **An ingress identity hook** (`pipeline/request-identity-hook.ts`, registered once in `server.ts` via `registerRequestIdentityHook(app)`) builds the per-request `AuditBridgeRequestIdentity` for the four direct-route prefixes (reading `X-GovAI-Idempotency-Key`), runs the remainder of the request lifecycle inside a request-owned `requestIdentityAls.run()` scope so the dispatcher reads the SAME identity (the F4 preventive hardening, PR #120 — see §8), echoes `X-GovAI-Request-Id` (the echo does not reach direct streaming responses — a pre-existing, separately-tracked gap; §8), and returns HTTP 400 `invalid_idempotency_key` on a malformed key. The passthrough producers take an injectable clock (`now?`) so an idempotent replay can hold `occurred_at` stable.
3. **`captureAuditEvent` now has runtime call-sites** (via `makeAuditBridge` → `pipeline/audit-bridge.ts`). The AuditBridge validates/narrows `event: unknown` via `PassthroughInvokedSchema` (v4) before mapping to `captureAuditEvent` → outbox; it is best_effort (never fails the request path).
4. **Integration-tested end-to-end:** `tests/integration/audit-bridge-wiring.test.ts` (one capture row per route; rev4 `redaction_metadata.audit_bridge` shape; RLS isolation; no banned keys/raw content; byte-fidelity non-regression; best_effort on capture failure; ingress 400 + `X-GovAI-Request-Id`) and `tests/integration/audit-bridge-idempotency.test.ts` (the same-key replay REUSE proof I3 — one row, stable `capture_seq`, no conflict — and the divergent-`occurred_at` CONFLICT proof I4 — 23505 → error log → request still 2xx → no second row).
5. **B3 seals captures already in the outbox.** With the four direct routes now feeding the outbox (PR-B #98) and the B3 runner implemented (EP-006, `apps/audit-sealer`), the runtime → capture → seal arc is closed: direct-route runtime events are captured to the outbox and the dedicated sealer advances them into the HMAC chain.

Separately documented (not the same path):
- **`/v1/runs` run-lifecycle chain writes flow through the P0.3-A durable dispatch layer** (`pipeline/run-dispatch-state.ts` — `auditAppend` call sites at `:149`, `:178`, `:350` — for the dispatch lifecycle events `run.dispatch_prepared`/`run.dispatch_claimed`/`run.outcome_unknown`/`run.outcome_reconciled`, the terminal `run.completed`/`run.failed`/`run.denied`, and the governed `passthrough.invoked` v4 capture). The orchestrator retains one direct `auditAppend` at `run-orchestrator.ts:1132` (the in-transaction governed `run.denied` path). This is the HMAC append chain, **not** the capture outbox.
- **Regulatory** (`regulatory/service.ts:249`) and **admin provider credentials** (`admin-provider-credentials.ts:165,289`) also write via `auditAppend` directly.

### Durable provider dispatch (P0.3-A / F3 — PR #123, squash `165291d9`)

F3 (DEMONSTRATED: provider network I/O inside database transactions / checked-out clients) is **CORRECTED** at this anchor. The merged design:

- **Dispatch boundary:** the run is prepared and committed in TX-A (`run.dispatch_prepared` — run row + real `native_request_hash` durable **before** any provider I/O), exactly one executor wins the `queued→running` CAS (`run.dispatch_claimed`), the provider forward happens **outside** any database transaction and outside checked-out clients, and the outcome is finalized in a separate transaction (`pipeline/run-dispatch-config.ts`, `run-dispatch-state.ts`, `run-orchestrator.ts`).
- **Honest unknown semantics:** when the system cannot prove whether the provider received the request, the run terminates as `run.outcome_unknown` (closed `ForwardObservation` semantics, `packages/core-events/src/run-dispatch-lifecycle.ts`) — **never retried, never classified as failed**. A later reconciliation to a known **HTTP provider result** (with a persisted invocation) appends `run.outcome_reconciled` idempotently — the only reconciliation marker the state machine emits (`run-dispatch-state.ts:955-957`). There is **no exactly-once claim**.
- **Bounded recovery:** a periodic worker (`pipeline/run-dispatch-recovery.ts`, started in `server.ts:193`) recovers stale claims within explicit bounds, deciding the branch atomically on the durable boundary (`run-dispatch-state.ts:1191-1247`): boundary **absent** → the mandatory durable gate never committed, so provider invocation was structurally impossible → KNOWN `run.failed` with `dispatch_never_started` (never an unknown); boundary **present** → the gate was crossed but nothing past it is provable → honest `run.outcome_unknown` (`stale_dispatch_claim`, `forward_observation='not_observed'`). Every `run.outcome_unknown` is therefore post-boundary by construction; recovery never calls a provider and never generates a token.
- **Forensic lifecycle evidence:** the lifecycle/status transitions (`run.dispatch_prepared`/`run.dispatch_claimed`, the terminals, `run.outcome_unknown`/`run.outcome_reconciled`) append chain events with deterministic payload hashes; the bound lifecycle chronology rides the database clock so it can never contradict the transition order. The durable boundary commit itself is the deliberate exception: `commitDispatchBoundary()` (`run-dispatch-state.ts:481-505`) only records `dispatch_boundary_committed_at` (a `clock_timestamp()` CAS) and appends **no chain event of its own** — its timestamp is deferred-bound into the later evidence: `run.outcome_unknown` requires it by schema, and the `run.completed`/`run.failed` terminals (including `dispatch_pre_forward_failed`) bind it into both the payload hash and the safe metadata whenever the boundary was crossed. A governed block is decided **pre-forward and therefore pre-boundary** — the handler returns `blocked` at tool/enforcement validation before any `forwardRaw` call, and `beforeDispatch` commits the boundary inside `forwardRaw` immediately before `fetch` (`handle-responses.ts:265-303`, `packages/provider-*/src/passthrough/forward.ts:97-104`, `run-orchestrator.ts:1415` governed / `:2004` passthrough) — so a blocked run has no committed boundary to bind, and its `run.denied` (`run-dispatch-state.ts:1059-1071`) hashing only `governed_blocked:${reason}` is consistent with that, **not** an evidence gap.
- **Tenant-isolated status polling:** `GET /v1/runs/:run_id` (`routes/runs.ts:224`), RLS-scoped.
- **Migration `0029_durable_provider_dispatch.sql`** adds the durable dispatch schema and the hardened M-B guard. **RLS process description (canonical):** `RLS_FORCE_SUSPENSION_USED=YES`, `RLS_DEFINER_FUNCTION_USED=NO` for the M-B decision count, `RLS_VISIBILITY_MECHANISM=OWNER_FORCE_SUSPENSION` (owner `NO FORCE ROW LEVEL SECURITY` window, `0029:110-115`), `RLS_ROW_SECURITY_OFF_ROLE=FAIL_CLOSED_ASSERTION` (`row_security=off` is armed so that any policy interference fails loudly, not to bypass). Stated precisely: the M-B decision count does **not** use a `SECURITY DEFINER` function; `SECURITY DEFINER` **remains in use elsewhere in 0029** — the recovery-discovery candidates primitive (`0029:460,497`).
- **Scope guard:** the shared provider handlers gained optional, orchestrator-only dispatch hooks (`beforeDispatch`/`dispatchSignal`/`monotonicDeadlineMs`/`onDispatchStart`/`preResolvedCredentialSource`); the direct governed/passthrough routes do not supply them, and their behavior and AuditBridge → outbox path are unchanged; `/v1/runs` stays chain-authoritative. Tests: `tests/integration/run-dispatch-{boundary,durability,unknown,recovery,approval-locks,migration-0029}.test.ts`, `runs-status-endpoint.test.ts`, plus the unit suites `run-dispatch-config.test.ts`, `run-dispatch-lifecycle.test.ts`, `dlp-dispatch-contract.test.ts`, `governed-v4-capture.test.ts`.

### Cross-request execution idempotency (P0.3-C — PR #129, squash `f381d3fa`)

P0.3-C adds the keyed-intent layer on top of F3 for both run-creation surfaces (`POST /v1/runs`, `POST /v1/workrooms/:id/runs`), composing with — never replacing — the F3 guarantees (`AT_MOST_ONE_LOCAL_FORWARD_INVOCATION_PER_RUN_ID`, honest `run.outcome_unknown`, recovery that never redispatches, late known-result reconciliation):

- **Identity:** optional `X-GovAI-Run-Idempotency-Key` header (distinct from the AuditBridge `X-GovAI-Idempotency-Key`); only the SHA-256 of the normalized key is ever persisted — the raw key is never stored, logged or forwarded upstream. Binding table `govai.run_idempotency` (migration `0030`): immutable, tenant-scoped (RLS ENABLE+FORCE), app-role grants SELECT+INSERT only; the composite PK `(org_id, idempotency_key_hash)` is the single PostgreSQL concurrency arbiter (`INSERT … ON CONFLICT DO NOTHING` reservation inside TX-A, before any duplicate-sensitive durable work).
- **Correspondence:** the canonical `govai.run_execution_intent.v1` semantic projection (actor, route scope, workspace, capability, model, input, resolved mode, metadata; the Workroom variant adds participant, workroom, task, governance mode and `effective_approval_request_id`), SHA-256 over a frozen canonical JSON. `provider_invocations.native_request_hash` is explicitly NOT the idempotency identity (it cannot encode the full logical intent — test-proven via metadata divergence and DLP-redaction convergence).
- **Semantics:** same tenant + same key + same canonical intent ⇒ ONE durable logical run — a matching replay returns the current durable state (200 + `X-GovAI-Run-Idempotent-Replay: true` + `Location`), with no second policy/DLP persistence, no approval consumption, no dispatch claim and **no intentional second local provider execution**. Divergent same-key intent ⇒ 409 `idempotency_key_conflict` (static body). No header ⇒ prior behavior unchanged (no auto-generated dedupe key). Workroom: a keyed approval is validated ONLY inside TX-A after the reservation winner is known; a matching replay after consumption mutates no approval state; current membership authorization is always required.
- **Explicit non-guarantees:** no attempts table, no TTL (v1), no automatic provider retry, no provider fallback, and **no provider-side exactly-once** (receipt, execution or transmission) — the strongest claim is that GovAI will not intentionally launch a second local provider execution for a matching tenant-scoped keyed intent.
- Tests: `apps/api/src/pipeline/run-idempotency.test.ts` (unit), `tests/integration/run-idempotency.test.ts` + `tests/integration/workroom-run-idempotency.test.ts` (real-Postgres winner arbitration, RLS/immutability, replay/conflict/authorization matrix, actual upstream-request counting).

**Status lines:**
- Runtime-to-evidence dispatch for **direct governed-native / passthrough** routes: **IMPLEMENTED & INTEGRATION-TESTED (PR-B / EP-004)** — the AuditBridge (ADR-027) is wired into all four routes; `event: unknown` is validated/narrowed via `PassthroughInvokedSchema` (v4) before `captureAuditEvent` → outbox. ADR-027 supersedes the older passthrough "Governed Run pipeline (PR3+)" absorption intent for direct routes; `/v1/runs` remains distinct and chain-authoritative via `auditAppend`.
- Direct-route request identity (**ADR-028**): **IMPLEMENTED** — an ingress hook mints `govai_request_id` + optional `X-GovAI-Idempotency-Key`; the AuditBridge `captureId` is the deterministic UUIDv5 (NOT `audit_event_id`), and `payloadHash` is the stable `AuditBridgeCapturePayloadV1` projection. Same-key replay reuse (I3) and divergent-`occurred_at` conflict (I4) are proven end-to-end.
- Evidence primitives (B0/B1/B2): `IMPLEMENTED_FOUNDATIONAL_CONTROL`. **Live (M2/M2A, executed scope):** every direct-route request against the real providers produced exactly one durable `passthrough.invoked` v4 capture in `govai.audit_capture_outbox`; `payload_hash` + `capture_id` recomputed with the repository's own functions matched (21/21, 6/6); one bounded seal-once (`apps/audit-sealer/src/seal-once.ts`, one committed tx, no loop) sealed exactly one capture with the deterministic `audit_event_id`, chain verified, tenant isolation held. This is acceptance evidence, not a claim of continuous production sealing.
- **Native/Governed pre-provider denies are evidenced (M1 FB-4):** every governance-decision block (computer-use floor, `hard_denied` beta, governed matrix `blocked`) emits a durable blocked v4 capture (`enforcement_decision='blocked'`, `body_forward_mode='blocked'`, `credential_source='not_resolved_pre_provider_block'`, streaming block `stream_final_hash=SHA256(empty)` without `stream_outcome`); the ONE local outcome without a durable v4 event is provider-credential-unresolvable (HTTP 502 + structured warn log; residual R4). The v1 diagnostics `tool.validation_blocked` / `passthrough.beta_denied` remain log-only and are counted as bridge drops (residual R5).
- Continuous sealer runner (B3): **IMPLEMENTED & INTEGRATION-TESTED (EP-006, `apps/audit-sealer`)** — Shape-S choreography (SPEC-B3 §1), the SEPARATE stale-recovery path, startup probe, bounded loop, OTel metrics; S0–S11 against real Postgres. ADR-023 Option A(b) impl/tested PR #92; AuditBridge wiring impl/tested PR-B #98; B3 authorized + implemented. (A B0 `failed→sealing` "unstick" migration for a terminally-stalled chain is a SEPARATE future decision, not in EP-006.)
- `/v1/runs` run-lifecycle → audit chain (`auditAppend` via the P0.3-A durable dispatch layer, `run-dispatch-state.ts`): `IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED` (but to the chain, not the outbox). Durable dispatch boundary + honest `run.outcome_unknown` + bounded recovery: **IMPLEMENTED & INTEGRATION-TESTED (P0.3-A / PR #123)** — see *Durable provider dispatch* above.

---

## 4. Governance and policy

| Item | Status | Evidence / note |
|---|---|---|
| Capability registry (facets, default-deny) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `@govai/core-governance`; `capability.test.ts`; ADR-004 |
| Org override downgrade resolver | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `@govai/core-governance`; `resolve-governance.test.ts` |
| `/v1/runs` governed mode | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `run-orchestrator.ts`; `governed-run-e2e.test.ts` |
| `/v1/runs` passthrough mode | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `run-orchestrator.ts`; `runs-passthrough-mode.test.ts` |
| DLP pre-scan (scan-only) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `@govai/dlp-br`; governed handlers `dlpScan`; `scan-sensitive.test.ts` |
| Policy decision persistence (Native beta floor) | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | M1: only `hard_denied` tokens (provider-hosted computer-use family) are denied — 403 + `passthrough.beta_denied` diagnostic + durable blocked v4 capture; unknown/unresolved tokens forwarded with hashed markers (`beta:<state>:sha256:<64hex>` in `risk_escalation_reasons`); native-contract `BETA-*`/`DENY-01`; `passthrough-beta-denied.test.ts` |
| Workroom approval override (passthrough) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `workroom-approvals.ts`; `workroom-approvals-runs.test.ts` |
| Hard-deny runtime enforcement (regulatory) | DOCUMENTED_TARGET_ONLY | the ONLY runtime hard denies are the provider-hosted computer-use floor (tool + beta) and the governed matrix `blocked` outcome; regulatory prohibited-use/high-risk/agent hard-deny-floor are **evidence only** — no runtime gateway block; Phase 5 ask/sandbox/enforce primitives NOT implemented. **Not claimed complete.** |

---

## 5. Regulatory Core

PR-R1..R9 are foundational controls — **governance evidence, not runtime enforcement** (no execution is blocked). Migrations + tests verified present.

| Capability | Status | Source | Tests | Runtime enforcement? | Next step |
|---|---|---|---|---|---|
| Regulatory Source Registry | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0016; `regulatory/service.ts` | `regulatory-catalog.test.ts` | no | change/diff engine |
| Unified Control Catalog | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0016 | `regulatory-catalog.test.ts` | no | drift detection |
| AI System Registry | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0017 | `regulatory-ai-systems.test.ts` | no | — |
| Provider Registry | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0018 | `regulatory-providers.test.ts` | no | — |
| Model Registry | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0019 | `regulatory-models.test.ts` | no | — |
| Agent Registry | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0020 | `regulatory-agents.test.ts` | no — `hard_deny_floor_expected` is a declared expectation, not enforced | wire to runtime later |
| Use-case Registry | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0021 | `regulatory-use-cases.test.ts` | no | — |
| Risk Classification Engine | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0022; `service.ts::classifyRisk` | `regulatory-risk-classifications.test.ts` | no | — |
| High-risk Review Workflow | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0023 | `regulatory-high-risk-reviews.test.ts` | no — APPROVED = evidence, not runtime authorization | bind to execution (future) |
| Prohibited-use Workflow | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0024 | `regulatory-prohibited-use-workflow.test.ts` | no — DENIED = evidence, not a runtime block | runtime gateway (future) |
| Sensitive Data taxonomy/detectors | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | `@govai/dlp-br` SD1 + SD2A | `secret-detectors.test.ts`, `financial-detectors.test.ts`, `health-detectors.test.ts` | no — advisory only | SD persistence + policy binding |
| CNJ/Sinapses readiness | DOCUMENTED_TARGET_ONLY | regulatory/25-cnj-sinapses-readiness.md | n/a | no | — |
| Certification/readiness dossiers | DOCUMENTED_TARGET_ONLY | regulatory/22-certification-and-audit-readiness.md | n/a | no | — |
| Regulatory intelligence (monitor/diff) | DOCUMENTED_TARGET_ONLY | regulatory/21-regulatory-intelligence-operating-model.md | n/a | no | — |

The README and regulatory docs explicitly disclaim LGPD/judicial/legal/medical/financial/ISO/NIST/EU-AI-Act compliance, certification, or court admissibility. This document makes no compliance claim.

---

## 6. Known stale docs

Summarized in [stale-docs-register.md](./stale-docs-register.md). At the M3 freeze the former README status block, the ADR-032 `IMPLEMENTATION_STATUS=PENDING` pointer, the H1 coverage map's B3-gate wording, ADR-021 "Proposed" and the D9 "not present in repository" statements are all resolved. Remaining registered staleness is localized: `workroom-governance-room.md` status, ADR-020/022–027 status-line wording that predates EP-004/EP-006 (accepted decisions, not stale decisions), the untouched PR-0 E2–E13 targets (`governance-philosophy.md`, `baseline-decisions.md`, `source-spec.md`, `docs/contracts/*` — historical/target framing), two `tests/live/*` comments, and the promoted July 2026 plans/registers whose bodies are historical snapshots (each carries a promulgation header saying so). ADR-022..026 are Accepted and B3 (EP-006) is implemented.

---

## 7. Current non-negotiables

- **Provider-native semantics are sacred** (no re-serialization / hidden defaults / schema narrowing on the native surface).
- **No provider traffic in the AuditSealer.**
- **Evidence failure is evidence-plane health, not provider UX failure** for low-risk traffic.
- **No runtime hard-deny claim** unless implemented and tested.
- **No compliance/legal/certification claim** unless validated externally.
- **No document is a source of truth unless it distinguishes evidence from target architecture.**
- **Runtime route existence does not imply runtime evidence capture** (see §3).

---

## 8. P0 findings register (F1–F6, C-2) and F4 canonical state

The P0 "Truth and Integrity" program tracks source findings about evidence truthfulness (see the roadmap's operational-priority register for sequencing). The canonical per-finding state at the Foundation V1 anchor `de80664a` is the **matrix below**. All seven items (F1–F6 + C-2) are dispositioned: five corrected, F4 preventive hardening, and **F2 CLOSED as an evidence-granularity residual** by the M3 source adjudication (freeze record §5) — no runtime defect, no false evidence, no schema v5. EP-11 (PR #126) is a **subsequent provider-truth correction outside this matrix** — it is not an F-finding and must not be conflated with F2.

| Finding | Classification | Implementation status | Landed by / next | Subject |
|---|---|---|---|---|
| F1 | DEMONSTRATED | CORRECTED | P0.2 / `19bcb452` (PR #119) | real provider-credential provenance |
| F2 | EVIDENCE_GRANULARITY_GAP (`F2_RUNTIME_DEFECT=NO`, `F2_FALSE_EVIDENCE=NO`, `F2_FOUNDATION_BLOCKER=NO`) | CLOSED_WITH_REGISTERED_RESIDUAL (residual R2; `F2_SCHEMA_EVOLUTION=DEFERRED`, no v5) | M1 (PR #131) exposed recommendation vs applied honestly over HTTP (`x-govai-enforcement-decision` / `x-govai-enforcement-applied`, 403 `block_trigger`); M3 source adjudication closed it documentarily (freeze record §5, anti-evaporation clause §7) | block-source / applied-vs-recommended provenance is recomputed from other sealed fields + HTTP, not first-class in sealed v4 |
| F3 | DEMONSTRATED | CORRECTED | P0.3-A / `165291d9` (PR #123) — durable provider dispatch; the remaining P0.3 slice (P0.3-C) landed as PR #129 / `f381d3fa` — the P0.3 runtime lane is COMPLETE | transaction and dispatch-state work |
| F4 | LATENT_ARCHITECTURAL_RISK_NOT_OBSERVED_AS_FAILURE | PREVENTIVE_HARDENING_MERGED_AND_DUAL_VERIFIED | PR #120 / merge `719fefc2`, tree `c13d83db` | AuditBridge request-identity lifecycle scoping |
| F5 | DEMONSTRATED | CORRECTED | P0.1 / `ed18736a` (PR #118) | demonstrated overlapping-span redaction paths |
| F6 | DEMONSTRATED | CORRECTED | P0.1 / `ed18736a` (PR #118) | evidence counts derived from fused spans |
| C-2 | DEMONSTRATED — catalogued **SEPARATE from the F1–F6 numbering** | CORRECTED | P0.2 / `19bcb452` (PR #119) | real SHA-256 of the blocked native request body (after PR #123 the real native-body hash is computed before the dispatch boundary — `run-orchestrator.ts:1184` governed, `:1707` passthrough — and carried by the durable dispatch records) |

### EP-DOCS-04 / PR #121 canonical state

```text
PR121_STATUS=MERGED_AND_DUAL_VERIFIED
PR121_MERGE_SHA=e422280d63d52da2ed08fb488146266b2ef7dac0
PR121_MERGE_TREE=196701d877cc40d977197529f809985162c9254c
PR121_MERGE_PARENT=719fefc25502bb9f7547743f339b38fa3a20c4c7
PR121_PARENT_COUNT=1
PR121_SCOPE=THREE_ARCHITECTURE_DOCS_PLUS_COMMENT_ONLY_ALS_CORRECTION
PR121_RUNTIME_CHANGE=NONE
PR121_MAIN_CI=GREEN
PR121_FABLE5_MERGE_VERIFY=PASS
PR121_OPUS_MERGE_VERIFY=PASS
```

The squash tree is byte-identical to the reviewed PR head tree.
PR #121 does not change the F1–F6 + C-2 classification matrix and
is not a second F4 runtime implementation.

### P0.3-A / PR #123 canonical state

```text
PR123_STATUS=MERGED
PR123_MERGE_SHA=165291d90b144d3063ed87b8eaeac73e9a506e41
PR123_MERGE_TREE=93613383e9e0d78be3daa2641c491879f597595e
PR123_MERGE_PARENT=4d6eab725fa0b6939d90418bff74c08b62551144
PR123_PARENT_COUNT=1
PR123_AUDITED_HEAD=08b59930e3ad8920fec4ee5e7ec878264fca2253
PR123_TREE_EQUALS_AUDITED_HEAD_TREE=PASS
PR123_CHANGED_FILES=38
PR123_COMMITS_ADDED_TO_MAIN=1
PR123_POST_MERGE_MAIN_CI_RUN=31282331366
PR123_POST_MERGE_MAIN_CI=SUCCESS
PR123_SOURCE_BRANCH_PRESERVED=YES

F3_CLASSIFICATION=DEMONSTRATED
F3_STATUS=CORRECTED
P0_3_A=COMPLETE
P0_3_C=COMPLETE          (PR #129 — see the P0.3-C canonical state below;
                          was OPEN at the PR #123 anchor)
F2_STATUS=CLOSED_WITH_REGISTERED_RESIDUAL   (M3; was OPEN_PENDING_SOURCE_CLASSIFICATION at the PR #123 anchor)
```

**RLS process description (migration 0029), canonical correction** — earlier
process reports described the M-B guard mechanism imprecisely:

```text
RLS_FORCE_SUSPENSION_USED=YES
RLS_DEFINER_FUNCTION_USED=NO          (for the M-B decision count)
RLS_VISIBILITY_MECHANISM=OWNER_FORCE_SUSPENSION
RLS_ROW_SECURITY_OFF_ROLE=FAIL_CLOSED_ASSERTION
```

The M-B decision count does **not** use a `SECURITY DEFINER` function; its
visibility mechanism is the owner `NO FORCE ROW LEVEL SECURITY` window
(`0029:110-115`) with `row_security=off` armed as a fail-closed assertion.
`SECURITY DEFINER` remains in use **elsewhere in 0029** — the
recovery-discovery candidates primitive (`0029:460,497`). A generic
"0029 does not use SECURITY DEFINER" claim would be false.

### EP-11 / PR #126 canonical state (ADR-032 provider-truth runtime correction)

```text
PR126_STATUS=MERGED
PR126_MERGE_SHA=01c05fd61428a76d300b73fb335021f598519d2f
PR126_MERGE_TREE=20ccd433b27b53a645962ebd51a807bc76d0398c
PR126_MERGE_PARENT=629b6e9f36a0b39baf320658e53ee5c4c60bdcef
PR126_PARENT_COUNT=1
PR126_AUDITED_HEAD=acc740fd327322d9f36fbf7eb1e95a6cb6fadf18
PR126_TREE_EQUALS_AUDITED_HEAD_TREE=PASS
PR126_CHANGED_FILES=6
PR126_POST_MERGE_MAIN_CI_RUN=31649394857
PR126_POST_MERGE_MAIN_CI=SUCCESS
PR126_SOURCE_BRANCH_PRESERVED=YES

EP11_IMPLEMENTATION=COMPLETE
EP11_PR=126
EP11_MERGE_SHA=01c05fd61428a76d300b73fb335021f598519d2f
ADR032_DECISION_STATUS=ACCEPTED
ADR032_REPOSITORY_PROMULGATION=COMPLETE
ADR032_RUNTIME_IMPLEMENTATION=IMPLEMENTED
ADR032_ADR_FILE_IMPLEMENTATION_POINTER=RECONCILED_BY_M3   (was STALE_PENDING_SEPARATE_MAINTENANCE)

LOCAL_DATE_TRIGGERED_DENY_REMOVED=YES
LOCAL_DEPRECATION_WARNING_REMOVED=YES
PROVIDER_FORWARD_PRESERVED=YES
PROVIDER_RESULT_EVIDENCE_PRESERVED=YES
```

The landed runtime deleted
`packages/provider-openai/src/passthrough/files-purpose-validator.ts` and its
dedicated unit test; removed the date-triggered `block_post_sunset` branch,
the local synthetic purpose-deprecation 403, the
`x-govai-deprecation-warning` header, the route-side supply of the three
legacy purpose-deprecation fields, and the obsolete public exports; preserved
provider forwarding and actual provider-result evidence; and retained the
historical event/emitter/capture compatibility machinery
(`packages/provider-openai/src/passthrough/audit-emit.ts`,
`packages/core-events/src/passthrough-invoked.ts`,
`packages/core-events/src/audit-bridge-capture-payload.ts`). "Runtime
implementation" (complete, PR #126) and the ADR file's own "documentary
pointer" were distinct statements at the PR #130 anchor; the ADR file now
reads `IMPLEMENTATION_STATUS=COMPLETE — implemented by EP-11 / PR #126` (M3
reconciliation; the promulgation-era interim wording is retained as
`HISTORICAL_PRE_EP11_RUNTIME`).

### P0.3-C / PR #129 canonical state (cross-request execution idempotency)

```text
PR129_STATUS=MERGED
PR129_MERGE_SHA=f381d3fac24d5938aed91b6618ef511b66ddc878
PR129_MERGE_TREE=a64e7178ecd0e90f43d67550be3a6e688054a67c
PR129_MERGE_PARENT=21afa116e8e85b536a000f0889e6d2bf6929a4a9
PR129_PARENT_COUNT=1
PR129_AUDITED_HEAD=bfa05c5bfeca536d0bd4c41c045246ecd5124c95
PR129_TREE_EQUALS_AUDITED_HEAD_TREE=PASS
PR129_CHANGED_FILES=8
PR129_POST_MERGE_MAIN_CI_RUN=31802636887
PR129_POST_MERGE_MAIN_CI=SUCCESS
PR129_SOURCE_BRANCH_PRESERVED=YES

P0_3_C=COMPLETE
P03_RUNTIME_LANE=COMPLETE
P0_TRUTH_AND_INTEGRITY_PROGRAM=CLOSED_AT_FOUNDATION_V1_FREEZE   (F2 closed with residual; PR-0/D9 promulgated in the M3 tree — see the M3 blocks below)
F2_STATUS=CLOSED_WITH_REGISTERED_RESIDUAL   (was OPEN_PENDING_SOURCE_CLASSIFICATION at this PR's anchor)
PROVIDER_EXACTLY_ONCE=NOT_CLAIMED
```

Review/process bookkeeping (canonical): 4 substantive review threads, all
resolved with recorded adjudications, 0 active unresolved current threads;
**3 substantive Codex correction rounds** (the configured maximum was not
exceeded) followed by **1 final verification pass** on the corrected exact
head, which produced **2 explicit clean responses** — delivered as issue
comments from the trusted Codex bot identity with exact-head attribution (a
valid clean-signal transport only when author provenance, explicit clean
content and exact-head SHA are ALL verified; see stale-docs-register.md,
process-control lessons).

#### P0.3-C known v1 boundary (non-blocking)

```text
P03C_PRE_RESERVATION_CONCURRENT_WINNER_WINDOW=KNOWN_V1_LIMITATION
CLASS=DEFERRED_LIVENESS_ENHANCEMENT_BY_FROZEN_CONSTRAINT
SAFETY_DEFECT=NO
IDEMPOTENCY_VIOLATION=NO
DUPLICATE_EXECUTION_RISK_FROM_THIS_WINDOW=NO
P03C_BLOCKER=NO
```

When two matching keyed requests overlap and the winner's TX-A is still
uncommitted at BOTH of the loser's committed reads (the initial probe and the
bounded recheck after a pre-reservation failure such as credential/KMS
resolution), the loser may return its original pre-reservation error while
the winner commits immediately afterward. This is a consistent linearizable
history for v1: no second committed run, no second provider execution, no key
poisoning, no second approval consumption — and a later retry of the same key
converges to the winner's committed run. The frozen v1 constraints
deliberately exclude the mechanisms that would close it (polling for the
winner's commit, automatic execution/credential/provider retry, candidate-run
creation before credential resolution, or an advisory-lock authority in front
of the binding-table arbiter). Revisit only if those architectural
constraints are deliberately reconsidered. This is **not** an exactly-once
gap and **not** a duplicate-execution vulnerability, and P0.3-C is not
incomplete because of it.

### Foundation V1 M1 / PR #131 canonical state (native/governed contract)

```text
PR131_STATUS=MERGED
PR131_MERGE_SHA=3e90f2fbfb60a011ce8a21e189896c06887c1c04
PR131_MERGE_TREE=599501bfe48e75b3b0b51edb042a0aa796563f56
PR131_MERGE_PARENT=ab722debf92166a0685593cc6a80b2b69204fc3c
PR131_PARENT_COUNT=1
PR131_AUDITED_HEAD=1dd4d5e9d2cc653bd4df65d432cc9fd8eba12fe5
PR131_TREE_EQUALS_AUDITED_HEAD_TREE=PASS
PR131_CHANGED_FILES=57
PR131_POST_MERGE_MAIN_CI_RUN=31965736103
PR131_POST_MERGE_MAIN_CI=SUCCESS
PR131_SOURCE_BRANCH_PRESERVED=YES

OD1=A   NATIVE_AUDITED_DEFAULT=PASS_OBSERVE_EVIDENCE; hard-deny family = PROVIDER_HOSTED_COMPUTER_USE only; NATIVE_HARD_DENY_EXPANSION=FORBIDDEN
OD2=A   labels keep forwarding; enforcement_applied + block_trigger exposed additively over HTTP; no sealed-schema change
UNKNOWN_BETA_EVIDENCE_MODE=hashed_marker_in_risk_escalation_reasons   RAW_UNKNOWN_BETA_IN_EVIDENCE=NO
CONTENT_ENCODING_DECISION=identity_upstream + defense_in_depth_drop_when_decoded
DIRECT_CREDENTIAL_UNRESOLVABLE=502 provider_credential_unresolvable (scoped error handler; no fabricated v4)
TAXONOMY_VERSION=<provider>.tools_taxonomy:schema_version=3:m1_noncomputer_forward_computer_use_floor
OPENAI_BETA_POLICY_VERSION=openai-beta-policy@2026-08-16   ANTHROPIC_BETA_POLICY_VERSION=unchanged (2026-05-06 table)
MIGRATIONS_CHANGED=0  CORE_EVENTS_CHANGED=0  AUDIT_BRIDGE_CHANGED=0  CAPTURE_PROJECTION_CHANGED=0  HASH_DOMAIN_CHANGED=0
```

Codex: 3 substantive P2 rounds (representation validators when decoded; 405 gate on
method-agnostic resolver branches; pool acquisition inside the 502-wrapped path), then an
explicit clean on the exact head.

### Foundation V1 M2 real-provider acceptance canonical state (read-only at `3e90f2fb`)

```text
M2_BASE_SHA=3e90f2fbfb60a011ce8a21e189896c06887c1c04
M2_REPOSITORY_WRITES=NONE
M2_LANES=8/8 SDK Native+Governed × non-stream+stream (Anthropic + OpenAI) + chat-completions smoke
M2_PROVIDER_4XX_RELAY=PASS   M2_UNKNOWN_BETA=PASS_PROVIDER_REJECTED_AS_EXPECTED   M2_REAL_BETA=PASS
M2_TOOL_DESCRIPTORS=PASS   M2_COMPUTER_USE_BLOCK=PASS (4/4 surfaces, provider dispatch count 0)
M2_V1_RUNS=PASS (both providers)   M2_IDEMPOTENT_REPLAY=PASS (0 second dispatch; divergent → 409)
M2_AUDITBRIDGE_CAPTURE=PASS (30 durable rows; 21/21 hash + capture_id recomputation)
M2_ONE_SHOT_SEALER=PASS (bounded seal-once; deterministic audit_event_id; chain valid; tenant isolation)
M2_AGENT_CLIENTS=PASS (Claude Code 2.1.233 + Codex CLI 0.140.0-alpha.2, passthrough + governed)
M2_SECRET_LEAK_CHECK=PASS   M2_SPEND_USD≈0.0177
M2_FINDINGS=6 (F1 P2 request-id; F2–F6 P3) → F1/F2/F5 fixed by M2A; F3/F4/F6 deferred non-blocking
```

### Foundation V1 M2A / PR #132 canonical state (final corrections + live re-acceptance)

```text
PR132_STATUS=MERGED
PR132_MERGE_SHA=de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68   (= FOUNDATION_V1_RUNTIME_ANCHOR)
PR132_MERGE_TREE=0174a5c5b2e74c80b904d035b4f8ddc10abbbd69   (= live-accepted head tree ⇒ no post-merge live rerun needed)
PR132_MERGE_PARENT=3e90f2fbfb60a011ce8a21e189896c06887c1c04
PR132_PARENT_COUNT=1
PR132_AUDITED_HEAD=7cdde1915e76d202623bc0b0f1807759c885c123
PR132_TREE_EQUALS_AUDITED_HEAD_TREE=PASS
PR132_CHANGED_FILES=23
PR132_POST_MERGE_MAIN_CI_RUN=31988375993
PR132_POST_MERGE_MAIN_CI=SUCCESS
PR132_SOURCE_BRANCH_PRESERVED=YES

ANTHROPIC_REQUEST_ID_PRIMARY=request-id (fallbacks anthropic-request-id, x-request-id; provider-aware extractProviderRequestId)
MAIN_MODULE_HELPER=apps/api/src/main-module.ts isMainModule
F5_CLAUDE_BETA_QUERY_POLICY=PRESERVE (CASE A: real Anthropic accepts POST /v1/messages?beta=true)
QUERY_STRIP_GENERAL_REGEX_REMOVED=YES   QUERY_IN_SEALED_V4=NO (native_endpoint stays the template)
LIVE_REACCEPTANCE=PASS (real Anthropic non-stream + stream captures with request-id; real query lanes both providers; Claude Code smoke)
CODEX_FINAL_RESULT=CLEAN on the exact head; CODEX_SUBSTANTIVE_CORRECTION_ROUNDS=0
FOUNDATION_V1_RUNTIME_FREEZE_READY=YES
```

### Foundation V1 M3 canonical freeze — D9 / PR-0 promulgation state (this tree)

```text
FOUNDATION_V1_RUNTIME_ANCHOR=de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68
FOUNDATION_V1_DOCUMENTARY_FREEZE_PR=133   (branch docs/foundation-v1-m3-canonical-freeze; frozen head/tree + merge SHA in the external mission record)
FOUNDATION_V1=DOCUMENTARY_FREEZE_RECORDED_IN_THIS_TREE   (tree-stable: this tree carries the freeze record; the lifecycle step FREEZE_PENDING_M3_MERGE → FROZEN_BASELINE is declared by the external post-merge proof of PR #133, never by this file)

D9_SOURCE_CORPUS_LOCATED=YES
D9_SOURCE_PROVENANCE=USER_SUPPLIED_V09_PACKAGE
D9_EXTERNAL_LEDGER=43_OF_43_PASS   PR0_INTERNAL_MANIFEST=26_OF_26_PASS   V09_PHYSICAL_ENTRIES=15   D9_HASH_VERIFICATION=11_OF_11_PASS
D9_PRIOR_CANONICAL_HASH_LEDGER=NOT_AVAILABLE
D9_PRESENT_IN_REPOSITORY_MAIN=YES_IN_M3_TREE   (post-merge proof re-runs against main)
D9_REPOSITORY_PROMULGATION=COMPLETE_IN_M3_TREE
D9_REAL_MISSING_TARGETS_IN_PR_TREE=0        (0025_…sql:35-37 → spec-v2.1 / ADR-017 / threat-model now resolve; capture.ts:54 "See ADR-017" resolves)
PR0_STATUS=PROMULGATED_BY_M3                (was DOCUMENTARY_BLOCKED_PENDING_PROMULGATION)
PR0_D9_V2=COMPLETE_IN_M3_TREE

ADR021_STATUS=ACCEPTED   ADR032_IMPLEMENTATION_STATUS=COMPLETE (EP-11 / PR #126)
ADR016=CANDIDATE_TARGET_ARCHITECTURE  ADR017=HISTORICAL_PRECURSOR  ADR018=ACCEPTED_DOCTRINE  ADR019=ACCEPTED_TARGET_DECISION
ADR029=PROPOSED (text reconciled)  ADR030=PROPOSED (text reconciled)  ADR031=ACCEPTED
SPEC_V2_1=HISTORICAL_PRE_FOUNDATION_RUNTIME   SPEC_V2_2=NAMED_FOLLOW_UP (not authored; no file)
H1_COVERAGE_MAP=REGENERATED_AT_de80664a (CT-005 covered; STREAM-005 hash correctness; live acceptance separated)
LEGACY_ROOT_ARTIFACTS=INVENTORIED_DEFERRED_TO_SEPARATE_HYGIENE_PR
```

Provenance record: [d9-promulgation-manifest.md](./d9-promulgation-manifest.md); ADR
status per file: [adr/ADR-INDEX.md](./adr/ADR-INDEX.md); documentary navigation:
[../README.md](../README.md).

### F4 canonical state

```text
F4_CODE_STATUS=CLOSED
F4_CLASSIFICATION=PREVENTIVE_HARDENING
F4_BASELINE_FALSIFICATION_RESULT=NO_OBSERVABLE_FAILURE_REPRODUCED
F4_MERGE_SHA=719fefc25502bb9f7547743f339b38fa3a20c4c7
F4_MERGE_TREE=c13d83dbc78b7ddda81b542cb6fab568623a54ff
F4_DUAL_DIFF_VERIFY=PASS
F4_DUAL_MERGE_VERIFY=PASS
F4_MAIN_CI=GREEN
```

F4 is **preventive hardening** — it is NOT a proven cross-request contamination defect, NOT a repaired evidence lie, and NOT a reproduced production failure:

- The deterministic falsification harness (`tests/integration/request-identity-isolation.test.ts`) reproduced **no** observable identity contamination and **no** delayed-stream context loss against the tested previous implementation.
- `enterWith()` nevertheless lacked an explicit callback-owned restoration boundary.
- The merged change places Fastify's continuation (`done()`) inside `AsyncLocalStorage.run()` in `pipeline/request-identity-hook.ts`.
- Asynchronous resources created by that continuation retain the request-owned store; the caller's previous ambient context is restored when the `run()` callback returns.
- The harness is now a permanent regression guard for the asynchronous and transactional work expected in P0.3.
- The harness cleanup fix tracks complete request Promises, so parked requests cannot obscure the original test failure.

### Separate P1 evidence-integrity register — SUPERSEDED BY NARROW RESIDUALS (M3)

The former class-wide **LOCAL_DENY_EVIDENCE_INCOMPLETENESS** P1 family (Subfamily A
"emitted then dropped": `passthrough.beta_denied`, `tool.validation_blocked`;
Subfamily B "no audit event": the `purpose_deprecated_post_sunset` branch) is
**not carried forward as a class** — `OLD_CLASS_WIDE_LOCAL_DENY_LABEL=SUPERSEDED_BY_NARROW_RESIDUALS`
(source-adjudicated at `de80664a`, freeze record §9):

- Subfamily B's member was **removed by EP-11** (`PURPOSE_DEPRECATED_LOCAL_DENY_BRANCH=CLOSED_BY_EP11`).
- Subfamily A: since M1 (FB-4) every Native/Governed pre-provider governance block
  (computer-use floor, `hard_denied` beta, governed matrix `blocked`) emits a **durable
  blocked v4 capture** in addition to the v1 diagnostic — the block evidence is durable;
  what remains is (i) the log-only v1 diagnostics being counted as bridge drops
  (residual **R5**, non-blocking) and (ii) the provider-credential-unresolvable path,
  which returns 502 with a structured log and no fabricated v4 event (residual **R4**).
- Evidence-granularity items that used to be argued under this label are registered as
  R2 (F2 applied-vs-recommended provenance) and R3 (typed unknown-beta provenance).

### F4 follow-up register (narrow, non-blocking)

- **SEEDORG_FLAKE_CANDIDATE** — root cause: **SOURCE-ADJUDICATED (M3)**; classification since sharpened by observation. Observed symptoms: an earlier unrelated integration attempt reported a primary-key prefix collision, and the collision has since **recurred in CI** (an actual `api_keys_pkey` duplicate during the AI Console closeout runs) — it is no longer merely theoretical. The collision domain is the API-key prefix generator and schema, not the fixture: `packages/core-identity/src/api-keys.ts` forms the lookup prefix as `govai_sk_` plus three base64url characters (`PREFIX_LOOKUP_LEN=12`, nominal domain 64³ = 262,144) with no collision retry, and `govai.api_keys.prefix` is the PRIMARY KEY (migration `0005_runtime_patch_1.sql`). No production human/API-key issuance lifecycle exists at the anchor — `generateApiKey()` and every `INSERT INTO govai.api_keys` in the tree are test-only — so the present-tense classification is `EMPIRICALLY_MANIFESTED_TEST_FIXTURE_COLLISION` (the latent design risk `LATENT_AUTH_LIFECYCLE_DESIGN_RISK` has manifested, in the test-fixture domain only), deferred to the named follow-up `EP-AUTH-API-KEY-PREFIX-COLLISION-HARDENING` (`OPEN_EMPIRICALLY_MANIFESTED`) in the R14 human-auth lane; not a Foundation V1 runtime blocker and it does not block F4 closure. `seedOrg` itself is unmodified.
- **DIRECT_STREAM_REQUEST_ID_HEADER_GAP** — status: **PRE_EXISTING**; introduced by F4: NO; F4-blocking: NO. Direct streaming responses do not carry the `X-GovAI-Request-Id` echo; resolving it is a separate future behavior-and-compatibility decision.
