# ADR-003 — Provider-native, sem abstração lossy

**Status:** accepted (baseline)

Não criar `GenericLLMRequest`/`GenericLLMResponse`. O comum é o
`GovernanceEnvelope<TNativeRequest, TNativeResponse>`. Anthropic permanece Anthropic;
OpenAI permanece OpenAI.

Implementação: `@govai/provider-anthropic` e `@govai/provider-openai` expõem o tipo
nativo do SDK (`Anthropic`, `OpenAI`) sem wrapping.
