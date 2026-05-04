# Runtime Patch 1 — Pre-Merge Checklist

**Branch alvo:** `runtime-patch-1` (commit base `c66df37`).
**Objetivo:** quatro ações pequenas e cirúrgicas antes do merge em `main`. Não amplia escopo; fecha divergências apontadas pela auditoria GPT/Opus.
**Modelo executor:** Claude Code.
**Tempo estimado:** 30-60 minutos.

---

## Ação 1 — E2E.7: provider HTTP 429 explícito (pre-merge obrigatório)

### Por que

Spec original do prompt v2 (§3.1.5 E2E.5) pediu "provider retorna 429 → mapped error". A execução reescreveu para network failure (porta fechada). São caminhos de código diferentes:

- **Network failure**: `fetch()` joga TypeError → catch em `provider-invoke.ts` → `ProviderInvokeError(0, 'network_error')`.
- **HTTP 429**: `fetch()` resolve normal → `res.ok === false` → `ProviderInvokeError(429, body)`.

Ambos terminam em `502 + run.failed`, mas o caminho HTTP-error precisa cobertura própria. O provider-protocol test server já suporta `x-test-error: 429` — use.

### Implementação

Adicionar em `tests/integration/governed-run-e2e.test.ts`:

```ts
it('E2E.7 — provider returns HTTP 429 → 502 + run.failed + audit registrado', async () => {
  const org = await seedOrg(stack);

  // Configurar fixture para retornar 429 em todas as chamadas desta org.
  // Opção A: provider-protocol test server suporta header global override via env;
  //         se não, instale handler que checa um discriminador (e.g. workspace_id)
  //         no body e retorna 429.
  // Opção B (mais simples e o que recomendo): adicionar helper
  //         configureProviderError(stack, { for: org.workspace_id, status: 429 }) no fixture.

  await configureProviderError(stack, { workspaceId: org.workspace_id, status: 429 });

  const res = await inject(stack, 'POST', '/v1/runs', org.api_key, {
    workspace_id: org.workspace_id,
    capability: 'anthropic.messages.create',
    model: 'claude-fixture-1',
    input: 'test 429 path',
  });

  expect(res.statusCode).toBe(502);
  const body = res.body as {
    status: string;
    run_id: string;
    audit_event_id: string;
    provider_invocation_id: string;
    policy_decision: { kind: string };
    error?: { class: string; status: number };
  };

  expect(body.status).toBe('failed');
  expect(body.policy_decision.kind).toBe('allow');
  expect(body.audit_event_id).toBeDefined();
  expect(body.provider_invocation_id).toBeDefined();

  // Provider invocation row deve ter status_code=429 e error_class definido (ex: 'rate_limited').
  const invocation = await stack.db.appPool.query(
    `SELECT status_code, error_class FROM govai.provider_invocations WHERE id = $1`,
    [body.provider_invocation_id],
  );
  expect(invocation.rows[0]?.status_code).toBe(429);
  expect(invocation.rows[0]?.error_class).toBeTruthy();

  // Audit event run.failed na chain.
  const events = await inject(stack, 'GET', '/v1/audit-events?chain_category=run', org.api_key);
  expect(events.statusCode).toBe(200);
  const ev = events.body as { events: Array<{ event_type: string }> };
  expect(ev.events.map((e) => e.event_type)).toContain('run.failed');

  // verifyFullChain ainda válido — chain não corrompida por evento de falha.
  const kms = new DevKms(stack.kmsSeed);
  await stack.db.appPool.query(`SELECT set_config('app.org_id', $1, true)`, [org.org_id]);
  const result = await verifyFullChain(stack.db.appPool, {
    chainId: chainIdFor(org.org_id, 'run'),
    kms,
    orgId: org.org_id,
  });
  expect(result.valid).toBe(true);
});
```

### Helper `configureProviderError`

Se o provider-protocol test server (`tests/integration/fixtures/provider-protocol-server.ts`) ainda não tem injeção de erro por discriminador, adicione:

```ts
// Em provider-protocol-server.ts:
const errorOverrides = new Map<string, { status: number; body?: unknown }>();

export function setErrorOverride(workspaceId: string, override: { status: number; body?: unknown }) {
  errorOverrides.set(workspaceId, override);
}

export function clearErrorOverrides() {
  errorOverrides.clear();
}

// No handler de cada endpoint, antes de retornar response normal:
const wsId = req.body?.metadata?.workspace_id ?? req.headers['x-test-workspace-id'];
if (wsId && errorOverrides.has(wsId)) {
  const override = errorOverrides.get(wsId)!;
  reply.code(override.status);
  return override.body ?? { error: { type: 'simulated', status: override.status } };
}
```

E em `tests/integration/helpers/server-fixture.ts`:

