// pt-BR — the PRIMARY catalog. The MessageKey union is derived from this object, so every
// other locale is a `Record<MessageKey, string>` and TypeScript refuses to compile a catalog
// that is missing a key or invents one. A runtime parity test guards the same property for
// anyone reading the tests rather than the types.
//
// ★ NORMATIVE COPY. Several strings below are governance vocabulary, not decoration:
// translating them into a stronger claim than the runtime makes is a product defect. Rules
// enforced by tests (see honesty.test.ts / i18n.test.ts):
//   • a decision that was FORWARDED to the provider must say so, and must never read as
//     blocked / applied / protected / withheld;
//   • "blocked" appears if and only if the request produced a 403;
//   • an unverified state is pending, never "fine".

export const ptBR = {
  // --- application chrome -----------------------------------------------------------------
  'app.name': 'GovAI',
  'app.skipToContent': 'Ir para o conteúdo principal',
  'app.nav.label': 'Navegação principal',
  'app.nav.ai': 'AI Console',
  'app.nav.cockpit': 'Cockpit',
  'app.nav.gaps': 'Lacunas',
  'app.nav.auditEvents': 'Cadeia de auditoria',
  'app.nav.capabilities': 'Capacidades',
  'app.chunkError.title': 'Não foi possível carregar esta tela',
  'app.chunkError.description':
    'Parte da aplicação não foi baixada. Em geral isso significa que uma nova versão foi publicada enquanto esta aba estava aberta, ou que a rede derrubou a requisição. Recarregar busca a versão atual. O que existe apenas nesta aba — inclusive uma conversa do Console de IA — não sobrevive ao recarregamento.',
  'app.chunkError.reload': 'Recarregar a aplicação',
  'app.footer.build': 'Build da UI',
  'app.footer.buildUnavailable': 'não informado',
  'app.footer.org': 'Organização',
  'app.footer.scope':
    'Leitura de evidência e conversa provider-native (U1 + U1.5). Workrooms, regulatório e administração não fazem parte desta entrega.',

  // --- session ----------------------------------------------------------------------------
  'session.org': 'Organização',
  'session.signOut': 'Encerrar sessão',
  'session.signOut.description':
    'Descarta a chave da memória e limpa os dados carregados nesta aba.',
  'session.memoryOnly': 'A chave vive apenas na memória desta aba.',

  // --- authenticated principal (EP-B2 — GET /v1/me) ---------------------------------------
  // ★ NORMATIVE. `identity.tier.*` exists to keep a COMMERCIAL fact from being read as a
  // governance fact (Foundation V1 residual R13), and `identity.noProductionAuth` exists so
  // that showing a real server-resolved identity never starts reading like a user login.
  'identity.title': 'Sessão',
  'identity.details': 'Detalhes da sessão',
  'identity.principal': 'Principal autenticado',
  'identity.user': 'Usuário (id)',
  'identity.roles': 'Papéis',
  'identity.roles.none': 'nenhum papel concedido a esta chave',
  'identity.tier': 'Plano',
  'identity.tier.qualifier': 'contexto comercial/de conta',
  'identity.tier.note':
    'Plano é contexto comercial e de conta. Não é nível de segurança, perfil de governança, rigor de política nem modo de enforcement.',
  'identity.operationalMode': 'Modo operacional',
  'identity.operationalMode.note':
    'Estado operacional que o servidor informa para esta organização. Esta interface mostra o valor; não o interpreta.',
  'identity.noProductionAuth':
    'Autenticação humana de produção: não implementada. Não existe conta de usuário, senha, sessão persistente nem ciclo de vida de chave.',
  'identity.serverAuthoritative':
    'Todos estes valores vêm do servidor (GET /v1/me) a cada autenticação. Esta interface não os deduz, não os edita e não os guarda como autoridade.',

  // --- /enter -----------------------------------------------------------------------------
  'enter.title': 'Entrar',
  'enter.lead':
    'Cole a chave de API da sua organização. Ela é validada contra a API do GovAI e mantida apenas na memória desta aba.',
  'enter.keyLabel': 'Chave de API do GovAI',
  'enter.keyHint':
    'A chave não é gravada em localStorage, sessionStorage, cookie nem na URL. Recarregar a página encerra a sessão e pede a chave de novo.',
  'enter.submit': 'Entrar',
  'enter.submitting': 'Validando…',
  'enter.error.empty': 'Informe a chave de API.',
  'enter.error.auth': 'Chave de API inválida ou sem acesso a esta organização.',
  'enter.error.network':
    'Não foi possível falar com a API do GovAI. Verifique se ela está no ar e tente de novo.',
  'enter.error.rateLimited':
    'Limite de requisições atingido. Aguarde alguns instantes e tente de novo.',
  'enter.error.server': 'A API do GovAI respondeu com erro. Tente de novo.',
  'enter.error.unknown': 'Não foi possível validar a chave.',
  'enter.probeNote':
    'A validação usa uma leitura autenticada de identidade (GET /v1/me); nada é escrito.',
  'enter.noProductionAuth':
    'Esta é a fundação de desenvolvimento / piloto controlado. Não existe login humano, sessão persistente nem ciclo de vida de chave em produção.',

  // --- evidence window --------------------------------------------------------------------
  'window.label': 'Janela de evidência',
  'window.1h': '1 h',
  'window.24h': '24 h',
  'window.7d': '7 d',
  'window.30d': '30 d',
  'window.selected': 'Janela',
  'window.tSeal': 'T_seal',
  'window.contextNote':
    'Todo número desta página é medido dentro da janela e do T_seal acima.',

  // --- locale selector --------------------------------------------------------------------
  'locale.label': 'Idioma',

  // --- generic table / states -------------------------------------------------------------
  'table.loading': 'Carregando…',
  'table.loadMore': 'Carregar mais',
  'table.loadOlder': 'Carregar mais antigos',
  'table.loadingMore': 'Carregando…',
  'table.endOfList': 'Fim dos resultados desta consulta.',
  'table.rowsLoaded': 'Linhas carregadas',
  'state.empty.title': 'Nenhum resultado nesta consulta',
  'state.error.title': 'Não foi possível carregar',
  'state.error.retry': 'Tentar de novo',
  'state.error.auth': 'A sessão não é mais válida. Entre novamente.',
  'state.error.notFound': 'Não encontrado — ou fora da sua organização.',
  'state.error.conflict': 'O estado mudou no servidor. Recarregue a consulta.',
  'state.error.rateLimited':
    'Limite de requisições atingido (limite compartilhado da API). Aguarde e tente de novo.',
  'state.error.server': 'A API do GovAI respondeu com erro. Isto pode ser temporário.',
  'state.error.network': 'Sem resposta da API do GovAI.',
  'state.error.invalidRequest': 'A API recusou os parâmetros desta consulta.',
  'state.error.malformedResponse':
    'A resposta da API não corresponde ao contrato esperado. Nada foi exibido para não apresentar dado não verificado.',
  'state.error.forbidden': 'Esta credencial não tem permissão para esta leitura.',
  'state.error.unknown': 'Erro não classificado.',

  // --- hashes -----------------------------------------------------------------------------
  'hash.copy': 'Copiar valor completo',
  'hash.copied': 'Copiado',
  'hash.copyFailed': 'Não foi possível copiar',
  'hash.showFull': 'Ver valor completo',
  'hash.fullValueTitle': 'Valor completo',
  'hash.close': 'Fechar',
  'hash.absent': 'ausente',

  // --- query export -----------------------------------------------------------------------
  'export.button': 'Exportar esta consulta (JSON)',
  'export.description':
    'Serializa exatamente o que a API devolveu nesta consulta, com os parâmetros usados. Não é um dossiê nem um relatório de conformidade.',
  'export.copied': 'JSON copiado para a área de transferência',
  'export.failed': 'Não foi possível copiar o JSON',
  'export.title': 'Exportação da consulta',
  'export.close': 'Fechar',
  'export.hint':
    'Copie o conteúdo abaixo. Ele contém apenas dados recebidos da API e o contexto não sensível da consulta — nenhuma credencial.',

  // --- cockpit ----------------------------------------------------------------------------
  'cockpit.title': 'Completude da evidência',
  'cockpit.subtitle':
    'Os invariantes de completude (EC) que a API do GovAI mede para esta organização.',
  'cockpit.coverage.title': 'coverage_ratio',
  'cockpit.coverage.covered': 'cobertos',
  'cockpit.coverage.total': 'total',
  'cockpit.coverage.terms': 'Termos incluídos no índice',
  'cockpit.coverage.excluded': 'Invariantes excluídos do índice',
  'cockpit.coverage.term': 'Invariante',
  'cockpit.coverage.reason': 'Razão da exclusão',
  'cockpit.coverage.noUnits':
    'Nenhuma unidade observável nesta janela — o índice vale 1,000 por ausência de população, não por verificação.',
  'cockpit.coverage.parity':
    'O não-coberto de cada termo é exatamente a população de lacunas daquele invariante.',
  'cockpit.tiles.title': 'Invariantes',
  'cockpit.tile.drillDown': 'Ver lacunas',
  'cockpit.tile.noDrillDown': 'Sem lista de lacunas para este invariante.',
  'cockpit.ec5Note':
    'EC-5 (terminal de streaming) está diferido nesta versão do backend e não é reportado por esta API. Sua ausência aqui não é um resultado.',

  // --- invariants -------------------------------------------------------------------------
  'invariant.ec1': 'EC-1 — estado terminal da captura',
  'invariant.ec2': 'EC-2 — contiguidade de sequência',
  'invariant.ec3seal': 'EC-3 — selagem nativa',
  'invariant.ec3drop': 'EC-3 — perda nativa',
  'invariant.ec4': 'EC-4 — ciclo de vida do run (path-A)',
  'invariant.ec6': 'EC-6 — integridade da cadeia',
  'invariant.unknown': 'Invariante desconhecido',

  'ec1.total': 'capturas',
  'ec1.sealed': 'seladas',
  'ec1.failed': 'falhas',
  'ec1.stalled': 'estagnadas além do T_seal',
  'ec1.empty': 'Nenhuma captura nesta janela.',
  'seal.inFlightNoneSealed': 'nenhuma selada ainda — em trânsito',

  'ec2.chains': 'cadeias',
  'ec2.withGap': 'com lacuna de sequência',
  'ec2.empty': 'Nenhuma cadeia nesta janela.',

  'ec3seal.total': 'capturas nativas',
  'ec3seal.sealed': 'seladas',
  'ec3seal.unsealed': 'não seladas além do T_seal',
  'ec3seal.empty': 'Nenhuma captura nativa nesta janela.',

  'ec3drop.unobserved': 'não observado neste processo',
  'ec3drop.unobservedDetail':
    'Este processo não registrou nenhuma observação de perda. O coletor OTLP detém o sinal autoritativo — zero aqui NÃO prova ausência de perdas.',
  'ec3drop.observedDetail': 'Perdas observadas neste processo.',
  'ec3drop.drops': 'perdas',
  'ec3drop.captures': 'capturas',
  'ec3drop.rate': 'taxa de perda',
  'ec3drop.rateUnavailable': 'sem taxa (nada observado)',
  'ec3drop.boundLabel': 'Limite declarado pelo backend',
  'ec3drop.singletonNote':
    'Este invariante é um agregado único, não uma lista: a API o devolve na primeira página e nunca pagina.',

  'ec4.invocations': 'invocações de provedor',
  'ec4.withoutTerminal': 'sem evento terminal de run',
  'ec4.expectedEmpty': 'O resultado esperado é zero.',
  'ec4.empty': 'Nenhuma invocação de provedor nesta janela.',

  'ec6.pending': 'cadeias pendentes de verificação',
  'ec6.verified': 'verificadas',
  'ec6.chains': 'cadeias',
  'ec6.noteLabel': 'Nota do backend (verbatim)',
  'ec6.neverGreen':
    'Pendente não é verificado. Este build não persiste verificação de cadeia, portanto EC-6 nunca é apresentado como aprovado.',
  'ec6.noDrillDown':
    'EC-6 fica deliberadamente fora da lista de lacunas: é um estado por organização, não uma população de linhas.',
  'ec6.emptyScope': 'Nenhuma cadeia nesta janela.',

  // --- gaps -------------------------------------------------------------------------------
  'gaps.title': 'Lacunas por invariante',
  'gaps.backToCockpit': 'Voltar ao cockpit',
  'gaps.empty':
    'Nenhuma lacuna devolvida para este invariante nesta janela. Isto não significa que tudo foi verificado.',
  'gaps.unknownInvariant':
    'Invariante não reconhecido. A API aceita apenas ec1, ec2, ec3seal, ec3drop e ec4.',
  'gaps.column.captureId': 'capture_id',
  'gaps.column.chainId': 'chain_id',
  'gaps.column.chainCategory': 'chain_category',
  'gaps.column.status': 'status',
  'gaps.column.capturedAt': 'captured_at',
  'gaps.column.attempts': 'attempts',
  'gaps.column.lastError': 'last_error',
  'gaps.column.firstGapSeq': 'first_gap_seq',
  'gaps.column.gapCount': 'gap_count',
  'gaps.column.runId': 'run_id',
  'gaps.column.providerInvocationId': 'provider_invocation_id',
  'gaps.column.provider': 'provider',
  'gaps.column.nativeEndpoint': 'native_endpoint',
  'gaps.column.statusCode': 'status_code',
  'gaps.column.errorClass': 'error_class',
  'gaps.column.createdAt': 'created_at',
  'gaps.bigintNote':
    'Os números de sequência chegam como cadeias decimais porque podem exceder o inteiro seguro do JavaScript. São exibidos dígito a dígito, sem conversão.',
  'gaps.unreadableValue': 'valor ilegível',
  'gaps.nullValue': '—',
  'gaps.tSealUnavailable':
    'Não foi possível ler o T_seal: a leitura do resumo falhou. Este invariante seleciona linhas por esse limiar, então as linhas abaixo continuam visíveis mas a exportação fica indisponível até o limiar ser conhecido.',

  // --- audit events -----------------------------------------------------------------------
  'audit.title': 'Cadeia de auditoria',
  'audit.subtitle': 'Os eventos da cadeia HMAC desta organização, do mais recente ao mais antigo.',
  'audit.metadataOnly':
    'Esta API expõe metadados e hashes criptográficos. O conteúdo dos eventos não é exposto: esta tela permite inspecionar integridade, não reconstruir conteúdo.',
  'audit.category.label': 'Cadeia',
  'audit.category.auth': 'auth',
  'audit.category.run': 'run',
  'audit.category.policy': 'policy',
  'audit.category.admin': 'admin',
  'audit.chainId': 'chain_id',
  'audit.column.sequence': 'sequence_number',
  'audit.column.eventType': 'event_type',
  'audit.column.eventVersion': 'event_version',
  'audit.column.subjectType': 'subject_type',
  'audit.column.subjectId': 'subject_id',
  'audit.column.occurredAt': 'occurred_at',
  'audit.column.payloadHash': 'payload_hash',
  'audit.column.previousHmac': 'previous_hmac',
  'audit.column.hmac': 'hmac',
  'audit.column.canonicalHash': 'canonical_hash',
  'audit.column.evidenceStrength': 'evidence_strength',
  'audit.column.keyId': 'key_id',
  'audit.column.keyVersion': 'key_version',
  'audit.genesisLink': 'primeiro evento da cadeia (sem elo anterior)',
  'audit.brokenLink': 'elo anterior ausente fora do início da cadeia — inesperado',
  'audit.empty': 'Nenhum evento nesta cadeia.',
  'audit.keysetNote':
    'A paginação é por chave decrescente (before_seq). A API não devolve cursor: a próxima página parte do menor sequence_number já carregado.',

  // --- capabilities -----------------------------------------------------------------------
  'capabilities.title': 'Capacidades',
  'capabilities.subtitle':
    'A matriz capacidade × faceta servida pelo registro de governança, com os downgrades da organização já aplicados.',
  'capabilities.filter.label': 'Filtrar as linhas já carregadas',
  'capabilities.filter.placeholder': 'capacidade, provedor, faceta…',
  'capabilities.column.capability': 'capability_id',
  'capabilities.column.provider': 'provider',
  'capabilities.column.capabilityStatus': 'status efetivo',
  'capabilities.column.capabilityBaseline': 'status baseline',
  'capabilities.column.facet': 'facet_id',
  'capabilities.column.level': 'nível de governança',
  'capabilities.column.facetStatus': 'status efetivo',
  'capabilities.column.facetBaseline': 'status baseline',
  'capabilities.column.evidenceStrength': 'evidence_strength',
  'capabilities.column.reason': 'reason',
  'capabilities.column.lastLiveTest': 'last_live_test_at',
  'capabilities.column.docs': 'docs_url',
  'capabilities.column.override': 'override aplicado',
  'capabilities.docsLink': 'documentação',
  'capabilities.override.yes': 'sim',
  'capabilities.override.no': 'não',
  'capabilities.empty': 'O registro não devolveu nenhuma capacidade.',
  'capabilities.levelNote':
    'O nível é o nível de governança 0–3 do registro (ADR-004/ADR-005). Não é o modo de superfície do provedor e não descreve risco.',
  'capabilities.evidenceNote':
    'evidence_strength é ortogonal ao nível e não é certificação: no baseline apenas hmac_internal e dev_signed estão disponíveis.',
  'capabilities.plannedNote':
    'Uma capacidade planejada não está disponível para uso. Ela é exibida como registrada, nunca como entregue.',
  'capabilities.overrideNote':
    'Um override da organização só pode rebaixar: o status efetivo nunca é melhor que o baseline.',

  // --- status vocabulary: capture ---------------------------------------------------------
  'status.capture.captured': 'capturada',
  'status.capture.sealing': 'selando',
  'status.capture.sealed': 'selada',
  'status.capture.failed': 'falhou',

  // --- status vocabulary: capability ------------------------------------------------------
  'status.capability.supported': 'suportada',
  'status.capability.planned': 'planejada',
  'status.capability.blocked': 'bloqueada',
  'status.capability.experimental': 'experimental',

  // --- status vocabulary: evidence strength -----------------------------------------------
  'status.evidenceStrength.hmac_internal': 'HMAC interno',
  'status.evidenceStrength.dev_signed': 'assinado em desenvolvimento',
  'status.evidenceStrength.external_anchor': 'âncora externa',
  'status.evidenceStrength.customer_signed': 'assinado pelo cliente',
  'status.evidenceStrength.icp_brasil_tsa': 'carimbo ICP-Brasil',

  // --- status vocabulary: chain category --------------------------------------------------
  'status.chainCategory.auth': 'autenticação',
  'status.chainCategory.run': 'execução',
  'status.chainCategory.policy': 'política',
  'status.chainCategory.admin': 'administração',

  // --- status vocabulary: principal type --------------------------------------------------
  'status.principalType.api_key': 'chave de API da organização (piloto controlado)',

  // --- ★ NORMATIVE: enforcement honesty vocabulary ----------------------------------------
  // Forwarded means the request reached the provider. None of these may be translated into a
  // word that suggests the request was stopped, protected, redacted or that a declared effect
  // was carried out.
  'enforcement.observe': 'Observado — encaminhado ao provedor',
  'enforcement.warn': 'Alerta registrado — encaminhado ao provedor',
  'enforcement.ask':
    'Aprovação recomendada — encaminhado ao provedor (ninguém foi consultado)',
  'enforcement.enforce':
    'Política registrada — encaminhado ao provedor; os efeitos declarados não são executados',
  'enforcement.sandbox_required':
    'Sandbox requerido — precondição declarada, não verificada; encaminhado ao provedor',
  'enforcement.blocked.matrix': 'Bloqueado (403) — matriz de enforcement',
  'enforcement.blocked.toolValidation': 'Bloqueado (403) — validação de ferramenta',
  'enforcement.passthrough': 'Passthrough — observado; nunca aplica política',
  'enforcement.note':
    'Uma decisão só é apresentada como bloqueio quando a requisição realmente devolveu 403. Recomendações encaminhadas são descritas como encaminhadas.',


  // --- ★ AI Console (UI/UX V1 U1.5) -------------------------------------------------------
  // ★ NORMATIVE COPY, under the same rule as the enforcement vocabulary above: a translation
  // may weaken a claim and may never strengthen one. Concretely, in every language:
  //   • "encaminhado" nunca vira "bloqueado", "aplicado", "protegido" ou "impedido";
  //   • um fluxo que terminou sem o marcador terminal do provedor é NÃO CONFIRMADO, jamais
  //     "falhou" e jamais "concluído";
  //   • nenhuma string aqui afirma que evidência foi capturada, selada, verificada ou
  //     certificada — o navegador não recebe nada que prove isso;
  //   • a correlação exata entre um turno e um evento de auditoria é declarada indisponível.
  'ai.title': 'AI Console',
  'ai.lead':
    'Converse com os provedores pelas rotas provider-native do GovAI. A resposta é do provedor; o recibo ao lado dela mostra apenas o que este navegador conseguiu observar.',
  'ai.scopeNote':
    'Esta entrega expõe apenas conversa em texto. Ferramentas, busca na web, arquivos, imagens, agentes e prompt de sistema não fazem parte do AI Console V1, mesmo quando o provedor os suporta.',

  // controls
  'ai.controls.label': 'Configuração da conversa',
  'ai.provider': 'Provedor',
  'ai.provider.openai': 'OpenAI',
  'ai.provider.anthropic': 'Anthropic',
  'ai.mode': 'Modo',
  'ai.mode.native': 'Nativo / Auditado',
  'ai.mode.governed': 'Governado',
  'ai.surface': 'Superfície de API',
  'ai.surface.responses': 'Responses',
  'ai.surface.chatCompletions': 'Chat Completions',
  'ai.surface.messages': 'Messages',
  'ai.advanced': 'Avançado',
  'ai.maxTokens': 'max_tokens',
  'ai.maxTokens.hint':
    'A API Messages da Anthropic exige max_tokens. É o teto de geração enviado ao provedor.',
  'ai.locked':
    'Provedor, modo, superfície e modelo ficam fixos depois do primeiro envio. Para trocar, inicie uma nova conversa.',
  'ai.newConversation': 'Nova conversa',

  // model discovery
  'ai.model': 'Modelo',
  'ai.model.placeholder': 'id do modelo, como o provedor o nomeia',
  'ai.model.hint':
    'Sugestões vêm da listagem do próprio provedor. Estar na lista não garante suporte em toda superfície de API; o provedor continua sendo a autoridade e o id digitado é enviado exatamente como está.',
  'ai.model.loading': 'Carregando a listagem do provedor…',
  'ai.model.listEmpty': 'O provedor não retornou nenhum modelo. Digite o id manualmente.',
  'ai.model.listUnavailable':
    'Não foi possível ler a listagem do provedor. Digite o id do modelo manualmente.',
  'ai.model.listCredential':
    'O GovAI não conseguiu resolver uma credencial de provedor para esta organização. Digite o id do modelo manualmente.',
  'ai.model.listRejected':
    'O provedor recusou a credencial desta organização ao listar modelos. Digite o id do modelo manualmente.',
  'ai.model.listRateLimited':
    'Limite de requisições atingido ao listar modelos. Digite o id do modelo manualmente.',

  // transcript
  'ai.memoryOnly.label': 'Onde esta conversa vive',
  'ai.memoryOnly':
    'O GovAI UI não persiste esta transcrição: ela existe apenas na memória desta aba e desaparece ao recarregar a página, ao sair de /ai ou ao encerrar a sessão. Isso não é uma afirmação sobre o provedor — o tratamento de dados do lado do provedor continua seguindo a configuração do provedor e da conta.',
  'ai.conversation.label': 'Conversa',
  'ai.empty.title': 'Nenhuma mensagem ainda',
  'ai.empty.description':
    'Escolha provedor, modo, superfície e modelo e envie a primeira mensagem. A partir daí, essa identidade de transporte fica fixa nesta conversa.',
  'ai.you': 'Você',
  'ai.assistant': 'Assistente',
  'ai.generating': 'Gerando…',

  // composer
  'ai.composer.label': 'Mensagem',
  'ai.composer.placeholder': 'Pergunte qualquer coisa…',
  'ai.composer.hint': 'Enter envia. Shift+Enter quebra linha.',
  'ai.composer.largeInput':
    'Esta mensagem é muito grande; o limite de contexto quem define é o provedor.',
  'ai.send': 'Enviar',
  'ai.stop': 'Parar',
  'ai.retry': 'Tentar de novo — nova chamada ao provedor',
  'ai.retry.note':
    'Tentar de novo dispara uma NOVA chamada ao provedor, que pode ser cobrada de novo. O GovAI UI nunca repete um POST de provedor automaticamente.',

  // per-attempt annotations
  'ai.refusal': 'Recusa do modelo',
  'ai.unsupportedOutput':
    'O fluxo trouxe conteúdo que este console não renderiza (por exemplo, chamada de ferramenta ou bloco não textual). Ele não foi convertido em texto.',
  'ai.contextExcluded':
    'Esta resposta não entra automaticamente no contexto das próximas mensagens: ela não foi concluída pelo provedor.',
  'ai.contextExcluded.outOfOrder':
    'Esta resposta não entra automaticamente no contexto das próximas mensagens: ela veio de uma nova tentativa de um turno anterior, e as mensagens seguintes já haviam sido respondidas sem ela. Enviá-la apresentaria ao modelo uma conversa que nunca aconteceu.',
  'ai.markdown.imageBlocked': 'imagem não carregada',
  'ai.code.copy': 'Copiar',
  'ai.code.copied': 'Copiado',

  // turn states
  'ai.state.submitting': 'Enviando',
  'ai.state.streaming': 'Transmitindo',
  'ai.state.completed': 'Concluído pelo provedor',
  'ai.state.stopped': 'Interrompido por você',
  'ai.state.stopped.note':
    'Este navegador cancelou a requisição. O texto parcial acima é o que chegou; o que o provedor fez depois disso não é informado nesta resposta.',
  'ai.state.blocked': 'Bloqueado (403)',
  'ai.state.blocked.note':
    'A resposta veio com 403 e um código de bloqueio do GovAI. Para esse código o GovAI não chama o provedor. Este navegador lê o código da resposta; ele não tem como verificar sozinho a origem dela.',
  'ai.state.providerError': 'Erro do provedor',
  'ai.state.providerError.note': 'O provedor respondeu com erro. O que ele disse está abaixo.',
  'ai.state.rateLimited': 'Limite de requisições',
  'ai.state.rateLimited.note':
    'Limite de requisições atingido. Nada foi repetido automaticamente: um POST de provedor pode já ter sido executado e cobrado.',
  'ai.state.credentialUnavailable': 'Credencial de provedor indisponível',
  'ai.state.credentialUnavailable.note':
    'A resposta veio com 502 e o código de credencial de provedor do GovAI. O GovAI devolve esse código quando não consegue resolver uma credencial para a organização, e nesse caso não chama o provedor. É uma condição de configuração, resolvida por quem administra a organização.',
  'ai.state.requestTooLarge': 'Recusada por tamanho',
  'ai.state.requestTooLarge.note':
    'A requisição foi recusada pelo tamanho. O GovAI tem o próprio limite de corpo e recusa antes de chamar o provedor, que é a causa usual — mas este navegador não consegue provar qual salto recusou, então não afirma que o provedor foi ou não chamado. Encurte a mensagem ou comece uma nova conversa: uma transcrição longa é enviada inteira a cada turno.',
  'ai.state.networkError': 'Resultado não confirmado',
  'ai.state.networkError.note':
    'A requisição saiu deste navegador e nenhuma resposta chegou. Este navegador não tem como saber se o provedor executou a chamada, então nada foi repetido automaticamente.',
  'ai.state.unknownOutcome': 'Resultado não confirmado',
  'ai.state.unknownOutcome.note':
    'O fluxo terminou sem o marcador terminal do provedor. O texto acima é o que chegou; este navegador não pode afirmar que a resposta está completa.',
  'ai.state.retryAfter': 'aguarde {seconds}s antes de tentar de novo',
  'ai.error.providerSaid': 'O provedor respondeu',

  // interaction receipt
  'ai.receipt.title': 'Recibo da interação',
  'ai.receipt.provider': 'Provedor',
  'ai.receipt.model': 'Modelo enviado',
  'ai.receipt.surface': 'Superfície de API',
  'ai.receipt.mode': 'Modo GovAI',
  'ai.receipt.endpoint': 'Rota GovAI',
  'ai.receipt.status': 'HTTP',
  'ai.receipt.noResponse': 'nenhuma resposta recebida',
  'ai.receipt.termination': 'Encerramento',
  'ai.receipt.stopReason': 'stop_reason do provedor',
  'ai.receipt.providerRequestId': 'Request id do provedor',
  'ai.receipt.providerMessageId': 'Id da mensagem no provedor',
  'ai.receipt.notExposed': 'não exposto nesta resposta',
  'ai.receipt.duration': 'Duração observada pelo navegador',
  'ai.receipt.governance': 'Governança',
  'ai.receipt.governance.nativeSurface':
    'A superfície Nativa / Auditada não resolve decisão de governança por requisição e não devolve nenhuma ao navegador. Nada é deduzido aqui.',
  'ai.receipt.governance.absentOnResponse':
    'Esta resposta não trouxe os cabeçalhos de governança do GovAI.',
  'ai.receipt.capabilityLevel': 'capability_level',
  'ai.receipt.riskClass': 'effective_risk_class',
  'ai.receipt.recommendation': 'Recomendação',
  'ai.receipt.applied': 'Aplicado de fato',
  'ai.receipt.applied.forwarded': 'Encaminhado ao provedor',
  'ai.receipt.applied.blocked': 'Bloqueado (403)',
  'ai.receipt.governanceNote': 'Como ler',
  'ai.receipt.recommendationVsApplied':
    'Recomendação é o que a matriz de enforcement indicou. Aplicado de fato é o que o runtime executou. Encaminhado significa que a requisição chegou ao provedor: ninguém foi consultado, nenhum sandbox foi criado e nada foi impedido.',
  'ai.receipt.correlationCaveat':
    'A correlação exata entre este turno e um evento de auditoria específico não é exposta pela API atual, e este console não a estima. Consulte Evidência e Cadeia de auditoria para ver o que foi registrado.',
  'ai.receipt.openEvidence': 'Abrir Evidência',
  'ai.receipt.openAudit': 'Abrir Cadeia de auditoria',

  // --- unknown-value fallback -------------------------------------------------------------
  'status.unknown': 'valor não reconhecido',
} as const;

export type MessageKey = keyof typeof ptBR;
export type Catalog = Record<MessageKey, string>;
