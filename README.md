# GovAI Platform

Plataforma de governance de IA, modular, com audit chain append-only,
RLS multi-tenant, KMS, capability registry, DLP-BR (CPF/CNPJ/email/telefone + RE2 custom),
e providers Anthropic + OpenAI nativos.

**Status:** Active development. Implemented and source-verified on `main` at the
**Foundation V1 runtime anchor** (`de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68`, 2026-08-17):
provider-native **passthrough** (Native/Audited) and **governed** surfaces (OpenAI + Anthropic),
the `/v1/runs` governed execution API (durable provider dispatch outside DB transactions,
honest `run.outcome_unknown`, cross-request run idempotency via `X-GovAI-Run-Idempotency-Key`),
the append-only HMAC audit chain + capability registry, the **AuditBridge wired on the four
direct provider routes** (runtime → durable capture outbox, ADR-027/028), the AuditSealer
**B0/B1/B2/B3** (capture outbox + capture adapter + sealer library + the implemented **B3
runner**, `apps/audit-sealer/`, with a deployable bundle), the evidence-completeness views /
metrics and the RLS-scoped `/v1/evidence` read API, Workroom Phases 1–4 (create/participants,
transcript/tasks/evidence, workroom-owned runs, approvals), regulatory foundational controls
(PR-R1..R9, **evidence-only**, not runtime enforcement), DLP-BR detectors, and KMS
envelope-encrypted provider credentials (dev KMS + AWS KMS adapter). Foundation V1 was
live-accepted against the real Anthropic and OpenAI APIs with the official SDKs, Claude Code
and Codex CLI **within an explicitly executed scope** (see the freeze record). Two admin routes
(`/v1/admin/audit-events/:id/crypto-shred`, `/v1/admin/dlp-detectors`) remain not-implemented
stubs.

**Not implemented / not claimed:** Phase 5 runtime enforcement primitives (ask / sandbox /
enforce — the governed surface reports recommendation vs applied honestly over HTTP and only
`blocked` blocks), Workroom Phases 5–7, a human UI and a production human auth/session/API-key
lifecycle, real EC-5, universal provider/endpoint parity, provider-side exactly-once, and any
regulatory-compliance, certification or legal/judicial-validity claim. The sealer runner code
exists; **continuous production sealer operation is a separate operational authorization** and
is not implied here.

The authoritative implementation state is
[`docs/architecture/current-state.md`](docs/architecture/current-state.md); the Foundation V1
baseline is [`docs/architecture/foundation-v1-freeze.md`](docs/architecture/foundation-v1-freeze.md);
documentation navigation and the hierarchy of truth start at [`docs/README.md`](docs/README.md);
see also the [development roadmap](docs/architecture/development-roadmap.md) and the
[resume playbook](docs/architecture/resume-playbook.md).

> Canonical architecture documents live in this repository under `docs/` (see `docs/README.md`).
> The former external `../docs/govai_adp_v3.md` reference is **historical** — it is no longer a
> current authority; the in-repo canonical set supersedes it. `docs/architecture/baseline-decisions.md`
> records the pinned ADP-v3-era baseline resolutions (historical document).

## Pré-requisitos

- Node 24 LTS (`nvm use 24`)
- pnpm 10.33.2 (`npm i -g pnpm@10.33.2`)
- Docker (para docker-compose / Testcontainers)

## Quickstart

```bash
# 1. Generate dev secrets (NEVER commit .env)
cp .env.example .env
openssl rand -hex 32 | xargs printf 'KMS_DEV_SEED=%s\n'      >> .env
openssl rand -hex 24 | xargs printf 'POSTGRES_PASSWORD=%s\n' >> .env
openssl rand -hex 24 | xargs printf 'GOVAI_DB_APP_PASSWORD=%s\n' >> .env
# Then edit DATABASE_URL / DATABASE_ADMIN_URL with the passwords above.

# 2. Subir Postgres 16 + Redis 7 (POSTGRES_PASSWORD obrigatório no env)
docker compose --env-file .env -f infra/docker-compose.yml up -d

# 3. Instalar deps
pnpm install

# 4. Aplicar bootstrap.sql + migrations (lê GOVAI_DB_APP_PASSWORD do env)
DATABASE_ADMIN_URL=$DATABASE_ADMIN_URL \
GOVAI_DB_APP_PASSWORD=$GOVAI_DB_APP_PASSWORD \
  pnpm --filter @govai/api run migrate

# 5. Rodar testes (unit + integration via Testcontainers — gera senha por container)
pnpm test

# 6. Subir o servidor (dev)
pnpm --filter @govai/api run dev
```

> Senhas de DB nunca são hardcoded. Ver `docs/runbooks/db-roles-production.md`.

## Live tests

Não rodam por default. Comando manual:

```bash
GOVAI_LIVE_TESTS=1 \
ANTHROPIC_API_KEY=... \
OPENAI_API_KEY=... \
pnpm test:live
```

## Estrutura

```
govai-platform/
  apps/api/                     # Fastify boot + rotas + pipeline (AuditBridge, durable run dispatch)
  apps/audit-sealer/            # B3 AuditSealer runner (dedicated deploy unit; esbuild bundle + Dockerfile)
  packages/
    config/                     # env loader + boot fail conditions
    core-events/                # Run, ProviderInvocation, EvidenceRecord types; PassthroughInvoked v4
    core-types/                 # shared types (tiers, risk classes, enforcement modes)
    core-tenant/                # SET LOCAL app.org_id helpers
    core-audit/                 # canonical-json, hmac, lock-key, append, verify
    core-identity/              # KMS (DevKms HKDF — dev; AWS KMS adapter — production), JWT (jose), API keys (argon2id), RBAC
    signing/                    # Signer interface + DevSigner Ed25519
    core-governance/            # Capability registry com facets + override resolver
    dlp-br/                     # CPF/CNPJ/email/phone + RE2 custom
    provider-anthropic/         # SDK wrapper + usage extraction
    provider-openai/            # SDK wrapper + usage extraction
    provider-stream-http/       # stream pump/classify helper (terminal-event completeness)
    observability/              # shared OTel MeterProvider bootstrap
  infra/
    postgres/bootstrap.sql      # idempotente (DO blocks)
    docker-compose.yml          # dev only
  docs/
    README.md                   # documentation index + hierarchy of truth (start here)
    architecture/               # current-state, roadmap, freeze record, ADRs, specs, plans, registers
    architecture/adr/           # ADRs do projeto (see ADR-INDEX.md)
    security/ operations/       # threat model, artifact hygiene (doctrine)
    contracts/                  # planned: passthrough-headers, ICP-BR, TSA, MCP, etc.
    runbooks/
  tests/
    integration/                # Testcontainers Postgres 16 + Redis
    live/                       # opt-in via GOVAI_LIVE_TESTS=1
```

## Documentation provenance

Promulgated architecture documents carry a promulgation header with their source SHA-256;
the corpus provenance is recorded in
[`docs/architecture/d9-promulgation-manifest.md`](docs/architecture/d9-promulgation-manifest.md).
The former "audit against ADP v3" step (checksums of external files outside the monorepo) is
historical; those checksums are recorded in `docs/architecture/baseline-decisions.md`.
