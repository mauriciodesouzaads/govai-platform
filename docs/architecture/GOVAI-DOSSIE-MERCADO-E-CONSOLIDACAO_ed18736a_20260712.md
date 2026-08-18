> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** COMMERCIAL_EVALUATION
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12; market sources 2026-02..07)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; PR-0 header retained below as history)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D12=APPROVED_WITH_CLAIMS_DISCIPLINE)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES (byte-identical below this header, incl. the PR-0 header)
> **SOURCE_SHA256:** `abdde8e7e9a0f330d456c271677052712d2a5ab2edecc487844bc12c8189ec5a` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** COMMERCIAL EVALUATION (D12 = APPROVED_WITH_CLAIMS_DISCIPLINE). Body byte-preserved; NO new market research was performed by M3. CLAIMS-DISCIPLINE LABELS for readers (the body has no per-statement tags — apply these): (1) FACTUAL SOURCE-DERIVED = the four-vendor capability tables and §5 source list, each carrying its own date (2026-02..07) — CURRENT-AS-OF 2026-07-12, expiring quarterly per the document's own rule (STALE AFTER ~2026-10-12; treat as unverified until re-checked); (2) EVALUATION = the ABSORVER/INTEGRAR/IGNORAR verdicts and the "moat by absence" reading (§2–§4); (3) INFERENCE = the "40–60% do backend existe" and prioritization judgments; (4) TARGET = the Workroom materialization (§6, a product specification — Workroom Phases 5–7 and any UI are NOT implemented) and the anchoring/ICP-Brasil/TSA differentiation — the sentence in §3.3 that GovAI "produz evidência ancorada externamente … com carimbo do tempo ICP-Brasil" is a TARGET statement, not a current capability (`evidence_strength` values are reserved in migration 0001; no anchor/Merkle/TSA implementation exists — see `specs/specs-enterprise-anchoring.md`, accepted as target design); (5) COMMERCIAL HYPOTHESIS = pricing/positioning motions. Code-state rows (§1.1 F0 table, C-2, README/D9 items) are the state at `ed18736a` and are resolved at the Foundation V1 anchor.
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** VIGENTE — COMPANION DO MAPA (fontes de mercado expiram trimestralmente)
> **BASE DECLARADA PELO DOCUMENTO:** ed18736a + fontes 2026-02..07 · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** 4 líderes estudados (Cisco/PANW/Purview/Netskope); moat confirmado por ausência (§4); Workroom materializada (§6).
> **ORIGEM:** Gerado nesta operação, 2026-07-12
> ---

# GOVAI — DOSSIÊ DE MERCADO, CONSOLIDAÇÃO DO NÚCLEO E MATERIALIZAÇÃO DA WORKROOM

**Data:** 2026-07-12 · **Base de código:** `ed18736a` · **Base de mercado:** verificação web independente 2026-02 a 2026-07 (fontes datadas na §5) · **Companion de:** GOVAI-MAPA-MESTRE-DESENVOLVIMENTO v1.1 e do COMUNICADO-REANCORAGEM. Este documento responde às três perguntas que precedem o desenvolvimento — (1) o que falta para fechar o que temos? (2) o que é tecido e o que é retalho? (3) o que os sérios oferecem que vale absorver? — e formaliza a Workroom como produto a partir do método que operamos.

Regra herdada: cada afirmação factual sobre o código é âncora verificável (`arquivo:linha`); cada afirmação de mercado carrega fonte + data (§5); o código vence os documentos; nenhuma capacidade é afirmada além do que a fonte entrega.

---

## §0 — A tese, reancorada no mercado (por que ela sobrevive aos gigantes)

A intenção fundadora ("o empresário quer usar IA mas tem medo; só as grandes corporações resolvem isso; quero dar esse acesso a PMEs, sem fricção, com prova forte") não é uma aposta contra o mercado — é a leitura correta do mercado. O estudo dos quatro players sérios (Cisco AI Defense, Palo Alto Prisma AIRS 3.0, Microsoft Purview DSPM for AI, Netskope One AI Security) mostra **convergência total** na espinha de produto e **três frestas estruturais** que são exatamente o diferencial do GovAI.

**A convergência (o que valida a arquitetura):** os quatro adotaram, em 2026, a mesma estrutura de verbos que o nosso documento de tese propôs de forma independente:
- Cisco AI Defense: **Discover → Detect → Protect** (fonte C1, C2).
- Palo Alto Prisma AIRS 3.0: **Discover → Assess → Protect** (fonte P1).
- Netskope One: **Discover → Protect → Coach** (fonte N1, N2).
- Microsoft Purview DSPM: **Discover → Protect → Investigate** (fonte M1).

