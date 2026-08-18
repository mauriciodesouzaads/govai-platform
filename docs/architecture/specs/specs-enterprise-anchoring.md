> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** ACCEPTED_TARGET_DESIGN
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12; authored 2026-07-10 at f975533d, Briefing #8)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; PR-0 header retained below as history)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D11=ACCEPT_AS_TARGET_DESIGN)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES (byte-identical below this header, incl. the PR-0 header)
> **SOURCE_SHA256:** `4743286d1f31625c90f3e739e5075910cf1ecd8d4e4485e05261f58c81573b05` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** ACCEPTED AS TARGET DESIGN (D11) — ONE status: *Accepted as target design; NOT implemented*. The PR-0 header's "ACEITA — NÃO IMPLEMENTADA" is the authority label; the body's `[NOVO — PROPOSTO]` / `[ALVO DOCUMENTADO → spec de implementação]` tags are IMPLEMENTATION-STATE labels for each of the four specs (Connector §A, Evidence Package §B, Crosswalk §C, Anchoring §D) and remain accurate — none of the four exists in the runtime at the Foundation V1 anchor (source-verified in the body's own §"Fatos verificados" at f975533d and unchanged: no `evidence_anchors`, `evidence_packages`, `crosswalk_cells`, `external_evidence_events` or `/v1/connectors`). Body byte-preserved (large target-design document; §16 large-document policy). Anchoring is a POST-seal upgrade design (the 0001:317 append guard stays) — see §D.2; the `docs/contracts/{evidence-anchoring,tsa-rfc-3161,icp-brasil}.md` files are untouched by M3.
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** ACEITA — NÃO IMPLEMENTADA (4 specs de receita: Connector §A · Evidence Package §B · Crosswalk §C · Anchoring §D — o moat)
> **BASE DECLARADA PELO DOCUMENTO:** base f975533d (2026-07-07/10) — anterior ao #118 · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** Sequência pelo Mapa §6 (Merkle PR-A na Fase 1; §B+seed §C na Fase 2; RFC3161/ICP nas fases 3+); complementa docs/contracts/{evidence-anchoring,tsa-rfc-3161,icp-brasil}.md (edit E13).
> **ORIGEM:** handoff GOVAI-SPECS-ENTERPRISE_ANCHORING (renomeado)
> ---

# GOVAI — AS 4 SPECS DE MAIOR RETORNO COMERCIAL (Connector Framework · Evidence Package · Compliance Crosswalk · Anchoring externo)

**Base:** `f975533d122afab251742c9459a12acc095dd8fb` (snapshot `git archive` verificado). **Autor:** Fable 5 / Claude Code, 2026-07-10. **Briefing:** #8 (última rodada).
**Relação com a série:** expande o EXECUTION-MANUAL §21.3/§21.4/§21.5 e o plano-mestre; nada aqui re-decide o que já é normativo. Cada spec é implementável por um agente sem re-decidir arquitetura, com PRs granulares e critério comercial "Pronto-para-vender".

**Fatos verificados NESTA sessão (os load-bearing das 4 specs):**
1. **Nenhuma das 4 features existe** — grep vazio por `evidence_anchors|evidence_packages|crosswalk_cells|external_evidence_events|/v1/connectors` em apps/ e packages/ `[CODE]`. Todas `[NOVO — PROPOSTO]` (anchoring: `[ALVO DOCUMENTADO → spec de implementação]`).
2. **O que a 0001 JÁ reserva para anchoring** `[CODE] apps/api/src/db/migrations/0001_audit_chain.sql`: `chain_anchor_id uuid NULL` (:47); `evidence_strength` DEFAULT 'hmac_internal' com CHECK aceitando os 5 graus (:48-51: `hmac_internal, dev_signed, external_anchor, customer_signed, icp_brasil_tsa`); e o **guard em `audit_append_locked`** (:317-319): `p_evidence_strength NOT IN ('hmac_internal','dev_signed') → RAISE 'not implemented in baseline'`. NÃO existe tabela de âncora/Merkle/lote — tudo a construir.
3. ★ **Refinamento do briefing, ancorado na fonte (§D):** o guard da :317 é de **APPEND-time**, e `audit_events` é IMUTÁVEL por trigger (`audit_no_modify_row`, 0001:178-204). Logo o anchoring TSA/Merkle/ICP não é "remover o guard": o evento **nasce** `hmac_internal` (o guard fica) e **ganha** o grau **pós-selagem**, por uma exceção estreita de trigger + função SECURITY DEFINER — exatamente o precedente que a própria 0001 já tem para o crypto-shred (`audit_event_payloads_restrict_update`, :218-270, que permite SÓ a transição de shred). O único grau que um dia mexeria no guard de append é `customer_signed` nascido-assinado (fase 3). Detalhe no §D.2.
4. **O vocabulário de proveniência REAL no código** `[CODE] packages/dlp-br/src/sensitive-provenance.ts`: `SensitiveDataSourceQuality = primary_govai_evidence(4) > provider_generated(3) > customer_attested(2) > normalized_external(1) > unverified_external(0)` + o motor puro `decideSourcePrecedence` (:169-206) com a invariante "nativo nunca é rebaixado; sinal externo mais estrito vira `escalation` metadata, nunca override". O `trust_level` do ExternalEvidenceEvent MAPEIA para esse motor (§A.3) — não se inventa um segundo motor de precedência.
5. **O verificador existente** `[CODE] packages/core-audit/src/verify.ts`: `verifyFullChain` (:28) e `verifyTailWindow` (:109) — a base que o §D estende.
6. **O padrão de worker a espelhar** `[CODE] apps/audit-sealer/`: claim-loop com `claimBatch/maxInFlight/idleSleepMs/emptyBackoff{Min,Max}Ms` (config.ts:25-29), URL própria de banco (:12), descoberta de orgs pelo enumerator (INV-1), readiness fail-loud, bundle esbuild.
7. **A semente REAL do crosswalk** `[DOC] regulatory/01-lgpd-anpd-mapping.md:99-119`: a tabela LGPD JÁ mapeada com status e evidência de repo (Art. 46 ×4 COVERED com citações; Art. 37 RoPA GAP; Art. 18 DSR GAP; Art. 48 incidente GAP; Art. 9/49 PARTIAL) + `[DOC] regulatory/06-evidence-chain-custody.md:123-125` (as 3 linhas de anchoring GAP "reserved value only") + a taxonomia normativa em `regulatory/README` e os domínios em `regulatory/20`.

**Convenções herdadas:** status por capacidade; fontes tipadas; claims discipline (nada de "certificado"/"validade jurídica" até implementado E validado); proveniência PRIMARY nunca por ingestão; PRs pequenos ordenados (schema → vertical fino → generalização → maior risco por último).

---
---

# §A — CONNECTOR FRAMEWORK (o maior ticket enterprise) — `[NOVO — PROPOSTO]`

## A.1 Objetivo, persona, user stories

**Objetivo:** materializar a doutrina "standalone E integrada": GovAI **exporta** a evidência de governança de IA para o stack que o cliente enterprise JÁ opera (SIEM/GRC) e, depois, **ingere** sinais externos como evidência classificada por proveniência — normaliza, correlaciona e reporta sobre Purview/OneTrust/ServiceNow/SIEM/cloud-governance sem jamais deixar sinal ingerido sobrepor evidência primária.
**Personas e prioridade por persona** (manual §12): **CISO → export SIEM primeiro** (o evento de IA governada dentro do SOC que ele já opera — o maior ticket); DPO → correlação Purview/BigID (ingestão, fase 2); Jurídico → work-items ServiceNow (export GRC, fase 1.5).
**User stories:**
- (CISO) "Cada bloqueio, detecção de PII e decisão de governança da GovAI aparece no meu Splunk/Sentinel no formato nativo, com severidade mapeada, minutos depois de selado — sem eu operar nada novo."
- (DPO) "Quando o Purview rotula um documento que também passou pela GovAI, eu vejo os dois sinais correlacionados — com o selo de que o sinal externo é ingerido, não primário."
- (Jurídico) "Um item de revisão da GovAI abre um work-item no meu ServiceNow com o link de evidência."

## A.2 Estado atual `[na fonte]`

- Export hoje = SÓ OTel/OTLP de MÉTRICAS do operador (`server.ts:116`; contadores/gauges) — não é evidência por-evento. `[IMPLEMENTADO]` mas fora de escopo de tenant.
- Ingestão/normalização/correlação: **inexistentes** (grep vazio). `[LACUNA]`.
- O que JÁ existe e a spec REUSA: o vocabulário de proveniência + motor de precedência `[FUNDACIONAL — sensitive-provenance.ts]` (inclusive os source_surfaces `connector_microsoft/aws/google/...` já tipados :27-35); o padrão de worker assíncrono (sealer); o padrão de credencial envelope-KMS (0009); o padrão de outbox com CHECKs anti-payload (0025); a matriz de responsabilidade nativo-vs-connector `[DOC] regulatory/16` (§Responsibility matrix + §Evidence flow model); o threat model T6 `[MIRROR] threat-model.md` (envenenamento por conector).

## A.3 O contrato `ExternalEvidenceEvent` e a regra de proveniência

**O contrato (ingestão) — todos os campos:**
```ts
export const TrustLevel = z.enum([
  'PRIMARY_GOVAI',      // NUNCA aceito por ingestão (CHECK no schema + Zod)
  'INGESTED_PROVIDER',  // log/flag do provedor de IA (Bedrock/Vertex/Azure OpenAI/OpenAI Compliance)
  'INGESTED_GRC',       // Purview/OneTrust/ServiceNow/BigID/Securiti
  'INGESTED_DLP',       // DLP corporativo (Netskope, Purview-DLP...)
  'DERIVED',            // derivado de relato de terceiro (não-observado por sistema)
  'DECLARATIVE',        // informado por usuário/tenant (atestado)
]);
export const ExternalEvidenceEvent = z.object({
  source_system: z.string().min(1).max(120),          // ex.: 'microsoft_purview'
  source_event_id: z.string().min(1).max(256),        // idempotência: UNIQUE(connector, source_event_id)
  occurred_at: z.string().datetime(),                 // ISO-8601 UTC (do sistema-fonte)
  actor: z.object({ kind: z.enum(['user','service','agent','unknown']), ref: z.string().max(256).optional() }),
  tenant: z.string().uuid().optional(),                // org alvo; default = a org do conector
  provider: z.string().max(64).optional(),             // provedor de IA envolvido, se houver
  ai_system: z.string().max(256).optional(),           // ref ao registry regulatório (ai_systems), se correlacionável
  action: z.string().min(1).max(120),                  // vocabulário do sistema-fonte, preservado
  input_classification: z.string().max(120).optional(),   // rótulo do FONTE (ex.: label Purview)
  output_classification: z.string().max(120).optional(),
  policy_decision: z.string().max(120).optional(),      // a decisão que o FONTE tomou (não a nossa)
  native_risk_signal: z.string().max(200).optional(),   // sinal bruto tipado do fonte
  raw_ref: z.string().max(512).optional(),              // ponteiro para o registro no sistema-fonte (URL/id) — NUNCA conteúdo
  normalized_ref: z.string().uuid().optional(),         // preenchido pela normalização (fase 2)
  trust_level: TrustLevel,                              // ≠ PRIMARY_GOVAI (validado 2×)
  evidence_hash: z.string().regex(/^[0-9a-f]{64}$/),    // sha256 hex do registro-fonte como recebido
});
```
**★ O mapeamento trust_level → o motor de precedência EXISTENTE** (a decisão que evita um segundo motor):
| trust_level (evento) | source_quality (código, `sensitive-provenance.ts:58-64`) | rank |
|---|---|---|
| PRIMARY_GOVAI | `primary_govai_evidence` | 4 — **inatingível por ingestão** |
| INGESTED_PROVIDER | `provider_generated` | 3 |
| DECLARATIVE | `customer_attested` | 2 |
| INGESTED_GRC / INGESTED_DLP | `normalized_external` | 1 |
| DERIVED | `unverified_external` | 0 |
★ **Divergência declarada e resolvida:** a cadeia de exibição do manual (`…INGESTED_DLP > DERIVED > DECLARATIVE`) põe DECLARATIVE por último; o motor implementado ranqueia `customer_attested(2) > normalized_external(1)`. Para **precedência de merge** vale O MOTOR DO CÓDIGO (não se bifurca a regra); para exibição, a UI ordena por trust_level como taxonomia de ORIGEM. A invariante em que ambos concordam — e a única com efeito de segurança — é: **nada ingerido/declarado alcança `primary_govai_evidence`**, e sinal externo mais estrito vira `escalation` metadata (nunca override) — `decideSourcePrecedence:178-189`.

## A.4 Schema SQL completo (migração aditiva, padrão da casa: RLS FORCE + policies + imutabilidade onde é evidência)

```sql
-- 00XX_connector_framework.sql — Parte A (PR-A). SET ROLE govai_audit_writer; idempotente.

CREATE TABLE IF NOT EXISTS govai.connectors (
  id              uuid PRIMARY KEY,
  org_id          uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN (
                    'splunk_hec','ms_sentinel','elastic','datadog','generic_cef_syslog',
                    'servicenow','onetrust',
                    'ms_purview','bigid','securiti','aws_bedrock_cloudtrail','azure_openai','gcp_vertex','openai_compliance','anthropic_logs','github','slack_teams','custom')),
  direction       text NOT NULL CHECK (direction IN ('ingest','export','both')),
  display_name    text NOT NULL,
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- endpoint, índice/workspace, mapeamento; NUNCA segredo
  status          text NOT NULL DEFAULT 'disabled' CHECK (status IN ('active','disabled')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(config)='object'
         AND NOT config ? 'token' AND NOT config ? 'secret' AND NOT config ? 'password'
         AND NOT config ? 'api_key')                     -- segredo NUNCA em config (vai p/ credentials)
);

-- credencial do conector: espelha 0009_provider_credentials (envelope KMS, append-only + revoke)
CREATE TABLE IF NOT EXISTS govai.connector_credentials (
  id              uuid PRIMARY KEY,
  org_id          uuid NOT NULL,
  connector_id    uuid NOT NULL REFERENCES govai.connectors(id),
  purpose         text NOT NULL CHECK (purpose IN ('outbound_auth','inbound_auth')),
  encrypted_secret bytea NOT NULL,                       -- outbound: token/segredo do destino (envelope)
  dek_wrapped     bytea NULL,
  key_id          text NOT NULL, key_version integer NOT NULL,
  inbound_hash    text NULL,                             -- inbound: argon2id do bearer (verify sem decrypt)
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at      timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz NULL,
  CHECK (purpose <> 'inbound_auth' OR inbound_hash IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS connector_credentials_active_uq
  ON govai.connector_credentials (connector_id, purpose) WHERE status='active';
-- + triggers no_delete/no_truncate (padrão 0009)

-- watermark de export: até onde cada conector exportou, por cadeia (espelha audit_capture_chain_state)
CREATE TABLE IF NOT EXISTS govai.connector_export_state (
  connector_id    uuid NOT NULL REFERENCES govai.connectors(id),
  chain_id        text NOT NULL,
  org_id          uuid NOT NULL,
  last_enqueued_seq bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (connector_id, chain_id),
  CHECK (last_enqueued_seq >= 0)
);

-- o OUTBOX de export (espelha audit_capture_outbox: fila durável + estados terminais + anti-payload)
CREATE TABLE IF NOT EXISTS govai.connector_export_outbox (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          uuid NOT NULL,
  connector_id    uuid NOT NULL REFERENCES govai.connectors(id),
  audit_event_id  uuid NOT NULL,                         -- o evento SELADO a exportar
  chain_id        text NOT NULL, sequence_number bigint NOT NULL,
  normalized_json jsonb NOT NULL,                        -- a projeção congelada no enqueue (metadados+hashes; NUNCA payload)
  status          text NOT NULL DEFAULT 'enqueued'
                   CHECK (status IN ('enqueued','sending','delivered','failed')),
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error      text NULL CHECK (last_error IS NULL OR length(last_error) <= 200),
  enqueued_at     timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz NULL, failed_at timestamptz NULL,
  destination_ack text NULL,                             -- id/ack do destino (Splunk ackId etc.)
  UNIQUE (connector_id, audit_event_id),                 -- idempotência de enqueue (fan-out 1 evento × N conectores)
  CHECK (status <> 'delivered' OR delivered_at IS NOT NULL),
  CHECK (status <> 'failed' OR (failed_at IS NOT NULL AND last_error IS NOT NULL)),
  CHECK (jsonb_typeof(normalized_json)='object'
         AND NOT normalized_json ? 'prompt' AND NOT normalized_json ? 'response'
         AND NOT normalized_json ? 'raw_input' AND NOT normalized_json ? 'raw_output')
);
CREATE INDEX IF NOT EXISTS ceo_connector_status_idx
  ON govai.connector_export_outbox (connector_id, status, id);

-- eventos ingeridos (fase 2 — a tabela já nasce no PR-A para o CHECK ficar gravado)
CREATE TABLE IF NOT EXISTS govai.external_evidence_events (
  id              uuid PRIMARY KEY,
  org_id          uuid NOT NULL,
  connector_id    uuid NOT NULL REFERENCES govai.connectors(id),
  source_system   text NOT NULL, source_event_id text NOT NULL,
  occurred_at     timestamptz NOT NULL,
  actor_kind      text NOT NULL CHECK (actor_kind IN ('user','service','agent','unknown')),
  actor_ref       text NULL,
  provider        text NULL, ai_system_ref uuid NULL,
  action          text NOT NULL,
  input_classification text NULL, output_classification text NULL,
  policy_decision text NULL, native_risk_signal text NULL,
  raw_ref         text NULL,                              -- ponteiro, NUNCA conteúdo
  normalized_ref  uuid NULL,
  trust_level     text NOT NULL CHECK (trust_level IN
                    ('INGESTED_PROVIDER','INGESTED_GRC','INGESTED_DLP','DERIVED','DECLARATIVE')),
                    -- ★ PRIMARY_GOVAI AUSENTE do CHECK: irrepresentável por construção
  evidence_hash   bytea NOT NULL,
  ingested_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connector_id, source_event_id)                  -- idempotência de ingestão
);
-- + triggers no_update/no_delete/no_truncate (evidência ingerida é imutável)
-- + RLS ENABLE+FORCE + policies (app select/insert por org; writer select) em TODAS as tabelas acima
```
**Papel de banco novo:** `govai_connector_exporter` NOINHERIT NOLOGIN (bootstrap, não migração — regra spec-v2.1 §5.1): SELECT em `audit_events` (org-scoped, política própria), SELECT/UPDATE em `connector_export_state`+`connector_export_outbox`, SELECT em `connectors`/`connector_credentials`. Descoberta de orgs via o MESMO enumerator runtime URL do sealer (INV-1 preservado).

## A.5 O worker de export (espelho do sealer — mecânica exata)

**Deploy:** `apps/connector-exporter` (bundle esbuild + Docker non-root + compose profile — o template do sealer) OU um segundo loop no processo do sealer atrás de `CONNECTOR_EXPORT_ENABLED` `[recomendação: processo próprio — blast radius separado do selo; mesma imagem-base]`.
**Loop por org (org-discovery igual ao sealer):**
1. **Enqueue (watermark):** para cada conector `active` com `direction IN ('export','both')`: ler eventos SELADOS com `sequence_number > last_enqueued_seq` por cadeia (join outbox `status='sealed'` OU direto de `audit_events` — fonte: `audit_events`, que é o fato selado), projetar → `normalized_json`, INSERT no outbox (ON CONFLICT DO NOTHING pela UNIQUE), avançar `last_enqueued_seq` na MESMA transação. ⇒ nenhum evento pulado (watermark só avança com enqueue durável).
2. **Deliver (claim):** claim de lote `enqueued` (`FOR UPDATE SKIP LOCKED`, `claimBatch` default 10) → `sending` → POST ao destino via adapter → `delivered` (+ack) OU `attempts++` com backoff exponencial (`emptyBackoffMin/Max` como o sealer); `attempts > max (default 10)` → `failed` (dead-letter visível na UI; retry manual re-enfileira).
3. **Ordem e perda:** ordem por (chain_id, seq) dentro do conector; entrega at-least-once (o destino deduplica por `event_id` — incluído na projeção); NUNCA perda silenciosa: falha permanente = `failed` contável (métrica `govai_connector_export_failed_total`) + saúde do conector na UI.
**Config (env, padrão sealer):** `CONNECTOR_EXPORTER_DATABASE_URL`, `..._ENUMERATOR_DATABASE_URL`, `..._CLAIM_BATCH`, `..._MAX_ATTEMPTS`, `..._IDLE_SLEEP_MS`, `..._BACKOFF_{MIN,MAX}_MS`.

**A projeção `normalized_json` (o registro canônico de export — só metadados+hashes):**
```json
{ "schema": "govai.export.v1", "event_id": "…", "org_id": "…", "chain_category": "run",
  "sequence_number": "123", "event_type": "passthrough.invoked", "event_version": "4",
  "subject_type": "run", "subject_id": "…", "occurred_at": "…",
  "payload_hash": "hex", "hmac": "hex", "canonical_hash": "hex",
  "evidence_strength": "hmac_internal",
  "governance": { "enforcement_decision": "…", "effective_risk_class": "…", "provider": "…", "capability_id": "…", "status_code": 403 },
  "trust_level": "PRIMARY_GOVAI" }
```
(`governance` vem da projeção de captura quando o evento é v4; ausente para eventos de outras cadeias. `trust_level: PRIMARY_GOVAI` no EXPORT é correto — é a evidência primária saindo; a proibição é na INGESTÃO.)

**Adapters de destino (PR-B um; PR-C demais):**
| Destino | Transporte | Formato | Severidade |
|---|---|---|---|
| **Splunk HEC** (PR-B) | POST `/services/collector/event`, header `Authorization: Splunk <token>` (envelope KMS) | `{time, host:'govai', source:'govai:audit', sourcetype:'govai:evidence', event: normalized_json}` | `blocked/denied→high`, `ask/sandbox→medium`, resto→info |
| MS Sentinel | Logs Ingestion API (DCR) | tabela custom `GovAIEvidence_CL` com colunas = projeção | idem |
| Elastic | bulk API | ECS: `event.kind=event`, `event.category=configuration/intrusion_detection` (por decisão), `event.action=event_type`, campos govai.* custom | `event.severity` |
| Datadog | logs intake | JSON com `ddsource:govai`, `service:govai-api` | `status` |
| CEF/syslog genérico | syslog TLS | `CEF:0\|GovAI\|TrustLayer\|1.0\|<event_type>\|<label>\|<sev>\|` + extensões chave=valor | mapa fixo |
| ServiceNow (GRC) | Table API `POST /api/now/table/incident` (ou tabela GRC) | work-item com short_description + link `raw_ref` de volta à GovAI + hashes | prioridade |
| OneTrust | API de evidência/assessment | registro de evidência com hash + ref | n/a |
Adapter = função pura `(normalized_json, config) → {url, headers, body}` + verificação de ack — **adicionar destino é um adapter + uma linha no CHECK de `kind`, ZERO mudança no worker** (critério do PR-C).

## A.6 Endpoints (config + ingestão)

```
GET    /v1/connectors                       → lista (sem segredos) — admin
POST   /v1/connectors                       → cria {kind, direction, display_name, config} — admin
PATCH  /v1/connectors/:id                   → config/status — admin
POST   /v1/connectors/:id/credentials       → define credencial outbound (segredo one-way, envelope) OU gera inbound token (retorna UMA vez) — admin
POST   /v1/connectors/:id/credentials/:cid/revoke — admin
GET    /v1/connectors/:id/health            → {export: {enqueued, delivered_24h, failed, last_delivery_at}, ingest: {events_24h, last_event_at}} — admin
POST   /v1/connectors/:id/events            → INGESTÃO (PR-D): body ExternalEvidenceEvent[] (≤100/lote)
```
**Auth da ingestão:** `Authorization: Bearer <inbound token do conector>` — verificado por argon2 contra `connector_credentials.inbound_hash` (padrão api-keys reusado), escopado ÀQUELE conector (org derivada dele). **NUNCA a chave de tenant.** Erros: 401 token; 403 conector disabled/direction=export; 422 `trust_level=PRIMARY_GOVAI` (Zod) — e mesmo que o Zod falhasse, o CHECK do banco o torna irrepresentável; 409 nunca (idempotente: duplicata → 200 com `{deduplicated:true}`).
**Eventos de auditoria (cadeia `admin`):** `connector.created`, `connector.config_changed`, `connector.credential_set/revoked`, `connector.export_failed_threshold` (saúde); (cadeia `run`): `connector.events_ingested {connector_id, count, trust_level_histogram}` — a ingestão é ela mesma evidenciada.

## A.7 Telas (área Conectores — componentes Ledger)

1. **/connectors** — DataTable (kind, direction, status StatusBadge, saúde: entregues-24h/failed com cor semântica); "Adicionar conector" (FormSheet por kind; config gerada do Zod do adapter).
2. **/connectors/:id (export)** — saúde do destino (tiles: enfileirados/entregues/failed + last_delivery); dead-letter com retry (ConfirmModal com consequência: "reenvia N eventos ao destino"); credencial one-way ("o token nunca é exibido de novo" — padrão provider-credentials).
3. **/connectors/ingest** — fontes com **ProvenanceBadge** (o componente 11 do design system) por trust_level; contadores por fonte; a frase normativa fixa: *"sinal ingerido nunca sobrepõe evidência primária; sinais mais estritos aparecem como escalação"*.

## A.8 Testes

- **Unit:** projeção `normalized_json` (nunca payload; CHECK-shape); cada adapter (formato exato por destino, golden files); mapeamento trust_level→source_quality; severidade.
- **Integração:** RLS/CHECKs do schema (PRIMARY irrepresentável; UNIQUEs); enqueue-watermark (evento selado novo → 1 linha por conector ativo; re-run não duplica); deliver com destino mockado (Splunk HEC fake: ack→delivered; 500→retry/backoff; permanente→failed); credencial nunca em plaintext (teste padrão 0009); ingestão idempotente (2× mesmo source_event_id → 1 linha + deduplicated); ingestão com PRIMARY → 422; conector disabled → 403; evento de auditoria da ingestão emitido.
- **O que provar (T6):** um conector ingest comprometido NÃO consegue: criar evidência primária (CHECK), alterar decisão de runtime (nada lê external_events em enforcement), ler evidência de outra org (RLS), nem injetar conteúdo (metadata-first: sem campo de conteúdo no contrato).

## A.9 Critérios de aceite

- **Técnico:** os 4 do briefing — idempotência de ingestão; PRIMARY rejeitado (2 camadas); export sem perda silenciosa (watermark+outbox+dead-letter contável); credencial nunca em plaintext. + adapter novo sem tocar o worker.
- **★ Pronto-para-vender:** *um evento de governança da GovAI (ex.: o 403 de `enforcement_blocked:D`) aparece, no formato nativo, dentro do Splunk (ou Sentinel) de um cliente real — o CISO vê a atividade de IA governada no SOC que ele já opera, com severidade certa e link de volta.*

## A.10 Plano de PRs (fatias pequenas, ordenadas)

| PR | Conteúdo | Critério de saída |
|---|---|---|
| **A** — schema | migração (connectors, credentials, export_state, export_outbox, external_evidence_events) + role no bootstrap + RLS/CHECKs/triggers | migração idempotente 2×; testes de RLS/CHECK verdes; PRIMARY irrepresentável; NENHUMA rota |
| **B** — export vertical fino | worker (enqueue+deliver) + adapter **Splunk HEC** + credencial outbound (envelope) + `GET/POST /v1/connectors` mínimo + health | 1 evento selado de teste chega ao HEC mockado no formato exato; claim/retry/backoff provados; watermark não pula nem duplica |
| **C** — generalizar destinos | adapters Sentinel/Elastic/Datadog/CEF + ServiceNow/OneTrust; PATCH/credentials/revoke; telas 1-2 | golden-file por destino; "novo destino = adapter+CHECK, worker intocado"; dead-letter com retry na UI |
| **D** — ingestão (fase separada, T6 antes) | `POST /v1/connectors/:id/events` + inbound token + tela 3 + evento de auditoria da ingestão + o T6 documentado/testado (A.8) | idempotência; PRIMARY 422; metadata-first (contrato sem conteúdo); trust_level→escalation via `decideSourcePrecedence` num consumidor de exemplo |

**Riscos e mitigações:** T6 (export-first; metadata-first; CHECK; motor de precedência); credencial de destino (envelope KMS obrigatório; one-way); volume (outbox indexado por conector+status; claim SKIP LOCKED); responsabilidade (a matriz de `regulatory/16` no contrato comercial: GovAI entrega o export; o SIEM do cliente é sistema do cliente).

**O que um agente implementa a partir daqui:** PR-A inteiro (é só schema — o padrão 0009+0025 dita tudo), depois PR-B com o Splunk HEC fake nos testes de integração; PR-D SÓ depois do threat-model T6 revisado pelo dono.
---
---

# §B — EVIDENCE PACKAGE / CASE EXPORT — `[NOVO — PROPOSTO]`

## B.1 Objetivo, persona, user story

**Objetivo:** o pacote auditável por incidente/caso — o artefato que o jurídico/auditor COMPRA: timeline + decisões + hashes + status de selagem + ressalvas, exportável e **verificável por terceiro sem confiar na GovAI**.
**Persona:** Jurídico/Compliance (compõe o dossiê do caso); Auditor (verifica); DPO (anexa ao relatório).
**User story:** "Como jurídico, componho o pacote do incidente X (janela + filtros + itens), exporto JSON/PDF, e um auditor externo confere cada hash contra a cadeia — o pacote se sustenta sozinho."

## B.2 Estado atual `[na fonte]`
Nenhuma rota de relatório/dossiê (`DOCUMENTED_TARGET_ONLY` no SoT); o que existe e a spec REUSA: a cadeia com `canonical_hash/hmac` por evento (0001), `canonicalize()`/`sha256` (`[CODE] core-audit/canonical-json.ts:15, hash.ts:3` — o manifesto usa O MESMO canonicalizador da cadeia), os EC-reports (`evidence-reports.ts`), a Review Queue (§N2 — decisões de revisor entram no pacote quando existirem), e o degrau 0 da UI ("Exportar esta consulta (JSON)").

## B.3 Schema SQL

```sql
CREATE TABLE IF NOT EXISTS govai.evidence_packages (
  id               uuid PRIMARY KEY,
  org_id           uuid NOT NULL,
  title            text NOT NULL CHECK (length(title) <= 200),
  window_start     timestamptz NOT NULL,
  window_end       timestamptz NOT NULL CHECK (window_end > window_start),
  filters          jsonb NOT NULL DEFAULT '{}'::jsonb,      -- {chain_categories[], subject_ids[], invariants[], include_gaps bool, item_ids[]}
  manifest         jsonb NOT NULL,                           -- congelado na composição (shape B.4)
  manifest_hash    bytea NOT NULL,                           -- sha256(canonicalize(manifest))
  anchor_proofs    jsonb NOT NULL DEFAULT '[]'::jsonb,       -- ★ o gancho do §D (vazio até PR-D de lá)
  created_by_user_id uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(manifest)='object'
         AND NOT manifest ? 'prompt' AND NOT manifest ? 'response'
         AND NOT manifest ? 'raw_input' AND NOT manifest ? 'raw_output')
);
-- imutável: triggers no_update*/no_delete/no_truncate (padrão 0001) — *exceção estreita: UPDATE permitido
-- SOMENTE em anchor_proofs '[]'→valor, via função SECURITY DEFINER evidence_package_attach_anchor()
-- (o precedente do shred: transição única, guardada por trigger). RLS ENABLE+FORCE + policies app/writer.
```

## B.4 O manifesto (shape EXATO — determinístico)

```jsonc
{
  "manifest_version": 1,
  "package": { "org_id": "…", "title": "…", "window": {"start":"…","end":"…"}, "filters": {…},
               "generated_at": "…", "generator": {"api_version":"…","commit":"f975533d"} },
  "items": [   // ordem DETERMINÍSTICA: (kind, chain_category, sequence_number, id) — mesma janela ⇒ mesmo hash
    { "kind":"audit_event", "id":"…", "chain_category":"run", "sequence_number":"123",
      "event_type":"passthrough.invoked", "event_version":"4", "subject_type":"run", "subject_id":"…",
      "occurred_at":"…", "payload_hash":"hex", "previous_hmac":"hex|null", "hmac":"hex",
      "canonical_hash":"hex", "evidence_strength":"hmac_internal" },
    { "kind":"policy_decision", "id":"…", "run_id":"…", "decision":"deny", "reasons":[…], "evaluated_at":"…" },
    { "kind":"review_decision", "id":"…", "review_item_id":"…", "decision":"deny", "reason":"…", "decided_at":"…" },
    { "kind":"dlp_signal", "run_id":"…", "detector":"cpf", "count":2,
      "caveat":"contagens podem sobrepor até o fix F6" },
    { "kind":"ec_gap", "invariant":"ec1", "row": {…} }
  ],
  "seal_status": { "ec1": {"total":n,"sealed":n,"failed":n,"stalled_past_slo":n}, "window_seconds":n, "t_seal_seconds":300 },
  "caveats": [
    "EC-6 (integridade de cadeia) está PENDING neste build — sem verificação persistida",
    "EC-3.drop é agregado com bound; o coletor OTLP é a fonte autoritativa",
    "contagens de DLP podem sobrepor (F6) até o fix",
    "evidence_strength=hmac_internal — sem âncora externa neste build (ver anchor_proofs)"
  ],
  "verification_instructions": "1) Para cada item audit_event, obtenha o evento por GET /v1/audit-events (chain_category, before_seq) e confira payload_hash, hmac e canonical_hash byte a byte. 2) Confira o encadeamento: previous_hmac de N == hmac de N-1 na mesma cadeia. 3) Recalcule manifest_hash = sha256(JSON canônico deste manifesto) e confira com o valor registrado. 4) A integridade provada é HMAC interna (a chave é da plataforma); quando anchor_proofs estiver preenchido, valide a raiz Merkle e o carimbo RFC 3161/ICP-Brasil de forma independente e offline (§D).",
  "self_description": "technical evidence bundle — not certification; não constitui parecer jurídico"
}
```
`manifest_hash` calculado com `canonicalize()` de `core-audit` (o MESMO canonicalizador da cadeia — um só conceito de canônico no produto). **Determinismo testável:** recompor a mesma janela+filtros ⇒ manifesto byte-idêntico ⇒ mesmo hash.

## B.5 Endpoints, autorização, eventos

```
POST /v1/evidence-packages           {title, window_start, window_end, filters} → compõe e CONGELA (201 {id, manifest_hash})
GET  /v1/evidence-packages           → lista (cursor composto) 
GET  /v1/evidence-packages/:id       → manifesto completo
GET  /v1/evidence-packages/:id/export?format=json|pdf → o bundle (json = manifesto+assinatura de instruções; pdf = B.6)
```
Erros: 400 janela>1 ano ou filtros inválidos (issues[] Zod); 404 cross-org; 422 janela sem NENHUM item (pacote vazio não se cria — honestidade). **Autorização:** compor/exportar `admin|data_protection_officer|auditor`; leitura idem (é artefato de caso, não dado operacional). **Eventos (cadeia `admin`):** `evidence_package.created {id, manifest_hash, window, item_count}` e `evidence_package.exported {id, format, by}` — **o acesso à evidência é ele mesmo auditado** (fecha a lacuna apontada no manual §24).

## B.6 O PDF (o dossiê que um comitê lê — layout)

Página 1 — capa: título, org, janela, manifest_hash em destaque (mono), gerado-em/por, a autodenominação e o disclaimer. Página 2 — sumário executivo: contagens por tipo de item, seal_status em tiles, AS RESSALVAS EM CAIXA (nunca rodapé). Páginas 3+ — timeline: um item por linha (hora, tipo, rótulo honesto da decisão — o vocabulário do design system, hash truncado); decisões de política/revisor com razão integral. Anexo A — a tabela de hashes completa (mono, uma linha por evento: seq, payload_hash, hmac). Anexo B — as instruções de verificação verbatim. Anexo C (quando §D existir) — a prova de âncora (root, caminho Merkle, token TSA em base64, instruções offline). Geração: HTML template → PDF (playwright/print CSS — sem dependência nativa nova) `[recomendação]`.

## B.7 Telas (Ledger)
**/cases** (lista: título, janela, itens, manifest_hash HashText, exportado-por-último) · **/cases/new** (wizard: janela → filtros → prévia de contagens → ConfirmModal com consequência: "o manifesto será CONGELADO; recompor a mesma janela gera hash idêntico") · **/cases/:id** (manifesto navegável + botão export + trilha de acessos do próprio pacote — os eventos `exported`).

## B.8 Testes
Manifesto congela (INSERT-only; UPDATE negado exceto anchor_proofs via função); determinismo (2× mesma janela ⇒ mesmo manifest_hash); nenhum payload no manifesto (CHECK + teste de shape); ressalvas SEMPRE presentes (mesmo pacote "limpo"); 422 em pacote vazio; export auditado (evento emitido); PDF: golden de estrutura (seções presentes); RLS 404 cross-org; anchor_proofs vazio até §D e imutável fora da função.

## B.9 Aceite
- **Técnico:** os do B.8 + integração com a cadeia real (cada hash do manifesto bate com `GET /v1/audit-events`).
- **★ Pronto-para-vender:** *o jurídico exporta o dossiê de um caso e um TERCEIRO (auditor/juiz) confere cada hash contra a cadeia de forma independente — o pacote se sustenta como evidência técnica sem confiar na palavra da GovAI (e declara com precisão o que ainda NÃO prova: âncora externa até o §D).*

## B.10 Plano de PRs
| PR | Conteúdo | Critério de saída |
|---|---|---|
| **A** — schema+compose | migração + `POST` (congela manifest+hash com canonicalize) + `GET` ×2 | manifesto congela; recompor ⇒ hash idêntico; RLS; 422 vazio |
| **B** — export JSON | `GET /:id/export?format=json` + instruções + eventos created/exported | não vaza payload; acesso auditado; hashes conferem contra a cadeia (teste de integração ponta-a-ponta) |
| **C** — export PDF | template HTML→PDF (layout B.6) | o PDF é legível por auditor não-técnico (seções golden); ressalvas em caixa |
| **D** — gancho de âncora | `anchor_proofs` + `evidence_package_attach_anchor()` (SECURITY DEFINER) + Anexo C no PDF | o campo existe e fica vazio até o §D PR-D; a função é o ÚNICO caminho de escrita |

**Riscos:** R12 (lido como certificação → autodenominação + disclaimer + ressalvas em caixa); pacote como vetor de exfiltração (só hashes/metadados; acesso auditado); PDF pesado (streaming/limite de itens com aviso "recorte").

**O que um agente implementa a partir daqui:** PR-A/B juntos formam o vertical fino (compose+JSON); o PDF (PR-C) só depois do JSON validado com um auditor real de teste.

---
---

# §C — COMPLIANCE CROSSWALK — `[NOVO — PROPOSTO]` (base documental PRONTA)

## C.1 Objetivo, persona, user story
**Objetivo:** Requirement→Control→Evidence→Status→Gap→Remediation→Owner com status DERIVADO de evidência VIVA — transformar o núcleo regulatório de "registro" em "prova de cobertura" que o DPO compra.
**Persona:** DPO (LGPD), Jurídico/Compliance (comitê), CISO (frameworks internacionais).
**User story:** "Como DPO, abro a matriz LGPD, vejo o % de cobertura derivado de evidência viva (não planilha), clico numa célula COVERED e vejo a CONSULTA que a sustenta — e exporto para o comitê."

## C.2 Estado atual `[na fonte]` — mais pronto do que parece
- A taxonomia é NORMATIVA e já definida: `COVERED/PARTIAL/GAP/NEEDS_SOURCE_VERIFICATION` (`[DOC] regulatory/README` + a regra "COVERED só com evidência concreta citada" em `regulatory/01:40-45`).
- ★ **A SEMENTE JÁ EXISTE COMO TABELA CURADA**: `regulatory/01-lgpd-anpd-mapping.md:99-119` mapeia a LGPD linha a linha COM status e evidência de repo (Art. 46 ×4 = COVERED com citações de migração/teste; Art. 37 RoPA = GAP; Art. 18 DSR = GAP; Art. 48 incidente = GAP; Art. 9/49 = PARTIAL; Art. 20 = GAP…). `regulatory/06:105-125` idem para custódia/anchoring. `regulatory/20` dá os domínios + "turns COVERED when…". O PR-C do seed é uma TRANSCRIÇÃO curada desses docs, não pesquisa nova.
- No schema: `regulatory_controls` + `regulatory_control_framework_mappings` (`[CODE] regulatory.ts:1474,1502`; migração 0016) ligam controle↔framework. Falta: a célula requirement-level, a ponta Evidence EXECUTÁVEL e o motor de status.

## C.3 Schema SQL — com a correção de segurança da evidence_query

★ **Endurecimento sobre o manual §21.5:** `evidence_query text` livre seria SQL arbitrário executável curado por admin/dpo — inaceitável. A célula referencia uma **query REGISTRADA em código** (allowlist tipada) + parâmetros:
```sql
CREATE TABLE IF NOT EXISTS govai.crosswalk_cells (
  id               uuid PRIMARY KEY,
  org_id           uuid NOT NULL,
  framework        text NOT NULL CHECK (framework IN ('LGPD','NIST_AI_RMF','ISO_42001','EU_AI_ACT')),
  requirement_key  text NOT NULL,            -- ex.: 'LGPD.Art46.encryption_at_rest'
  requirement_label text NOT NULL,           -- o texto humano do requisito
  control_id       uuid NULL REFERENCES govai.regulatory_controls(id),
  evidence_query_kind text NULL,             -- ★ id de query REGISTRADA (allowlist em código; nunca SQL livre)
  evidence_query_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  curated_status   text NOT NULL DEFAULT 'NEEDS_SOURCE_VERIFICATION'
                    CHECK (curated_status IN ('COVERED','PARTIAL','GAP','NEEDS_SOURCE_VERIFICATION')),
  gap_note         text NULL, remediation text NULL, owner_user_id uuid NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, framework, requirement_key),
  CHECK (curated_status <> 'COVERED' OR evidence_query_kind IS NOT NULL)  -- COVERED sem query é IRREPRESENTÁVEL
);
-- RLS FORCE + policies; mutação emite evento na cadeia policy
```
**O registro de queries (código, `apps/api/src/pipeline/crosswalk-queries.ts` — allowlist tipada; cada uma RLS-scoped e read-only):**
`audit_events_in_window {chain_category?}` · `sealed_ratio_min {min}` (EC-1) · `rls_forced_tables {expected_count}` (catálogo pg) · `encrypted_payloads_exist` · `provider_credentials_envelope_only` · `workroom_approvals_sod_exists` · `regulatory_registry_rows {resource}` · `high_risk_reviews_decided` · `prohibited_use_determinations` · `review_decisions_in_window` (N2) · `evidence_anchor_exists {anchor_type}` (§D) · `dlp_findings_in_window {detector?}`.

## C.4 O motor de status (a regra "nunca COVERED sem fonte", executável)

`effective_status(cell)`:
1. `curated_status ∈ {GAP, NEEDS_SOURCE_VERIFICATION}` → ele mesmo (curadoria manda para baixo).
2. `curated_status = PARTIAL` → PARTIAL (a query, se houver, vira "evidência parcial" exibida).
3. `curated_status = COVERED` → executa a query registrada (janela default 30d): **retornou ≥1 linha → COVERED (com `last_verified_at` + contagem)**; retornou 0/erro → **degrada para NEEDS_SOURCE_VERIFICATION** com razão exibida ("evidência sem resultado na janela"). ⇒ COVERED é sempre CONDICIONAL a evidência viva; o default do schema é o honesto; auto-upgrade NUNCA acontece (a curadoria propõe, a evidência confirma, nunca promove sozinha).

## C.5 O seed (células reais, transcritas dos docs — exemplos ponta-a-ponta)

| framework.requirement_key | Rótulo | curated | evidence_query_kind | Fonte da célula |
|---|---|---|---|---|
| `LGPD.Art46.encryption_at_rest` | Segurança — cifra em repouso | COVERED | `encrypted_payloads_exist` | `regulatory/01:112` (cita 0001+kms+0009+teste plaintext-leak) |
| `LGPD.Art46.tenant_isolation` | Segurança — isolamento | COVERED | `rls_forced_tables` | `:113` (RLS FORCE + testes) |
| `LGPD.Art46_50.chain_integrity` | Trilha tamper-evident | COVERED | `audit_events_in_window` + `sealed_ratio_min` | `:115` |
| `LGPD.Art37.ropa` | Registro das operações (RoPA) | **GAP** | — | `:110` ("audit events are not RoPA") |
| `LGPD.Art18.dsr` | Direitos do titular | **GAP** (primitivo shred existe → gap_note) | — | `:109` |
| `LGPD.Art48.incident_notification` | Comunicação de incidente | **GAP** | — | `:117` |
| `LGPD.Art20.automated_review` | Revisão de decisão automatizada | GAP→PARTIAL quando N2 existir (`review_decisions_in_window`) | — | `:108` |
| `EU_AI_ACT.Art12.record_keeping` | Logging de alto risco | PARTIAL | `audit_events_in_window` | logging existe; classificação high-risk↔logs não ligada (Fase 5) |
| `ISO_42001.A6.ai_system_inventory` | Inventário de sistemas de IA | PARTIAL | `regulatory_registry_rows{ai_systems}` | registries R2-R5 |
| `NIST_AI_RMF.MEASURE.risk_tracking` | Medição/rastreio de risco | PARTIAL | `regulatory_registry_rows{risk_classifications}` | motor 0022 |
| `LGPD.Art46.external_anchor` (custódia) | Carimbo externo | **GAP até §D** → `evidence_anchor_exists` | — | `regulatory/06:123-125` |
(O seed completo transcreve as ~20 linhas de `regulatory/01` + as de `06` + 1 exemplo por domínio de `20` — trabalho de transcrição curada, escopo do PR-C.)

## C.6 Endpoints, telas, testes, aceite

```
GET /v1/crosswalk?framework=LGPD      → { framework, cells:[{…, effective_status, last_verified_at, evidence_count}], coverage:{covered,partial,gap,nsv,pct_covered} }
PUT /v1/crosswalk/mappings            → upsert de células (admin|dpo) — evento policy `crosswalk.mapping_changed`
POST /v1/crosswalk/:id/verify         → re-executa a query da célula agora (rate-limitado)
```
**Telas:** **/crosswalk** — a matriz como dashboard (tiles de % por framework — NUNCA verde sem evidência viva; CoverageCell componente 12); **/crosswalk/:requirement** — detalhe: requisito, controle linkado, a query registrada + params EXIBIDOS ("a consulta que sustenta esta célula"), resultado/contagem, gap_note+remediation+owner, histórico de mudanças (cadeia policy). Selo permanente da área: *"prova de cobertura técnica — não certificação, não parecer jurídico"*.
**Testes:** COVERED sem query irrepresentável (CHECK); query 0-linhas degrada; curadoria auditada; queries são as REGISTRADAS (id inválido → 400; nunca SQL do usuário); RLS; o seed LGPD bate com `regulatory/01` (teste de consistência doc↔seed).
**Aceite técnico:** default honesto; COVERED impossível sem query viva; célula ponta-a-ponta por framework.
**★ Pronto-para-vender:** *o DPO abre a matriz LGPD, vê % de cobertura derivado de evidência VIVA, clica numa célula COVERED e vê a consulta que a sustenta — e exporta isso para o comitê (via §B: um Evidence Package pode incluir o recorte do crosswalk).*

## C.7 Plano de PRs
| PR | Conteúdo | Critério |
|---|---|---|
| **A** — schema | `crosswalk_cells` + CHECKs + RLS + evento de mutação | default nunca COVERED; COVERED-sem-query irrepresentável |
| **B** — motor + GET | registro de queries (allowlist) + effective_status + `GET /v1/crosswalk` | COVERED só com query viva; degradação com razão; 400 em query não registrada |
| **C** — seed + PUT | transcrição curada de `regulatory/01`+`06`+`20` (4 frameworks) + `PUT /mappings` + `POST verify` | ≥1 célula real ponta-a-ponta por framework; teste doc↔seed |
| **D** — UI | matriz + detalhe + selo + export-recorte | % por framework; a query visível na célula |

**Riscos:** R12 (certificação → selo + query-visível + claims); query custosa (janela bounded + cache 15min + verify rate-limitado); drift doc↔seed (o teste de consistência prende).

**O que um agente implementa a partir daqui:** PR-A+B (o motor é ~200 linhas sobre a allowlist); o PR-C é transcrição — dá para paralelizar com um segundo agente enquanto o primeiro faz a UI.
---
---

# §D — ANCHORING EXTERNO (TSA / Merkle / ICP-Brasil) — o MOAT — `[ALVO DOCUMENTADO → spec de implementação]`

## D.1 Objetivo, persona, a escada de graus (o que cada um prova e a quem importa)

**Objetivo:** elevar a evidência de "íntegra segundo a GovAI" (HMAC com chave da plataforma) para "**verificável por terceiro, offline, sem confiar na GovAI**" — e, no grau BR, com carimbo do tempo ICP-Brasil. É o fosso do doc fundador 01 ("único vendor global com isto") e a linha `external anchoring` que `regulatory/06:123-125` registra como GAP.

| Grau (`evidence_strength`) | O que prova | A quem importa | Estado |
|---|---|---|---|
| `hmac_internal` (hoje) | integridade e ordem intra-plataforma (a chave HMAC é da GovAI — o verificador confia na plataforma) | auditor técnico do tenant | `[IMPLEMENTADO — 0001 + verify.ts]` |
| `dev_signed` | idem, ambiente dev (DevSigner — `[CODE] packages/signing`) | dev | `[IMPLEMENTADO]` |
| **`external_anchor`** | a raiz Merkle de um LOTE de eventos existia ANTES do instante T, atestado por um TSA RFC 3161 independente ⇒ anti-retroatividade verificável offline por qualquer um | auditor externo, perícia, cliente enterprise | `[ALVO — fase 1]` |
| **`icp_brasil_tsa`** | o mesmo, com carimbo de ACT credenciada ICP-Brasil (MP 2.200-2/2001; Lei 14.063/2020) ⇒ presunção legal no Brasil — o diferencial que `regulatory/06` conecta a CNJ/judiciário | jurídico, setor público, judiciário — **o preço premium** | `[ALVO — fase 2]` |
| `customer_signed` | o TENANT co-assina (BYOK) ⇒ nem a GovAI consegue forjar retroativamente contra o cliente | Regulated/Sovereign | `[ALVO — fase 3]` |
**Persona:** Auditor/perícia (verifica offline); Jurídico (validade BR); CISO Regulated (BYOK).
**User story (grau 1):** "Como auditor, pego a raiz Merkle carimbada e o proof de inclusão de UM evento e verifico, offline, que ele existia antes de T — sem pedir nada à GovAI." **(grau BR):** "Como jurídico, o carimbo é de ACT ICP-Brasil — apresentável em juízo com presunção de validade."

## D.2 Estado atual verificado + ★ o refinamento de design ancorado na fonte

**O que a 0001 reserva `[CODE]`:** `chain_anchor_id uuid NULL` (:47); `evidence_strength` CHECK com os 5 graus (:48-51); o guard de APPEND `p_evidence_strength NOT IN ('hmac_internal','dev_signed') → RAISE` (:317-319). **NÃO existe** tabela de âncora/Merkle/lote (inventário completo de objetos re-verificado — 0001 cria só `audit_events`+`audit_event_payloads`). `verify.ts` tem `verifyFullChain` (:28) e `verifyTailWindow` (:109) — HMAC-only.

**★ O refinamento (diverge da letra do briefing, ancorado na fonte — a substância fica MAIS forte):** o briefing diz "remover o guard da :317". Mas o guard é de **append-time**, e `audit_events` é imutável por trigger (`audit_no_modify_row` :178-204). A semântica correta dos graus TSA/Merkle é **pós-selagem**: um evento NASCE `hmac_internal` (o guard FICA — continua bloqueando nascer `external_anchor`, o que seria mentira: a âncora ainda não existia) e **GANHA** o grau quando o lote que o contém é ancorado. O mecanismo é o precedente que a própria 0001 já estabeleceu para o crypto-shred (`audit_event_payloads_restrict_update` :218-270 — UPDATE bloqueado EXCETO a transição específica, via função SECURITY DEFINER):
- Nova função `govai.audit_event_anchor_apply(p_event_ids uuid[], p_anchor_id uuid, p_strength text)` SECURITY DEFINER, executável só pelo role de anchoring: seta `chain_anchor_id` (NULL→valor, nunca sobrescreve) e faz o UPGRADE de `evidence_strength` (`hmac_internal→external_anchor→icp_brasil_tsa` — **downgrade e regressão IRREPRESENTÁVEIS**: a função valida a direção; o trigger de imutabilidade ganha a exceção estreita "UPDATE permitido apenas quando vindo desta função e apenas nesses 2 campos nessa direção").
- O guard da :317 só será tocado na fase 3 (`customer_signed` NASCIDO-assinado no append — aí sim o append aceita o grau novo, com a assinatura presente).
⇒ Nenhuma reescrita da cadeia; o HMAC/canonical_bytes originais ficam intactos (o hash ancorado é sobre eles); a âncora é camada ADITIVA.

## D.3 Arquitetura: Merkle sobre lotes selados + carimbo da raiz

**Por que Merkle+lote:** um carimbo TSA por EVENTO é caro e lento; a árvore agrega N eventos num único carimbo e dá proof de inclusão O(log N) por evento — verificável offline com: o evento (canonical_hash), o caminho, a raiz e o token TSA.
**Desenho:**
- **Folha** = `canonical_hash` do evento selado (JÁ armazenado por evento — 0001; nenhum recompute de canônico necessário). Lote = por ORG, eventos selados ainda não-ancorados, ordenados por `(chain_id, sequence_number)` (determinístico), até `ANCHOR_BATCH_MAX` (default 10.000) ou fechado por janela (`ANCHOR_INTERVAL` default 1h).
- **Árvore**: sha256, estilo RFC 6962 (leaf-prefix 0x00, node-prefix 0x01 — anti-second-preimage; proofs padrão de mercado). Raiz = `root_hash`.
- **Carimbo**: request RFC 3161 (`MessageImprint = sha256(root_hash)`) → `TimeStampToken` DER retornado; grau BR: o MESMO protocolo contra ACT credenciada ICP-Brasil.
- **Aplicação**: `audit_event_anchor_apply` marca os eventos do lote (chain_anchor_id → o registro da âncora; strength ↑). Proofs de inclusão **recomputáveis** das folhas (armazenadas nos eventos) — não se persiste proof por evento; o endpoint os computa on demand.

**Schema SQL:**
```sql
CREATE TABLE IF NOT EXISTS govai.evidence_anchors (
  id             uuid PRIMARY KEY,
  org_id         uuid NOT NULL,
  anchor_type    text NOT NULL CHECK (anchor_type IN ('merkle_only','merkle_rfc3161','merkle_icp_brasil')),
  root_hash      bytea NOT NULL,
  tree_size      integer NOT NULL CHECK (tree_size > 0),
  batch_ranges   jsonb NOT NULL,        -- {"<chain_id>": {"min_seq":"n","max_seq":"m"}, …} (bigint como string)
  tsa_url        text NULL,
  tsa_token      bytea NULL,            -- TimeStampToken DER (RFC 3161)
  tsa_signed_at  timestamptz NULL,      -- genTime extraído do token
  icp_act_name   text NULL,             -- a ACT credenciada (fase 2)
  status         text NOT NULL DEFAULT 'built'
                  CHECK (status IN ('built','anchored','verify_ok','verify_failed')),
  built_at       timestamptz NOT NULL DEFAULT now(),
  anchored_at    timestamptz NULL,
  last_verified_at timestamptz NULL,
  CHECK (anchor_type = 'merkle_only' OR (tsa_token IS NOT NULL) OR status = 'built'),
  CHECK (status <> 'anchored' OR anchored_at IS NOT NULL)
);
-- imutável pós-anchored (trigger: UPDATE permitido só built→anchored→verify_*, campos de verificação);
-- RLS FORCE (âncora é por org — INV-1 preservado: nenhuma estrutura cross-org)
```
**Role:** `govai_evidence_anchorer` NOINHERIT NOLOGIN (bootstrap): SELECT eventos selados da org (política própria), INSERT/UPDATE-restrito em `evidence_anchors`, EXECUTE em `audit_event_anchor_apply`. **Worker:** um loop novo no `apps/audit-sealer` atrás de `AUDIT_SEALER_ANCHOR_ENABLED=1` `[recomendação: reusa org-discovery/health/backoff/bundle — zero deployable novo; alternativa: worker próprio se o blast radius preocupar]`. Env: `ANCHOR_INTERVAL_MS`, `ANCHOR_BATCH_MAX`, `ANCHOR_TSA_URL`, `ANCHOR_TSA_KIND=rfc3161|icp`, credencial da ACT via envelope (connector_credentials pattern).

## D.4 Endpoints e a extensão do verify (EP-7)

```
POST /v1/evidence/anchor            → agenda/dispara o lote da PRÓPRIA org (admin; rate-limitado; 202 {anchor_id?})
GET  /v1/evidence/anchors           → lista (cursor) — auditor/admin/dpo
GET  /v1/evidence/anchors/:id       → detalhe: root, ranges, tsa {url, signed_at, token_b64}, status
GET  /v1/evidence/anchors/:id/proof?event_id= → {leaf:canonical_hash, path:[{hash,side}…], root_hash, tsa_token_b64}
GET  /v1/evidence/verify            → (EP-7 estendido) roda verifyFullChain/verifyTailWindow (HMAC) E, para eventos ancorados,
                                      recomputa a raiz do lote + valida o token TSA (cadeia de certs offline) → persiste resultado
                                      → EC-6 finalmente sai de `pending` (o gauge chain_verification_ok já espera — evidence-metrics.ts:33)
```
**Eventos (cadeia `admin`):** `evidence.anchor_built`, `evidence.anchor_stamped {anchor_type, tsa_url}`, `evidence.anchor_verify {ok|failed}` — o anchoring é ele mesmo evidenciado.
**Integração §B (o gancho combinado):** `evidence_package_attach_anchor()` popula `anchor_proofs[]` do pacote: para cada item ancorado, `{anchor_id, root_hash, merkle_path, tsa_token_ref}` + Anexo C do PDF — *"verificável independentemente, sem confiar na GovAI"*.

## D.5 Claims por grau (o gate que se abre degrau a degrau)
- Hoje/PR-A (`merkle_only`): NENHUM claim novo — "integridade HMAC interna" (inalterado).
- PR-B (`merkle_rfc3161`): permitido: "evidência com carimbo de tempo RFC 3161 verificável offline por terceiros". Proibido: qualquer menção a validade jurídica/ICP.
- PR-C (`merkle_icp_brasil`): permitido: "carimbo do tempo ICP-Brasil (ACT credenciada)" — a formulação "presunção de validade jurídica" SÓ após validação com counsel (claims-policy §3: qualified). 
- Fase 3 (`customer_signed`): "co-assinatura do cliente (BYOK)". Cada grau atualiza `capabilities`/facets (`evidence_strength` por facet já existe no registry) — o claim segue o status, nunca o precede.

## D.6 ★ A dependência comercial com LEAD-TIME (iniciar EM PARALELO, já)
- **O que contratar:** uma **ACT credenciada pelo ITI/ICP-Brasil** (exemplos de mercado: Serpro, Certisign, Valid, Soluti `[INFERENCE — nomes de mercado; validar comercialmente]`) — contrato de carimbo do tempo (volume/mês, SLA, homologação técnica do endpoint RFC 3161 deles).
- **Lead-time estimado:** semanas a poucos meses (proposta + contrato + credenciais + homologação) `[INFERENCE]` — **corre em PARALELO ao código**, não depois.
- **O que NÃO depende do contrato:** TODO o mecanismo (PR-A Merkle + PR-B com TSA RFC 3161 genérico — em dev, um TSA público/de teste; em staging, qualquer TSA comercial não-ICP) é construível e testável ANTES. O PR-C troca a URL/credencial e adiciona a validação da cadeia de certificados ICP.
- **Ação de negócio a registrar já:** (1) shortlist de ACTs + pedido de proposta; (2) parecer de counsel sobre a formulação de claim jurídico; (3) decidir o tier que inclui `icp_brasil_tsa` (doc 05: Enterprise/Regulated — é o que justifica o preço premium).

## D.7 Testes
- **Merkle:** raiz reconstruível das folhas (determinismo); proof de inclusão válido para cada evento do lote; proof INVÁLIDO para evento fora do lote; árvore ímpar (RFC 6962); lote vazio não cria âncora.
- **Upgrade:** `anchor_apply` seta chain_anchor_id NULL→valor e strength SÓ para cima; **downgrade/regravação IRREPRESENTÁVEL** (trigger rejeita; teste tenta external_anchor→hmac_internal e falha); o guard de APPEND continua rejeitando nascer `external_anchor` (:317 inalterado — teste explícito).
- **TSA:** token DER parseia; `MessageImprint == sha256(root)`; genTime extraído; verificação offline com truststore fixado; token adulterado → verify_failed.
- **Verify estendido:** cadeia OK+âncora OK → verify_ok persistido e EC-6 deixa de ser pending para as cadeias cobertas; adulteração de evento ancorado → falha na camada CERTA (HMAC pega primeiro; Merkle pega se o HMAC fosse recomputado com a chave — o teste documenta a defesa em camadas).
- **Integração §B:** pacote com item ancorado carrega proof que valida standalone (script de verificação offline incluído no teste).

## D.8 Aceite
- **Técnico:** os de D.7 + o worker ancora lotes por org sem tocar o hot path (assíncrono; latência de selagem inalterada — o batching é pós-seal).
- **★ Pronto-para-vender (grau 1):** *um cliente/juiz pega a raiz Merkle carimbada + o proof de UM evento e verifica a integridade de forma independente, OFFLINE, sem a GovAI.* **(grau BR):** *o carimbo é de ACT ICP-Brasil — o diferencial que nenhum concorrente da análise competitiva (doc 01) oferece.*

## D.9 Plano de PRs
| PR | Conteúdo | Critério de saída |
|---|---|---|
| **A** — Merkle batching | `evidence_anchors` + role + builder (árvore RFC 6962 sobre lotes selados por org) + `anchor_apply` (upgrade estreito) + o worker `merkle_only` | raiz reconstruível; proof valida; downgrade irrepresentável; guard de append INTACTO (teste); zero carimbo externo ainda |
| **B** — `external_anchor` RFC 3161 | client TSA (request/parse/verify DER) + carimbo da raiz + strength↑external_anchor + `POST /v1/evidence/anchor` + `GET anchors*` + claims gate 1 | evento sobe a external_anchor com token verificável offline; truststore fixado; evento de auditoria do carimbo |
| **C** — `icp_brasil_tsa` | a ACT credenciada (URL+credencial envelope) + validação da cadeia ICP + strength↑icp_brasil_tsa + claims gate 2 | carimbo via ACT real em staging; formulação de claim aprovada por counsel ANTES do material comercial |
| **D** — verify estendido + §B | `GET /v1/evidence/verify` com âncora + persistência (EC-6 sai de pending) + `attach_anchor` no Evidence Package + Anexo C do PDF | verify confirma HMAC+Merkle+TSA; o pacote carrega a prova; EC-6 verde SÓ onde verificado |

**Riscos e mitigações:** dependência ACT (lead-time em paralelo — D.6; o mecanismo prova-se com TSA genérico); custo por carimbo (batching: 1 carimbo/org/intervalo, não por evento); latência de selagem (inalterada — anchoring é pós-seal, assíncrono); claim jurídico (gate por counsel; claims-policy); revogação/expiração de cert da TSA (re-carimbo periódico do conjunto de raízes — "witness chain" — registrado como extensão futura, não bloqueia).

**O que um agente implementa a partir daqui:** PR-A é puro (árvore + tabela + função de upgrade — testável 100% offline); PR-B adiciona o client RFC 3161 (uma dependência de parse ASN.1/DER a escolher no PR — avaliar `@peculiar/asn1-*` vs implementação mínima própria; decisão de dependência é do PR, com o critério "verificável offline sem serviço da GovAI"); PR-C é config+validação ICP quando o contrato da ACT fechar (a ação de negócio D.6 corre desde já).

---

## Fecho — as 4 specs em uma linha cada
- **§A Connector:** a evidência da GovAI dentro do SOC do cliente (export-first, outbox+watermark espelhando o sealer; ingestão depois, com PRIMARY irrepresentável e o motor de precedência já existente).
- **§B Evidence Package:** o dossiê congelado com hash canônico, verificável por terceiro contra a cadeia — com o gancho de âncora pronto.
- **§C Crosswalk:** a matriz cuja célula COVERED só existe com consulta REGISTRADA retornando evidência viva — semeada da tabela LGPD que os docs regulatórios JÁ curaram.
- **§D Anchoring:** eventos nascem `hmac_internal` e GANHAM grau pós-selagem (Merkle por lote → RFC 3161 → ICP-Brasil), pelo precedente de UPDATE-restrito que a 0001 já tem; o contrato da ACT corre em paralelo; cada grau abre um claim.

— Fim das 4 specs (GOVAI-SPECS-ENTERPRISE+ANCHORING @ f975533d, 2026-07-10). Depois desta rodada: construção.
