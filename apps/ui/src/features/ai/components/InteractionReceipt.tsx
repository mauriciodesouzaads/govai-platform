import { Link } from 'react-router-dom';
import { useI18n } from '../../../lib/i18n/I18nProvider.js';
import type { MessageKey } from '../../../lib/i18n/catalogs/index.js';
import { ToneBadge } from '../../../components/StatusBadge.js';
import { enforcementLabel } from '../../../lib/honesty.js';
import type { Tone } from '../../../lib/vocab.js';
import type { ConsoleMode, ProviderId, SurfaceId } from '../providers/types.js';
import type { InteractionReceipt as Receipt, TurnState } from '../conversation/types.js';

// ★ THE INTERACTION RECEIPT — the honesty surface of the AI Console.
//
// It is called an INTERACTION RECEIPT and not a proof, a certificate, a compliance receipt or
// verified evidence, because the browser does not hold enough to make any of those claims.
// Every row below is one of four things and nothing else:
//
//   a value this browser SENT           provider, model, surface, mode, endpoint
//   a status this browser RECEIVED      HTTP status, termination state
//   a header this browser READ          provider request id, the four x-govai-* governance
//                                       headers on the governed route
//   a clock this browser RAN            client-observed duration
//
// Four things it deliberately does NOT contain, each because no response on these routes
// carries it:
//
//   1. AN AUDIT EVENT ID. The direct-provider routes build an internal `audit_event_id` and
//      return it to nobody: it appears in no response body and no response header on any of
//      the six route/surface combinations (verified at source). There is therefore no exact
//      turn→audit correlation to render, and constructing one from timestamp + model + status
//      would be a heuristic guess presented as a link to a specific record. The receipt links
//      to the Evidence and Audit screens in general terms and SAYS that exact correlation is
//      not exposed. Named backend follow-up: EP-AI-CONSOLE-TURN-EVIDENCE-CORRELATION.
//
//   2. "EVIDENCE CAPTURED". The AuditBridge dispatch on these routes is best-effort by design
//      (apps/api/src/pipeline/audit-bridge.ts — `posture: 'best_effort'`, never strict in v1)
//      and the browser receives no acknowledgement that anything was captured, let alone
//      sealed. A green tick here would be an assertion about a subsystem that did not report
//      back. The receipt points at the evidence screens instead of speaking for them.
//
//   3. PROVIDER OR BACKEND LATENCY. `latency_ms` exists inside the audit event; it is not a
//      response field. What the browser can measure is wall time in this tab, so that is what
//      the row is called.
//
//   4. A GOVERNANCE DECISION ON THE NATIVE ROUTE. That surface resolves none and returns none.
//      See below.

const PROVIDER_LABEL: Record<ProviderId, MessageKey> = {
  openai: 'ai.provider.openai',
  anthropic: 'ai.provider.anthropic',
};

const SURFACE_LABEL: Record<SurfaceId, MessageKey> = {
  responses: 'ai.surface.responses',
  chat_completions: 'ai.surface.chatCompletions',
  messages: 'ai.surface.messages',
};

const MODE_LABEL: Record<ConsoleMode, MessageKey> = {
  native_audited: 'ai.mode.native',
  governed: 'ai.mode.governed',
};

/** The visible label for each terminal state, and its tone. `ok` is used ONLY for a state the
 *  provider's own terminal event confirmed — never for "no error was reported". */
