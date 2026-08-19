import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useI18n, type I18nValue } from '../../lib/i18n/I18nProvider.js';
import { useEvidenceWindow } from '../../app/shell/evidence-window-context.js';
import { useEvidenceGaps, useEvidenceSummary, type GapRowFor } from '../../lib/api/hooks.js';
import { ContextItem, MeasurementContext, PageHeader } from '../../components/PageHeader.js';
import { DataTable, LoadMore, type U1ColumnDef } from '../../components/DataTable.js';
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/states.js';
import { CaveatNote } from '../../components/CaveatNote.js';
import { QueryExport } from '../../components/QueryExport.js';
import { formatDurationSeconds, formatInteger, formatPercent } from '../../lib/format.js';
import {
  EVIDENCE_INVARIANTS,
  GAPS_DEFAULT_LIMIT,
  type DropEstimate,
  type EvidenceInvariant,
} from '../../lib/contract/evidence.js';
import type { MessageKey } from '../../lib/i18n/catalogs/index.js';
import { ec1Columns, ec2Columns, ec3SealColumns, ec4Columns } from './gap-columns.js';

// /evidence/gaps/:invariant — one typed view framework with invariant-specific columns.
//
// Four of the five invariants return a paginated list of rows. EC-3.drop does not: the API
// returns a SINGLE aggregate on page 0 and never paginates it, so it renders as an information
// card rather than as a one-row table pretending to be a list.
//
// Each branch below is a separate component so the row type is genuinely narrowed by the
// invariant — there is no cast anywhere between the response schema and the column cells.

type ListInvariant = Exclude<EvidenceInvariant, 'ec3drop'>;

/**
 * The invariants whose gap POPULATION is defined by the seal SLO. `ec1GapList` and
 * `ec3SealList` both select captured/sealing rows older than `t_seal_seconds`
 * (apps/api/src/pipeline/evidence-reports.ts), so a reader who opens one of these views
 * directly cannot tell why an in-flight row qualifies unless the threshold is on the page.
 *
 * The /gaps response does NOT carry `t_seal_seconds` — only /summary does — so these two
 * views read it from the summary. Arriving from the cockpit that is already cached under the
 * same window; on a direct link it costs one request. The other invariants do not depend on
 * it, and showing it there would imply a relevance it does not have.
 */
const SLO_DEPENDENT: ReadonlySet<string> = new Set<ListInvariant>(['ec1', 'ec3seal']);

const INVARIANT_LABEL: Record<EvidenceInvariant, MessageKey> = {
  ec1: 'invariant.ec1',
  ec2: 'invariant.ec2',
  ec3seal: 'invariant.ec3seal',
  ec3drop: 'invariant.ec3drop',
  ec4: 'invariant.ec4',
};

function isEvidenceInvariant(value: string | undefined): value is EvidenceInvariant {
  return (EVIDENCE_INVARIANTS as readonly string[]).includes(value ?? '');
}

export function GapsPage() {
  const { t } = useI18n();
  const invariant = useParams<{ invariant: string }>().invariant;

  if (!isEvidenceInvariant(invariant)) {
    // Not a fabricated 404 screen: the reader followed a URL the API's own enum rejects, and
    // the honest answer is which values it does accept.
    return (
      <div className="space-y-[var(--govai-space-4)]">
        <PageHeader title={t('gaps.title')} />
        <EmptyState title={t('invariant.unknown')} description={t('gaps.unknownInvariant')} />
        <Link className="text-[var(--govai-link)] underline underline-offset-2" to="/">
          {t('gaps.backToCockpit')}
        </Link>
      </div>
    );
  }

  switch (invariant) {
    case 'ec1':
      return <GapsListScreen invariant="ec1" buildColumns={ec1Columns} />;
    case 'ec2':
      return <GapsListScreen invariant="ec2" buildColumns={ec2Columns} note="gaps.bigintNote" />;
    case 'ec3seal':
      return <GapsListScreen invariant="ec3seal" buildColumns={ec3SealColumns} />;
    case 'ec4':
      return <GapsListScreen invariant="ec4" buildColumns={ec4Columns} />;
    case 'ec3drop':
      return <DropScreen />;
  }
}