```ts
export async function configureProviderError(
  stack: Stack,
  opts: { workspaceId: string; status: number; body?: unknown }
): Promise<void> {
  // Se setErrorOverride é exportado pelo módulo do provider-protocol-server:
  const { setErrorOverride } = await import('../fixtures/provider-protocol-server.js');
  setErrorOverride(opts.workspaceId, { status: opts.status, body: opts.body });
}
```

Lembrar de chamar `clearErrorOverrides()` em `afterEach` ou `afterAll` para isolamento entre testes.

#### Discriminador `workspace_id` no provider-invoke (test-only)

Para `configureProviderError` aplicar o 429 de forma determinística, o `provider-invoke.ts` precisa enviar `workspace_id` ao provider-protocol test server. Caminho recomendado:

```ts
// Em apps/api/src/pipeline/provider-invoke.ts:

// Test-only discriminator: forwarda workspace_id para o provider-protocol test
// server via header x-test-workspace-id para permitir simulação de erros por
// discriminador. APENAS quando NODE_ENV='test' E provider apontando para
// loopback (mesma guard que assertCapabilityExecutable usa).
const isHermeticTest =
  input.env.NODE_ENV === 'test' && isLoopbackUrl(input.baseUrl);

const headers: Record<string, string> = {
  'content-type': 'application/json',
  ...input.headers,
};
if (isHermeticTest && input.workspaceId) {
  headers['x-test-workspace-id'] = input.workspaceId;
}

// fetch() ... body inclui metadata.workspace_id também via input.metadata
```

Atualizar `ProviderInvokeInput` em `provider-invoke.ts` para aceitar `workspaceId?: string` opcional, e `run-orchestrator.ts` passa `workspaceId: body.workspace_id` ao `invokeProvider`.

**Constraints obrigatórios:**

1. O envio do `x-test-workspace-id` **só** ocorre quando `NODE_ENV === 'test'` E `isLoopbackUrl(baseUrl) === true`. Em qualquer outro ambiente, o header **não** é enviado.
2. `metadata.workspace_id` no body é aceitável adicionar mesmo fora de test (já é metadata neutra), mas o handler do test server só lê em path de teste.
3. Adicionar teste de regressão: em `NODE_ENV !== 'test'`, ou contra um base URL não-loopback, o `x-test-workspace-id` não deve aparecer no request capturado. Pode ser unit test sobre uma função pura `buildProviderHeaders()` que recebe `{env, baseUrl, workspaceId}` e retorna o objeto de headers.

Sem esse fan-out do discriminador, o `errorOverrides.has(wsId)` no test server retorna `false` e o E2E.7 fica não-determinístico.

### Critério de aceitação E2E.7

- Teste compila e passa.
- Novo total: 102 testes passando (era 101).
- Lint clean. Typecheck clean.
- Coverage não regride.

---

## Ação 2 — Issues registradas no tracker (pre-merge obrigatório)

Criar 3 issues no GitHub do repositório `mauriciodesouzaads/govai-platform`. Pode usar `gh issue create`.

### Issue #1 — `[PR3/security] audit_append_locked: validar canonical_hash SQL-side`

```
**Tipo:** Security hardening
**Prioridade:** High (mas não bloqueia PR1)
**Fase planejada:** PR3

## Contexto
A função SECURITY DEFINER `govai.audit_append_locked` armazena `p_canonical_hash`
recebido do caller sem validar que `sha256(p_canonical_bytes) == p_canonical_hash`
SQL-side.

Mitigações atuais:
1. TS-side `auditAppend` sempre re-deriva canonical_bytes e canonical_hash antes
   de chamar a função SQL.
2. Tenant boundary: `govai_app` recebe conexões a partir do API server.
3. `verifyFullChain` detecta inconsistência em audit run.

## Risco residual
Detecção #3 só ocorre quando `verifyFullChain` é executado — não é tamper-evident
em tempo real. Atacante com acesso a conexão `govai_app` (insider/compromised
server) pode bypass `auditAppend` chamando `audit_append_locked` direto via
`pool.query()` com hashes inconsistentes.

## Opções de remediação (avaliar em PR3)
- (a) ADP exception explícita para usar `pgcrypto digest()` na validação.
- (b) PL/pgSQL hash-of-fields check independente do canonical_hash recebido.
- (c) Hash auxiliar TS-side computado de forma independente, validado SQL-side
      via comparação byte-a-byte.

## Aceitação
- Decisão arquitetural documentada em ADR.
- Implementação SQL-side da opção escolhida.
- Teste hermético que prova: chamada direta `audit_append_locked` com canonical_hash
  inconsistente é rejeitada antes do INSERT (não detectada apenas em verify posterior).

## Referências
- Codex adversarial review: `docs/codex-review-runtime-patch-1-adversarial.md` finding #3
- Mitigação atual: `docs/architecture/baseline-decisions.md#open-security-questions`
```

### Issue #2 — `[PR3/quality] Branch coverage ≥80% nos core-*`

```
**Tipo:** Test quality
**Prioridade:** Medium
**Fase planejada:** PR3

