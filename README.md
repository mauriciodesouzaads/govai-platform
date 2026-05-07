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
