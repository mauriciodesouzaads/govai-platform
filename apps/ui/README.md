# @govai/ui — GovAI evidence interface (UI/UX V1, milestone U1)

The first visible GovAI product layer, built on the frozen Backend Foundation V1. It is a
**static React + TypeScript SPA** that consumes the Fastify API **directly** — no BFF, no SSR,
no server-side session.

Its job is to make the evidence plane **legible, navigable and impossible to misread**. It
renders exactly what the API returns, including the API's own qualifications, and it never
represents a capability the runtime does not have.

---

## What U1 contains

| Route | Screen | Backend |
|---|---|---|
| `/enter` | Paste the organization's API key | probe: `GET /v1/evidence/summary` |
| `/` | Evidence cockpit | `GET /v1/evidence/summary` |
| `/evidence/gaps/:invariant` | Gap list per invariant (`ec1 ec2 ec3seal ec3drop ec4`) | `GET /v1/evidence/gaps` |
| `/audit-events` | HMAC chain (metadata + hashes) | `GET /v1/audit-events` |
| `/capabilities` | Capability × facet matrix | `GET /v1/capabilities` |

Deliberately **not** in U1: workrooms, the regulatory bench, admin, a run playground,
governance settings, user management. There is no route and no disabled menu item for any of
them — a promise the backend cannot keep is still a promise.

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
- **No role, tier or operational-mode badge.** No route returns them at this base and there is
  no `/v1/me`; displaying one would be fabrication, and coupling a commercial tier to a
  governance posture is exactly the conflation the Foundation V1 residual register forbids.

## Session model — read this before calling it "login"

This is the **development / controlled-pilot** access mechanism, not production human
authentication. There is no user account, no password, no session cookie and no key lifecycle.

- The reader pastes the organization's GovAI API key at `/enter`.
- It is validated with a real authenticated read before the session accepts it.
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
- **EP-B1 per-key rate limiting** — the API's limit is 100 req/min **per process, globally**. The
  client caches aggressively and backs off, but a dashboard in production wants a per-key limit.
- **EP-B2 `GET /v1/me`** — without it the shell cannot show roles, tier or operational mode, and
  correctly shows none.
- **EP-V1 persisted chain verification** — the honest CTA behind EC-6's permanent `pending`.
- **Playwright end-to-end** — the component and data-layer suites run in CI today; a browser
  suite against the local stack is registered as a U1 follow-up rather than scope-expanded here.
- **`EP-UI-DEPLOY` — the deployable unit.** CI builds, scans and now uploads `apps/ui/dist`,
  but nothing in the repository yet packages it for serving: there is no UI image and no
  reverse-proxy configuration for the `/app/` + `/v1/*` same-origin topology this README
  describes. That packaging is its own movement, on the pattern `EP-SEALER-DEPLOY`
  established for the audit sealer — deliberately not folded into U1.