## Contexto
Coverage gate configurado em runtime-patch-1:
- lines ≥80% ✓ (93.77%)
- statements ≥80% ✓ (91.07%)
- functions ≥80% ✓ (96.82%)
- branches ≥70% ✓ (75.13%) — **threshold abaixo do ≥80% spec original**

Decisão de runtime-patch-1: branches a 70% como pragmatismo (branches são
historicamente mais difíceis e 70% é threshold padrão de indústria). Spec do
prompt dizia "≥80%" sem dimensão específica.

## Ação
Em PR3, elevar branches para ≥80% nos packages:
- `core-audit`
- `core-governance`
- `core-identity`
- `dlp-br`

Opções por arquivo onde branches < 80%:
- (a) Escrever testes adicionais que cubram branches específicos.
- (b) Documentar exceção file-level com `/* c8 ignore next */` em código
      legitimamente não-testável (ex: defesas em SECURITY DEFINER que nunca
      devem disparar em fluxo normal).

## Aceitação
- branches ≥80% no gate global, OU
- exceções file-level documentadas com justificativa por arquivo.

## Referência
- vitest.config.ts (threshold atual)
- Auditoria: análise GPT/Opus pós-runtime-patch-1
```

### Issue #3 — `[PR2] E2E.7 já incluso; promoção a supported requer live test`

(Esta issue só faz sentido se você quiser deixar trilha do que PR2 precisa inaugurar. Pode pular se preferir manter o tracker enxuto.)

```
**Tipo:** Feature/test
**Prioridade:** Medium
**Fase planejada:** PR2

## Pré-requisitos satisfeitos pelo PR1
- Pipeline real funciona contra fixture hermético.
- `assertCapabilityExecutable` distingue planned vs supported.
- Provider-protocol test server suporta erros simulados.
- E2E.7 (HTTP 429) cobre error mapping.

## PR2 deve entregar
1. SDKs Anthropic/OpenAI wired contra `GOVAI_PROVIDER_BASE_URL` real quando
   capability for `supported`.
2. Streaming nas 4 capabilities streaming.
3. Passthrough Anthropic + OpenAI implementados.
4. Live tests opt-in via `GOVAI_LIVE_TESTS=1`.
5. Promoção de pelo menos uma capability para `supported` com os 4 acceptance
   gates do ADP §15:
   - live test verde recente
   - integration test com provider-protocol server
   - capability registry test
   - ADR ou contrato em `docs/`

## Não-objetivos PR2
- Crypto-shred (PR3)
- Custom DLP CRUD (PR3)
- OTel boot completo (PR3)
- Concurrency stress (PR3)
```

### Comandos para criar as issues

```bash
cd ~/Projects/GovAI\ GRC\ Platform/govai-platform

