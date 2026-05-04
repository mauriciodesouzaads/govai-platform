# ADR-002 — Dois modos de operação

**Status:** accepted (baseline)

- **Governed Run** (primário): `/v1/runs/*`, `/v1/audit-events`, `/v1/capabilities`.
  Aplica todo o pipeline.
- **Provider Passthrough** (secundário): `/passthrough/{anthropic,openai}/*`.
  Preserva shape nativo. Substitui credencial. Adiciona governance headers.
  Level 1 baseline.
