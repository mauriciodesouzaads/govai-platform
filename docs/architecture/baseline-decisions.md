# Baseline Decisions — GovAI Platform

Resolução das open questions do ADP v3 §17 e do prompt operacional v2 §2.

## Fontes canônicas externas

Este monorepo (`govai-platform/`) é gerado a partir de duas fontes canônicas que vivem **fora** dele, em `../docs/`:

- `../docs/govai_adp_v3.md` — Architecture Decision Packet v3 (fonte exclusiva de verdade arquitetural).
- `../docs/govai_claude_code_prompt_v2.md` — Prompt operacional v2 (Claude Code).

SHAs registrados no §5.14 do output final.

A pasta `docs/` interna deste monorepo contém apenas docs do projeto (ADRs, contracts, runbooks). Ver `source-spec.md`.

## Decisões pinadas

| # | Pergunta (ADP §17) | Decisão | Justificativa |
|---|---|---|---|
| 1 | Postgres version | `postgres:16-alpine` (Docker tag) | LTS, suficiente para Testcontainers; Postgres 17 sem benefício mensurável no baseline. |
| 2 | `@opentelemetry/semantic-conventions` | `1.40.0` | Versão estável do registry npm em 2026-05-03 (`npm view`). |
| 3 | TypeScript 5.x exato | `5.9.3` | Maior 5.9.x estável no registry. TS 6 = pós-baseline (ADP §3). |
| 4 | Testcontainers strategy | Shared container per test file + `BEGIN`/`ROLLBACK` por teste, **exceto** suítes append-only (audit chain) que precisam commit real para validar triggers e advisory locks. | Reduz tempo de boot vs. container-per-test, mantém isolamento via transação. Append-only não pode usar rollback porque o teste é justamente sobre commit. |
| 5 | Hash de API key | **argon2id** (`argon2@0.44.0`) | Constant-time, melhor resistência a GPU, build verificado em Node 24. Pinado. |
| 6 | Anthropic `anthropic-beta` allowlist | Lista vazia hardcoded; cliente passando beta não-listado → 403 + audit `passthrough.beta_denied`. | Ver `docs/contracts/passthrough-headers.md`. Expandir requer PR explícito. |
| 7 | OpenAI Responses + Chat Completions | Ambas implementadas | Capability registry distingue. Capabilities: `openai.responses.create`, `openai.responses.stream`, `openai.chat.completions.create`, `openai.chat.completions.stream`. |
| 8 | Streaming hash agregação | **Final-only** (hash do response completo após stream encerrar) | Janela 1s = `planned` (capability `*.stream.realtime_audit`). |

## Versões pinadas

Ver `package.json` raiz e cada `packages/*/package.json`. Tabela completa no relatório §5.3.

## Node

Node 24 LTS Active (`v24.15.0` instalado via nvm). Node 22 fica como fallback emergencial documentado no ADR-013 (não usado em CI).

## Hashes das fontes canônicas (reproducibilidade)

- `../docs/govai_adp_v3.md` SHA-256: `a37669aecb273ff3e6c6f64f6445c88adb594ac53fa836e5b8ed4a094caa2f5f`
- `../docs/govai_claude_code_prompt_v2.md` SHA-256: `4ee63a2ea3896ea358c8ab4702d95dace71363c72e9ebc1c52de6f044042605c`

## Decisões adicionais tomadas em runtime

- ADR-013 — Node 24 instalado on-the-fly via `nvm install 24` no início da execução. Ambiente original tinha apenas Node 22.22.2.
- `canonical_bytes` adicionado preventivamente em `audit_events` (fallback §14.5 aplicado como baseline). Documentado em `docs/runbooks/canonical-reconstruction-fallback.md`.
- Capabilities runtime (`anthropic.messages.*`, `openai.responses.*`, `openai.chat.completions.*`) marcadas como `planned`, não `supported`, porque as rotas equivalentes ainda retornam 503. Decisão pós-Codex normal #1.
- `crypto_shred` SQL function exige session var `app.crypto_shred_authorized = 'true'` setada pelo app após RBAC check. Defense-in-depth pós-Codex security audit #2.
- Trigger `audit_event_payloads_restrict_update` agora exige `dek_wrapped IS NULL` E `shredded_at IS NOT NULL` para QUALQUER transição saindo de `active` (não só `crypto_shredded`). Defense-in-depth pós-Codex security audit #1.