gh issue create \
  --title "[PR3/security] audit_append_locked: validar canonical_hash SQL-side" \
  --label "security,PR3,hardening" \
  --body-file <(cat <<'EOF'
[colar conteúdo da Issue #1 acima]
EOF
)

gh issue create \
  --title "[PR3/quality] Branch coverage ≥80% nos core-*" \
  --label "quality,PR3,test-coverage" \
  --body-file <(cat <<'EOF'
[colar conteúdo da Issue #2 acima]
EOF
)

# Issue #3 opcional
```

### Critério de aceitação Ação 2

- 2 issues (mínimo) ou 3 (com #3 opcional) criadas no GitHub.
- Issue #1 vinculada à seção `open-security-questions` em `baseline-decisions.md` (link inverso).
- Output do `gh issue list` confirma criação.

---

## Ação 3 — Verificação da senha `govai_app`

### Investigação

Rodar:

```bash
cd ~/Projects/GovAI\ GRC\ Platform/govai-platform

# Onde a senha aparece?
grep -r "govai_app:govai_app\|password.*govai_app\|PASSWORD.*govai_app" \
  apps packages tests infra .env.example docker-compose.yml docs 2>/dev/null

# Bootstrap.sql tem ALTER ROLE com password?
grep -A 2 "govai_app" infra/postgres/bootstrap.sql

# Migration 0005 mexe na role?
grep -A 5 "govai_app\|api_keys" apps/api/src/db/migrations/0005_runtime_patch_1.sql
```

### Resultados esperados e ação por caso

**Caso A — senha aparece apenas em Testcontainers/dev local (`tests/integration/setup.ts` ou `helpers/server-fixture.ts`):**

- Aceitável.
- Adicionar comentário inline marcando como dev-only:

```ts
// dev-only: govai_app password is fixed for Testcontainers determinism.
// Production must use a generated password injected via env (see runbook
// docs/runbooks/kms-production.md and equivalent for DB roles).
```

- Atualizar `docs/runbooks/kms-production.md` ou criar `docs/runbooks/db-roles-production.md` com instrução explícita: "em production, defina `GOVAI_DB_APP_PASSWORD` antes do bootstrap; jamais reutilize a senha do bootstrap de dev".

**Caso B — senha aparece em `docker-compose.yml` ou `.env.example` como default sem aviso:**

- Não aceitável.
- Corrigir `docker-compose.yml` para usar variável de ambiente:

```yaml
  postgres:
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

- Atualizar `.env.example`:

```
# Generate locally for development:
#   openssl rand -hex 16 | xargs printf 'POSTGRES_PASSWORD=%s\n' >> .env
POSTGRES_PASSWORD=
GOVAI_DB_APP_PASSWORD=
```

**Caso C — senha aparece em `bootstrap.sql` ou `0005_runtime_patch_1.sql` como `CREATE/ALTER ROLE ... PASSWORD 'govai_app'`:**

- Não aceitável em código commitado.
- Reescrever para:

```sql
DO $$
DECLARE
  v_password text := current_setting('govai.app_password', true);
BEGIN
  IF v_password IS NULL OR length(v_password) < 8 THEN
    RAISE EXCEPTION 'bootstrap requires SET govai.app_password before running. See docs/runbooks/db-roles-production.md.';
  END IF;
  EXECUTE format('ALTER ROLE govai_app WITH LOGIN PASSWORD %L', v_password);
END
$$;
```

- Migration call site passa `SET govai.app_password = '<value>'` antes de aplicar bootstrap, lendo de env.

### Critério de aceitação Ação 3

- Resultado da investigação documentado em `docs/architecture/baseline-decisions.md` (1 parágrafo).
- Se Caso A: comentário inline + runbook atualizado.
- Se Caso B ou C: correção aplicada + 1 commit adicional na branch antes do merge.
- Test suite continua passando após mudança.

---

## Ação 4 — Decisão sobre branches=70% (registrar)

Adicionar em `docs/architecture/baseline-decisions.md` na seção apropriada:

```markdown
## Coverage thresholds — runtime-patch-1

Decisão pinada para PR1:

| Métrica | Threshold PR1 | Resultado | Spec original |
|---|---|---|---|
| Lines | ≥80% | 93.77% | ≥80% ✓ |
| Statements | ≥80% | 91.07% | ≥80% ✓ |
| Functions | ≥80% | 96.82% | ≥80% ✓ |
| Branches | ≥70% | 75.13% | ≥80% (relaxado) |

Branches threshold relaxado para 70% em PR1 como pragmatismo: branches são
historicamente mais difíceis de cobrir e 70% é threshold padrão de indústria.
Compensação: Issue #2 (PR3) eleva para ≥80% antes do baseline ser declarado
completo.
```

### Critério de aceitação Ação 4

- Texto adicionado em `baseline-decisions.md`.
- Referência inversa à Issue #2.

---

## Ordem de execução

1. **Ação 3** primeiro (10 min) — investigação rápida, descobre se há trabalho extra.
2. **Ação 1** (20-30 min) — E2E.7 + helper.
3. **Ação 2** (10 min) — `gh issue create` x2 (ou x3).
4. **Ação 4** (5 min) — texto em `baseline-decisions.md`.
5. Re-rodar `pnpm test`. 102 testes verdes (era 101).
6. Re-rodar `pnpm lint` e `pnpm typecheck`. Clean.
7. Commit único: `runtime-patch-1: pre-merge fixes (E2E.7 + issues + senha)`.
8. Push para `runtime-patch-1`.
9. Abrir PR de `runtime-patch-1` → `main` no GitHub.

---

## Output final esperado

Relatório curto (1-2 páginas) com:

1. Output de `gh issue list` mostrando as 2-3 novas issues.
2. Resultado da investigação da senha (qual caso A/B/C aplicou).
3. Diff dos arquivos novos/modificados (E2E.7 + helper, baseline-decisions.md, eventuais correções de senha).
4. `pnpm test` final: 102 testes verdes, coverage não regrediu.
5. SHA do commit pre-merge.
6. URL do PR criado.

---

## O que NÃO fazer neste patch

- Não tocar em código que não esteja listado nas 4 ações.
- Não amplificar escopo (PR2 vem depois).
- Não promover capability para `supported`.
- Não rodar Codex novamente — não há mudança suficiente para justificar terceiro round.
- Não alterar ADP v3 nem prompt v2.
- Não tagar release.

---

**Anexos referenciados:** `../docs/govai_adp_v3.md`, `../docs/govai_claude_code_prompt_v2.md`, `../docs/govai_runtime_patch_1_prompt_v2.md`.

**Fim do patch pre-merge.**
