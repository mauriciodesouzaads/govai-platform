# ADR-006 — Zero placeholders públicos

**Status:** accepted (baseline) — com nota honesta

Permitido: contratos internos (`Signer`), docs (`docs/contracts/`), capability `planned`.
Proibido: rota retornando "not implemented".

**Honest gap no baseline atual:** as rotas `/v1/runs`, `/v1/audit-events`, `/passthrough/*`,
`/v1/admin/*` retornam `503 pipeline_incomplete_in_baseline` em vez de não existirem.
Isto é uma violação parcial do ADR-006. A escolha foi tornar a violação **explícita
no payload** (em vez de silenciosa) para que clientes que tentem usar saibam imediatamente.

Plano: implementar pipeline completo (auth → tenant → capability → dlp → policy → invoke
→ audit-append → telemetry) em próximo ciclo.
