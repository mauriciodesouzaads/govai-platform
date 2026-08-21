// en-US. Typed as `Catalog` (= Record<MessageKey, string>), so TypeScript fails the build if a
// key is missing or invented. See the pt-BR catalog for the normative-copy rules; in
// particular, every `enforcement.*` entry that describes a FORWARDED decision must say the
// request was forwarded and must never read as blocked / applied / protected / withheld.

import type { Catalog } from './pt-BR.js';

export const enUS: Catalog = {
  // --- application chrome -----------------------------------------------------------------
  'app.name': 'GovAI',
  'app.skipToContent': 'Skip to main content',
  'app.nav.label': 'Main navigation',
  'app.nav.ai': 'AI Console',
  'app.nav.cockpit': 'Cockpit',
  'app.nav.gaps': 'Gaps',
  'app.nav.auditEvents': 'Audit chain',
  'app.nav.capabilities': 'Capabilities',
  'app.chunkError.title': 'This screen could not be loaded',
  'app.chunkError.description':
    'Part of the application failed to download. This usually means a new version was deployed while this tab was open, or the network dropped the request. Reloading fetches the current version. Anything held only in this tab — including an AI Console conversation — is not carried across a reload.',
  'app.chunkError.reload': 'Reload the application',
  'app.footer.build': 'UI build',
  'app.footer.buildUnavailable': 'not provided',
  'app.footer.org': 'Organization',
  'app.footer.scope':
    'Evidence reading and provider-native conversation (U1 + U1.5). Workrooms, regulatory and administration are not part of this delivery.',

  // --- session ----------------------------------------------------------------------------
  'session.org': 'Organization',
  'session.signOut': 'End session',
  'session.signOut.description': 'Discards the key from memory and clears the data loaded in this tab.',
  'session.memoryOnly': 'The key lives only in this tab’s memory.',

  // --- authenticated principal (EP-B2 — GET /v1/me) ---------------------------------------
  'identity.title': 'Session',
  'identity.details': 'Session details',
  'identity.principal': 'Authenticated principal',
  'identity.user': 'User (id)',
  'identity.roles': 'Roles',
  'identity.roles.none': 'no role granted to this key',
  'identity.tier': 'Plan',
  'identity.tier.qualifier': 'commercial / account context',
  'identity.tier.note':
    'Plan is commercial and account context. It is not a security level, a governance profile, a policy strictness or an enforcement mode.',
  'identity.operationalMode': 'Operational mode',
  'identity.operationalMode.note':
    'The operational state the server reports for this organization. This interface shows the value; it does not interpret it.',
  'identity.noProductionAuth':
    'Production human authentication: not implemented. There is no user account, no password, no persistent session and no key lifecycle.',
  'identity.serverAuthoritative':
    'Every value here comes from the server (GET /v1/me) at each authentication. This interface does not infer them, does not edit them and does not hold them as authority.',

  // --- /enter -----------------------------------------------------------------------------
  'enter.title': 'Sign in',
  'enter.lead':
    'Paste your organization’s API key. It is validated against the GovAI API and kept only in this tab’s memory.',
  'enter.keyLabel': 'GovAI API key',
  'enter.keyHint':
    'The key is not written to localStorage, sessionStorage, a cookie or the URL. Reloading the page ends the session and asks for the key again.',
  'enter.submit': 'Sign in',
  'enter.submitting': 'Validating…',
  'enter.error.empty': 'Enter the API key.',
  'enter.error.auth': 'Invalid API key, or no access to this organization.',
  'enter.error.network':
    'Could not reach the GovAI API. Check that it is running and try again.',
  'enter.error.rateLimited': 'Request limit reached. Wait a moment and try again.',
  'enter.error.server': 'The GovAI API returned an error. Try again.',
  'enter.error.unknown': 'The key could not be validated.',
  'enter.probeNote':
    'Validation uses an authenticated identity read (GET /v1/me); nothing is written.',
  'enter.noProductionAuth':
    'This is the development / controlled-pilot foundation. There is no human login, no persistent session and no production API-key lifecycle.',

  // --- evidence window --------------------------------------------------------------------
  'window.label': 'Evidence window',
  'window.1h': '1 h',
  'window.24h': '24 h',
  'window.7d': '7 d',
  'window.30d': '30 d',
  'window.selected': 'Window',
  'window.tSeal': 'T_seal',
  'window.contextNote': 'Every number on this page is measured inside the window and T_seal above.',

  // --- locale selector --------------------------------------------------------------------
  'locale.label': 'Language',

  // --- generic table / states -------------------------------------------------------------
  'table.loading': 'Loading…',
  'table.loadMore': 'Load more',
  'table.loadOlder': 'Load older',
  'table.loadingMore': 'Loading…',
  'table.endOfList': 'End of the results for this query.',
  'table.rowsLoaded': 'Rows loaded',
  'state.empty.title': 'No results for this query',
  'state.error.title': 'Could not load',
  'state.error.retry': 'Try again',
  'state.error.auth': 'The session is no longer valid. Sign in again.',
  'state.error.notFound': 'Not found — or outside your organization.',
  'state.error.conflict': 'The state changed on the server. Reload the query.',
  'state.error.rateLimited':
    'Request limit reached (shared API limit). Wait and try again.',
  'state.error.server': 'The GovAI API returned an error. This may be temporary.',
  'state.error.network': 'No response from the GovAI API.',
  'state.error.invalidRequest': 'The API rejected the parameters of this query.',
  'state.error.malformedResponse':
    'The API response does not match the expected contract. Nothing was displayed, so that no unverified data is presented.',
  'state.error.forbidden': 'This credential is not permitted to perform this read.',
  'state.error.unknown': 'Unclassified error.',

  // --- hashes -----------------------------------------------------------------------------
  'hash.copy': 'Copy full value',
  'hash.copied': 'Copied',
  'hash.copyFailed': 'Could not copy',
  'hash.showFull': 'View full value',
  'hash.fullValueTitle': 'Full value',
  'hash.close': 'Close',
  'hash.absent': 'absent',

  // --- query export -----------------------------------------------------------------------
  'export.button': 'Export this query (JSON)',
  'export.description':
    'Serializes exactly what the API returned for this query, with the parameters used. It is not a dossier and not a compliance report.',
  'export.copied': 'JSON copied to the clipboard',
  'export.failed': 'Could not copy the JSON',
  'export.title': 'Query export',
  'export.close': 'Close',
  'export.hint':
    'Copy the content below. It contains only data received from the API and the non-sensitive query context — no credential.',

  // --- cockpit ----------------------------------------------------------------------------
  'cockpit.title': 'Evidence completeness',
  'cockpit.subtitle':
    'The completeness invariants (EC) the GovAI API measures for this organization.',
  'cockpit.coverage.title': 'coverage_ratio',
  'cockpit.coverage.covered': 'covered',
  'cockpit.coverage.total': 'total',
  'cockpit.coverage.terms': 'Terms included in the ratio',
  'cockpit.coverage.excluded': 'Invariants excluded from the ratio',
  'cockpit.coverage.term': 'Invariant',
  'cockpit.coverage.reason': 'Reason for exclusion',
  'cockpit.coverage.noUnits':
    'No observable units in this window — the ratio reads 1.000 because the population is empty, not because anything was verified.',
  'cockpit.coverage.parity':
    'Each term’s uncovered count is exactly that invariant’s gap population.',
  'cockpit.tiles.title': 'Invariants',
  'cockpit.tile.drillDown': 'View gaps',
  'cockpit.tile.noDrillDown': 'No gap list exists for this invariant.',
  'cockpit.ec5Note':
    'EC-5 (stream terminal) is deferred in this backend build and is not reported by this API. Its absence here is not a result.',

  // --- invariants -------------------------------------------------------------------------
  'invariant.ec1': 'EC-1 — capture terminal state',
  'invariant.ec2': 'EC-2 — sequence contiguity',
  'invariant.ec3seal': 'EC-3 — native sealing',
  'invariant.ec3drop': 'EC-3 — native loss',
  'invariant.ec4': 'EC-4 — run lifecycle (path-A)',
  'invariant.ec6': 'EC-6 — chain integrity',
  'invariant.unknown': 'Unknown invariant',

  'ec1.total': 'captures',
  'ec1.sealed': 'sealed',
  'ec1.failed': 'failed',
  'ec1.stalled': 'stalled past T_seal',
  'ec1.empty': 'No captures in this window.',
  'seal.inFlightNoneSealed': 'none sealed yet — in flight',

  'ec2.chains': 'chains',
  'ec2.withGap': 'with a sequence gap',
  'ec2.empty': 'No chains in this window.',

  'ec3seal.total': 'native captures',
  'ec3seal.sealed': 'sealed',
  'ec3seal.unsealed': 'unsealed past T_seal',
  'ec3seal.empty': 'No native captures in this window.',

  'ec3drop.unobserved': 'not observed in this process',
  'ec3drop.unobservedDetail':
    'This process recorded no loss observations. The OTLP collector holds the authoritative signal — a zero here does NOT prove that nothing was lost.',
  'ec3drop.observedDetail': 'Losses observed in this process.',
  'ec3drop.drops': 'drops',
  'ec3drop.captures': 'captures',
  'ec3drop.rate': 'drop rate',
  'ec3drop.rateUnavailable': 'no rate (nothing observed)',
  'ec3drop.boundLabel': 'Bound declared by the backend',
  'ec3drop.singletonNote':
    'This invariant is a single aggregate, not a list: the API returns it on the first page and never paginates it.',

  'ec4.invocations': 'provider invocations',
  'ec4.withoutTerminal': 'without a terminal run event',
  'ec4.expectedEmpty': 'The expected result is zero.',
  'ec4.empty': 'No provider invocations in this window.',

  'ec6.pending': 'chains pending verification',
  'ec6.verified': 'verified',
  'ec6.chains': 'chains',
  'ec6.noteLabel': 'Backend note (verbatim)',
  'ec6.neverGreen':
    'Pending is not verified. This build persists no chain verification, so EC-6 is never presented as passing.',
  'ec6.noDrillDown':
    'EC-6 is deliberately outside the gap list: it is a per-organization state, not a population of rows.',
  'ec6.emptyScope': 'No chains in this window.',

  // --- gaps -------------------------------------------------------------------------------
  'gaps.title': 'Gaps by invariant',
  'gaps.backToCockpit': 'Back to the cockpit',
  'gaps.empty':
    'No gaps returned for this invariant in this window. That does not mean everything was verified.',
  'gaps.unknownInvariant':
    'Unrecognized invariant. The API accepts only ec1, ec2, ec3seal, ec3drop and ec4.',
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
    'Sequence numbers arrive as decimal strings because they can exceed JavaScript’s safe integer. They are shown digit for digit, with no conversion.',
  'gaps.unreadableValue': 'unreadable value',
  'gaps.nullValue': '—',
  'gaps.tSealUnavailable':
    'T_seal could not be read: the summary request failed. This invariant selects its rows by that threshold, so the rows below stay visible but the export is unavailable until the threshold is known.',

  // --- audit events -----------------------------------------------------------------------
  'audit.title': 'Audit chain',
  'audit.subtitle': 'This organization’s HMAC chain events, newest first.',
  'audit.metadataOnly':
    'This API exposes metadata and cryptographic hashes. Event content is not exposed: this view supports integrity inspection, not content reconstruction.',
  'audit.category.label': 'Chain',
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
  'audit.genesisLink': 'first event of the chain (no previous link)',
  'audit.brokenLink': 'previous link missing outside the start of the chain — unexpected',
  'audit.empty': 'No events in this chain.',
  'audit.keysetNote':
    'Pagination is descending keyset (before_seq). The API returns no cursor: the next page starts from the smallest sequence_number already loaded.',

  // --- capabilities -----------------------------------------------------------------------
  'capabilities.title': 'Capabilities',
  'capabilities.subtitle':
    'The capability × facet matrix served by the governance registry, with this organization’s downgrades already applied.',
  'capabilities.filter.label': 'Filter the rows already loaded',
  'capabilities.filter.placeholder': 'capability, provider, facet…',
  'capabilities.column.capability': 'capability_id',
  'capabilities.column.provider': 'provider',
  'capabilities.column.capabilityStatus': 'effective status',
  'capabilities.column.capabilityBaseline': 'baseline status',
  'capabilities.column.facet': 'facet_id',
  'capabilities.column.level': 'governance level',
  'capabilities.column.facetStatus': 'effective status',
  'capabilities.column.facetBaseline': 'baseline status',
  'capabilities.column.evidenceStrength': 'evidence_strength',
  'capabilities.column.reason': 'reason',
  'capabilities.column.lastLiveTest': 'last_live_test_at',
  'capabilities.column.docs': 'docs_url',
  'capabilities.column.override': 'override applied',
  'capabilities.docsLink': 'documentation',
  'capabilities.override.yes': 'yes',
  'capabilities.override.no': 'no',
  'capabilities.empty': 'The registry returned no capabilities.',
  'capabilities.levelNote':
    'The level is the registry’s governance level 0–3 (ADR-004/ADR-005). It is not the provider surface mode and it does not describe risk.',
  'capabilities.evidenceNote':
    'evidence_strength is orthogonal to the level and is not certification: only hmac_internal and dev_signed are available in the baseline.',
  'capabilities.plannedNote':
    'A planned capability is not available for use. It is shown as registered, never as delivered.',
  'capabilities.overrideNote':
    'An organization override can only downgrade: the effective status is never better than the baseline.',

  // --- status vocabulary: capture ---------------------------------------------------------
  'status.capture.captured': 'captured',
  'status.capture.sealing': 'sealing',
  'status.capture.sealed': 'sealed',
  'status.capture.failed': 'failed',

  // --- status vocabulary: capability ------------------------------------------------------
  'status.capability.supported': 'supported',
  'status.capability.planned': 'planned',
  'status.capability.blocked': 'blocked',
  'status.capability.experimental': 'experimental',

  // --- status vocabulary: evidence strength -----------------------------------------------
  'status.evidenceStrength.hmac_internal': 'internal HMAC',
  'status.evidenceStrength.dev_signed': 'development-signed',
  'status.evidenceStrength.external_anchor': 'external anchor',
  'status.evidenceStrength.customer_signed': 'customer-signed',
  'status.evidenceStrength.icp_brasil_tsa': 'ICP-Brasil timestamp',

  // --- status vocabulary: chain category --------------------------------------------------
  'status.chainCategory.auth': 'authentication',
  'status.chainCategory.run': 'execution',
  'status.chainCategory.policy': 'policy',
  'status.chainCategory.admin': 'administration',

  // --- status vocabulary: principal type --------------------------------------------------
  'status.principalType.api_key': 'organization API key (controlled pilot)',

  // --- ★ NORMATIVE: enforcement honesty vocabulary ----------------------------------------
  'enforcement.observe': 'Observed — forwarded to the provider',
  'enforcement.warn': 'Warning recorded — forwarded to the provider',
  'enforcement.ask': 'Approval recommended — forwarded to the provider (nobody was asked)',
  'enforcement.enforce':
    'Policy recorded — forwarded to the provider; the declared effects are not executed',
  'enforcement.sandbox_required':
    'Sandbox required — precondition declared, not verified; forwarded to the provider',
  'enforcement.blocked.matrix': 'Blocked (403) — enforcement matrix',
  'enforcement.blocked.toolValidation': 'Blocked (403) — tool validation',
  'enforcement.passthrough': 'Passthrough — observed; never applies policy',
  'enforcement.note':
    'A decision is presented as a block only when the request actually returned 403. Forwarded recommendations are described as forwarded.',


  // --- ★ AI Console (UI/UX V1 U1.5) -------------------------------------------------------
  // ★ NORMATIVE COPY — see the pt-BR catalog for the rule. A translation may weaken a claim
  // and may never strengthen one: forwarded never becomes blocked or applied, an unconfirmed
  // outcome never becomes a failure or a success, nothing here says evidence was captured,
  // and exact turn-to-audit-event correlation is stated as unavailable.
  'ai.title': 'AI Console',
  'ai.lead':
    'Talk to the providers through GovAI’s provider-native routes. The answer is the provider’s; the receipt beside it shows only what this browser was able to observe.',
  'ai.scopeNote':
    'This delivery exposes text conversation only. Tools, web search, files, images, agents and a system prompt are not part of AI Console V1, even where the provider supports them.',

  // controls
  'ai.controls.label': 'Conversation configuration',
  'ai.provider': 'Provider',
  'ai.provider.openai': 'OpenAI',
  'ai.provider.anthropic': 'Anthropic',
  'ai.mode': 'Mode',
  'ai.mode.native': 'Native / Audited',
  'ai.mode.governed': 'Governed',
  'ai.surface': 'API surface',
  'ai.surface.responses': 'Responses',
  'ai.surface.chatCompletions': 'Chat Completions',
  'ai.surface.messages': 'Messages',
  'ai.advanced': 'Advanced',
  'ai.maxTokens': 'max_tokens',
  'ai.maxTokens.hint':
    'Anthropic’s Messages API requires max_tokens. It is the generation ceiling sent to the provider.',
  'ai.locked':
    'Provider, mode, surface and model are fixed after the first send. Start a new conversation to change them.',
  'ai.newConversation': 'New conversation',

  // model discovery
  'ai.model': 'Model',
  'ai.model.placeholder': 'model id, as the provider names it',
  'ai.model.hint':
    'Suggestions come from the provider’s own listing. Availability in the list does not guarantee support on every API surface; the provider remains the authority, and the id you type is sent exactly as typed.',
  'ai.model.loading': 'Loading the provider listing…',
  'ai.model.listEmpty': 'The provider returned no models. Type the id manually.',
  'ai.model.listUnavailable': 'The provider listing could not be read. Type the model id manually.',
  'ai.model.listCredential':
    'GovAI could not resolve a provider credential for this organization. Type the model id manually.',
  'ai.model.listRejected':
    'The provider rejected this organization’s credential while listing models. Type the model id manually.',
  'ai.model.listRateLimited':
    'Rate limit reached while listing models. Type the model id manually.',

  // transcript
  'ai.memoryOnly.label': 'Where this conversation lives',
  'ai.memoryOnly':
    'The GovAI UI does not persist this transcript: it exists only in this tab’s memory and disappears on reload, on leaving /ai, or on ending the session. That is not a statement about the provider — provider-side data handling continues to follow the provider and account configuration.',
  'ai.conversation.label': 'Conversation',
  'ai.empty.title': 'No messages yet',
  'ai.empty.description':
    'Choose provider, mode, surface and model, then send the first message. From then on that transport identity is fixed for this conversation.',
  'ai.you': 'You',
  'ai.assistant': 'Assistant',
  'ai.generating': 'Generating…',

  // composer
  'ai.composer.label': 'Message',
  'ai.composer.placeholder': 'Ask anything…',
  'ai.composer.hint': 'Enter sends. Shift+Enter inserts a newline.',
  'ai.composer.largeInput':
    'This message is very large; the provider is what defines the context limit.',
  'ai.send': 'Send',
  'ai.stop': 'Stop',
  'ai.retry': 'Retry — new provider call',
  'ai.retry.note':
    'Retry issues a NEW provider call, which may be billed again. The GovAI UI never repeats a provider POST automatically.',

  // per-attempt annotations
  'ai.refusal': 'Model refusal',
  'ai.unsupportedOutput':
    'The stream carried content this console does not render (a tool call or a non-text block, for example). It was not turned into text.',
  'ai.contextExcluded':
    'This answer is not automatically included in the context of later messages: the provider did not complete it.',
  'ai.contextExcluded.outOfOrder':
    'This answer is not automatically included in the context of later messages: it came from retrying an earlier turn, and the messages after it had already been answered without it. Sending it would present the model with a conversation that never happened.',
  'ai.markdown.imageBlocked': 'image not loaded',
  'ai.code.copy': 'Copy',
  'ai.code.copied': 'Copied',

  // turn states
  'ai.state.submitting': 'Sending',
  'ai.state.streaming': 'Streaming',
  'ai.state.completed': 'Completed by the provider',
  'ai.state.stopped': 'Stopped by you',
  'ai.state.stopped.note':
    'This browser cancelled the request. The partial text above is what arrived; what the provider did afterwards is not reported in this response.',
  'ai.state.blocked': 'Blocked (403)',
  'ai.state.blocked.note':
    'The response came back 403 with a GovAI block code. GovAI does not call the provider for that code. This browser reads the code from the response; it cannot verify the response’s origin on its own.',
  'ai.state.providerError': 'Provider error',
  'ai.state.providerError.note': 'The provider answered with an error. What it said is below.',
  'ai.state.rateLimited': 'Rate limited',
  'ai.state.rateLimited.note':
    'Rate limit reached. Nothing was repeated automatically: a provider POST may already have been executed and billed.',
  'ai.state.credentialUnavailable': 'Provider credential unavailable',
  'ai.state.credentialUnavailable.note':
    'The response came back 502 with GovAI’s provider-credential code. GovAI returns that code when it cannot resolve a credential for the organization, and does not call the provider in that case. This is a configuration condition, resolved by whoever administers the organization.',
  'ai.state.requestTooLarge': 'Rejected as too large',
  'ai.state.requestTooLarge.note':
    'The request was rejected for its size. GovAI has its own body limit and rejects before calling the provider, which is the usual cause — but this browser cannot prove which hop rejected it, so it does not claim the provider was or was not called. Shorten the message, or start a new conversation: a long transcript is sent in full on every turn.',
  'ai.state.networkError': 'Outcome not confirmed',
  'ai.state.networkError.note':
    'The request left this browser and no response arrived. This browser cannot tell whether the provider executed the call, so nothing was repeated automatically.',
  'ai.state.unknownOutcome': 'Outcome not confirmed',
  'ai.state.unknownOutcome.note':
    'The stream ended without the provider’s terminal marker. The text above is what arrived; this browser cannot assert that the answer is complete.',
  'ai.state.retryAfter': 'wait {seconds}s before trying again',
  'ai.error.providerSaid': 'The provider answered',

  // interaction receipt
  'ai.receipt.title': 'Interaction receipt',
  'ai.receipt.provider': 'Provider',
  'ai.receipt.model': 'Model sent',
  'ai.receipt.surface': 'API surface',
  'ai.receipt.mode': 'GovAI mode',
  'ai.receipt.endpoint': 'GovAI route',
  'ai.receipt.status': 'HTTP',
  'ai.receipt.noResponse': 'no response received',
  'ai.receipt.termination': 'Termination',
  'ai.receipt.stopReason': 'provider stop_reason',
  'ai.receipt.providerRequestId': 'Provider request id',
  'ai.receipt.providerMessageId': 'Provider message id',
  'ai.receipt.notExposed': 'not exposed in this response',
  'ai.receipt.duration': 'Client-observed duration',
  'ai.receipt.governance': 'Governance',
  'ai.receipt.governance.nativeSurface':
    'The Native / Audited surface resolves no per-request governance decision and returns none to the browser. Nothing is inferred here.',
  'ai.receipt.governance.absentOnResponse':
    'This response carried none of the GovAI governance headers.',
  'ai.receipt.capabilityLevel': 'capability_level',
  'ai.receipt.riskClass': 'effective_risk_class',
  'ai.receipt.recommendation': 'Recommendation',
  'ai.receipt.applied': 'Actually applied',
  'ai.receipt.applied.forwarded': 'Forwarded to the provider',
  'ai.receipt.applied.blocked': 'Blocked (403)',
  'ai.receipt.governanceNote': 'How to read this',
  'ai.receipt.recommendationVsApplied':
    'Recommendation is what the enforcement matrix indicated. Actually applied is what the runtime carried out. Forwarded means the request reached the provider: nobody was asked, no sandbox was created, and nothing was stopped.',
  'ai.receipt.correlationCaveat':
    'Exact correlation between this turn and one specific audit event is not exposed by the current API, and this console does not estimate it. Open Evidence and Audit chain to see what was recorded.',
  'ai.receipt.openEvidence': 'Open Evidence',
  'ai.receipt.openAudit': 'Open Audit chain',

  // --- unknown-value fallback -------------------------------------------------------------
  'status.unknown': 'unrecognized value',
};
