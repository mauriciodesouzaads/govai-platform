# GovAI Platform

Plataforma de governance de IA, modular, com audit chain append-only,
RLS multi-tenant, KMS, capability registry, DLP-BR (CPF/CNPJ/email/telefone + RE2 custom),
e providers Anthropic + OpenAI nativos.

**Status:** Active development. Implemented runtime surfaces include provider-native
**passthrough** and **governed** surfaces (OpenAI + Anthropic), the `/v1/runs` governed
shortcut, the append-only audit chain + capability registry, Workroom Phases 1–4
(create/participants, transcript/tasks/evidence, workroom-owned runs, approvals),
regulatory foundational controls (PR-R1..R9, **evidence-only**, not runtime enforcement),
and the AuditSealer **B0/B1/B2** foundations (capture outbox + capture adapter + sealer
**library**). The AuditSealer **B3 runner is not implemented and is not authorized**. Two
admin routes (`/v1/admin/audit-events/:id/crypto-shred`, `/v1/admin/dlp-detectors`) are
still PR3 not-implemented stubs.

GovAI does **not** claim regulatory compliance, certification, legal/judicial validity, or
runtime hard-deny completeness. The authoritative implementation state is
[`docs/architecture/current-state.md`](docs/architecture/current-state.md); see also the
[development roadmap](docs/architecture/development-roadmap.md) and
[resume playbook](docs/architecture/resume-playbook.md).

> Veja `../docs/govai_adp_v3.md` para a especificação canônica externa.
> Veja `docs/architecture/baseline-decisions.md` para resoluções pinadas.

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
  apps/api/                     # Fastify boot + rotas + pipeline
  packages/
    config/                     # env loader + boot fail conditions
    core-events/                # Run, ProviderInvocation, EvidenceRecord types
    core-tenant/                # SET LOCAL app.org_id helpers
    core-audit/                 # canonical-json, hmac, lock-key, append, verify
    core-identity/              # KMS (DevKms HKDF), JWT (jose), API keys (argon2id), RBAC
    signing/                    # Signer interface + DevSigner Ed25519
    core-governance/            # Capability registry com facets + override resolver
    dlp-br/                     # CPF/CNPJ/email/phone + RE2 custom
    provider-anthropic/         # SDK wrapper + usage extraction
    provider-openai/            # SDK wrapper + usage extraction
  infra/
    postgres/bootstrap.sql      # idempotente (DO blocks)
    docker-compose.yml          # dev only
  docs/
    architecture/adr/           # ADRs do projeto
    architecture/baseline-decisions.md
    contracts/                  # planned: passthrough-headers, ICP-BR, TSA, MCP, etc.
    runbooks/
  tests/
    integration/                # Testcontainers Postgres 16 + Redis
    live/                       # opt-in via GOVAI_LIVE_TESTS=1
```

## Auditoria contra ADP v3

```bash
# As fontes canônicas vivem fora do monorepo:
sha256sum ../docs/govai_adp_v3.md
sha256sum ../docs/govai_claude_code_prompt_v2.md
```