/** Header, measurement context, export and back link — identical for every invariant. */
function GapsChrome({
  invariant,
  windowSeconds,
  tSealSeconds,
  tSealUnavailable = false,
  onRetryTSeal,
  exportData,
  exportPageParams,
  children,
}: {
  invariant: EvidenceInvariant;
  windowSeconds: number;
  /** Present only for the SLO-dependent invariants; `null` while it is not yet known. */
  tSealSeconds?: number | null;
  /** The summary read FAILED, so the threshold that selected these rows is unknown. */
  tSealUnavailable?: boolean;
  onRetryTSeal?: () => void;
  exportData: unknown;
  /** The offset cursor actually used for each loaded page, in order. */
  exportPageParams?: number[];
  children: ReactNode;
}) {
  const { t, locale } = useI18n();
  const showTSeal = tSealSeconds !== undefined || tSealUnavailable;
  // ★ An export of an SLO-dependent list without its threshold is an artifact that cannot be
  // read correctly later — the same defect as omitting it from the screen. So while T_seal is
  // unknown the export is withheld and the reason is stated, rather than quietly producing an
  // incomplete snapshot. The rows themselves stay visible: they are real data.
  const exportBlocked = tSealUnavailable || (showTSeal && (tSealSeconds ?? null) === null);
  return (
    <div className="space-y-[var(--govai-space-4)]">
      <PageHeader
        title={t(INVARIANT_LABEL[invariant])}
        description={t('gaps.title')}
        actions={
          exportData && !exportBlocked ? (
            <QueryExport
              endpoint="/v1/evidence/gaps"
              params={{ invariant, window: windowSeconds, limit: GAPS_DEFAULT_LIMIT }}
              {...(exportPageParams
                ? {
                    pageParams: exportPageParams.map((cursor) => ({
                      invariant,
                      window: windowSeconds,
                      limit: GAPS_DEFAULT_LIMIT,
                      cursor,
                    })),
                  }
                : {})}
              {...(showTSeal && tSealSeconds !== null
                ? { serverContext: { t_seal_seconds: tSealSeconds } }
                : {})}
              data={exportData}
              fileStem={`evidence-gaps-${invariant}`}
            />
          ) : null
        }
        context={
          <MeasurementContext
            items={
              <>
                <ContextItem
                  label={t('window.selected')}
                  value={formatDurationSeconds(windowSeconds, locale)}
                />
                {showTSeal && (
                  <ContextItem
                    label={t('window.tSeal')}
                    value={
                      tSealSeconds === null || tSealSeconds === undefined
                        ? t('gaps.nullValue')
                        : formatDurationSeconds(tSealSeconds, locale)
                    }
                  />
                )}
                <ContextItem label="invariant" value={invariant} />
              </>
            }
          />
        }
      />
      <Link className="inline-block text-[var(--govai-link)] underline underline-offset-2" to="/">
        {t('gaps.backToCockpit')}
      </Link>
      {tSealUnavailable && (
        <div
          role="alert"
          className="rounded-[var(--govai-radius-card)] border border-[var(--govai-attention-border)] bg-[var(--govai-attention-bg)] p-[var(--govai-space-4)]"
          data-testid="tseal-unavailable"
        >
          <p className="max-w-prose text-[var(--govai-text-primary)]">
            {t('gaps.tSealUnavailable')}
          </p>
          {onRetryTSeal && (
            <button
              type="button"
              onClick={onRetryTSeal}
              className="mt-[var(--govai-space-3)] rounded-[var(--govai-radius-control)] border border-[var(--govai-border-strong)] bg-[var(--govai-bg-surface)] px-[var(--govai-space-3)] py-[var(--govai-space-1)] hover:bg-[var(--govai-bg-inset)]"
              data-testid="tseal-retry"
            >
              {t('state.error.retry')}
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function GapsListScreen<I extends ListInvariant>({
  invariant,
  buildColumns,
  note,
}: {
  invariant: I;
  buildColumns: (i18n: I18nValue) => U1ColumnDef<GapRowFor[I]>[];
  /** An extra caveat this invariant needs (EC-2's bigint-string explanation). */
  note?: MessageKey;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const { window: evidenceWindow } = useEvidenceWindow();
  const query = useEvidenceGaps(invariant, evidenceWindow.seconds, GAPS_DEFAULT_LIMIT);
  // Only the SLO-dependent views need T_seal, so only they fetch it. The query key is the
  // cockpit's, so arriving from a tile costs nothing at all; on a direct link it costs one
  // request — and none whatsoever on the views that would discard the answer.
  const sloDependent = SLO_DEPENDENT.has(invariant);
  const summary = useEvidenceSummary(evidenceWindow.seconds, { enabled: sloDependent });

  const pages = useMemo(() => query.data?.pages ?? [], [query.data]);
  const items = useMemo(() => pages.flatMap((p) => p.items), [pages]);
  const columns = useMemo(() => buildColumns(i18n), [buildColumns, i18n]);

  return (
    <GapsChrome
      invariant={invariant}
      windowSeconds={pages[0]?.window_seconds ?? evidenceWindow.seconds}
      {...(sloDependent
        ? {
            tSealSeconds: summary.data?.t_seal_seconds ?? null,
            tSealUnavailable: summary.isError,
            onRetryTSeal: () => void summary.refetch(),
          }
        : {})}
      exportData={query.data ? pages : null}
      {...(query.data ? { exportPageParams: query.data.pageParams } : {})}
    >
      {query.isPending && <LoadingSkeleton rows={6} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data && (
        <>
          {note && <CaveatNote>{t(note)}</CaveatNote>}
          {items.length === 0 ? (
            <EmptyState description={t('gaps.empty')} />
          ) : (
            <>
              <DataTable
                caption={`${t(INVARIANT_LABEL[invariant])} — ${t('gaps.title')}`}
                columns={columns}
                rows={items}
              />
              <LoadMore
                hasMore={query.hasNextPage}
                isLoading={query.isFetchingNextPage}
                onLoadMore={() => void query.fetchNextPage()}
                loadedCount={items.length}
              />
            </>
          )}
        </>
      )}
    </GapsChrome>
  );
}

/** EC-3.drop — a single aggregate, presented as a card. Its `observed` flag governs whether
 *  any number is shown at all: a zero from an unobserved snapshot is not a measurement. */
function DropScreen() {
  const { t } = useI18n();
  const { window: evidenceWindow } = useEvidenceWindow();
  const query = useEvidenceGaps('ec3drop', evidenceWindow.seconds, GAPS_DEFAULT_LIMIT);
  const pages = query.data?.pages ?? [];
  const drop: DropEstimate | undefined = pages[0]?.items[0];

  return (
    <GapsChrome
      invariant="ec3drop"
      windowSeconds={pages[0]?.window_seconds ?? evidenceWindow.seconds}
      exportData={query.data ? pages : null}
      {...(query.data ? { exportPageParams: query.data.pageParams } : {})}
    >
      {query.isPending && <LoadingSkeleton rows={3} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data && (drop ? <DropCard drop={drop} /> : <EmptyState description={t('gaps.empty')} />)}
    </GapsChrome>
  );
}

function DropCard({ drop }: { drop: DropEstimate }) {
  const { t, locale } = useI18n();
  return (
    <section
      className="space-y-[var(--govai-space-4)] rounded-[var(--govai-radius-card)] border border-[var(--govai-border)] bg-[var(--govai-bg-surface)] p-[var(--govai-space-6)]"
      data-testid="ec3drop-singleton"
    >
      <p className="text-[var(--govai-text-secondary)]">{t('ec3drop.singletonNote')}</p>

      {drop.observed ? (
        <dl className="grid grid-cols-1 gap-[var(--govai-space-4)] sm:grid-cols-3">
          <div>
            <dt className="text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]">
              {t('ec3drop.drops')}
            </dt>
            <dd className="govai-tabular text-[length:var(--govai-text-xl)] font-semibold">
              {formatInteger(drop.drops, locale)}
            </dd>
          </div>
          <div>
            <dt className="text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]">
              {t('ec3drop.captures')}
            </dt>
            <dd className="govai-tabular text-[length:var(--govai-text-xl)] font-semibold">
              {formatInteger(drop.captures, locale)}
            </dd>
          </div>
          <div>
            <dt className="text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]">
              {t('ec3drop.rate')}
            </dt>
            <dd className="govai-tabular text-[length:var(--govai-text-xl)] font-semibold">
              {drop.drop_rate === null
                ? t('ec3drop.rateUnavailable')
                : formatPercent(drop.drop_rate, locale)}
            </dd>
          </div>
        </dl>
      ) : (
        <CaveatNote tone="attention">
          <span data-testid="ec3drop-singleton-unobserved">{t('ec3drop.unobservedDetail')}</span>
        </CaveatNote>
      )}

      <CaveatNote label={t('ec3drop.boundLabel')} verbatim>
        {drop.bound}
      </CaveatNote>
    </section>
  );
}
