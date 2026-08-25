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
- **The Native Experience Parity V1 BASELINE is complete in this tree** (EP-PROVIDER-NATIVE-PARITY-V1-BASELINE-01, research snapshot 2026-08-21): parity vocabulary + four provider-surface baselines + product-UX reference + the 248-row machine manifest (`pnpm docs:parity:check`), and the **AI Conversation Continuity V1 DESIGN spec** — documentation, manifest and validator tooling ONLY. `CONVERSATION_PERSISTENCE=NOT_IMPLEMENTED`; no provider capability was implemented; no runtime behaviour changed. See §*EP-PROVIDER-NATIVE-PARITY-V1-BASELINE-01 canonical state* at the end of this document.

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
| Architecture docs | `docs/architecture/**/*.md` | 106 |
| Regulatory docs | `docs/architecture/regulatory/*.md` | 20 |
| ADR decision records | `docs/architecture/adr/ADR-[0-9][0-9][0-9]-*.md` (excludes `ADR-INDEX.md`) | 31 |
| Workspace apps | `apps/*` | 3 — `apps/api`, `apps/audit-sealer`, `apps/ui` |
| Workspace packages | `packages/*` | 13 |
| Other workspace members | literal entries in `pnpm-workspace.yaml` | `scripts`, `tests` |
| API route files | `apps/api/src/routes/*.ts` | 20 |
| DB migrations | `apps/api/src/db/migrations/*.sql` | 32 |

| Test category | Execution | Files | Tests |
|---|---|---|---|
| Root unit | `pnpm test` (no `GOVAI_INTEGRATION`) | 144 | 1646 |
| Root integration-only | the identities `GOVAI_INTEGRATION=1` adds (proved set difference, all under `tests/integration/`) | 89 | 1308 |
| Root full integration gate | `pnpm test:integration` (unit + integration; the CI `integration` job) | 233 | 2954 |
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

- **SEEDORG_FLAKE_CANDIDATE** — root cause: **SOURCE-ADJUDICATED (M3)**; classification since sharpened by observation. Observed symptoms: an earlier unrelated integration attempt reported a primary-key prefix collision, and the collision has since **recurred in CI** (an actual `api_keys_pkey` duplicate during the AI Console closeout runs) — it is no longer merely theoretical. The collision domain is the API-key prefix generator and schema, not the fixture: `packages/core-identity/src/api-keys.ts` forms the lookup prefix as `govai_sk_` plus three base64url characters (`PREFIX_LOOKUP_LEN=12`, nominal domain 64³ = 262,144) with no collision retry, and `govai.api_keys.prefix` is the PRIMARY KEY (migration `0005_runtime_patch_1.sql`). No production human/API-key issuance lifecycle exists at the anchor — `generateApiKey()` and every `INSERT INTO govai.api_keys` in the tree are test-only — so the classification was `EMPIRICALLY_MANIFESTED_TEST_FIXTURE_COLLISION` (the latent design risk `LATENT_AUTH_LIFECYCLE_DESIGN_RISK` had manifested, in the test-fixture domain only), deferred to the named follow-up `EP-AUTH-API-KEY-PREFIX-COLLISION-HARDENING` in the R14 human-auth lane; not a Foundation V1 runtime blocker and it did not block F4 closure. The collision recurred twice in one CI day during the P0-A1 closeout (`workroom-rls.test.ts` and `workroom-run-idempotency.test.ts`, both `api_keys_pkey` through the shared `seedOrg` fixture path). **T1 mitigation (this tree, `EP-AUTH-API-KEY-PREFIX-COLLISION-HARDENING` T1-TEST-ISSUANCE-BOUNDARY-RETRY-01)**: the test issuance boundary now performs a bounded whole-transaction retry on the exact `23505`/`api_keys_pkey` collision only — `withGeneratedApiKeyCollisionRetry` (8 attempts, a NEWLY generated candidate per attempt, full ROLLBACK before each retry, fail-closed exhaustion with no secret material in the error) wraps `seedOrg`/`addApiKey` in `tests/integration/helpers/server-fixture.ts` plus the hae-004 local seeder; deterministic forced-collision regression matrix in `tests/integration/api-key-prefix-collision-retry.test.ts`. The DB uniqueness constraint remains the authority and is unchanged; `PREFIX_LOOKUP_LEN`/key format/`lookupPrefix`/`api_key_lookup_v2` semantics unchanged; no migration; no production runtime change. Status: `TEST_FIXTURE_COLLISION=CLOSED_BY_BOUNDED_DB_COLLISION_RETRY` (current test-fixture manifestation); the collision domain still originates from the short lookup-prefix contract, so `LATENT_AUTH_LIFECYCLE_DESIGN_RISK=OPEN_R14` and `PRODUCTION_API_KEY_ISSUANCE_LIFECYCLE=NOT_IMPLEMENTED` (prefix entropy/length, backward compatibility, production-boundary collision retry, rotation, revocation and issuance UX remain future R14 design).
- **DIRECT_STREAM_REQUEST_ID_HEADER_GAP** — status: **PRE_EXISTING**; introduced by F4: NO; F4-blocking: NO. Direct streaming responses do not carry the `X-GovAI-Request-Id` echo; resolving it is a separate future behavior-and-compatibility decision.

### EP-PROVIDER-NATIVE-PARITY-V1-BASELINE-01 canonical state (this tree)