Quando quatro líderes convergem para Descobrir→Proteger→Governar/Avaliar→(Prova/Coaching), a espinha **Descobrir→Proteger→Governar→Provar** do GovAI está no osso certo. Isso encerra a dúvida "estou construindo algo que já existe": a *categoria* é validada; o *diferencial* é onde eles não vão.

---

## §1 — PERGUNTA 1: O que falta para FECHAR o que já temos

"Fechar" = o núcleo dizer 100% a verdade e ter o primeiro rosto. Verificado em `ed18736a`. É trabalho de **semanas**, não meses, e é investimento sem arrependimento (necessário em qualquer futuro do produto).

### 1.1 — Os consertos de honestidade (F0 técnico)
| Item | O que falta | Âncora (re-verificar antes de editar) |
|---|---|---|
| F1 | `credential_source` derivado do resolvedor, não literal | `handle-messages.ts:283,351,416` + OpenAI + passthrough (14 pontos) |
| F2 | decisão real + `block_trigger` no evento de bloqueio | `handle-messages.ts:278` |
| F3 | fechar a transação antes do fetch; `AbortSignal`+timeout; `/ready` real; `dispatch_status` | `run-orchestrator.ts:467,471,647,999` |
| F4 | `enterWith` → `als.run` (perda de captura em terminal) | `request-identity-hook.ts:63` |
| C-2 | gravar `native_request_hash` real no ramo governed-blocked (hoje `'\x00'`) | `run-orchestrator.ts:809-811` |
| EP-11 | evento de auditoria do deny pós-sunset (★ prazo 2026-08-26) | `files-purpose-validator.ts` |
| Rota crypto-shred | a função de banco existe; a rota é 501 | `0001` fn `:399`; `admin-audit-shred.ts` |

*Concluído pelo #118 (não refazer):* F5/F6 — merge de spans de DLP, redação seletiva por ação, `dlp_findings` no deny, idempotência. Verificado.

### 1.2 — A verdade documental (F0 documental)
As 10 correções da Docs Consistency Review: README nega o estado (`README.md:13-15`), resume-playbook 24 PRs atrás, governance-philosophy contradiz o código, doutrina fora do VCS (D9 — fecha 3 referências quebradas), e — novo — re-fundar o moat nos textos em LGPD+CNJ (não PL 2338).

### 1.3 — O primeiro rosto (F1 do roadmap)
U1 (cockpit de evidência, 4 telas, sobre rotas prontas) + EP-V1 (verificação de cadeia operacionalizada, tira EC-6 de `pending`) + §D PR-A (Merkle batching, offline-testável). `apps/ui` não existe ainda (confirmado).

**Definição de "fechado":** eventos que não mentem + docs que não contradizem o código + uma tela que mostra a evidência + a cadeia que se verifica sozinha. Isso é o produto mínimo honesto.

---

## §2 — PERGUNTA 2: O que é TECIDO e o que é RETALHO

Distinção pedida: o que do que já existe é núcleo sólido e reutilizável ("tecido") vs. o que é acúmulo frágil que ameaça a correção ("retalho"). Veredito da auditoria de duas rodadas + este estudo.

