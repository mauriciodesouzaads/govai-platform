# @govai/ui — GovAI interface (UI/UX V1: U1 evidence cockpit + U1.5 AI Console)

The first visible GovAI product layer, built on the frozen Backend Foundation V1. It is a
**static React + TypeScript SPA** that consumes the Fastify API **directly** — no BFF, no SSR,
no server-side session.

Its job is to make the evidence plane **legible, navigable and impossible to misread**. It
renders exactly what the API returns, including the API's own qualifications, and it never
represents a capability the runtime does not have.

---

## What this interface contains

| Route | Screen | Backend |
|---|---|---|
| `/enter` | Paste the organization's API key | probe: `GET /v1/me` |
| `/ai` | **AI Console** (U1.5) | the six direct provider routes — see below |
| `/` | Evidence cockpit | `GET /v1/evidence/summary` |
| `/evidence/gaps/:invariant` | Gap list per invariant (`ec1 ec2 ec3seal ec3drop ec4`) | `GET /v1/evidence/gaps` |
| `/audit-events` | HMAC chain (metadata + hashes) | `GET /v1/audit-events` |
| `/capabilities` | Capability × facet matrix | `GET /v1/capabilities` |

Deliberately **not** here: workrooms, the regulatory bench, admin, a run playground,
governance settings, user management. There is no route and no disabled menu item for any of
them — a promise the backend cannot keep is still a promise.

## The AI Console (`/ai`)

One conversation at a time, over the provider routes GovAI already registers:

| Mode | OpenAI Responses | OpenAI Chat Completions | Anthropic Messages |
|---|---|---|---|
| Native / Audited | `POST /passthrough/openai/v1/responses` | `POST /passthrough/openai/v1/chat/completions` | `POST /passthrough/anthropic/v1/messages` |
| Governed | `POST /governed/openai/v1/responses` | `POST /governed/openai/v1/chat/completions` | `POST /governed/anthropic/v1/messages` |

**There is no GovAI chat API and no normalized message schema.** Each adapter builds the
provider's own request body and reads the provider's own stream events; the only thing shared
between them is the transcript of plain text the reader typed and read. Model discovery reads
the providers' own `GET /v1/models` — this console ships no hardcoded model id, and a typed id
is sent exactly as typed, because a provider can serve a model it does not enumerate.

Properties worth knowing before changing anything here:

- **The browser never holds a provider key.** It sends the GovAI session key as one header to a
  same-origin GovAI path. There is no provider SDK in the bundle and no request to a provider
  domain; a build-time scan fails CI if anything credential-shaped reaches `dist`.
- **A provider POST is issued exactly once.** Never retried on 429, 5xx, network fault or stream
  fault: the provider may have executed and billed a request whose result this browser never
  saw. Retry is an explicit user action, labelled as a new provider call. The bounded 429 retry
  that model discovery keeps is GET-only.
- **The transcript is memory-only by construction** — `useReducer` state in the route component,
  with no storage adapter anywhere in the feature. Reload, leave `/ai`, or end the session and
  it is gone. The copy says that, and says nothing about what the provider retains.
- **Success is a marker, not an absence of failure.** `completed` requires the provider's own
  terminal event; a stream that delivered text and stopped without one is an unconfirmed
  outcome, and an unconfirmed answer is never sent back as context.
- **Hidden reasoning never arrives.** Responses runs stateless (`store: false`, history in
  `input`) and never requests encrypted reasoning; Anthropic `thinking_delta` / `signature_delta`
  are dropped before anything can read them.
- **Model output is untrusted input.** It reaches the DOM only through `react-markdown` with GFM
  — no `rehype-raw`, no `dangerouslySetInnerHTML`, and a link-scheme allowlist.

### What the Interaction Receipt may and may not say

It carries only what the browser can prove: a value it sent, a status it received, a header it
read, a clock it ran. Therefore it has **no audit event id** (no response on these six routes
exposes one), **no "evidence captured"** (AuditBridge dispatch is best-effort and acknowledges
nothing to the browser) and **no provider or backend latency** (only client-observed duration).

