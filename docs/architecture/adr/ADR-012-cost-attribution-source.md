# ADR-012 — Cost attribution com procedência

**Status:** accepted (baseline)

`provider_invocations.usage_json.source` obrigatório:
`provider_direct | estimated_from_chunks | estimated_from_text`.

Implementação: `extractAnthropicUsage` e `extractOpenAIUsage` retornam `source: 'provider_direct'`
quando o provider retorna usage; chunked/text estimation são `planned`.