export const STATE_LABEL: Record<TurnState, { key: MessageKey; tone: Tone }> = {
  submitting: { key: 'ai.state.submitting', tone: 'info' },
  streaming: { key: 'ai.state.streaming', tone: 'info' },
  completed: { key: 'ai.state.completed', tone: 'ok' },
  stopped: { key: 'ai.state.stopped', tone: 'neutral' },
  blocked: { key: 'ai.state.blocked', tone: 'failure' },
  provider_error: { key: 'ai.state.providerError', tone: 'failure' },
  rate_limited: { key: 'ai.state.rateLimited', tone: 'attention' },
  credential_unavailable: { key: 'ai.state.credentialUnavailable', tone: 'attention' },
  network_error: { key: 'ai.state.networkError', tone: 'attention' },
  unknown_outcome: { key: 'ai.state.unknownOutcome', tone: 'attention' },
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-[var(--govai-space-2)] gap-y-[2px] py-[2px]">
      <dt className="min-w-[10rem] text-[length:var(--govai-text-2xs)] uppercase tracking-wide text-[var(--govai-text-tertiary)]">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-[length:var(--govai-text-xs)] text-[var(--govai-text-primary)]">
        {children}
      </dd>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code className="govai-mono break-all">{children}</code>;
}

export function InteractionReceipt({ receipt }: { receipt: Receipt }) {
  const { t } = useI18n();
  const state = STATE_LABEL[receipt.state];
  const governance = receipt.governance;

  return (
    <details
      className="mt-[var(--govai-space-2)] rounded-[var(--govai-radius-control)] border border-[var(--govai-border)] bg-[var(--govai-bg-surface)]"
      data-testid="interaction-receipt"
    >
      <summary className="cursor-pointer px-[var(--govai-space-3)] py-[var(--govai-space-2)] text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]">
        {t('ai.receipt.title')}
      </summary>

      <dl className="border-t border-[var(--govai-border)] px-[var(--govai-space-3)] py-[var(--govai-space-2)]">
        <Row label={t('ai.receipt.provider')}>{t(PROVIDER_LABEL[receipt.provider])}</Row>
        <Row label={t('ai.receipt.model')}>
          <Mono>{receipt.model}</Mono>
        </Row>
        <Row label={t('ai.receipt.surface')}>{t(SURFACE_LABEL[receipt.surface])}</Row>
        <Row label={t('ai.receipt.mode')}>{t(MODE_LABEL[receipt.mode])}</Row>
        <Row label={t('ai.receipt.endpoint')}>
          <Mono>{receipt.endpoint}</Mono>
        </Row>
        <Row label={t('ai.receipt.status')}>
          {receipt.status === null ? (
            <span className="text-[var(--govai-text-secondary)]">
              {t('ai.receipt.noResponse')}
            </span>
          ) : (
            <Mono>{`HTTP ${receipt.status}`}</Mono>
          )}
        </Row>
        <Row label={t('ai.receipt.termination')}>
          <ToneBadge tone={state.tone} data-testid="receipt-state">
            {t(state.key)}
          </ToneBadge>
        </Row>
        {receipt.stopReason !== null && (
          <Row label={t('ai.receipt.stopReason')}>
            <Mono>{receipt.stopReason}</Mono>
          </Row>
        )}
        <Row label={t('ai.receipt.providerRequestId')}>
          {receipt.providerRequestId === null ? (
            <span
              className="text-[var(--govai-text-secondary)]"
              data-testid="receipt-request-id-absent"
            >
              {t('ai.receipt.notExposed')}
            </span>
          ) : (
            <Mono>{receipt.providerRequestId}</Mono>
          )}
        </Row>
        {receipt.providerMessageId !== null && (
          <Row label={t('ai.receipt.providerMessageId')}>
            <Mono>{receipt.providerMessageId}</Mono>
          </Row>
        )}
        <Row label={t('ai.receipt.duration')}>
          {receipt.clientDurationMs === null ? (
            <span className="text-[var(--govai-text-secondary)]">
              {t('ai.receipt.notExposed')}
            </span>
          ) : (
            <span className="govai-tabular" data-testid="receipt-duration">
              {`${receipt.clientDurationMs} ms`}
            </span>
          )}
        </Row>

        {/* ── Governance ──────────────────────────────────────────────────────────────────
            ★ RECOMMENDATION AND APPLIED ARE TWO SEPARATE ROWS, ALWAYS. `decision` is what the
            enforcement matrix recommended; `applied` is what the runtime did. At this base the
            runtime forwards for every decision except a real 403 — so `ask` + `forwarded` is
            normal, and it means NOBODY WAS ASKED and the request reached the provider. The
            recommendation label comes from lib/honesty.ts, the single normative table, so this
            screen cannot invent a word for it. */}
        {governance === null ? (
          <Row label={t('ai.receipt.governance')}>
            <span className="text-[var(--govai-text-secondary)]" data-testid="receipt-no-governance">
              {receipt.mode === 'governed'
                ? t('ai.receipt.governance.absentOnResponse')
                : t('ai.receipt.governance.nativeSurface')}
            </span>
          </Row>
        ) : (
          <>
            {governance.capabilityLevel !== null && (
              <Row label={t('ai.receipt.capabilityLevel')}>
                <Mono>{governance.capabilityLevel}</Mono>
              </Row>
            )}
            {governance.effectiveRiskClass !== null && (
              <Row label={t('ai.receipt.riskClass')}>
                <Mono>{governance.effectiveRiskClass}</Mono>
              </Row>
            )}
            <Row label={t('ai.receipt.recommendation')}>
              <span
                className="inline-flex flex-wrap items-center gap-[var(--govai-space-2)]"
                data-testid="receipt-recommendation"
              >
                {governance.decision === null ? (
                  <ToneBadge tone="neutral">{t('status.unknown')}</ToneBadge>
                ) : (
                  (() => {
                    // The 403 fact — not the recorded decision — decides whether the word
                    // "blocked" may appear. That rule lives in honesty.ts and is applied, not
                    // re-implemented, here.
                    const verdict = enforcementLabel({
                      http403: receipt.status === 403,
                      decision: governance.decision,
                      surface: 'governed',
                      ...(governance.blockTrigger
                        ? { blockTrigger: governance.blockTrigger }
                        : {}),
                    });
                    return <ToneBadge tone={verdict.tone}>{t(verdict.messageKey)}</ToneBadge>;
                  })()
                )}
                {governance.decisionRaw !== null && (
                  <Mono>
                    <span className="opacity-70">{governance.decisionRaw}</span>
                  </Mono>
                )}
              </span>
            </Row>
            <Row label={t('ai.receipt.applied')}>
              <span
                className="inline-flex flex-wrap items-center gap-[var(--govai-space-2)]"
                data-testid="receipt-applied"
              >
                {governance.applied === 'blocked' ? (
                  <ToneBadge tone="failure">{t('ai.receipt.applied.blocked')}</ToneBadge>
                ) : governance.applied === 'forwarded' ? (
                  <ToneBadge tone="neutral">{t('ai.receipt.applied.forwarded')}</ToneBadge>
                ) : (
                  <ToneBadge tone="neutral">{t('status.unknown')}</ToneBadge>
                )}
                {governance.appliedRaw !== null && (
                  <Mono>
                    <span className="opacity-70">{governance.appliedRaw}</span>
                  </Mono>
                )}
              </span>
            </Row>
            <Row label={t('ai.receipt.governanceNote')}>
              <span className="text-[var(--govai-text-secondary)]">
                {t('ai.receipt.recommendationVsApplied')}
              </span>
            </Row>
          </>
        )}
      </dl>

      {/* ── Evidence ─────────────────────────────────────────────────────────────────────
          Navigation, not a claim. No "evidence captured", no per-turn link. */}
      <div className="border-t border-[var(--govai-border)] px-[var(--govai-space-3)] py-[var(--govai-space-2)] text-[length:var(--govai-text-2xs)] text-[var(--govai-text-secondary)]">
        <p data-testid="receipt-correlation-caveat">{t('ai.receipt.correlationCaveat')}</p>
        <p className="mt-[var(--govai-space-1)] flex flex-wrap gap-x-[var(--govai-space-3)]">
          <Link className="text-[var(--govai-link)] underline underline-offset-2" to="/">
            {t('ai.receipt.openEvidence')}
          </Link>
          <Link
            className="text-[var(--govai-link)] underline underline-offset-2"
            to="/audit-events"
          >
            {t('ai.receipt.openAudit')}
          </Link>
        </p>
      </div>
    </details>
  );
}