**Recommendation and Applied are two rows and must stay two rows.** At this base the runtime
forwards for every decision except a real 403, so `ask` + `forwarded` is the normal case and it
means nobody was asked. The recommendation label comes from `src/lib/honesty.ts`, the single
normative table, which is what stops this screen inventing a word for it. On the Native/Audited
surface the receipt reports that no per-request governance decision was returned — it does not
print what the internals record.

### Non-goals, deliberately

Tools, function calling, web search, file search, uploads, images, vision, audio, MCP, computer
use, code execution, artifacts, RAG, agent loops, a system-prompt field, persistent history, and
anything belonging to Workroom. Several are supported by the providers; each opens a governance
surface this milestone was not scoped to open.

### Two open backend findings the live acceptance produced

Neither is a UI defect and neither is fixed here:

- **`AI-CONSOLE-ORIGIN-RELAY-01`.** The direct routes forward the browser's `Origin` header
  upstream, and Anthropic answers `401 "CORS requests must set
  'anthropic-dangerous-direct-browser-access' header"`. **The Anthropic surface therefore does
  not work from a browser** until that relay is fixed server-side. A page cannot remove its own
  `Origin`, and this console must not send that beta header — it asserts that the provider key is
  exposed to the browser, which is the opposite of what GovAI does.
- **`AI-CONSOLE-RESPONSES-DLP-GAP-01`.** The governed Responses DLP pre-scan skips `input[]`
  items identified by `role` alone. This console sends fully-qualified typed user items so its
  own governed traffic is scanned; the gap remains for callers using the provider-documented
  shorthand.

## What this interface must never say

These are product-safety rules, encoded in `src/lib/honesty.ts` and `src/lib/vocab.ts` and
enforced by tests that run before any screen uses them:

- **Green is a fact, not an absence.** `ok` appears only where the backend asserts that
  something was verified, covered or sealed.
- **EC-6 is never green while pending.** This build persists no chain verification, so every
  chain is `pending`; the tile is amber and carries the backend's own note verbatim.
- **An unobserved signal is not a zero.** EC-3.drop reports `observed: false` with a zero
  count. The tile shows an em dash and says the OTLP collector holds the authoritative signal.
- **An empty population is not full coverage.** `coverage_ratio` returns `1.0` when the total
  is zero; that renders as "no units in scope", neutral, never as a clean bill of health.
- **Blocked if and only if 403.** A governance decision that was forwarded to the provider is
  never labelled blocked, applied, protected or withheld — in any of the three languages.
- **`ask` and `sandbox_required` are recommendations, not applied controls.** Nobody was asked;
  no sandbox was created. Phase 5 primitives do not exist.
- **`evidence_strength` is not certification** (ADR-005: the strong members are themselves
  planned in the baseline), and a **`planned`** capability is registered, not available.
- **Only what a response carried.** `GET /v1/me` (EP-B2) serializes the caller's roles,
  commercial tier and operational mode, so the shell shows them — rendered verbatim, next to a
  translated field label, never re-worded into a friendlier value. Before that route existed the
  shell correctly showed none of them; the rule did not change, the supply did.
- **A plan is not a governance posture.** `tier` appears only in the account/details affordance,
  qualified as commercial/account context and accompanied by an explicit denial that it is a
  security level, a governance profile, a policy strictness or an enforcement mode. It is
  deliberately kept out of the header cluster, where sitting beside an operational mode would
  invite exactly that reading (Foundation V1 residual R13).
- **An API key is not a login.** `principal_type` is rendered through the status vocabulary, so
  a principal type this build has never seen degrades to an explicit unknown with the raw value
  visible — it can never inherit copy written for a controlled-pilot API key.

## Session model — read this before calling it "login"

This is the **development / controlled-pilot** access mechanism, not production human
authentication. There is no user account, no password, no session cookie and no key lifecycle.

- The reader pastes the organization's GovAI API key at `/enter`.
- It is validated with a real authenticated read before the session accepts it — `GET /v1/me`,
  which both proves the key and returns the principal the server resolved for it
  (`principal_type`, `org_id`, `user_id`, `roles`, `tier`, `operational_mode`).