- `NATIVE_EXPERIENCE_PARITY_V1=BASELINE_COMPLETE_TARGET_NOT_IMPLEMENTED` — this tree adds the
  **baseline only**: [native-experience-parity-v1.md](./native-experience-parity-v1.md) (the
  parity vocabulary, the four surface baselines OPENAI_API / ANTHROPIC_API / CODEX / CLAUDE_CODE,
  the PRODUCT_ONLY UX reference, findings, residual classification and implementation waves),
  [ai-conversation-continuity-v1.md](./ai-conversation-continuity-v1.md) (the P0 conversation
  continuity DESIGN spec — `CONVERSATION_PERSISTENCE=NOT_IMPLEMENTED`, no migration, no route,
  no runtime change), and the machine-readable manifest
  [generated/native-experience-parity-v1.json](./generated/native-experience-parity-v1.json)
  (248 capability rows at research snapshot 2026-08-21), validated by `pnpm docs:parity:check` /
  canonicalized by `pnpm docs:parity:format` and enforced in the default unit lane
  (`scripts/lib/parity-core.test.ts`, `scripts/native-experience-parity-manifest.test.ts`).
- **No provider capability was implemented, no residual was fixed, and no governance semantics
  changed in this movement.** The baseline records (it does not alter) the open findings it
  proved, including **TOOL-TAXONOMY-DRIFT-2026-08**: the computer-use guardrail matches the
  legacy tool-type/beta-header shapes, while the providers' 2026 GA computer-use/browser-use
  shapes would classify `typed_unknown` and forward under the observe doctrine — registered as a
  `BLOCKER_BEFORE_PARITY_IMPLEMENTATION` for that capability class (P7), with the beta-policy
  snapshot staleness residual R6 now demonstrably material.
- `AI_CONSOLE_V1=COMPLETE_UNCHANGED`; `FOUNDATION_V1=UNCHANGED`; `WORKROOM=SEMANTICALLY_SEPARATE`
  (the Conversation ≠ Workroom adjudication is recorded in the continuity spec §4);
  `NEXT_IMPLEMENTATION_MISSION=EP-AI-CONVERSATION-CONTINUITY-V1-01` (source-adjudicated candidate
  scope in native-experience-parity-v1.md §10; its P0-A1 movement is implemented in this tree —
  see the next section).

### EP-AI-CONVERSATION-CONTINUITY-V1-01 — P0-A1 canonical state (this tree)

- `EP_AI_CONVERSATION_CONTINUITY_V1=IMPLEMENTATION_IN_PROGRESS`;
  `P0_A1_STORAGE_SECURITY_FOUNDATION=IMPLEMENTED_AND_INDEPENDENTLY_CONFIRMED`;
  `PR140=MERGED_AND_VERIFIED` (squash merge; the merge commit's tree is byte-identical to
  the final independently reviewed technical tree). Review arc: independent Opus 5 Max
  audit of head `ff08a8ea` (KMS/RLS/lineage/migration-safety PASS; three P2 MATERIAL
  integrity classes C1/C2/C3) → exact-head confirmation at `0fc69aa2` (closed C2, C3 and
  ten of eleven C1 manifestations; ONE residual — P0A1-C1-R, the post-boundary causal
  freeze) → final narrow C1-R remediation and final Opus exact-head confirmation at
  head `5d786bc913463d145a9284011886bca0721e4d99`
  (tree `718943ccc84e39724a295e11a7a2dc8ebe440428`): C1=PASS, C2=PASS, C3=PASS,
  P0=0, P1=0, P2_MATERIAL=0 — `OPUS_5_MAX_P0_A1_FINAL_CONFIRMATION=PASS`.
  Codex review `UNAVAILABLE_DUE_TO_QUOTA` (quota-limit notices only — NOT a clean review);
  the independent Opus lane is the documented compensating review control
  (`PR140-CODEX-UNAVAILABLE-OPUS-INDEPENDENT-COMPENSATION-01`,
  `PROCESS_CONTROL_SUBSTITUTION` — not a finding waiver).
  `P0_A2_WORKER_TRUST_RECOVERY_DISCOVERY=COMPLETE` (see the P0-A2 section below — the exact
  independently reviewed tree landed on main, and the movement is recorded as complete only
  because that review returned PASS);
  `CONVERSATION_CONTINUITY_ARCHITECTURE=SPECIFIED_IMPLEMENTATION_IN_PROGRESS`;
  **`CONVERSATION_PERSISTENCE=NOT_IMPLEMENTED`** — there is still no durable user-facing
  Send/hydrate/reload path; the AI Console transcript remains memory-only
  (`apps/ui/tests/ai/persistence.test.tsx` unchanged and truthful). No parity-manifest row
  changed classification: storage primitives are not user/provider capability.
