# ADR-014 — Allow `files-api-2025-04-14` em ANTHROPIC_BETA_POLICY como global_allowlist

**Status:** accepted
**Data:** 2026-05-07
**Autores:** Mauricio de Souza + Claude (Batch A do PR2)
**Decisão de escalation prévia:** ESCALATION-A1 (Matrix v2 §15) — opção (A) aprovada.

---

## Context

A Anthropic Files API (`/v1/files` + 4 endpoints relacionados) é, no Macro Native
Substrate Contract (Addendum v4.2.2 §6.2), capability supported obrigatória. A
implementação Files exige o header `anthropic-beta: files-api-2025-04-14` em
todos os endpoints; sem este header, a Anthropic responde 4xx mesmo em GA.

PR1 introduziu `ANTHROPIC_BETA_ALLOWLIST` como lista vazia. PR2 substitui esse
mecanismo por `ANTHROPIC_BETA_POLICY` (Matrix v2 §13), que classifica cada token
em uma de 6 políticas: `global_allowlist`, `org_override_allowed`, `hard_denied`,
`verification_required`, `denied_until_decision`, `removed_as_no_longer_needed`.

Sem decisão arquitetural, o token ficaria em `denied_until_decision` ou
`org_override_allowed` — ambos exigem ato per-tenant para usar Files. Como Files
é capability `supported` em PR2 e nenhum tenant precisa fazer opt-in adicional
para usar uma capability supported, exigir override individual capa o produto.

## Decision

Promover `files-api-2025-04-14` à `global_allowlist` no momento de PR2,
referenciada por este ADR. Nenhum override de organização é necessário; o
header é injetado automaticamente pela rota `/passthrough/anthropic/v1/files*`.

Schema completo em `packages/provider-anthropic/src/beta-policy.ts`:

```typescript
{
  beta_token: 'files-api-2025-04-14',
  policy: 'global_allowlist',
  adr: 'ADR-014',
  reason: 'Files capability obrigatória em Macro Native Substrate Contract (Addendum §6.2)',
  source_doc: 'https://docs.claude.com/en/docs/build-with-claude/files',
  pinned_at: '2026-05-06T00:00:00Z',
}
```

A regra de aceitação `BETA_POLICY` (Matrix §4.2 pre-merge gate) é satisfeita
porque `policy === 'global_allowlist'` exige `adr` populado — o que está aqui.

## Consequences

### Positive

- Cliente que usa SDK oficial Anthropic com `baseURL: <govai>/passthrough/anthropic`
  consegue Files sem ato adicional — comportamento "Native-first, governance-around"
  do ADP v4.2 §1.2.
- Remove fricção de onboarding para uma capability obrigatória.
- A audit chain registra uso de Files via `passthrough.invoked v3` com
  `beta_allowlist_sources[].source = 'global_allowlist'` e este ADR como
  evidência arquitetural.

### Negative

- Anthropic pode rotar o header (ex.: futura versão `files-api-202X-XX-XX`).
  Quando isso acontecer, esta entry ficará obsoleta; o token novo cairá em
  `unknown_beta_token` → 403 com `passthrough.beta_denied`. Mitigação: um PR
  pequeno re-pinando a versão (sem novo ADR se for apenas bump de data; com
  novo ADR se mudança semântica).
- `global_allowlist` significa que toda org tem acesso, mesmo as que não usam
  Files. Não é problema operacional (tenant que não usa Files não envia
  upload), mas em audit reports a métrica "orgs com Files-API beta ativo"
  deixa de ser per-org.

### Neutral

- A política `verification_required` para `prompt-caching-2024-07-31` permanece
  como está (Matrix §13). Resolução desse token é trabalho separado; este ADR
  não a substitui. Em PR2 production, o boot guard
  `assertNoVerificationRequiredInProd` (Decisão 2 do Batch A) impede production
  enquanto qualquer token estiver em `verification_required`.
- `ADR-015` (prompt-caching) e `ADR-016` (message-batches) **não** são gerados
  por este ADR. Suas decisões dependem de verificação técnica posterior
  (cache_control nativo) e da promoção/não-promoção do Batch D, respectivamente.

## Riscos

| Risco | Mitigação |
|---|---|
| Anthropic rotar o token | PR + re-pin de versão (rev pequeno) |
| Cliente passar `anthropic-beta: files-api-2025-04-14` em rota não-Files | Forwardable ainda assim — o token está em allowlist global; pior caso é overhead pequeno |
| Token futuro `files-api-202X-XX-XX` ainda não pinado | `unknown_beta_token` → deny estruturado + `passthrough.beta_denied` |

## References

- ADP v4.2 §14 (Provider Coverage)
- Addendum ADP v4.2.2 §6.2 (Macro Native Substrate Contract — Files obrigatória)
- Matrix v2 §13 (`ANTHROPIC_BETA_POLICY`)
- Matrix v2 §15 ESCALATION-A1 (decisão fixada)
- Peça A v2 §7.3 (ANTHROPIC_BETA_POLICY canônica)
- `packages/provider-anthropic/src/beta-policy.ts` — implementação
- `packages/provider-anthropic/__tests__/beta-policy.test.ts` — testes

## Tests associados

- `beta-policy.test.ts` — 9 entries; valida que `files-api-2025-04-14` resolve
  com `decision='allow', source='global_allowlist'`.
- `boot-guard.test.ts` — 4 cenários: production+verification_required → fail;
  test/dev permite; production sem verification_required → ok; production
  com `removed_as_no_longer_needed` → ok.
- Integration: rota `/passthrough/anthropic/v1/files` (5 endpoints) faz
  forward com header injetado e audit `passthrough.invoked v3`.