- That principal is React state for **rendering only**. It is never an authority: every API
  route re-derives identity from the credential on every single request, so a tampered
  principal changes what this tab displays and nothing else. It is dropped with the credential
  on sign-out and on any 401.
- It lives in **one module-scoped variable** (`src/lib/session/credential.ts`) and nowhere
  else: never in localStorage, sessionStorage, IndexedDB, a cookie, the URL, router state, a
  React Query key, a log line or the DOM after submission.
- Reloading the tab ends the session. The UI says so.
- Signing out zeroes the credential **and clears the query cache** — query keys carry no
  identity, so the cache must not outlive the credential.

The only thing this application persists in the browser is the **selected language**.

Production human auth/session/API-key lifecycle remains a separate prerequisite
(Foundation V1 residual R14).

## Languages

`pt-BR` (default and fallback), `en-US`, `es`. Catalogs are typed as
`Record<MessageKey, string>`, so a missing or invented key is a **compile** error; a runtime
test additionally pins key parity, non-emptiness and — most importantly — that no translation
strengthens a claim.

## Architecture

```
src/
├── app/            App, route table, shell (nav, window selector, language selector)
├── lib/
│   ├── api/        one HTTP client, query keys, pagination adapters, resource hooks
│   ├── contract/   the mirrored API shapes — mirrored HERE and nowhere else
│   ├── session/    the in-memory credential store and its React provider
│   ├── i18n/       catalogs, provider, locale persistence
│   ├── honesty.ts  ★ the normative product-safety table
│   ├── vocab.ts    the single status vocabulary
│   └── format.ts   pure formatting, including the never-Number() rule
├── components/     AppShell parts, DataTable, tiles, badges, HashText, states, export
├── features/       auth/ and evidence/ screens
└── styles/         design tokens + the Tailwind theme mapping
```

Rules the structure encodes:

- **The UI binds 1:1 to the API.** No field is invented client-side; no state is shown that did
  not come from a response.
- **No sorting.** Every list is server-ordered and cursor-paginated, so a client-side sort would
  reorder only the loaded rows and contradict the cursor. Filtering is offered on the one
  screen that is not paginated (capabilities).
- **bigint stays a string.** `Ec2GapRow.first_gap_seq` / `gap_count` can exceed
  `Number.MAX_SAFE_INTEGER`; they are rendered digit for digit. There is deliberately no helper
  that converts them. (`sequence_number` on `/v1/audit-events` **is** a number — the route
  narrows it server-side. The UI mirrors what each route actually returns.)
- **Every response is validated** against the mirrored contract before a screen sees it. A
  shape change becomes an explicit error state, never blank cells a reader would take for zeros.

## Design system

"Ledger": a technical ledger — dense, sober, colour reserved almost entirely for status
semantics. Light theme only in U1; every colour resolves through the tokens in
`src/styles/tokens.css`, so a dark theme is a second token block, never a component edit.

Typography uses system stacks (Inter-style for UI, JetBrains-Mono-style for technical data): an
evidence product must not depend on fetching a font from a third-party origin at runtime, and
the bundle ships no font bytes. Swapping in packaged webfonts later is a two-line token change.

## Running it

```bash
# 1. bring up the API (from the repository root)
docker compose -f infra/docker-compose.yml up -d postgres
pnpm --filter @govai/api run migrate
pnpm --filter @govai/api run dev            # http://localhost:8080

# 2. the UI dev server, which proxies the API prefixes to it
pnpm --filter @govai/ui dev                 # http://localhost:5173/app/
```

The dev server proxies `/v1`, `/governed`, `/passthrough` and `/health` to
`GOVAI_UI_DEV_API_TARGET` (default `http://127.0.0.1:8080`), which reproduces the production
same-origin topology exactly: the browser only ever talks to one origin.

You need an API key for an organization on that database. The integration harness
(`tests/integration/helpers/server-fixture.ts` → `seedOrg`) is the repository's mechanism for
creating one.

### Driving the AI Console end to end