- What P0-A1 actually shipped (movement
  `P0-A1-OPERATIONAL-STORAGE-CRYPTO-OWNER-RLS-FOUNDATION-01`):
  - **Migration `0031_ai_conversation_storage_foundation.sql`** — eight `ai_*` tables
    (`ai_conversations`, `ai_conversation_branches`, `ai_conversation_turns`,
    `ai_conversation_attempts`, `ai_conversation_items`, `ai_conversation_content`,
    `ai_conversation_provider_state`, `ai_conversation_evidence_links`), all with
    dual-predicate FORCE RLS (`app.org_id` AND `app.user_id`), composite-lineage FKs
    (no pointer by id alone; `current_attempt_id` is a DEFERRABLE composite FK; the fork pin
    is one composite FK to a specific attempt), guard triggers realizing §7's PHYSICS
    (identity/lineage frozen; FULL-ROW terminal freeze — a terminal attempt is never
    mutated; `outcome_unknown` closed probe resolution; write-once
    provenance/request/capture identity + write-once dispatch boundary; the POST-BOUNDARY
    CAUSAL FREEZE — `causal_version_at_build` + the `continuation_parent_*` anchor are
    frozen once `state <> 'accepted'`, keyed on the state edge so the §9.4
    restore→rebuild→re-cross re-stamp stays lawful; a §7.1b attempt
    BIRTH guard; the §7 forward transition graph with `dispatching → accepted` gated on
    provenance ABSENCE — the durable no-POST proof; provider-state ratchets — taint never
    clears, `superseded` is final with a frozen payload; the conversation lifecycle ratchet
    — no edge out of `deleted_pending`/`deleted`), the §7 state × authority × provenance
    CHECK implication matrix (with `B` = boundary committed and `P` = credential provenance
    defined in-schema: `completed⟹B∧P`, `streaming⟹P`, `outcome_unknown⟹P`, `accepted⟹¬P`,
    `capture⟹request`, `request⟹B`, `error_class⟹failed`; `rejected` deliberately carries
    no universal B/P rule — §7 admits pre- and post-boundary rejection), an 8-column
    evidence-identity composite FK binding each evidence link to its attempt's OWN
    `{govai_request_id, capture_id}`, and an additive `(org_id, id)` UNIQUE key on
    `govai.provider_credentials` for org-composite credential provenance. Grants:
    `govai_app` SELECT+INSERT only.
  - **KMS purpose isolation** (`packages/core-identity`): new purposes `conversation_content`
    (envelope) + `conversation_content_integrity` (keyed digest); `envelopeEncrypt`/
    `envelopeDecrypt` accept an optional narrow `KmsEnvelopePurpose` — omitted purpose is
    byte-identical to the historical `payload_dek` behavior in BOTH DevKms and AwsKms (legacy
    ciphertext unaffected; cross-purpose decrypt fails closed).
  - **Owner-scoped tenant context** (`packages/core-tenant`, additive): `setLocalAppUserId` /
    `clearAppUserId` / `withOwnerContext` (transaction-local `set_config`; commit/rollback
    clear; UUID-validated). `withTenant` org-only semantics unchanged.
  - **Security test matrix** (`tests/integration/ai-conversation-*.test.ts`): RLS A–G matrix
    (same-org cross-owner negative proof, cross-org, missing/partial/no context, WITH CHECK),
    §29 lineage falsification, guard-trigger ratchets, cross-org credential provenance
    rejection, owner-context lifecycle + pooled-connection leak proof, and an encrypted-row
    proof (ciphertext at rest; digest is keyed HMAC, provably not `sha256(plaintext)`).
- Deliberately NOT in P0-A1 (later movements): worker identity + recovery discovery (P0-A2 —
  now `COMPLETE`: independently confirmed and landed on main, see the P0-A2 canonical section
  below), HTTP routes/Send/claims/runner/SSE/Stop/retry/fork, delete-protocol execution, provider
  adapters, attachments (`ai_conversation_attachments`) and the disposal ledger
  (`ai_provider_disposal_ledger`). **Deferred pointers, recorded:** `project_id` (Projects do
  not exist; an unconstrained pointer is forbidden) and `workroom_id` attribution
  (`govai.workrooms` has an id-only PK — no existing `(org_id, id)` composite identity to
  bind). Carry-forward acceptance notes: final Opus R-1 (provenance-absent lifecycle branching
  must serialize on the conversation root, §7.7 pattern); AUTH-READ-CACHE-01
  (`Cache-Control: no-store` on conversation reads from day one of P0-B); P0A1-C4 (fork-pin
  mode-specific STATE validity is a P0-B acceptance obligation: `after_attempt` pin must be
  `completed`; `before_attempt_output` pin must be an immutable terminal; `outcome_unknown`
  rejected in both modes; no non-terminal pin); and P0A1-C5 (`current_attempt_id` backward
  repoint — monotonic handoff is a P0-B acceptance proof if not taken structurally).
  **★ UPDATED BY P0-B (candidate, this tree):** all three of those forward obligations are
  DISCHARGED by the P0-B candidate below — AUTH-READ-CACHE-01 for the conversation surface,
  P0A1-C4 and P0A1-C5 both taken STRUCTURALLY in migration 0033 rather than as service checks
  alone. The three entries above are retained as the historical P0-A1 record; the P0-B canonical
  section is the current state, and it is a CANDIDATE state pending independent confirmation.

### EP-AI-CONVERSATION-CONTINUITY-V1-01 — P0-A2 canonical state (this tree)

- `P0_A2_WORKER_TRUST_RECOVERY_DISCOVERY=COMPLETE` — implemented by movement
  `P0-A2-DETACHED-WORKER-TRUST-RECOVERY-DISCOVERY`, base
  `8f3d250538b14cc3260715db8d1b081dc0e9cec8`, technical PR **#143**, reviewed head
  `ef7eba75673f04f35bf54e9c76262ee6da0c1790` (tree
  `0ac5efba171930cac0e0553bc8767e2c2f80df0b`), squash-merged to main as
  `dc0b827b3bdc2eaf4e6864f32690c34f3d0b0148` — whose tree IS that reviewed tree, byte for byte,
  so what landed is exactly what was audited. COMPLETE is written here only because
  `OPUS_5_MAX_P0_A2_FINAL_CONFIRMATION=PASS` closed the exact-head independent review; it is a
  record of that review, not a claim made on the executor's own authority.
  `P0_A1=COMPLETE` and `T1=COMPLETE` are unchanged.
