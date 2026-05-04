# GovAI Platform

Plataforma de governance de IA, modular, com audit chain append-only,
RLS multi-tenant, KMS, capability registry, DLP-BR (CPF/CNPJ/email/telefone + RE2 custom),
e providers Anthropic + OpenAI nativos.

**Status:** Runtime Phase 1 (PR1 / `runtime-patch-1`) — Governed Run pipeline
hermético `POST /v1/runs` + `GET /v1/audit-events` + `GET /v1/capabilities` por org +
guard de planned-capability (apenas hermético). Passthrough e admin routes ainda em
501 com schema estruturado apontando para PR2/PR3 (ver
`docs/architecture/baseline-decisions.md#runtime-roadmap`).

> Veja `../docs/govai_adp_v3.md` para a especificação canônica externa.
> Veja `docs/architecture/baseline-decisions.md` para resoluções pinadas.

## Pré-requisitos

- Node 24 LTS (`nvm use 24`)
- pnpm 10.33.2 (`npm i -g pnpm@10.33.2`)
- Docker (para docker-compose / Testcontainers)

## Quickstart

```bash
# 1. Subir Postgres 16 + Redis 7
docker compose -f infra/docker-compose.yml up -d

# 2. Instalar deps
pnpm install

# 3. Aplicar bootstrap.sql + migrations
DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/govai \
  pnpm --filter @govai/api run migrate

# 4. Rodar testes (unit + integration via Testcontainers)
pnpm test

# 5. Subir o servidor (dev)
cp .env.example .env
# editar .env, gerar KMS_DEV_SEED localmente:
openssl rand -hex 32 | xargs printf 'KMS_DEV_SEED=%s\n' >> .env
pnpm --filter @govai/api run dev
```

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
