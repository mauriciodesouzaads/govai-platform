# Planned-capability execution guard

## Por que existe

Capabilities marcadas como `status = 'planned'` no `BASELINE_REGISTRY` representam
implementações **parciais em validação**: o pipeline interno (auth, tenant, RLS,
audit chain, DLP, policy, provider-invoke contra fixture hermética) está wired,
mas o caminho ainda não atende os 4 acceptance gates do ADP v3 §15 — em particular
falta live test verde recente contra provider real.

Permitir que clientes acionem essas capabilities contra providers reais antes da
promoção formal seria duplamente ruim:

1. Faz GovAI inadvertidamente endossar funcionalidade não-validada como pronta.
2. Quebra a contrato implícito do registry (se está em produção e responde 200,
   está validado).

A guard `assertCapabilityExecutable` em `apps/api/src/pipeline/capability-resolution.ts`
impõe que capabilities `planned` só executam quando **todas** as condições abaixo
são verdadeiras:

1. `NODE_ENV === 'test'` **OU** `GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION === '1'`.
2. `GOVAI_PROVIDER_BASE_URL` aponta para `127.0.0.1` ou `localhost` (regex
   `^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/`).
3. A capability foi resolvida via registry (não inferida).

Caso contrário a chamada falha com `403 capability_not_supported` e shape JSON
estruturado:

```json
{
  "error": "capability_not_supported",
  "capability": "<id>",
  "status": "planned",
  "reason": "Planned capabilities cannot execute outside hermetic test environment. See docs/architecture/baseline-decisions.md#runtime-roadmap.",
  "planned_phase": "PR2"
}
```

## Hardening de produção

`packages/config/src/index.ts` rejeita `GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION=1`
durante boot quando `NODE_ENV=production`:

```
BootError: GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION cannot be set in production.
Remove env var. Runbook: docs/runbooks/planned-capability-guard.md
```

Isto fecha o vetor "dev liga a flag em produção achando que vai funcionar".

## Quando remover a guard

Quando a capability for promovida para `status: 'supported'` no `BASELINE_REGISTRY`,
a guard naturalmente deixa de ser invocada para esse id. A promoção exige os 4
acceptance gates do ADP v3 §15 — ver checklist em `docs/architecture/adr/ADR-004-capability-registry-facets.md`.

## Por que não usar a coluna `status_override`

`status_override` existe no schema para que o **operador da org** possa rebaixar
uma capability supported para blocked. Não pode ser usado como bypass da guard
(é explicitamente downgrade-only e validado pelo `resolveEffectiveLevel`).

## Testes

`tests/integration/planned-capability-guard.test.ts` cobre:

- PCG.1 — `NODE_ENV='test'` + provider `127.0.0.1:<port>` → run executa, retorna 200.
- PCG.2 — `NODE_ENV='development'` (sem flag) → 403 `capability_not_supported`.
- PCG.3 — `NODE_ENV='test'` + `GOVAI_PROVIDER_BASE_URL=https://api.anthropic.com` → 403.
- PCG.4 — `NODE_ENV='production'` + `GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION=1` → boot fail.