### 2.1 — TECIDO (o núcleo real — mantém, é o ativo)
- **A cadeia de evidência** (HMAC append-only + outbox + sealer + RLS FORCE + KMS fail-closed + tenancy). Este é o tecido mais forte, e — §5 — é o único componente sem equivalente entre os quatro gigantes. É o produto.
- **O gateway provider-native** (governed/passthrough, byte-perfeito, SSE). Tecido: testado, é a camada de runtime que o mercado exige.
- **O DLP-BR** (CPF/CNPJ com checksum, CNPJ alfanumérico, o merge de spans do #118). Tecido pós-#118.
- **O núcleo regulatório** (108 operações, máquinas de estado no banco). Tecido, mas ver §2.3 (é evidência, não enforcement — precisa de rótulo honesto).
- **O precursor de governança agêntica na Workroom** (hash de ação + SoD em trigger + consumo one-time). Tecido de altíssimo valor — §6 — é a peça que os gigantes estão construindo agora.

### 2.2 — RETALHO (frágil ou inconsistente — costurar, não remendar)
Estes são os pontos que a auditoria encontrou onde o sistema **funciona mas mente ou diverge** — retalho no sentido preciso de "costura que não fecha":
- **A divergência DLP entre os dois planos** (`/v1/runs` pode deny/redact; `/governed/*` só detecta-e-escala). É o retalho mais perigoso: uma org com política `deny` para CPF é protegida num caminho e furada no outro. A doutrina do ADR-029 ("os dois planos convergem no mesmo kernel") proíbe isso. **Costura:** convergência deny-primeiro (Fase 1).
- **Os campos de evidência que mentem** (F1 credential_source literal; F2 decisão fixa no bloqueio; C-2 hash `'\x00'`). Retalho: o evento selado afirma o que não aconteceu. **Costura:** F0.
- **Os dois contratos de `payload_hash`** para o mesmo `passthrough.invoked v4` (`JSON.stringify` no `/v1/runs` vs projeção canônica no bridge). Retalho semântico: um verificador futuro não sabe qual semântica vale. **Costura:** convergir para a projeção (Fase 1-2).
- **A fronteira de transação aberta durante o fetch** (F3). Retalho operacional: exaustão de pool sob provedor lento. **Costura:** F0.

### 2.3 — TECIDO MAL-ROTULADO (não é retalho de código; é retalho de narrativa)
- O núcleo regulatório e o caminho governado são **majoritariamente observacionais** hoje (bloqueiam poucos vetores; DENIED regulatório é evidência, não bloqueio de runtime). O código está correto; o risco é vender "enforcement" onde há "evidência". O mercado pune isso explicitamente (§5, Palo Alto: "monitoram o que a IA diz, cegos para o que a IA faz"). **Costura:** vocabulário honesto + a escada de enforcement com um degrau vendável por fase.

**Conclusão da Pergunta 2:** não há retalho de *arquitetura* — o osso é são. Há retalho de *costura* (as divergências entre planos e os campos que mentem) e retalho de *narrativa* (observacional vendido como enforcement). Os dois se resolvem na Fase 0-1, e nenhum exige reescrita.

---

## §3 — PERGUNTA 3: O que os SÉRIOS oferecem que vale ABSORVER

Estudo dos quatro, com o veredito ABSORVER / INTEGRAR / IGNORAR para cada capacidade. Fontes na §5.

### 3.1 — O que cada um faz (resumo verificado)
- **Cisco AI Defense** (fontes C1–C5): Discover→Detect→Protect na camada de rede/SASE, **sem agente** ("network-level without the need for agents or libraries"). Novidades 2026: AI BOM (bill of materials de ativos de IA), MCP Catalog (descoberta/inventário de servidores MCP), red teaming algorítmico multi-turno, guardrails de runtime em tempo real, SDK de runtime de agente que embute política no build. Mapeia para NIST/OWASP/MITRE. Preço por nº de apps + uso + deployment.
- **Palo Alto Prisma AIRS 3.0** (fontes P1–P6): "a plataforma de segurança de agentes mais abrangente"; Discover→Assess→Protect; integrou o **AI Gateway da Portkey** como control plane; identidade de agente com RBAC + audit trail; AI Runtime Firewall (30+ técnicas de prompt injection, 1000+ padrões de dado sensível); red teaming; **AI Agent Gateway** (preview) + Agentic Endpoint Security + navegador seguro para workflows agênticos. Enterprise, quote-based.
- **Microsoft Purview DSPM for AI** (fontes MS1–MS7): governança data-centric profunda para o **ecossistema Microsoft** (Copilot, Foundry, Fabric); inventário de agentes (Agent 365 + Entra Agent ID); labels de sensibilidade com direito EXTRACT; DLP no Edge que bloqueia PII colada no ChatGPT **sem onboarding de endpoint** (GA jan/2026); trilha no audit log unificado para eDiscovery; templates de mapeamento regulatório no Compliance Manager. Admite: **cobertura limitada para agentes de terceiros** (LangChain/CrewAI). Licenciamento complexo.
- **Netskope One AI Security** (fontes N1–N9): Discover→Protect→**Coach** na nuvem/SASE dela; CCI cataloga 370+ apps GenAI / 82.000+ SaaS; **inspeção semântica** (não regex) que entende intenção mesmo quando a IA reescreve o conteúdo; **user coaching** (pop-up que educa e redireciona em vez de bloquear — a maioria se autocorrige); consciência de instância (conta pessoal vs corporativa); UEBA; 4 produtos GA (Agentic Broker, AI Guardrails, AI Gateway, AI Red Teaming). Admite: **não pode prometer** segurança para tráfego com certificate-pinning (app desktop ChatGPT) — "empurre para o navegador".

### 3.2 — Veredito de absorção
| Capacidade dos gigantes | Veredito p/ GovAI | Como / por quê |
|---|---|---|
| **User coaching** (educar+redirecionar no lugar do bloqueio binário) — Netskope | **ABSORVER (alto valor, barato)** | Resolve a tensão "sem fricção" da tese fundadora; superior ao allow/deny atual; constrói sobre o enforcement existente. Vira um `enforcement_action = coach` com evento + redirecionamento. Fase 1-2. |
| **Inspeção semântica de DLP** (intenção, não só regex) — Netskope | **ABSORVER (roadmap)** | O DLP-BR é regex+checksum (preciso p/ CPF/CNPJ, mas cego a paráfrase). Camada semântica opcional (classificador) como evolução do SD1. Fase 3+. Não substitui o baseline determinístico — complementa. |
| **Consciência de instância** (pessoal vs corporativa) — Netskope/Purview | **ABSORVER (simples)** | Distinguir credencial/conta no evento aumenta o valor da descoberta. Fase 2-3. |
| **MCP Catalog + schema pinning + drift quarantine** — Cisco | **JÁ NO DESIGN (executar)** | É exatamente o MCP Gateway §04 do corpus (registry, `tool_schema_hash`, drift→verification_required). O mercado confirma a prioridade. Fase 3. |
| **Identidade de agente com RBAC + audit trail** — Palo Alto/Purview | **ABSORVER (encaixa na Workroom)** | Agentes como identidades de primeira classe com trilha. O precursor existe (participantes+SoD). §6. Fase 3-6. |
| **Red teaming algorítmico** (multi-turno, prompt-injection) — todos | **INTEGRAR, não construir** | É produto próprio e caro (motores dedicados). GovAI integra resultados como evidência; não compete. Backlog/parceria. |
| **AI BOM / supply-chain scanning de modelos** — Cisco/Palo Alto | **IGNORAR (fora da tese)** | Escanear artefatos de modelo é outro produto. Não serve os quatro verbos do comprador PME brasileiro. |
| **AI Runtime Firewall genérico** (30+ prompt-injection, DoS) — Palo Alto | **PARIDADE MÍNIMA + INTEGRAR** | Ter guardrails básicos de prompt-injection é esperado; profundidade completa é deles. Fazer "o suficiente" + integrar quem faz mais. Fase 3. |
| **Descoberta por rede/SASE/endpoint sem agente** — Cisco/Netskope/Purview-Edge | **INTEGRAR (é o standalone-e-integrada)** | GovAI não constrói SASE/EDR. Ingere logs que o cliente já tem + integra Purview/Netskope/Cisco onde existem. O Purview-Edge bloqueando PII no ChatGPT sem endpoint é o parceiro, não o inimigo. Fase 2-3 (Connector Framework §A). |
| **Trilha de auditoria para eDiscovery** — Purview | **SUPERAR (é o moat)** | Purview registra dentro do tenant, para eDiscovery. GovAI produz **evidência ancorada externamente, verificável offline por perito, com carimbo do tempo ICP-Brasil** — o que nenhum dos quatro faz. §4. |

### 3.3 — A lição estratégica dos quatro (a resposta curta à Pergunta 3)
Três coisas que valem absorver de imediato porque são baratas e alinhadas à tese: **coaching** (fricção mínima), **consciência de instância** (descoberta mais rica), **MCP catalog/drift** (já desenhado). Tudo o mais os gigantes fazem é (a) integrar quando o cliente já tem, ou (b) ignorar por estar fora da tese. E a coisa que **nenhum deles faz** — evidência probatória com âncora jurídica brasileira — é precisamente o que não se absorve de fora: é o que o GovAI constrói como moat.

---

## §4 — O MOAT confirmado por ausência

Os quatro gigantes mapeiam para frameworks de **segurança** (NIST, OWASP LLM Top 10, MITRE ATLAS). Nenhum produz **prova forense com cadeia de custódia verificável por terceiro**:
- Cisco/Palo Alto/Netskope: evidência é telemetria de segurança + relatórios exportáveis para review — não pacote probatório assinado, verificável offline.
- Microsoft Purview: trilha de auditoria robusta, mas **dentro do tenant Microsoft**, para eDiscovery interno — não ancorada externamente, não portável como prova pericial, não LGPD/CNJ-nativa.
- Nenhum dos quatro fala **ICP-Brasil, LGPD art. 18 (crypto-shred), CNJ Res. 615, ou carimbo do tempo RFC 3161 com AC credenciada brasileira**.

O GovAI já reservou a estrutura (`chain_anchor_id`, `evidence_strength` 5 graus, guard `:317`) e desenhou o mecanismo (§D: Merkle → RFC 3161 → ICP-Brasil + verificador offline + Evidence Package). **Este é o único terreno onde o GovAI não tem concorrente entre os líderes — e é defensável porque combina cripto (que eles têm) com especificidade jurídica brasileira (que eles não têm e não terão tão cedo).**

---

## §5 — Fontes de mercado (verificadas 2026-07-12 · re-verificar trimestralmente)

**Cisco AI Defense:** C1 newsroom.cisco.com "Redefines Security for the Agentic Era" (10/02/2026) · C2 cisco.com AI Defense Data Sheet (21/05/2026) · C3 AI Defense Solution Overview · C4 newsroom "Reimagines Security for the Agentic Workforce" / DefenseClaw (23/03/2026) · C5 Gartner Peer Insights (2026).
**Palo Alto Prisma AIRS:** P1 paloaltonetworks.com/blog "Prisma AIRS 3.0" (23/03/2026) · P2 prnewswire "Secures Agentic AI with Prisma AIRS 3.0" (23/03/2026) · P3 prisma product page (integração Portkey AI Gateway) · P4 docs.paloaltonetworks.com AI Runtime Security · P5 tokenmix review (25/04/2026) · P6 docs new-features junho/2026 (Privilege Misuse).
**Microsoft Purview:** MS1 learn.microsoft.com "ai-microsoft-purview" (27/05/2026) · MS2 "data-security-posture-management-learn-about" (26/05/2026) · MS3 techcommunity "Securing AI Agents End-to-End / Agent 365" (19/05/2026) · MS4 noraa.ca "Purview Updates 2024-2026" (28/03/2026, DLP no Edge GA jan/2026) · MS5 princetonits (10/06/2026) · MS6 ai-m365-copilot · MS7 github microsoft/Data-and-Agent-Governance Accelerator.
**Netskope:** N1 netskope.com "Securing Generative AI" (11/03/2026) · N2 "Securing AI with Netskope One" · N3 press "Shadow AI Risks Proliferate" · N4 community "Securing SaaS and GenAI Without Saying No" (18/05/2026, coaching+broker) · N5 "AI Security" product · N6 Cloud and Threat Report 2026 (07/01/2026, 47% contas pessoais) · N7 securitybrief "unified platform" (18/03/2026, 4 produtos GA) · N8 stocktitan AWS competency (19/03/2026) · N9 community video "Inside Netskope 20" (28/05/2026, cert-pinning limitation).

*(Guias de fornecedor têm viés comercial; usados para "o que o comprador espera" e "o que o líder entrega", não como verdade neutra. Validação definitiva = design partners.)*

---

## §6 — A WORKROOM materializada: de método a produto

Esta seção formaliza o que você observou — **o que fazemos nesta conversa É a Workroom** — e a transforma em especificação de produto. O método que operamos (dono coordena; um modelo analisa; outro verifica na fonte; outro implementa; outro revisa; dono decide o merge; tudo vira evidência) é o produto que a §5 mostra ser a fronteira do mercado (governança agêntica), e que **nenhum dos quatro gigantes oferece como espaço de trabalho** — eles governam agentes; não hospedam a colaboração governada entre eles.

### 6.1 — O que a Workroom É (e o que não é)
- **NÃO é** "mais um chat multi-modelo" (isso é commodity dos providers).
- **É** um *Governed Multi-Agent Collaboration Workspace*: o ambiente onde múltiplos modelos e/ou humanos colaboram numa tarefa, cada turno é evidência selada, cada handoff é registrado, e cada ação sensível exige aprovação humana com separação de deveres. É o "Modo 2" da tese (trabalhar dentro do GovAI) — opcional, nunca obrigatório.
- **Uso flexível:** um usuário sozinho com vários modelos; um grupo de humanos; ou humanos + modelos no mesmo ambiente único.

### 6.2 — O método desta conversa como especificação (o dogfooding)
O fluxo que operamos mapeia 1:1 nas primitivas que já existem no backend:

| Papel no método | Primitiva no código (verificada) | O que a Workroom automatiza |
|---|---|---|
| Dono coordena e decide merge | `workroom` + aprovações com SoD (migr. 0012–0015) | A decisão de merge vira aprovação registrada, não cópia manual |
| Modelo A analisa / B critica / C implementa / D revisa | participantes + turnos com lock de ordenação | Cada contribuição vira turno selado; hoje é copy-paste manual |
| Handoff entre modelos | transcript cifrado + evidência por turno | O contexto passa dentro do sistema, não por copiar/colar |
| Ação sensível (ex.: rodar código, gravar arquivo) | `intended_action_hash` + consumo one-time + SoD | Aprovação humana vinculada a exatamente aquela ação (TOCTOU-safe) |
| Tudo fica ligado ao projeto (artefatos, decisões, prompts) | workroom messages/tasks/evidence | O projeto inteiro vira trilha auditável — a prova de "como isto foi produzido" |

**A implicação:** a Workroom não é greenfield. 40–60% do backend existe. O que falta é a UI (Fase 6) e os adaptadores de provider para orquestração. O risco é escopo de interface, não de núcleo.

### 6.3 — Por que isto é diferencial (a fresta de mercado)
A §5 mostra o mercado inteiro correndo para *governar* agentes (gateway, broker, catalog, identity). Ninguém oferece o *espaço onde a orquestração acontece sob governança nativa*. A Workroom é isso: enquanto Palo Alto/Cisco/Netskope vendem o "guarda de trânsito" dos agentes, a Workroom é a "sala de reunião gravada" dos agentes — e ela produz, por construção, a evidência probatória que é o moat (§4). É o único lugar onde os quatro verbos se fecham num único artefato: você DESCOBRE o que cada agente fez, PROTEGE o dado que passou, GOVERNA a ação por aprovação, e PROVA a cadeia inteira.

### 6.4 — A materialização como automação/auxílio (o que você pediu)
A Workroom "auxilia ou automatiza" o que hoje é manual: em vez de o dono copiar respostas, mover arquivos, pedir revisão e registrar decisões à mão, o ambiente (a) roteia contexto entre participantes, (b) sela cada passo, (c) exige aprovação onde há risco, (d) monta o pacote de evidência do projeto. É o método desta conversa, menos o trabalho braçal, mais a prova. **Posição no roadmap:** Fase 6 (após o núcleo confiável e as superfícies comerciais); backend mantido e congelado até lá; UI puxada por demanda de cliente que peça colaboração multi-agente governada.

---

## §7 — Síntese: unir o que o mercado precisa com o que queremos oferecer

**O que o mercado precisa** (verificado nos quatro líderes): descobrir uso de IA; proteger dado sensível; governar agentes; e — o que só o comprador brasileiro regulado precisa e ninguém entrega — provar com âncora jurídica. Mais: fazer isso sem fricção (coaching > bloqueio), integrando o stack que a empresa já tem, a preço que a PME paga.

**O que queremos oferecer** (a tese fundadora, agora confirmada): a camada de confiança que deixa usar qualquer IA com mínima fricção, descobre o não autorizado, protege o autorizado, governa o risco, prova o que aconteceu, e oferece a Workroom quando o cliente quiser colaboração governada.

**A união:** são a mesma coisa. O estudo de mercado não pediu para mudar a tese — pediu para (a) absorver três técnicas baratas e alinhadas (coaching, instância, MCP-catalog/drift), (b) rotular honestamente o que é evidência vs enforcement e subir a escada de enforcement por degraus, (c) tratar integração como princípio (standalone-e-integrada), e (d) reconhecer que o moat (evidência ancorada BR) é confirmado por ausência entre os líderes. Tudo isso já está no Mapa Mestre v1.1 e neste dossiê. Nada exige reescrever a arquitetura — exige sequenciar a construção e afiar o posicionamento.

**Próximo passo inalterado:** promulgar o Mapa v1.1 + o comunicado, versionar no repo (PR-0 com a doutrina D9), e executar a Fase 0 (F1+F2, F3+dispatch, F4, C-2, EP-11 com prazo 2026-08-26, verdade documental). O mercado confirma que a direção está certa; a Fase 0 fecha o que temos para que a primeira venda seja sobre terreno sólido.

— Fim do dossiê. Quatro líderes estudados na fonte; três perguntas respondidas (fechar = F0+U1; tecido vs retalho = osso são, costura e narrativa a corrigir; absorver = coaching+instância+MCP-catalog, integrar o resto, moat por ausência); Workroom formalizada como o dogfooding deste método. Companion do Mapa Mestre v1.1.