`tests/acceptance/ai-console/` brings up the whole stack — real Postgres with every migration,
the real Fastify app, real authentication and RLS, real provider-credential resolution through
the KMS envelope — and replaces only the upstream provider:

```bash
pnpm acceptance:ai-console        # a provider-protocol loopback upstream; free
pnpm acceptance:ai-console:live   # the REAL providers; costs real money
```

It prints an operator key to paste into `/enter` (auditor + developer — never admin), and a
ready-to-run `audit-sealer` command, because the console's receipt deliberately refuses to
correlate a turn to an audit event: closing that loop means sealing what the conversations
captured and reading the chain. The hermetic upstream writes SSE the way a provider does —
frames split across chunk boundaries, multi-byte characters cut in half — and understands
prompt markers (`#slow`, `#cut`, `#429`, `#400`, `#500`, `#unicode`) so the whole error matrix
is drivable by typing.

## Building and deploying

```bash
pnpm --filter @govai/ui build     # → apps/ui/dist (HTML + JS + CSS; zero Node runtime)
```

The build sets `base: '/app/'` and the router uses the same basename. The production topology
is a reverse proxy serving `/app/*` from `dist` and forwarding `/v1/*`, `/governed/*`,
`/passthrough/*` and `/health` to the Fastify API on the **same origin**, so CORS never enters
the picture and no credential is ever sent cross-origin. Serving the UI from its own origin is
possible via the API's existing `API_CORS_ORIGINS`, but same-origin is the intended shape.

### ⚠ Every `VITE_*` value is public

Build-time configuration is inlined into the client bundle. Only two values are configurable,
and neither is a secret:

| Variable | Meaning |
|---|---|
| `VITE_GOVAI_API_BASE_URL` | API base URL. Empty (default) = same origin. |
| `VITE_GOVAI_BUILD_SHA` | Build stamp shown in the footer. Unset renders an explicit "not provided" rather than a fabricated value. |

Never put an API key, provider key or token in a `VITE_*` variable. The CI `ui` job greps the
built bundle for credential-shaped strings and fails if it finds one.

## Gates

```bash
pnpm --filter @govai/ui typecheck
pnpm --filter @govai/ui lint
pnpm --filter @govai/ui test
pnpm --filter @govai/ui build
```

All four run in the CI `ui` job, alongside the existing `unit` and `integration` jobs. The UI
suite runs under its own vitest config (jsdom + Testing Library + MSW); the repository-root
`pnpm test` excludes `apps/ui/**` because that config is `environment: 'node'`.

Requires Node 24 and pnpm 10.33.2, like the rest of the monorepo.

## Named follow-ups this milestone does not do

- **EP-B7 `@govai/api-contract`** — extract the route Zod schemas into a shared package. Until
  then the shapes are mirrored in `src/lib/contract/` and nowhere else, so the swap is mechanical.
  EP-B2 added one more mirror (`contract/me.ts`) and, on the API side, one more copy of the
  credential-extraction helper — both are the same debt this movement pays off.
- **EP-B1 per-key rate limiting** — the API's limit is 100 req/min **per process, globally**. The
  client caches aggressively and backs off, but a dashboard in production wants a per-key limit.
- **EP-V1 persisted chain verification** — the honest CTA behind EC-6's permanent `pending`.
- **Playwright end-to-end** — the component and data-layer suites run in CI today, and
  `tests/acceptance/ai-console/` drives a real browser against a real stack by hand; an
  AUTOMATED browser suite is still a follow-up rather than scope-expanded here.
- **`EP-AI-CONSOLE-TURN-EVIDENCE-CORRELATION`** — a backend contract that lets a turn name the
  audit event it produced. Until one exists the receipt says so instead of guessing from
  timestamp, model and status.
- **`EP-UI-DEPLOY` — the deployable unit.** CI builds, scans and now uploads `apps/ui/dist`,
  but nothing in the repository yet packages it for serving: there is no UI image and no
  reverse-proxy configuration for the `/app/` + `/v1/*` same-origin topology this README
  describes. That packaging is its own movement, on the pattern `EP-SEALER-DEPLOY`
  established for the audit sealer — deliberately not folded into U1.
