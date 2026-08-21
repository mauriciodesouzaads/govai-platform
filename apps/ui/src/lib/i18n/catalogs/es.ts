// es. Typed as `Catalog` (= Record<MessageKey, string>), so TypeScript fails the build if a key
// is missing or invented. See the pt-BR catalog for the normative-copy rules; in particular,
// every `enforcement.*` entry that describes a FORWARDED decision must say the request was
// forwarded (reenviado) and must never read as bloqueado / aplicado / protegido / retenido.

import type { Catalog } from './pt-BR.js';

export const es: Catalog = {
  // --- application chrome -----------------------------------------------------------------
  'app.name': 'GovAI',
  'app.skipToContent': 'Ir al contenido principal',
  'app.nav.label': 'Navegación principal',
  'app.nav.ai': 'AI Console',
  'app.nav.cockpit': 'Panel',
  'app.nav.gaps': 'Brechas',
  'app.nav.auditEvents': 'Cadena de auditoría',
  'app.nav.capabilities': 'Capacidades',
  'app.footer.build': 'Build de la interfaz',
  'app.footer.buildUnavailable': 'no informado',
  'app.footer.org': 'Organización',
  'app.footer.scope':
    'Lectura de evidencia y conversación provider-native (U1 + U1.5). Workrooms, regulatorio y administración no forman parte de esta entrega.',

  // --- session ----------------------------------------------------------------------------
  'session.org': 'Organización',
  'session.signOut': 'Cerrar sesión',
  'session.signOut.description':
    'Descarta la clave de la memoria y limpia los datos cargados en esta pestaña.',
  'session.memoryOnly': 'La clave existe solo en la memoria de esta pestaña.',

  // --- authenticated principal (EP-B2 — GET /v1/me) ---------------------------------------
  'identity.title': 'Sesión',
  'identity.details': 'Detalles de la sesión',
  'identity.principal': 'Principal autenticado',
  'identity.user': 'Usuario (id)',
  'identity.roles': 'Roles',
  'identity.roles.none': 'ningún rol concedido a esta clave',
  'identity.tier': 'Plan',
  'identity.tier.qualifier': 'contexto comercial / de cuenta',
  'identity.tier.note':
    'El plan es contexto comercial y de cuenta. No es un nivel de seguridad, un perfil de gobernanza, un rigor de política ni un modo de enforcement.',
  'identity.operationalMode': 'Modo operativo',
  'identity.operationalMode.note':
    'Estado operativo que el servidor informa para esta organización. Esta interfaz muestra el valor; no lo interpreta.',
  'identity.noProductionAuth':
    'Autenticación humana de producción: no implementada. No existe cuenta de usuario, contraseña, sesión persistente ni ciclo de vida de clave.',
  'identity.serverAuthoritative':
    'Todos estos valores vienen del servidor (GET /v1/me) en cada autenticación. Esta interfaz no los deduce, no los edita y no los guarda como autoridad.',

  // --- /enter -----------------------------------------------------------------------------
  'enter.title': 'Entrar',
  'enter.lead':
    'Pega la clave de API de tu organización. Se valida contra la API de GovAI y se mantiene solo en la memoria de esta pestaña.',
  'enter.keyLabel': 'Clave de API de GovAI',
  'enter.keyHint':
    'La clave no se guarda en localStorage, sessionStorage, cookies ni en la URL. Recargar la página termina la sesión y vuelve a pedir la clave.',
  'enter.submit': 'Entrar',
  'enter.submitting': 'Validando…',
  'enter.error.empty': 'Introduce la clave de API.',
  'enter.error.auth': 'Clave de API inválida o sin acceso a esta organización.',
  'enter.error.network':
    'No fue posible contactar con la API de GovAI. Comprueba que esté activa e inténtalo de nuevo.',
  'enter.error.rateLimited': 'Límite de peticiones alcanzado. Espera un momento e inténtalo de nuevo.',
  'enter.error.server': 'La API de GovAI devolvió un error. Inténtalo de nuevo.',
  'enter.error.unknown': 'No fue posible validar la clave.',
  'enter.probeNote':
    'La validación usa una lectura autenticada de identidad (GET /v1/me); no se escribe nada.',
  'enter.noProductionAuth':
    'Esta es la base de desarrollo / piloto controlado. No existe inicio de sesión humano, ni sesión persistente, ni ciclo de vida de claves en producción.',

  // --- evidence window --------------------------------------------------------------------
  'window.label': 'Ventana de evidencia',
  'window.1h': '1 h',
  'window.24h': '24 h',
  'window.7d': '7 d',
  'window.30d': '30 d',
  'window.selected': 'Ventana',
  'window.tSeal': 'T_seal',
  'window.contextNote':
    'Cada número de esta página se mide dentro de la ventana y del T_seal indicados arriba.',

  // --- locale selector --------------------------------------------------------------------
  'locale.label': 'Idioma',

  // --- generic table / states -------------------------------------------------------------
  'table.loading': 'Cargando…',
  'table.loadMore': 'Cargar más',
  'table.loadOlder': 'Cargar más antiguos',
  'table.loadingMore': 'Cargando…',
  'table.endOfList': 'Fin de los resultados de esta consulta.',
  'table.rowsLoaded': 'Filas cargadas',
  'state.empty.title': 'Sin resultados para esta consulta',
  'state.error.title': 'No fue posible cargar',
  'state.error.retry': 'Reintentar',
  'state.error.auth': 'La sesión ya no es válida. Entra de nuevo.',
  'state.error.notFound': 'No encontrado — o fuera de tu organización.',
  'state.error.conflict': 'El estado cambió en el servidor. Recarga la consulta.',
  'state.error.rateLimited':
    'Límite de peticiones alcanzado (límite compartido de la API). Espera e inténtalo de nuevo.',
  'state.error.server': 'La API de GovAI devolvió un error. Puede ser temporal.',
  'state.error.network': 'Sin respuesta de la API de GovAI.',
  'state.error.invalidRequest': 'La API rechazó los parámetros de esta consulta.',
  'state.error.malformedResponse':
    'La respuesta de la API no corresponde al contrato esperado. No se mostró nada, para no presentar datos sin verificar.',
  'state.error.forbidden': 'Esta credencial no tiene permiso para esta lectura.',
  'state.error.unknown': 'Error sin clasificar.',

  // --- hashes -----------------------------------------------------------------------------
  'hash.copy': 'Copiar el valor completo',
  'hash.copied': 'Copiado',
  'hash.copyFailed': 'No fue posible copiar',
  'hash.showFull': 'Ver el valor completo',
  'hash.fullValueTitle': 'Valor completo',
  'hash.close': 'Cerrar',
  'hash.absent': 'ausente',

  // --- query export -----------------------------------------------------------------------
  'export.button': 'Exportar esta consulta (JSON)',
  'export.description':
    'Serializa exactamente lo que la API devolvió en esta consulta, con los parámetros usados. No es un expediente ni un informe de cumplimiento.',
  'export.copied': 'JSON copiado al portapapeles',
  'export.failed': 'No fue posible copiar el JSON',
  'export.title': 'Exportación de la consulta',
  'export.close': 'Cerrar',
  'export.hint':
    'Copia el contenido de abajo. Contiene solo datos recibidos de la API y el contexto no sensible de la consulta — ninguna credencial.',

  // --- cockpit ----------------------------------------------------------------------------
  'cockpit.title': 'Completitud de la evidencia',
  'cockpit.subtitle':
    'Los invariantes de completitud (EC) que la API de GovAI mide para esta organización.',
  'cockpit.coverage.title': 'coverage_ratio',
  'cockpit.coverage.covered': 'cubiertos',
  'cockpit.coverage.total': 'total',
  'cockpit.coverage.terms': 'Términos incluidos en el índice',
  'cockpit.coverage.excluded': 'Invariantes excluidos del índice',
  'cockpit.coverage.term': 'Invariante',
  'cockpit.coverage.reason': 'Motivo de la exclusión',
  'cockpit.coverage.noUnits':
    'No hay unidades observables en esta ventana — el índice marca 1,000 por población vacía, no por verificación.',
  'cockpit.coverage.parity':
    'Lo no cubierto de cada término es exactamente la población de brechas de ese invariante.',
  'cockpit.tiles.title': 'Invariantes',
  'cockpit.tile.drillDown': 'Ver brechas',
  'cockpit.tile.noDrillDown': 'Este invariante no tiene lista de brechas.',
  'cockpit.ec5Note':
    'EC-5 (terminal de streaming) está diferido en esta versión del backend y esta API no lo reporta. Su ausencia aquí no es un resultado.',

  // --- invariants -------------------------------------------------------------------------
  'invariant.ec1': 'EC-1 — estado terminal de la captura',
  'invariant.ec2': 'EC-2 — contigüidad de secuencia',
  'invariant.ec3seal': 'EC-3 — sellado nativo',
  'invariant.ec3drop': 'EC-3 — pérdida nativa',
  'invariant.ec4': 'EC-4 — ciclo de vida del run (path-A)',
  'invariant.ec6': 'EC-6 — integridad de la cadena',
  'invariant.unknown': 'Invariante desconocido',

  'ec1.total': 'capturas',
  'ec1.sealed': 'selladas',
  'ec1.failed': 'fallidas',
  'ec1.stalled': 'estancadas más allá del T_seal',
  'ec1.empty': 'Sin capturas en esta ventana.',
  'seal.inFlightNoneSealed': 'ninguna sellada aún — en tránsito',

  'ec2.chains': 'cadenas',
  'ec2.withGap': 'con brecha de secuencia',
  'ec2.empty': 'Sin cadenas en esta ventana.',

  'ec3seal.total': 'capturas nativas',
  'ec3seal.sealed': 'selladas',
  'ec3seal.unsealed': 'sin sellar más allá del T_seal',
  'ec3seal.empty': 'Sin capturas nativas en esta ventana.',

  'ec3drop.unobserved': 'no observado en este proceso',
  'ec3drop.unobservedDetail':
    'Este proceso no registró ninguna observación de pérdida. El colector OTLP tiene la señal autoritativa — un cero aquí NO prueba que no hubo pérdidas.',
  'ec3drop.observedDetail': 'Pérdidas observadas en este proceso.',
  'ec3drop.drops': 'pérdidas',
  'ec3drop.captures': 'capturas',
  'ec3drop.rate': 'tasa de pérdida',
  'ec3drop.rateUnavailable': 'sin tasa (nada observado)',
  'ec3drop.boundLabel': 'Límite declarado por el backend',
  'ec3drop.singletonNote':
    'Este invariante es un agregado único, no una lista: la API lo devuelve en la primera página y nunca pagina.',

  'ec4.invocations': 'invocaciones de proveedor',
  'ec4.withoutTerminal': 'sin evento terminal de run',
  'ec4.expectedEmpty': 'El resultado esperado es cero.',
  'ec4.empty': 'Sin invocaciones de proveedor en esta ventana.',

  'ec6.pending': 'cadenas pendientes de verificación',
  'ec6.verified': 'verificadas',
  'ec6.chains': 'cadenas',
  'ec6.noteLabel': 'Nota del backend (verbatim)',
  'ec6.neverGreen':
    'Pendiente no es verificado. Esta versión no persiste la verificación de cadena, por lo que EC-6 nunca se presenta como aprobado.',
  'ec6.noDrillDown':
    'EC-6 queda deliberadamente fuera de la lista de brechas: es un estado por organización, no una población de filas.',
  'ec6.emptyScope': 'Sin cadenas en esta ventana.',

  // --- gaps -------------------------------------------------------------------------------
  'gaps.title': 'Brechas por invariante',
  'gaps.backToCockpit': 'Volver al panel',
  'gaps.empty':
    'La API no devolvió brechas para este invariante en esta ventana. Eso no significa que todo esté verificado.',
  'gaps.unknownInvariant':
    'Invariante no reconocido. La API solo acepta ec1, ec2, ec3seal, ec3drop y ec4.',
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
    'Los números de secuencia llegan como cadenas decimales porque pueden superar el entero seguro de JavaScript. Se muestran dígito a dígito, sin conversión.',
  'gaps.unreadableValue': 'valor ilegible',
  'gaps.nullValue': '—',
  'gaps.tSealUnavailable':
    'No fue posible leer el T_seal: la lectura del resumen falló. Este invariante selecciona sus filas por ese umbral, así que las filas de abajo siguen visibles pero la exportación no está disponible hasta conocer el umbral.',

  // --- audit events -----------------------------------------------------------------------
  'audit.title': 'Cadena de auditoría',
  'audit.subtitle':
    'Los eventos de la cadena HMAC de esta organización, del más reciente al más antiguo.',
  'audit.metadataOnly':
    'Esta API expone metadatos y hashes criptográficos. El contenido de los eventos no se expone: esta vista permite inspeccionar integridad, no reconstruir contenido.',
  'audit.category.label': 'Cadena',
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
  'audit.genesisLink': 'primer evento de la cadena (sin eslabón anterior)',
  'audit.brokenLink': 'eslabón anterior ausente fuera del inicio de la cadena — inesperado',
  'audit.empty': 'Sin eventos en esta cadena.',
  'audit.keysetNote':
    'La paginación es por clave descendente (before_seq). La API no devuelve cursor: la página siguiente parte del menor sequence_number ya cargado.',

  // --- capabilities -----------------------------------------------------------------------
  'capabilities.title': 'Capacidades',
  'capabilities.subtitle':
    'La matriz capacidad × faceta que sirve el registro de gobernanza, con las rebajas de esta organización ya aplicadas.',
  'capabilities.filter.label': 'Filtrar las filas ya cargadas',
  'capabilities.filter.placeholder': 'capacidad, proveedor, faceta…',
  'capabilities.column.capability': 'capability_id',
  'capabilities.column.provider': 'provider',
  'capabilities.column.capabilityStatus': 'estado efectivo',
  'capabilities.column.capabilityBaseline': 'estado baseline',
  'capabilities.column.facet': 'facet_id',
  'capabilities.column.level': 'nivel de gobernanza',
  'capabilities.column.facetStatus': 'estado efectivo',
  'capabilities.column.facetBaseline': 'estado baseline',
  'capabilities.column.evidenceStrength': 'evidence_strength',
  'capabilities.column.reason': 'reason',
  'capabilities.column.lastLiveTest': 'last_live_test_at',
  'capabilities.column.docs': 'docs_url',
  'capabilities.column.override': 'override aplicado',
  'capabilities.docsLink': 'documentación',
  'capabilities.override.yes': 'sí',
  'capabilities.override.no': 'no',
  'capabilities.empty': 'El registro no devolvió ninguna capacidad.',
  'capabilities.levelNote':
    'El nivel es el nivel de gobernanza 0–3 del registro (ADR-004/ADR-005). No es el modo de superficie del proveedor y no describe riesgo.',
  'capabilities.evidenceNote':
    'evidence_strength es ortogonal al nivel y no es certificación: en el baseline solo hmac_internal y dev_signed están disponibles.',
  'capabilities.plannedNote':
    'Una capacidad planificada no está disponible para uso. Se muestra como registrada, nunca como entregada.',
  'capabilities.overrideNote':
    'Un override de la organización solo puede rebajar: el estado efectivo nunca es mejor que el baseline.',

  // --- status vocabulary: capture ---------------------------------------------------------
  'status.capture.captured': 'capturada',
  'status.capture.sealing': 'sellando',
  'status.capture.sealed': 'sellada',
  'status.capture.failed': 'falló',

  // --- status vocabulary: capability ------------------------------------------------------
  'status.capability.supported': 'soportada',
  'status.capability.planned': 'planificada',
  'status.capability.blocked': 'bloqueada',
  'status.capability.experimental': 'experimental',

  // --- status vocabulary: evidence strength -----------------------------------------------
  'status.evidenceStrength.hmac_internal': 'HMAC interno',
  'status.evidenceStrength.dev_signed': 'firmado en desarrollo',
  'status.evidenceStrength.external_anchor': 'ancla externa',
  'status.evidenceStrength.customer_signed': 'firmado por el cliente',
  'status.evidenceStrength.icp_brasil_tsa': 'sello ICP-Brasil',

  // --- status vocabulary: chain category --------------------------------------------------
  'status.chainCategory.auth': 'autenticación',
  'status.chainCategory.run': 'ejecución',
  'status.chainCategory.policy': 'política',
  'status.chainCategory.admin': 'administración',

  // --- status vocabulary: principal type --------------------------------------------------
  'status.principalType.api_key': 'clave de API de la organización (piloto controlado)',

  // --- ★ NORMATIVE: enforcement honesty vocabulary ----------------------------------------
  'enforcement.observe': 'Observado — reenviado al proveedor',
  'enforcement.warn': 'Alerta registrada — reenviado al proveedor',
  'enforcement.ask': 'Aprobación recomendada — reenviado al proveedor (nadie fue consultado)',
  'enforcement.enforce':
    'Política registrada — reenviado al proveedor; los efectos declarados no se ejecutan',
  'enforcement.sandbox_required':
    'Sandbox requerido — precondición declarada, no verificada; reenviado al proveedor',
  'enforcement.blocked.matrix': 'Bloqueado (403) — matriz de enforcement',
  'enforcement.blocked.toolValidation': 'Bloqueado (403) — validación de herramienta',
  'enforcement.passthrough': 'Passthrough — observado; nunca aplica política',
  'enforcement.note':
    'Una decisión se presenta como bloqueo solo cuando la petición devolvió realmente un 403. Las recomendaciones reenviadas se describen como reenviadas.',


  // --- ★ AI Console (UI/UX V1 U1.5) -------------------------------------------------------
  // ★ COPIA NORMATIVA — véase el catálogo pt-BR para la regla. Una traducción puede debilitar
  // una afirmación y nunca fortalecerla: reenviado nunca se convierte en bloqueado ni en
  // aplicado, un resultado no confirmado nunca se convierte en fallo ni en éxito, ninguna
  // cadena afirma que se capturó evidencia, y la correlación exacta turno↔evento de auditoría
  // se declara no disponible.
  'ai.title': 'AI Console',
  'ai.lead':
    'Converse con los proveedores por las rutas provider-native de GovAI. La respuesta es del proveedor; el recibo junto a ella muestra solo lo que este navegador pudo observar.',
  'ai.scopeNote':
    'Esta entrega expone únicamente conversación en texto. Herramientas, búsqueda web, archivos, imágenes, agentes y prompt de sistema no forman parte de AI Console V1, aunque el proveedor los admita.',

  // controls
  'ai.controls.label': 'Configuración de la conversación',
  'ai.provider': 'Proveedor',
  'ai.provider.openai': 'OpenAI',
  'ai.provider.anthropic': 'Anthropic',
  'ai.mode': 'Modo',
  'ai.mode.native': 'Nativo / Auditado',
  'ai.mode.governed': 'Gobernado',
  'ai.surface': 'Superficie de API',
  'ai.surface.responses': 'Responses',
  'ai.surface.chatCompletions': 'Chat Completions',
  'ai.surface.messages': 'Messages',
  'ai.advanced': 'Avanzado',
  'ai.maxTokens': 'max_tokens',
  'ai.maxTokens.hint':
    'La API Messages de Anthropic exige max_tokens. Es el techo de generación enviado al proveedor.',
  'ai.locked':
    'Proveedor, modo, superficie y modelo quedan fijos tras el primer envío. Para cambiarlos, inicie una nueva conversación.',
  'ai.newConversation': 'Nueva conversación',

  // model discovery
  'ai.model': 'Modelo',
  'ai.model.placeholder': 'id del modelo, tal como lo nombra el proveedor',
  'ai.model.hint':
    'Las sugerencias provienen del listado del propio proveedor. Aparecer en la lista no garantiza soporte en toda superficie de API; el proveedor sigue siendo la autoridad y el id que escriba se envía exactamente como está.',
  'ai.model.loading': 'Cargando el listado del proveedor…',
  'ai.model.listEmpty': 'El proveedor no devolvió ningún modelo. Escriba el id manualmente.',
  'ai.model.listUnavailable':
    'No se pudo leer el listado del proveedor. Escriba el id del modelo manualmente.',
  'ai.model.listCredential':
    'GovAI no pudo resolver una credencial de proveedor para esta organización. Escriba el id del modelo manualmente.',
  'ai.model.listRejected':
    'El proveedor rechazó la credencial de esta organización al listar modelos. Escriba el id del modelo manualmente.',
  'ai.model.listRateLimited':
    'Límite de peticiones alcanzado al listar modelos. Escriba el id del modelo manualmente.',

  // transcript
  'ai.memoryOnly.label': 'Dónde vive esta conversación',
  'ai.memoryOnly':
    'La interfaz de GovAI no persiste esta transcripción: existe solo en la memoria de esta pestaña y desaparece al recargar, al salir de /ai o al cerrar la sesión. Esto no es una afirmación sobre el proveedor — el tratamiento de datos del lado del proveedor sigue la configuración del proveedor y de la cuenta.',
  'ai.conversation.label': 'Conversación',
  'ai.empty.title': 'Todavía no hay mensajes',
  'ai.empty.description':
    'Elija proveedor, modo, superficie y modelo, y envíe el primer mensaje. A partir de ahí esa identidad de transporte queda fija en esta conversación.',
  'ai.you': 'Usted',
  'ai.assistant': 'Asistente',
  'ai.generating': 'Generando…',

  // composer
  'ai.composer.label': 'Mensaje',
  'ai.composer.placeholder': 'Pregunte lo que quiera…',
  'ai.composer.hint': 'Enter envía. Shift+Enter inserta un salto de línea.',
  'ai.composer.largeInput':
    'Este mensaje es muy grande; el límite de contexto lo define el proveedor.',
  'ai.send': 'Enviar',
  'ai.stop': 'Detener',
  'ai.retry': 'Reintentar — nueva llamada al proveedor',
  'ai.retry.note':
    'Reintentar dispara una NUEVA llamada al proveedor, que puede facturarse otra vez. La interfaz de GovAI nunca repite automáticamente un POST al proveedor.',

  // per-attempt annotations
  'ai.refusal': 'Rechazo del modelo',
  'ai.unsupportedOutput':
    'El flujo trajo contenido que esta consola no renderiza (por ejemplo, una llamada a herramienta o un bloque no textual). No se convirtió en texto.',
  'ai.contextExcluded':
    'Esta respuesta no entra automáticamente en el contexto de los mensajes siguientes: el proveedor no la completó.',
  'ai.contextExcluded.outOfOrder':
    'Esta respuesta no entra automáticamente en el contexto de los mensajes siguientes: proviene de reintentar un turno anterior, y los mensajes posteriores ya se habían respondido sin ella. Enviarla presentaría al modelo una conversación que nunca ocurrió.',
  'ai.markdown.imageBlocked': 'imagen no cargada',
  'ai.code.copy': 'Copiar',
  'ai.code.copied': 'Copiado',

  // turn states
  'ai.state.submitting': 'Enviando',
  'ai.state.streaming': 'Transmitiendo',
  'ai.state.completed': 'Completado por el proveedor',
  'ai.state.stopped': 'Detenido por usted',
  'ai.state.stopped.note':
    'Este navegador canceló la petición. El texto parcial de arriba es lo que llegó; lo que el proveedor hizo después no se informa en esta respuesta.',
  'ai.state.blocked': 'Bloqueado (403) antes del proveedor',
  'ai.state.blocked.note':
    'La respuesta llegó con 403 y un código de bloqueo de GovAI. Para ese código GovAI no llama al proveedor. Este navegador lee el código de la respuesta; no puede verificar por sí mismo su origen.',
  'ai.state.providerError': 'Error del proveedor',
  'ai.state.providerError.note': 'El proveedor respondió con un error. Lo que dijo está abajo.',
  'ai.state.rateLimited': 'Límite de peticiones',
  'ai.state.rateLimited.note':
    'Límite de peticiones alcanzado. No se repitió nada automáticamente: un POST al proveedor puede haberse ejecutado y facturado ya.',
  'ai.state.credentialUnavailable': 'Credencial de proveedor no disponible',
  'ai.state.credentialUnavailable.note':
    'GovAI no pudo resolver una credencial de proveedor para esta organización, por lo que no llamó al proveedor. Es una condición de configuración, que resuelve quien administra la organización.',
  'ai.state.networkError': 'Resultado no confirmado',
  'ai.state.networkError.note':
    'La petición salió de este navegador y no llegó ninguna respuesta. Este navegador no puede saber si el proveedor ejecutó la llamada, así que no se repitió nada automáticamente.',
  'ai.state.unknownOutcome': 'Resultado no confirmado',
  'ai.state.unknownOutcome.note':
    'El flujo terminó sin el marcador terminal del proveedor. El texto de arriba es lo que llegó; este navegador no puede afirmar que la respuesta esté completa.',
  'ai.state.retryAfter': 'espere {seconds}s antes de intentarlo de nuevo',
  'ai.error.providerSaid': 'El proveedor respondió',

  // interaction receipt
  'ai.receipt.title': 'Recibo de la interacción',
  'ai.receipt.provider': 'Proveedor',
  'ai.receipt.model': 'Modelo enviado',
  'ai.receipt.surface': 'Superficie de API',
  'ai.receipt.mode': 'Modo GovAI',
  'ai.receipt.endpoint': 'Ruta GovAI',
  'ai.receipt.status': 'HTTP',
  'ai.receipt.noResponse': 'no se recibió respuesta',
  'ai.receipt.termination': 'Cierre',
  'ai.receipt.stopReason': 'stop_reason del proveedor',
  'ai.receipt.providerRequestId': 'Request id del proveedor',
  'ai.receipt.providerMessageId': 'Id del mensaje en el proveedor',
  'ai.receipt.notExposed': 'no expuesto en esta respuesta',
  'ai.receipt.duration': 'Duración observada por el navegador',
  'ai.receipt.governance': 'Gobernanza',
  'ai.receipt.governance.nativeSurface':
    'La superficie Nativa / Auditada no resuelve ninguna decisión de gobernanza por petición y no devuelve ninguna al navegador. Aquí no se deduce nada.',
  'ai.receipt.governance.absentOnResponse':
    'Esta respuesta no trajo ninguna de las cabeceras de gobernanza de GovAI.',
  'ai.receipt.capabilityLevel': 'capability_level',
  'ai.receipt.riskClass': 'effective_risk_class',
  'ai.receipt.recommendation': 'Recomendación',
  'ai.receipt.applied': 'Aplicado realmente',
  'ai.receipt.applied.forwarded': 'Reenviado al proveedor',
  'ai.receipt.applied.blocked': 'Bloqueado (403)',
  'ai.receipt.governanceNote': 'Cómo leerlo',
  'ai.receipt.recommendationVsApplied':
    'Recomendación es lo que indicó la matriz de enforcement. Aplicado realmente es lo que ejecutó el runtime. Reenviado significa que la petición llegó al proveedor: no se consultó a nadie, no se creó ningún sandbox y no se impidió nada.',
  'ai.receipt.correlationCaveat':
    'La correlación exacta entre este turno y un evento de auditoría concreto no la expone la API actual, y esta consola no la estima. Abra Evidencia y Cadena de auditoría para ver lo que se registró.',
  'ai.receipt.openEvidence': 'Abrir Evidencia',
  'ai.receipt.openAudit': 'Abrir Cadena de auditoría',

  // --- unknown-value fallback -------------------------------------------------------------
  'status.unknown': 'valor no reconocido',
};
