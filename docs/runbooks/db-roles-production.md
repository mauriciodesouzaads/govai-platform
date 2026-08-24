# DB roles em production — runbook

## Roles e responsabilidades

- **superuser/admin** (`postgres` no dev; provider-managed em production): roda
  `bootstrap.sql` + migrations. Não é usado em runtime do app.
- **`govai_audit_writer`** (NOINHERIT, NOLOGIN, owner do schema `govai`):
  função SECURITY DEFINER `audit_append_locked` é executada sob esse role.
- **`govai_app`** (NOINHERIT, LOGIN, sem BYPASSRLS, sem SUPERUSER): role da
  conexão usada pelo API server em runtime.
- **`govai_conversation_worker`** (NOINHERIT, **NOLOGIN até ser provisionado**,
  sem BYPASSRLS, sem SUPERUSER, não é owner de nada): identidade do worker
  destacado de conversação (EP-AI-CONVERSATION-CONTINUITY-V1 P0-A2). Domínio de
  confiança SEPARADO do `govai_app` (LAW 11): `govai_app` **não** tem EXECUTE na
  função de discovery e **não** consegue `SET ROLE` para ele. Capacidade total no
  P0-A2 = `USAGE` no schema + EXECUTE em `govai.ai_turn_recovery_candidates` +
  `SELECT` **por coluna** em três tabelas `ai_*`, sempre sob FORCE RLS
  dual-predicate. Ver "Worker de conversação" abaixo.

## Identidade do migrador × RLS (migrations com guardas de dados, ex. 0029)

Quatro identidades distintas — não confundir:

1. **Superusuário PostgreSQL verdadeiro** (`postgres` em dev/Testcontainers):
   bypassa RLS integralmente; todos os diagnósticos count-only das migrations
   enxergam todas as linhas.
2. **Login administrativo gerenciado** (a identidade de `DATABASE_ADMIN_URL`):
   requisito PROVADO para rodar as migrations — `LOGIN` + membro de
   `govai_audit_writer` com opção `SET` (`GRANT govai_audit_writer TO <role>`),
   sem necessidade de `SUPERUSER` ou `BYPASSRLS`. `INHERIT` é opcional: sem ele
   os diagnósticos best-effort são pulados (ver abaixo), nunca a decisão de
   segurança.
3. **`govai_audit_writer`** (owner das tabelas, NOLOGIN): as migrations fazem
   `SET ROLE` para ele; tabelas com FORCE RLS sujeitam até o owner.
4. **`govai_app`** (runtime): sempre org-scoped via `app.org_id`; nunca roda
   migrations.

Propriedades provadas (PostgreSQL 16, testes RLS-M1..M9):

- A **decisão de segurança M-B** da migration 0029 (bloquear upgrade sobre
  linhas protocolo-v1 pré-boundary) conta com visibilidade TOTAL cross-org sob
  QUALQUER identidade suportada: a contagem roda como owner dentro de uma
  janela transacional `NO FORCE ROW LEVEL SECURITY` confinada a um único
  statement `DO` atômico. `ENABLE ROW LEVEL SECURITY` permanece ativo, nenhuma
  policy é alterada, e nenhum estado commitado jamais contém FORCE
  desabilitado (qualquer falha aborta o arquivo inteiro).
- Os **diagnósticos count-only** (D0 e a contagem de duplicatas da seção G)
  são best-effort sob identidade não-superusuário: podem ver um subconjunto
  filtrado por RLS ou ser pulados por `insufficient_privilege`. Os backstops
  estruturais independentes de role (validação do `ADD CONSTRAINT` e o unique
  index build) continuam bloqueando qualquer linha incompatível, com rollback
  completo do arquivo.

Limites honestos: nada aqui certifica provedores gerenciados específicos (AWS
RDS, Cloud SQL etc.) — o que está provado é o contrato de role acima em
PostgreSQL 16. O runtime do API server **nunca** recebe `DATABASE_ADMIN_URL`
(ver seção "Em production").

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

## Production: bootstrap deve rodar exatamente uma vez

Em production, rode o bootstrap exatamente uma vez durante o provisionamento
inicial. Reexecutar o bootstrap reaplica a senha de `govai_app` a partir de
`GOVAI_DB_APP_PASSWORD` — comportamento útil em dev/test (idempotência), mas
em production deve ser tratado como operação administrativa controlada,
nunca como parte de um pipeline rotineiro de migrations.

Se você precisar rotacionar a senha de `govai_app` em production, faça-o via
ALTER ROLE explícito em janela de manutenção, não via re-execução de
bootstrap.

## Worker de conversação (`govai_conversation_worker`)

Criado por `bootstrap.sql` como **NOLOGIN** — a role existe mas é inalcançável
até ser explicitamente provisionada. LOGIN e PASSWORD são concedidos JUNTOS,
atomicamente; não existe estado "LOGIN sem senha" em nenhum momento.

O ciclo de vida é a MESMA máquina de cinco células do
`govai_evidence_enumerator`, dirigida por dois sinais INDEPENDENTES (não existe
sentinela por ausência de senha — uma migration de rotina nunca deve desativar a
recuperação de conversação por omissão):

| Sinal | Efeito |
|---|---|
| `GOVAI_DB_CONVERSATION_WORKER_PASSWORD` (>= 8 chars), sem deprovision | provisiona / rotaciona o LOGIN |
| ambos os sinais definidos | **falha alto** (intenção contraditória) |
| nenhum sinal | role permanece **exatamente como está** |
| `GOVAI_DB_CONVERSATION_WORKER_DEPROVISION=1`, sem senha | NOLOGIN + senha limpa, e o runner reapa as sessões vivas pós-commit |
| `..._DEPROVISION` com qualquer valor != `1` | **falha alto** (sinal inválido) |

Provisionar/rotacionar:

```bash
export GOVAI_DB_CONVERSATION_WORKER_PASSWORD="$(openssl rand -hex 24)"
pnpm --filter @govai/api run migrate     # aplica bootstrap + migrations
```

Desativar:

```bash
export GOVAI_DB_CONVERSATION_WORKER_DEPROVISION=1   # e NÃO defina a senha
pnpm --filter @govai/api run migrate
```

**Runtime.** Um processo worker conecta com a URL própria
`GOVAI_CONVERSATION_WORKER_DATABASE_URL` (opcionalmente
`GOVAI_CONVERSATION_WORKER_POOL_MAX`, `GOVAI_CONVERSATION_WORKER_ID`). Essa é uma
config de CONEXÃO — nunca a senha de provisionamento acima, que gerencia a
credencial e não deve ser lida em runtime. A fábrica de pool **falha fechada** se
a URL estiver ausente: não há fallback para `DATABASE_URL`, porque rodar
recuperação como `govai_app` apagaria exatamente a fronteira de confiança que o
P0-A2 existe para criar.

**Nenhum processo worker existe ainda** (`WORKER_RUNTIME_PROCESS=NOT_IMPLEMENTED`):
o P0-A2 entrega a fronteira de confiança e a descoberta, não o runner. Em
production, deixe a role **não provisionada** até que o primeiro processo worker
seja implantado — uma role NOLOGIN é inalcançável sob qualquer modo de
autenticação do `pg_hba`.

**Custódia da credencial.** Comprometer a credencial do worker é o
comprometimento de um componente privilegiado: least privilege + FORCE RLS
limitam o raio de explosão e pegam erros de programação, mas não tornam uma
credencial roubada inofensiva. Trate-a com as mesmas regras de segredo de
qualquer outra credencial privilegiada da plataforma.