- **Codex review arc.** `CODEX_REVIEW=EXECUTED` on head `a837ce5a` (PR #143): **2 × P2**, both
  materially valid, both remediated on the follow-up head — (W1) the worker pool validated that a
  dedicated env var existed but never proved which database role the URL actually authenticated
  as, so an admin/superuser credential wired into `GOVAI_CONVERSATION_WORKER_DATABASE_URL` would
  have run discovery and owner-bound reads while bypassing the very FORCE RLS boundary the module
  exists to establish; and (W2) the post-commit session sweep declared a never-fail contract that
  `pg_terminate_backend` could break with `42501`, aborting a migration run AFTER the NOLOGIN had
  already committed and skipping every remaining schema migration. Both were falsified against the
  reviewed source before the fix and re-verified after; both threads are resolved and
  `CODEX_ACTIVE_MATERIAL_THREADS=0`. Codex is a review lane, not the independent exact-head
  audit, so it was never treated as the PASS.
- **Independent exact-head review: `INDEPENDENT_REVIEW=PASS`.** A fresh Opus 5 Max read-only
  auditor — a different session from the executor, with no authorship stake — reviewed head
  `ef7eba75673f04f35bf54e9c76262ee6da0c1790` / tree
  `0ac5efba171930cac0e0553bc8767e2c2f80df0b` and returned
  `OPUS_5_MAX_P0_A2_FINAL_CONFIRMATION=PASS` with `P0=0`, `P1=0`, `P2_MATERIAL=0`,
  `P2_NON_MATERIAL=0`, `P3=5`. All twenty-four subsystem verdicts PASS, including worker
  identity separation, runtime identity attestation, `SECURITY DEFINER` hardening and its
  shared-owner blast radius, definer RLS policy narrowness, worker column-privilege
  minimization, discovery content minimization and side-effect freedom, cross-candidate context
  isolation, the W2 deprovision sweep, and P0-A1 / T1 regression. Exact-head CI on the reviewed
  head: run `32815554924`, attempt 1, `unit` / `integration` / `ui` all success. The audit
  artifact lives outside the repository at
  `/Users/Shared/govai-handoff/audits/ai-conversation-continuity-v1/p0a2-worker-trust-discovery/OPUS-5-MAX-P0-A2-INDEPENDENT-EXACT-HEAD-REVIEW-PR143-ef7eba75.md`
  (SHA-256 `b44200c814e69113bee5f0404247d8a4170d075ec42ea8d92502bbec61f0306f`).
- **Five P3 carry-forwards from that review, open by design — none was fixed, because fixing one
  would have moved a tree that had already been reviewed.** (P0A2-P3-A1) checked-out pg-pool
  clients carry no per-client `error` listener; unreachable today because no worker process
  constructs the pool, and therefore a **gate: it MUST be adjudicated and implemented before the
  first real conversation-worker runtime activation**. (P0A2-P3-A2) `govai_audit_writer`, as
  table owner, can read all columns of the live claim-plane rows the three new definer policies
  admit — bounded and non-escalating under current role reachability; no tenant or application
  path reaches it. (P0A2-P3-A3) the 0031 test's app-policy role filter is substring-based; test
  precision only. (P0A2-P3-A4) `createConversationWorkerPool` returns a bare `pg.Pool`, so a
  FUTURE caller could call `pool.query` directly and bypass the attested helpers — no current
  production caller, but **reconsider an opaque / module-private worker DB handle before
  expanding worker runtime callers**. (P0A2-P3-A5) runtime attestation validates role attributes
  but not membership drift; `NOINHERIT` blocks implicit privilege and `SET ROLE` changes
  `current_user` and is rejected, so there is no current attack path — optional future
  hardening.
- What P0-A2 actually shipped:
  - **Role `govai_conversation_worker`** in `infra/postgres/bootstrap.sql` — roles are
    cluster-level and are never created in migrations (the 0028 rule). `NOINHERIT`,
    **NOLOGIN until explicitly provisioned**, never superuser, never `BYPASSRLS`, owns no
    relation or routine, holds no schema `CREATE`. Its LOGIN follows the SAME five-way
    lifecycle the evidence enumerator uses (`govai.conversation_worker_password` /
    `govai.conversation_worker_deprovision`; provision / rotate / declarative disable /
    leave-untouched / two fail-loud contradiction cells), realized ONCE in
    `applyPrivilegedRoleLifecycles` and shared by the production runner
    (`apps/api/src/db/migrate.ts`) and the integration runner (`tests/integration/setup.ts`)
    so the two cannot drift.
  - **Migration `0032_ai_conversation_worker_trust_discovery.sql`** —
    `govai.ai_turn_recovery_candidates(p_recovery_grace_ms, p_limit, p_after_created_at,
    p_after_attempt_id)`: SECURITY DEFINER, `STABLE`, fixed `search_path = pg_catalog,
    pg_temp`, owned by `govai_audit_writer` (NOLOGIN — reachable only through the definer),
    no dynamic SQL, `REVOKE ALL FROM PUBLIC`, EXECUTE granted to the worker and to NOBODY
    else. It returns eleven content-free claim-plane columns
    (`org_id, owner_user_id, conversation_id, turn_id, attempt_id, state, reason, claim_token,
    claim_deadline_at, is_branch_head, attempt_created_at`) — no title, ciphertext, wrapped
    DEK, digest, native request config, provider object id, continuation anchor, credential
    provenance or audit payload — and is bounded, keyset-cursor paged
    (`(attempt_created_at, id)`, no OFFSET), deterministic on a static dataset and
    side-effect-free (it never claims, rotates a token, touches a deadline or heartbeat,
    transitions a state or bumps `causal_version`).
  - **Source-adjudicated candidate arms** (spec §7.7 / §8, nothing invented): `queued_head`
    (`accepted` + UNCLAIMED + head of its branch queue — NOT deadline-gated),
    `accepted_lease_expired` (`accepted` + claimed + lease elapsed; no grace, because the
    dispatch-boundary CAS's own `deadline > now()` already fences the stalled owner),
    `dispatching_lease_expired` and `streaming_lease_expired` (post-boundary lease elapsed past
    `deadline + δ`). Roots must be EXECUTION-ELIGIBLE (`active`/`archived`), written in the
    positive form so a future status fails CLOSED.
  - **Deliberately NOT discoverable at this movement, each with its reason:** `outcome_unknown`
    (its one lawful resolution is the §7.7/§8 provider recovery PROBE, which needs the recorded
    dispatch credential and the continuation anchor — both forbidden in the result — and a
    provider call); roots in `deleted_pending`/`deleted` (§19.1 deletion fencing excludes them
    from every new claim, and the only lawful sweep arm there is §19.2's stop-ratchet, which is
    lifecycle work this movement does not implement); a non-head unclaimed `accepted` turn (§8
    branch-order — queued, not stranded); every terminal state.
  - **The definer's own visibility is narrow, not blanket.** `ai_*` is FORCE RLS, so a definer
    owned by the table owner sees only what a `TO govai_audit_writer` policy admits (the 0029
    §H / 0025 precedent). 0032 adds exactly three SELECT policies: attempts restricted to
    NON-TERMINAL rows, and turns/conversations restricted to those belonging to a branch /
    conversation that still holds one. `ai_conversation_branches`, `_items`, `_content`,
    `_provider_state` and `_evidence_links` get NO definer policy at all — the privileged path
    cannot read encrypted content in any form. The narrowing is a live predicate: when an
    attempt ratchets terminal, the owner role's visibility of its conversation disappears.
  - **Worker least privilege = CURRENT privilege.** COLUMN-scoped `SELECT` (the 0028 precedent)
    on three tables only — `ai_conversations (id, org_id, owner_user_id, status)`,
    `ai_conversation_turns (… client_turn_id, turn_seq, current_attempt_id …)` and
    `ai_conversation_attempts` (lineage, state, the lease triple + heartbeat, the durable stop
    flag, the boundary marker) — each with a worker policy carrying 0031's EXACT dual owner
    predicate. TABLE-level SELECT is false even there, so `SELECT *` is denied and a column
    added later is not silently readable. The worker holds NO `INSERT`/`UPDATE`/`DELETE`/
    `TRUNCATE` anywhere, no privilege on `provider_credentials`, `audit_events`, `runs` or
    `orgs`, and EXECUTE on exactly ONE SECURITY DEFINER function. The conceptual full worker
    matrix of spec §9 (claim UPDATE, item/content INSERT, provider-state mutation, credential
    SELECT, audit-capture EXECUTE, branch causal UPDATE, purge DELETE) is deliberately NOT
    pre-granted.
  - **Live database identity attestation (W1 remediation).** Configuration proves nothing about
    what a connection authenticated as, and an RLS bypass produces MORE rows rather than an
    error — so it fails silently and greenly. `assertConversationWorkerIdentity` therefore asks
    PostgreSQL itself, on an AWAITED path that gates every use: `session_user` (the authenticated
    login — catches an admin credential that then did `SET ROLE`), `current_user` (the effective
    role), and `rolsuper` / `rolbypassrls` / `rolinherit` read from `pg_roles`. It runs BEFORE
    `ai_turn_recovery_candidates` and BEFORE any owner context is entered, per CHECKOUT rather
    than once per pool, so privilege DRIFT is caught too. Failure is a typed
    `ConversationWorkerIdentityError` carrying role names and boolean attributes only — never a
    connection string or password. Falsified on the pre-fix source: an admin URL returned 2
    candidates across 2 orgs and an owner-A-context read saw 2 conversations instead of 1.
  - **Post-commit sweep never-fail contract, enforced (W2 remediation).** `sweepRoleSessions` now
    catches and logs failures of the signalling and counting layer with a sanitized SQLSTATE
    label. Empirically confirmed: a non-superuser that is not a member of `pg_signal_backend` DOES
    see the target's `pg_stat_activity` rows and CANNOT signal them, so the sweep finds work and
    raises `42501`. The swallow is deliberately narrow — bootstrap, the deprovision DDL, signal
    validation and the migration SQL all keep propagating. Applies to BOTH
    `govai_evidence_enumerator` (a pre-existing latent defect on that path) and
    `govai_conversation_worker`, since the implementation is shared.
  - **Owner-context entry**, reusing P0-A1's `withOwnerContext` semantics:
    `withConversationWorkerOwnerContext` does checkout → defensive SESSION-scope reset → BEGIN →
    BOTH GUCs `set_config(..., true)` → ordinary SQL under FORCE RLS → COMMIT/ROLLBACK (either
    clears the context). The reset lives at CHECKOUT, not on pg's `connect` event, because pg
    does not await a connect handler and the leak being defended against is per-checkout of a
    REUSED connection. Owner identity may originate ONLY from a discovery row — never from an
    HTTP request; P0-A2 exposes no route, and the invariant is documented at the helper. The
    attestation runs FIRST, before the reset and before any owner GUC is set. A client whose
    ROLLBACK failed is destroyed rather than pooled — defense in depth, since falsification showed
    a connection left mid-transaction still leaks nothing (the next entry's explicit `set_config`
    overwrites the context before any read).
  - **Inert runtime layer** (`apps/api/src/pipeline/ai-conversation-worker.ts`,
    `ai-conversation-recovery-discovery.ts`): a dedicated pool factory reading
    `GOVAI_CONVERSATION_WORKER_DATABASE_URL` that FAILS CLOSED with no fallback to the API's
    credential, plus `discoverRecoveryCandidates` / `nextDiscoveryCursor` /
    `loadOwnedRecoveryCandidate`. Nothing calls them at API startup: no route, no timer, no
    daemon, no sweep, no provider call.
  - **Security test matrix**: `tests/integration/ai-conversation-worker-trust.test.ts` (W1–W14 —
    role attributes, `govai_app` denied EXECUTE and denied `SET ROLE` by any membership path,
    PUBLIC denied, zero-rows-without-context, the owner dual-context matrix, same-connection
    cross-candidate leak proof, the privilege matrix, definer hardening, column-grant denials,
    the `govai_app` RLS regression, the fail-closed pool factory, and — from the remediation —
    W15–W21: the attestation passing on a correct pool, a `govai_app` URL and an admin URL each
    REJECTED before discovery with the counterfactual proving the gate load-bearing, BYPASSRLS /
    SUPERUSER / INHERIT drift rejected, no credential material in the error, a REAL `42501`
    surviving, and the ROLLBACK-disposition falsification),
    `ai-conversation-recovery-discovery.test.ts` (D1–D10 — cross-owner/cross-org discovery
    without BYPASSRLS, the full candidate predicate matrix, the PINNED content-free return
    shape, side-effect freedom against a whole-table digest, keyset pagination including an
    identical-`created_at` tie-breaker dataset, fail-closed bounds, head-of-queue rules and
    owner-bound resolution) and `ai-conversation-migration-0032.test.ts` (M1–M6 — byte-identical
    row preservation on a populated 0031 database, guard-trigger regression, `govai_app`
    unchanged, re-runnability, fail-loud on an absent role, and an exact inventory of what the
    migration adds), plus `apps/api/src/db/migrate.test.ts` (11 unit contract tests pinning the
    sweep's never-fail behaviour for BOTH privileged roles).
- **`AI_CLEANUP_CANDIDATE_DISCOVERY=DEFERRED_UNTIL_CLEANUP_SCHEMA_EXISTS`** — the spec's SECOND
  sanctioned bypass (`govai.ai_cleanup_candidates`) reads cleanup/disposal-ledger storage that
  0031 explicitly did not create and that does not exist at this anchor. P0-A2 ships NO
  placeholder: an always-empty function would falsely read as implemented. Asserted in DB by
  test D10.
- Deliberately NOT in P0-A2, and unchanged by it: `RECOVERY_CLAIM_MUTATION=NOT_IMPLEMENTED`,
  `RECOVERY_STATE_MACHINE_EXECUTOR=NOT_IMPLEMENTED`, `WORKER_RUNNER_LOOP=NOT_IMPLEMENTED`,
  `PROVIDER_DISPATCH_FROM_WORKER=NOT_IMPLEMENTED`, `QUEUE_WAKE_PROCESS=NOT_IMPLEMENTED`,
  `PROVIDER_CLEANUP_WORKER=NOT_IMPLEMENTED`,
  **`CONVERSATION_PERSISTENCE=NOT_IMPLEMENTED`** (no durable user-facing Send/hydrate/reload
  path; the AI Console transcript is still memory-only). ★ TWO of the tokens that stood here
  were forward statements about the NEXT movement and are superseded by the P0-B canonical
  section below: `CONVERSATION_HTTP_API=NOT_IMPLEMENTED` and `P0_B=NOT_STARTED` are no longer
  true of this tree (a control-plane candidate exists; durable send still does not). Everything
  else in this P0-A2 list is unchanged and remains true. A worker PROCESS is
  not implemented either: `WORKER_RUNTIME_PROCESS=NOT_IMPLEMENTED` and
  `WORKER_RUNTIME_POOL_ACTIVATION=DEFERRED_TO_FIRST_WORKER_PROCESS` — the credential lifecycle
  and the pool factory exist, but nothing constructs a worker pool at runtime. No
  parity-manifest row changed classification: a trust boundary is not user/provider capability.
- Carry-forwards untouched by P0-A2 (open AT P0-A2): P0A1-C4, P0A1-C5, the provider-sourced
  rejection discriminator, AUTH-READ-CACHE-01, P0-A1 P3a–P3d, the T1 acceptance-stack residual
  and its five P3 observations, and `LATENT_AUTH_LIFECYCLE_DESIGN_RISK=OPEN_R14`.
  ★ UPDATED BY P0-B (candidate): P0A1-C4 and P0A1-C5 are CLOSED STRUCTURALLY by migration 0033,
  and the AUTH-READ-CACHE-01 obligation is met FOR THE CONVERSATION SURFACE (the class itself
  stays open — the four pre-existing authenticated read surfaces are untouched). The
  provider-sourced rejection discriminator, the P3 sets and the R14 risk are carried forward
  UNCHANGED; the five P0-A2 P3 items are restated in the P0-B section, including P0A2-P3-A1's
  status as a MANDATORY GATE before the first worker runtime activation.

### EP-AI-CONVERSATION-CONTINUITY-V1-01 — P0-B canonical state (this tree)

- `P0_B_CONVERSATION_CONTROL_PLANE=IMPLEMENTED_PENDING_INDEPENDENT_CONFIRMATION` — implemented by
  movement `P0-B-CONVERSATION-CONTROL-PLANE-01` on base
  `e6eb886dab68d953fab7114687fae8d34c639e0a` (tree `6be1b724739d209fa754ff380446275967f54ab4`).
  **This status is deliberately NOT `COMPLETE`.** COMPLETE is written only after an independent
  exact-head audit passes and the candidate merges — the discipline P0-A1 and P0-A2 both
  followed. Nothing below is asserted on the executor's own authority beyond "this is what the
  tree contains and what its tests prove".
- **What P0-B is, stated precisely.** The owner-authorized CONVERSATION CONTROL PLANE: the
  request-side surfaces that can exist safely WITHOUT activating durable provider execution.
  It is not the conversation experience. After this movement:
  ```
  CONVERSATION_CONTROL_PLANE  = CANDIDATE_IMPLEMENTED
  CONVERSATION_PERSISTENCE    = NOT_IMPLEMENTED
  ```
  and the second line is the load-bearing one: there is still no complete user-facing
  `Send → durable accepted turn → server-owned execution → hydrate/reload` path, and the AI
  Console transcript remains memory-only by construction (its acceptance test is unchanged).
- **What P0-B actually shipped:**
  - **Migration `0033_ai_conversation_control_plane.sql`** — three things and no more.
    (a) The MINIMUM request-plane authority: COLUMN-scoped `UPDATE` for `govai_app` on exactly
    eight columns of `ai_conversations` (`status`, `archived_at`, the five encrypted-title
    columns, `updated_at`) plus one dual-predicate UPDATE policy. TABLE-level UPDATE stays
    FALSE, so a column added by a later migration is not silently writable, and
    `retention_class` — which 0031's guard trigger would tolerate — is deliberately excluded
    because no P0-B contract mutates it. No DELETE anywhere. No TRUNCATE. Not one grant, policy
    or EXECUTE for `govai_conversation_worker`: P0-C's needs are not pre-granted.
    (b) `govai.ai_conversation_fork_idempotency` — the fork arbiter, the 0030 `run_idempotency`
    composite-PK pattern (`PRIMARY KEY (org_id, conversation_id, client_fork_id)`,
    `INSERT … ON CONFLICT DO NOTHING RETURNING`), immutable by privilege (SELECT+INSERT only)
    AND by trigger, RLS ENABLE+FORCE with the same dual owner predicate, and LAW 1 composite
    binding to its branch. Adjudicated AGAINST columns on the branch row: 0031's branches guard
    is a positive whitelist, so added columns would fall OUTSIDE the frozen set and become
    silently mutable under any future UPDATE grant.
    (c) The two P0-A1 carry-forward closures, both STRUCTURAL.
  - **`P0A1-C4=CLOSED_STRUCTURALLY`** — fork-pin MODE-SPECIFIC state validity (spec §3), as a
    `BEFORE INSERT` trigger on `ai_conversation_branches`: `after_attempt` requires a
    **`completed`** pin; `before_attempt_output` accepts any IMMUTABLE TERMINAL pin
    (`completed|stopped|failed|rejected`); `outcome_unknown` is refused in BOTH modes because
    §7.6 lets a probe still resolve it, so it is not immutable. The trigger enforces the STATE
    predicate only and defers LINEAGE to 0031's composite fork FK over the identical tuple —
    it does not duplicate, pre-empt or restate an invariant 0031 already owns. The service
    enforces the same matrix so the client gets a `409 fork_source_not_forkable` naming its own
    attempt's state instead of a bare 500.
  - **`P0A1-C5=CLOSED_STRUCTURALLY`** — `current_attempt_id` MONOTONIC HANDOFF, as a
    `BEFORE UPDATE` trigger on `ai_conversation_turns`, ordered by `attempt_seq` and never by
    uuid value. Value-identical assignment is a no-op; the INITIAL `NULL → attempt` assignment
    stays lawful and unrestricted (0031's composite FK is the authority there, and pre-empting
    it would break the sanctioned `SET CONSTRAINTS … DEFERRED` mint); clearing to NULL, every
    backward repoint and every handoff whose target cannot be resolved in THIS turn's lineage
    are rejected. Retry does not exist yet — the invariant is closed now so it cannot later
    acquire unsafe freedom.
  - **Five routes, and no stubs** (`apps/api/src/routes/ai-conversations.ts`):
    `POST /v1/ai/conversations` (conversation + its ONE root branch, atomically — the branch is
    the durable owner of the executing triple, §3), `GET /v1/ai/conversations` (owner-scoped,
    keyset-paged `(updated_at DESC, id DESC)`, page ≤ 50, no OFFSET, bounded per-page title
    decryption, archived hidden by default), `GET /v1/ai/conversations/:id`,
    `PATCH /v1/ai/conversations/:id` (§13's two guarded fields — `title`, `archived` — and
    nothing else), and `POST /v1/ai/conversations/:id/branches`. The forbidden P0-C/P0-E
    endpoints are NOT registered even as placeholders: an unimplemented future endpoint stays
    nonexistent rather than returning a misleading shape.
  - **`AUTH-READ-CACHE-01` for the conversation surface**: `Cache-Control: no-store` on EVERY
    response of the plugin, installed by an encapsulated `onRequest` hook so it is present on
    success, on an authenticated 404, on a validation 400, on a 401 and on a 500 alike. The
    CLASS is not closed by this movement — `/v1/evidence/summary`, `/v1/evidence/gaps`,
    `/v1/audit-events` and `/v1/capabilities` are untouched — but conversations join it already
    closed rather than enlarging it. Registered limitation: the app-level rate limiter's 429 is
    produced by a root-level hook that runs before this plugin's context and does not carry the
    header; that body carries no tenant data.
  - **Titles are encrypted at rest, with a KEYED digest** (§6/§18): envelope under the
    `conversation_content` KMS purpose, digest under `conversation_content_integrity`, key
    id/version persisted per row (`ai-conversation-content-v1`, v1). There is no plaintext
    title column to misuse; the digest is provably NOT `sha256(plaintext)`; cross-purpose
    decryption fails closed. Manual rename is the only writer — no provider-generated title,
    and no provider call to make one.
  - **The fork control plane** pins a SPECIFIC IMMUTABLE ATTEMPT through its full composite
    lineage (never a turn alone), records the child branch's own durable `provider/surface/model`
    (omitted fields inherit the parent branch, per field), and is IDEMPOTENT under a
    client-supplied `client_fork_id` carried in the BODY — no existing idempotency header is
    overloaded and `X-GovAI-Client-Turn-Id` is not minted. Same key + same intent replays the
    one branch (HTTP 200 + `x-govai-ai-fork-idempotent-replay`); same key + any divergent intent
    axis is a static `409 fork_idempotency_key_conflict`. The intent hash is a LOCAL, frozen
    canonicalization (`govai.ai_conversation_fork_intent.v1`) — never the evidence
    canonicalization, and deliberately a separate function from run idempotency's so the two
    contracts can move independently. It hashes the RESOLVED triple, so "omit it" and "state the
    value the parent already has" are correctly the SAME fork.
  - **`before_attempt_output`** mints the regeneration child in the SAME transaction: the child
    turn, a CIPHERTEXT-ONLY copy of the source turn's immutable native request config and of its
    TURN-OWNED user items (never the attempt-owned output the mode excludes by definition), and
    a fresh initial attempt with `current_attempt_id` already set via the sanctioned
    `SET CONSTRAINTS … DEFERRED` mint — which is why the control plane needs NO UPDATE authority
    on `ai_conversation_turns` at all. The attempt is born `accepted` and UNCLAIMED: not claimed,
    not dispatched, not queued, not woken.
  - **LAW 10 and LAW 16 are realized, not asserted.** Every fork takes (1) the conversation-root
    row lock, REVALIDATES lifecycle under it, then (2) the parent branch's advisory execution
    authority (`ai_conversation_branch:<id>`, exported so P0-C reuses the identical key rather
    than minting a second locking domain), then (3) the turn/attempt writes the mode requires.
    The check-then-write race is impossible, and both lock orderings are proven by forced
    interleaving. `archived` IS execution-eligible — §19.1 admits both `active` and `archived`
    as deletion origins, and only `deleted_pending` closes a conversation to new work.
- **Adjudicated bound, stated rather than hidden — `P0B-FORK-BAO-TRIPLE-SWITCH=DEFERRED`.** A
  `before_attempt_output` fork that CHANGES `provider`/`surface`/`model` is REJECTED with
  `409 fork_replacement_config_required`. §3 says such a fork must supply a replacement native
  request config valid for the target or be REJECTED as incompatible, and must NEVER be silently
  translated. P0-B accepts no replacement config: the native request body is the durable-send
  surface (P0-C, explicitly out of scope), and no provider-native request validator exists in
  the tree to prove a supplied config "valid for the target provider" — storing an unvalidated
  blob and calling it a valid immutable config would be an overclaim. This movement therefore
  takes the architecture's OWN rejected branch. Same-provider regeneration — the case §7.6
  actually needs — is fully implemented. `after_attempt` cross-provider and model-switch forks
  are unaffected: they mint no child turn, so no config question arises.
- **Deliberately NOT in P0-B, and unchanged by it:** `POST /v1/ai/conversations/:id/turns`,
  turn hydration, the stream re-attach endpoint, retry, Stop, `DELETE` and the whole §19 delete
  protocol, durable Send / `client_turn_id` reservation, queue execution and wake, claim
  creation/mutation, lease/heartbeat/fencing, dispatch-boundary execution, worker runner loop
  and sweeps, recovery mutation, provider credential resolution for dispatch, every provider
  POST/stream/continuation, provider cleanup, the disposal ledger, `ai_cleanup_candidates`,
  turn↔evidence correlation, AuditBridge or audit-schema change, run-chain events, persistent
  AI workspace UI, deep links, browser conversation storage, Projects, Workroom-as-chat,
  attachments, full-content search, provider-generated titles, retention automation, production
  human auth (R14). `WORKER_RUNTIME_PROCESS=NOT_IMPLEMENTED`,
  `WORKER_RUNTIME_POOL_ACTIVATION=DEFERRED`, `RECOVERY_CLAIM_MUTATION=NOT_IMPLEMENTED`,
  `RECOVERY_STATE_MACHINE_EXECUTOR=NOT_IMPLEMENTED`, `PROVIDER_DISPATCH_FROM_WORKER=NOT_IMPLEMENTED`,
  `QUEUE_WAKE_PROCESS=NOT_IMPLEMENTED`, `PROVIDER_CONTINUATION=NOT_IMPLEMENTED`,
  `PERSISTENT_AI_WORKSPACE_UI=NOT_IMPLEMENTED`, `PROVIDER_EXACTLY_ONCE=NOT_CLAIMED`,
  `P0_C=NOT_STARTED`. No parity-manifest row changed classification: a control plane is not
  provider capability.
- **Test matrix** (`tests/integration/ai-conversation-*.test.ts` + the pure unit suites under
  `apps/api/src/ai-conversations/`): migration 0033 against a POPULATED 0031+0032 database
  (byte-identical row preservation, re-runnability, the exact grant/policy inventory, an
  unchanged worker privilege fingerprint, FORCE RLS everywhere, 0031/0032 unmodified);
  create/list/get/patch including the same-org cross-owner and cross-org negative proofs, the
  `no-store` header on ten response classes, keyset pagination through an identical-`updated_at`
  dataset that forces the tie-breaker, the page cap, and title encryption end to end; the FULL
  C4 matrix (8 states × 2 modes) at BOTH the service and database layers; the C5 matrix
  including uuid-order independence; fork lineage falsification; fork idempotency including a
  concurrent burst and every conflict axis; LAW 10 in both orderings with the fork forced to
  BLOCK on the root; LAW 16 proven by observing which lock is held while the fork waits; and a
  P0-C NEGATIVE BOUNDARY suite proving zero forbidden routes, zero provider requests during a
  full control-plane exercise, zero claimed or post-boundary attempts, and — over
  comment-stripped source — zero dispatch/worker/claim/queue/timer/notification constructs.
- **Carry-forwards, all preserved and none silently closed:** `P0A2-P3-A1` (checked-out pg
  clients carry no per-client `error` listener) remains a **MANDATORY GATE BEFORE THE FIRST REAL
  CONVERSATION-WORKER RUNTIME ACTIVATION** — P0-B activates no worker, so it is not fixed here
  and must reach P0-C's preflight intact; `P0A2-P3-A4` (`createConversationWorkerPool` returns a
  bare `pg.Pool`; reconsider an opaque module-private handle before worker runtime callers
  expand) — P0-B adds no such caller; `P0A2-P3-A2`, `P0A2-P3-A3` and `P0A2-P3-A5` keep their
  existing classifications. The **provider-sourced rejection discriminator** stays OPEN and is
  deliberately NOT closed cosmetically: P0-B exposes no durable turn hydration or execution, so
  the distinction is not yet material, and inventing a column or HTTP enum now would freeze a
  guess. `AUTH-READ-CACHE-01` stays open as a CLASS (see above). `R14` and
  `LATENT_AUTH_LIFECYCLE_DESIGN_RISK=OPEN_R14` are unchanged — persistence is keyed to the
  stable `(org_id, user_id)` the API-key lookup returns, and nothing here pretends that is a
  human login.
