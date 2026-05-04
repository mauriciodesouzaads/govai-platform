# Passthrough Headers — allowlist/blocklist

## Inbound (cliente → GovAI)

Aceitos: `content-type`, `accept`, `accept-encoding`, `user-agent`, `anthropic-version`,
`anthropic-beta` (filtrado por allowlist — ver abaixo).

Auth do cliente: `Authorization: Bearer <govai_token>` ou `x-govai-api-key`.

Strip antes de forward para o provider:
- `authorization`, `x-api-key`, `x-govai-api-key`
- `host`, `connection`, `content-length`
- `via`, `x-forwarded-*`

## Outbound (GovAI → provider)

Adicionados:
- Anthropic: `x-api-key: <provider_key>`, `anthropic-version`, opcional `anthropic-beta`.
- OpenAI: `Authorization: Bearer <provider_key>`, opcional `OpenAI-Organization`.

## Response (provider → GovAI → cliente)

Repassados: `content-type`, `cache-control`, `x-request-id`, `<provider>-ratelimit-*`,
`openai-version`, body.

Strip: `set-cookie`, `via`, `x-forwarded-*`, headers que vazem account info.

Adicionados pela GovAI:
- `x-govai-run-id`
- `x-govai-audit-chain-id`
- `x-govai-policy-decision`
- `x-govai-capability-level`

## anthropic-beta allowlist

Baseline: **vazia**. Cliente passando `anthropic-beta` não-listado → 403 + audit
`passthrough.beta_denied` na chain `run`.

Para adicionar um beta header, abra PR adicionando à constante
`ANTHROPIC_BETA_ALLOWLIST` em `packages/provider-anthropic/src/index.ts`
e linkando ADR justificando o risco/benefício.

## Status

`planned` — implementação completa do passthrough (rota + audit) ficou para próximo
ciclo. SDK wrapper, header rewrite e allowlist enforcement já implementados em
`@govai/provider-anthropic` e `@govai/provider-openai`.
