# Real-user e2e (local) — governed + passthrough native chat, no UI

A user does NOT need a GovAI UI. They point their existing Anthropic/OpenAI SDK (or
curl) at the GovAI host instead of the provider host, authenticating to GovAI with
the **org** `x-govai-api-key` (the upstream provider key lives server-side). The
request/response shape is native; GovAI is a governed, audited drop-in:

- `POST /passthrough/anthropic/v1/messages` — audited pass-through (native in/out).
- `POST /governed/anthropic/v1/messages` — audited + DLP + risk + a six-mode enforcement decision.
- `GET /v1/capabilities`, `GET /v1/evidence/summary` — what the org may use; capture counts.

> ★ Note (source-verified): on `/governed/anthropic/v1/messages` the capability is
> `anthropic.messages.create` (**base_risk_class `A`**), and risk escalations do not
> chain. So a **CPF/CNPJ alone escalates only to effective `C` → decision `ask`
> (non-blocking)** — it is detected and audited, but does not 403. The deterministic
> **block** is a **risk-D tool** (`bash_20241022` → effective `D`) at
> `tier:starter`, `operational_mode:production` → `enforcement_blocked:D`.

## 0. Bring the API up

```bash
docker compose -f infra/docker-compose.yml up -d postgres
pnpm --filter @govai/api run migrate
pnpm --filter @govai/api run dev            # API on http://localhost:${API_PORT:-8080}
```

Seed an org at `tier:'starter'`, `operational_mode:'production'` + its `x-govai-api-key`
(the automated suite `tests/live/user-e2e.test.ts` does this via `seedOrg` +
`setTierMode`; expose a one-shot seed script if you want a hand key). Call it `$KEY`.

## 1. What can the org use?

```bash
curl -s http://localhost:8080/v1/capabilities -H "x-govai-api-key: $KEY" | jq
```

## 2. Governance BLOCKS — 403, ZERO spend, no real key needed

```bash
curl -i -s -X POST http://localhost:8080/governed/anthropic/v1/messages \
  -H "x-govai-api-key: $KEY" -H 'content-type: application/json' \
  -d '{
    "model": "claude-3-5-haiku-latest",
    "max_tokens": 100,
    "messages": [{ "role": "user", "content": "meu CPF é 111.444.777-35" }],
    "tools": [{ "type": "bash_20241022", "name": "sh" }]
  }'
# → HTTP/1.1 403
#   { "error":"governed_blocked", "reason":"enforcement_blocked:D",
#     "governance": { "effective_risk_class":"D", "enforcement_decision":"blocked",
#       "risk_escalation_reasons":["tool:anthropic_defined_client_executed_bash:d","dlp:cpf:pii_strong"] } }
```

The block returns **before** the upstream key is even resolved (structurally zero
spend), and the attempt is still audited (`enforcement_decision:'blocked'`,
`body_forward_mode:'blocked'`, no `native_response_hash`). Remove the `tools` line and
the same CPF body returns non-403 (`ask`) — CPF alone does not block at base A.

## 3. Passthrough — native-identical response (<< $0.01, budget-ack only)

Only with a real upstream key configured server-side and an explicit budget
acknowledgement (`GOVAI_LIVE_PROVIDER_BUDGET_OK=1`). `max_tokens:1` caps the spend:

```bash
curl -s -X POST http://localhost:8080/passthrough/anthropic/v1/messages \
  -H "x-govai-api-key: $KEY" -H 'content-type: application/json' \
  -d '{ "model":"claude-3-5-haiku-latest", "max_tokens":1, "messages":[{"role":"user","content":"hi"}] }' | jq
# → the NATIVE Anthropic shape: { "type":"message", "role":"assistant", "content":[...], "stop_reason":... }
```

## 4. See the audit land

```bash
curl -s http://localhost:8080/v1/evidence/summary -H "x-govai-api-key: $KEY" | jq '.counts'
# capture counts moved; with the collector up (observability-local.md), the same in Grafana.
```

## Run it as an asserted suite

`tests/live/user-e2e.test.ts` (out of CI) makes steps 2–4 repeatable and asserted at
**zero provider spend** (Part A: the 403 block + the `ask`/`observe` controls, stubbed
upstream). The optional Part B (real passthrough, << $0.01) is triple-gated and skips
unless `GOVAI_LIVE_PROVIDER_BUDGET_OK=1` + a real key are set:

```bash
pnpm test:live       # all tests/live (needs Docker); Part B skips without the budget-ack
```
