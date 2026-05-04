# DB roles em production — runbook

## Roles e responsabilidades

- **superuser/admin** (`postgres` no dev; provider-managed em production): roda
  `bootstrap.sql` + migrations. Não é usado em runtime do app.
- **`govai_audit_writer`** (NOINHERIT, NOLOGIN, owner do schema `govai`):
  função SECURITY DEFINER `audit_append_locked` é executada sob esse role.
- **`govai_app`** (NOINHERIT, LOGIN, sem BYPASSRLS, sem SUPERUSER): role da
  conexão usada pelo API server em runtime.

## Senha do `govai_app`

A senha **não** é hardcoded em `bootstrap.sql`. O script exige que o GUC
`govai.app_password` esteja setado na **mesma sessão** antes de rodar:

```sql
SET govai.app_password = '<segredo>';
-- ... depois do SET, rodar bootstrap.sql ...
```

Validação dentro do bootstrap:

- `current_setting('govai.app_password', true) IS NOT NULL`
- `length(...) >= 8`

Caso contrário, `RAISE EXCEPTION` aborta o bootstrap.

## Em desenvolvimento (Testcontainers e local)

- **Testcontainers** (`tests/integration/setup.ts`): gera senha aleatória
  per-container via `randomBytes(24).toString('hex')` e injeta no `migrate()`.
  Determinístico dentro do test run; nunca commitada.

- **docker-compose dev**:
  1. `cp .env.example .env` e gere as senhas:
     ```bash
     openssl rand -hex 24 | xargs printf 'POSTGRES_PASSWORD=%s\n' >> .env
     openssl rand -hex 24 | xargs printf 'GOVAI_DB_APP_PASSWORD=%s\n' >> .env
     ```
  2. Construa `DATABASE_URL` e `DATABASE_ADMIN_URL` usando essas senhas
     (URL-encode caracteres especiais).
  3. `docker compose -f infra/docker-compose.yml up -d`. O bootstrap **não**
     roda automático no entry-point — `docker-entrypoint-initdb.d` não consegue
     setar GUC.
  4. `pnpm --filter @govai/api run migrate` lê `GOVAI_DB_APP_PASSWORD` do env e
     injeta via `SET` na mesma sessão antes de rodar `bootstrap.sql`.

## Em production

1. Provisione o cluster Postgres com senha do superuser via secret manager.
2. Gere `GOVAI_DB_APP_PASSWORD` com pelo menos 24 bytes random:
   ```bash
   openssl rand -hex 24
   ```
   Armazene no secret manager (AWS Secrets Manager, GCP Secret Manager, Vault).
3. Em deploy, exporte:
   - `DATABASE_ADMIN_URL` (superuser, usado **apenas** durante boot/migrate).
   - `GOVAI_DB_APP_PASSWORD` (senha plain do `govai_app`).
   - `DATABASE_URL` (a URL com a senha do `govai_app`).
4. Rode `pnpm --filter @govai/api run migrate` em job dedicado de deploy.
   Esse job tem acesso temporário ao admin URL; o pod do API server **não** tem.
5. API server boot lê `DATABASE_URL` (govai_app), nunca o admin URL.

## Rotação

Re-rodar `bootstrap.sql` com novo valor de `govai.app_password` aplica
`ALTER ROLE govai_app WITH LOGIN PASSWORD <new>` (caminho `WHEN duplicate_object`
do bloco DO). Atualize `DATABASE_URL` no API server na mesma janela.

## Não comitar

`.gitignore` cobre `.env`. gitleaks rule rejeita commits com hex >= 32 chars
em campos de senha. Adicionar nova rule para `GOVAI_DB_APP_PASSWORD=` se útil.
