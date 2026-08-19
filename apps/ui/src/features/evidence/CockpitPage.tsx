import { useI18n } from '../../lib/i18n/I18nProvider.js';
import { useEvidenceWindow } from '../../app/shell/evidence-window-context.js';
import { useEvidenceSummary } from '../../lib/api/hooks.js';
import { ContextItem, MeasurementContext, PageHeader } from '../../components/PageHeader.js';
import { ErrorState, LoadingSkeleton } from '../../components/states.js';
import { IndicatorTile } from '../../components/IndicatorTile.js';
import { CoverageRing } from '../../components/CoverageRing.js';
import { CaveatNote } from '../../components/CaveatNote.js';
import { QueryExport } from '../../components/QueryExport.js';
import { formatDurationSeconds, formatInteger, formatPercent, formatRatio } from '../../lib/format.js';
import {
  coverageTone,
  ec1Tone,
  ec2Tone,
  ec3DropTone,
  ec3SealTone,
  ec4Tone,
  ec6Tone,
  isCoverageInScope,
  hasGapList,
} from '../../lib/honesty.js';
import type { Tone } from '../../lib/vocab.js';

// The evidence cockpit — the authenticated home.
//
// Everything on this page comes from ONE response: GET /v1/evidence/summary. There is no
// second source, no derived metric, no trend line and no risk score: the invented number is
// the one an auditor cannot check.
//
// The qualifications the response carries — coverage terms and exclusions with their reasons,
// EC-6's note, EC-3.drop's bound and observed flag, the window and T_seal — are rendered as
// content at full size, never as an asterisk.

/**
 * Every tile follows ONE rule: the headline is the POPULATION, the metrics are the breakdown,
 * and the badge is the decisive count, LABELLED. The badge therefore states a fact rather than
 * a severity opinion, never repeats the headline's unit, and — because the label precedes the
 * number rather than agreeing with it — it stays grammatical in all three languages without a
 * pluralization engine ("falhas: 1", not "1 falhas").
 */
function countBadge(label: string, value: string): string {
  return `${label}: ${value}`;
}

/** Pick the badge for the resolved tone; `neutral` means nothing was in scope. */
function toneWord(tone: Tone, words: Partial<Record<Tone, string>>, fallback: string): string {
  return words[tone] ?? fallback;
}

export function CockpitPage() {
  const { t, locale } = useI18n();
  const { window: evidenceWindow } = useEvidenceWindow();
  const query = useEvidenceSummary(evidenceWindow.seconds);

  return (
    <div className="space-y-[var(--govai-space-6)]">
      <PageHeader
        title={t('cockpit.title')}
        description={t('cockpit.subtitle')}
        actions={
          query.data ? (
            <QueryExport
              endpoint="/v1/evidence/summary"
              params={{ window: evidenceWindow.seconds }}
              data={query.data}
              fileStem="evidence-summary"
            />
          ) : null
        }
        context={
          query.data ? (
            <MeasurementContext
              items={
                <>
                  <ContextItem
                    label={t('window.selected')}
                    value={formatDurationSeconds(query.data.window_seconds, locale)}
                  />
                  <ContextItem
                    label={t('window.tSeal')}
                    value={formatDurationSeconds(query.data.t_seal_seconds, locale)}
                  />
                </>
              }
              note={t('window.contextNote')}
            />
          ) : null
        }
      />

      {query.isPending && <LoadingSkeleton rows={6} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

      {query.data && (
        <>
          <CoveragePanel summary={query.data} />
          <section aria-labelledby="cockpit-tiles">
            <h2
              id="cockpit-tiles"
              className="mb-[var(--govai-space-3)] text-[length:var(--govai-text-md)] font-semibold"
            >
              {t('cockpit.tiles.title')}
            </h2>
            <div className="grid grid-cols-1 gap-[var(--govai-space-4)] sm:grid-cols-2 xl:grid-cols-3">
              <Ec1Tile summary={query.data} />
              <Ec2Tile summary={query.data} />
              <Ec3SealTile summary={query.data} />
              <Ec3DropTile summary={query.data} />
              <Ec4Tile summary={query.data} />
              <Ec6Tile summary={query.data} />
            </div>
          </section>
          <CaveatNote>{t('cockpit.ec5Note')}</CaveatNote>
        </>
      )}
    </div>
  );
}

type Summary = NonNullable<ReturnType<typeof useEvidenceSummary>['data']>;

/** The drill-down target for a tile, or undefined when the API exposes no gap list for that
 *  invariant (EC-6). One rule, applied to every tile — see honesty.hasGapList. */
function gapsHref(invariant: string): string | undefined {
  return hasGapList(invariant) ? `/evidence/gaps/${invariant}` : undefined;
}

// --- coverage ---------------------------------------------------------------------------

function CoveragePanel({ summary }: { summary: Summary }) {
  const { t, locale } = useI18n();
  const coverage = summary.coverage_ratio;
  const tone = coverageTone(coverage);
  const inScope = isCoverageInScope(coverage);

  return (
    <section
      aria-labelledby="coverage-heading"
      className="rounded-[var(--govai-radius-card)] border border-[var(--govai-border)] bg-[var(--govai-bg-surface)] p-[var(--govai-space-6)]"
      data-testid="coverage-panel"
      data-tone={tone}
    >
      <h2 id="coverage-heading" className="text-[length:var(--govai-text-md)] font-semibold">
        {t('cockpit.coverage.title')}
      </h2>

      <div className="mt-[var(--govai-space-4)] flex flex-wrap items-center gap-[var(--govai-space-8)]">
        <CoverageRing
          ratio={coverage.ratio}
          tone={tone}
          label={`${t('cockpit.coverage.title')} ${formatRatio(coverage.ratio, locale)}`}
          display={formatRatio(coverage.ratio, locale)}
        />
        <dl className="govai-tabular flex gap-[var(--govai-space-8)]">
          <div>
            <dt className="text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]">
              {t('cockpit.coverage.covered')}
            </dt>
            <dd className="text-[length:var(--govai-text-xl)] font-semibold">
              {formatInteger(coverage.covered, locale)}
            </dd>
          </div>
          <div>
            <dt className="text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]">
              {t('cockpit.coverage.total')}
            </dt>
            <dd className="text-[length:var(--govai-text-xl)] font-semibold">
              {formatInteger(coverage.total, locale)}
            </dd>
          </div>
        </dl>
      </div>

      {!inScope && (
        <div className="mt-[var(--govai-space-4)]" data-testid="coverage-no-units">
          <CaveatNote tone="attention">{t('cockpit.coverage.noUnits')}</CaveatNote>
        </div>
      )}

      <div className="mt-[var(--govai-space-6)] grid gap-[var(--govai-space-6)] lg:grid-cols-2">
        <div data-testid="coverage-terms">
          <h3 className="text-[length:var(--govai-text-base)] font-semibold">
            {t('cockpit.coverage.terms')}
          </h3>
          <p className="mt-[var(--govai-space-1)] max-w-prose text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]">
            {t('cockpit.coverage.parity')}
          </p>
          <table className="mt-[var(--govai-space-2)] w-full text-[length:var(--govai-text-sm)]">
            <caption className="govai-sr-only">{t('cockpit.coverage.terms')}</caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="border-b border-[var(--govai-border)] py-[var(--govai-space-1)] pr-[var(--govai-space-4)] text-left text-[length:var(--govai-text-xs)] font-semibold text-[var(--govai-text-secondary)]"
                >
                  {t('cockpit.coverage.term')}
                </th>
                <th
                  scope="col"
                  className="border-b border-[var(--govai-border)] py-[var(--govai-space-1)] pl-[var(--govai-space-4)] text-right text-[length:var(--govai-text-xs)] font-semibold text-[var(--govai-text-secondary)]"
                >
                  {t('cockpit.coverage.covered')}
                </th>
                <th
                  scope="col"
                  className="border-b border-[var(--govai-border)] py-[var(--govai-space-1)] pl-[var(--govai-space-4)] text-right text-[length:var(--govai-text-xs)] font-semibold text-[var(--govai-text-secondary)]"
                >
                  {t('cockpit.coverage.total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {coverage.terms.map((term) => (
                <tr key={term.invariant} className="border-b border-[var(--govai-border)] last:border-b-0">
                  <td className="py-[var(--govai-space-1)] pr-[var(--govai-space-4)]">
                    <code className="govai-mono">{term.invariant}</code>
                  </td>
                  <td className="govai-tabular py-[var(--govai-space-1)] pl-[var(--govai-space-4)] text-right">
                    {formatInteger(term.covered, locale)}
                  </td>
                  <td className="govai-tabular py-[var(--govai-space-1)] pl-[var(--govai-space-4)] text-right">
                    {formatInteger(term.total, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div data-testid="coverage-excluded">
          <h3 className="text-[length:var(--govai-text-base)] font-semibold">
            {t('cockpit.coverage.excluded')}
          </h3>
          <table className="mt-[var(--govai-space-2)] w-full text-[length:var(--govai-text-sm)]">
            <caption className="govai-sr-only">{t('cockpit.coverage.excluded')}</caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="border-b border-[var(--govai-border)] py-[var(--govai-space-1)] pr-[var(--govai-space-4)] text-left text-[length:var(--govai-text-xs)] font-semibold text-[var(--govai-text-secondary)]"
                >
                  {t('cockpit.coverage.term')}
                </th>
                <th
                  scope="col"
                  className="border-b border-[var(--govai-border)] py-[var(--govai-space-1)] pr-[var(--govai-space-4)] text-left text-[length:var(--govai-text-xs)] font-semibold text-[var(--govai-text-secondary)]"
                >
                  {t('cockpit.coverage.reason')}
                </th>
              </tr>
            </thead>
            <tbody>
              {coverage.excluded.map((ex) => (
                <tr key={ex.invariant} className="border-b border-[var(--govai-border)] last:border-b-0">
                  <td className="py-[var(--govai-space-1)] pr-[var(--govai-space-4)] align-top">
                    <code className="govai-mono">{ex.invariant}</code>
                  </td>
                  <td className="py-[var(--govai-space-1)] text-[var(--govai-text-secondary)]">
                    {ex.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// --- tiles ------------------------------------------------------------------------------

function Ec1Tile({ summary }: { summary: Summary }) {
  const { t, locale } = useI18n();
  const ec1 = summary.counts.ec1;
  const tone = ec1Tone(ec1);
  return (
    <IndicatorTile
      data-testid="tile-ec1"
      title={t('invariant.ec1')}
      value={formatInteger(ec1.total, locale)}
      unit={t('ec1.total')}
      tone={tone}
      toneLabel={toneWord(
        tone,
        {
          failure: countBadge(t('ec1.failed'), formatInteger(ec1.failed, locale)),
          attention: countBadge(t('ec1.stalled'), formatInteger(ec1.stalled_past_slo, locale)),
          neutral: t('ec1.empty'),
        },
        countBadge(t('ec1.sealed'), formatInteger(ec1.sealed, locale)),
      )}
      metrics={[
        { label: t('ec1.sealed'), value: formatInteger(ec1.sealed, locale) },
        { label: t('ec1.failed'), value: formatInteger(ec1.failed, locale), tone: 'failure' },
        {
          label: t('ec1.stalled'),
          value: formatInteger(ec1.stalled_past_slo, locale),
          tone: 'attention',
        },
      ]}
      to={gapsHref('ec1')}
      drillDownLabel={t('cockpit.tile.drillDown')}
    />
  );
}

function Ec2Tile({ summary }: { summary: Summary }) {
  const { t, locale } = useI18n();
  const ec2 = summary.counts.ec2;
  const tone = ec2Tone(ec2);
  return (
    <IndicatorTile
      data-testid="tile-ec2"
      title={t('invariant.ec2')}
      value={formatInteger(ec2.chains, locale)}
      unit={t('ec2.chains')}
      tone={tone}
      toneLabel={toneWord(
        tone,
        { neutral: t('ec2.empty') },
        countBadge(t('ec2.withGap'), formatInteger(ec2.chains_with_gap, locale)),
      )}
      metrics={[
        {
          label: t('ec2.withGap'),
          value: formatInteger(ec2.chains_with_gap, locale),
          tone: 'failure',
        },
      ]}
      to={gapsHref('ec2')}
      drillDownLabel={t('cockpit.tile.drillDown')}
    />
  );
}

function Ec3SealTile({ summary }: { summary: Summary }) {
  const { t, locale } = useI18n();
  const ec3 = summary.counts.ec3seal;
  const tone = ec3SealTone(ec3);
  return (
    <IndicatorTile
      data-testid="tile-ec3seal"
      title={t('invariant.ec3seal')}
      value={formatInteger(ec3.native_total, locale)}
      unit={t('ec3seal.total')}
      tone={tone}
      toneLabel={toneWord(
        tone,
        {
          attention: countBadge(
            t('ec3seal.unsealed'),
            formatInteger(ec3.native_unsealed_past_slo, locale),
          ),
          neutral: t('ec3seal.empty'),
        },
        countBadge(t('ec3seal.sealed'), formatInteger(ec3.native_sealed, locale)),
      )}
      metrics={[
        { label: t('ec3seal.sealed'), value: formatInteger(ec3.native_sealed, locale) },
        {
          label: t('ec3seal.unsealed'),
          value: formatInteger(ec3.native_unsealed_past_slo, locale),
          tone: 'attention',
        },
      ]}
      to={gapsHref('ec3seal')}
      drillDownLabel={t('cockpit.tile.drillDown')}
    />
  );
}

function Ec3DropTile({ summary }: { summary: Summary }) {
  const { t, locale } = useI18n();
  const drop = summary.ec3drop;
  const tone = ec3DropTone(drop);
  return (
    <IndicatorTile
      data-testid="tile-ec3drop"
      title={t('invariant.ec3drop')}
      // ★ When nothing was observed, the headline is an em dash, NOT a zero: printing "0"
      // large would read as "no loss", and a zero from an unobserved snapshot proves nothing.
      // The unit is dropped with it — "0 drops" and "— drops" both invite the same misreading.
      value={drop.observed ? formatInteger(drop.drops, locale) : '—'}
      {...(drop.observed ? { unit: t('ec3drop.drops') } : {})}
      tone={tone}
      toneLabel={
        drop.observed
          ? countBadge(t('ec3drop.drops'), formatInteger(drop.drops, locale))
          : t('ec3drop.unobserved')
      }
      metrics={
        drop.observed
          ? [
              { label: t('ec3drop.drops'), value: formatInteger(drop.drops, locale) },
              { label: t('ec3drop.captures'), value: formatInteger(drop.captures, locale) },
              {
                label: t('ec3drop.rate'),
                value:
                  drop.drop_rate === null
                    ? t('ec3drop.rateUnavailable')
                    : formatPercent(drop.drop_rate, locale),
              },
            ]
          : undefined
      }
      caveat={
        <div className="space-y-[var(--govai-space-2)]">
          {!drop.observed && <p data-testid="ec3drop-unobserved">{t('ec3drop.unobservedDetail')}</p>}
          <div>
            <p className="font-semibold text-[var(--govai-text-secondary)]">
              {t('ec3drop.boundLabel')}
            </p>
            <p className="govai-mono break-words text-[var(--govai-text-primary)]" data-testid="ec3drop-bound">
              {drop.bound}
            </p>
          </div>
        </div>
      }
      to={gapsHref('ec3drop')}
      drillDownLabel={t('cockpit.tile.drillDown')}
    />
  );
}

function Ec4Tile({ summary }: { summary: Summary }) {
  const { t, locale } = useI18n();
  const ec4 = summary.counts.ec4;
  const tone = ec4Tone(ec4);
  return (
    <IndicatorTile
      data-testid="tile-ec4"
      title={t('invariant.ec4')}
      value={formatInteger(ec4.provider_invocations, locale)}
      unit={t('ec4.invocations')}
      tone={tone}
      toneLabel={toneWord(
        tone,
        { neutral: t('ec4.empty') },
        countBadge(t('ec4.withoutTerminal'), formatInteger(ec4.without_terminal, locale)),
      )}
      metrics={[
        {
          label: t('ec4.withoutTerminal'),
          value: formatInteger(ec4.without_terminal, locale),
          tone: 'attention',
        },
      ]}
      caveat={<p>{t('ec4.expectedEmpty')}</p>}
      to={gapsHref('ec4')}
      drillDownLabel={t('cockpit.tile.drillDown')}
    />
  );
}

function Ec6Tile({ summary }: { summary: Summary }) {
  const { t, locale } = useI18n();
  const ec6 = summary.ec6;
  const tone = ec6Tone(ec6);
  return (
    <IndicatorTile
      data-testid="tile-ec6"
      title={t('invariant.ec6')}
      value={formatInteger(ec6.total_chains, locale)}
      unit={t('ec6.chains')}
      tone={tone}
      toneLabel={
        ec6.total_chains === 0
          ? t('ec6.emptyScope')
          : countBadge(t('ec6.pending'), formatInteger(ec6.pending, locale))
      }
      metrics={[
        {
          label: t('ec6.pending'),
          value: formatInteger(ec6.pending, locale),
          tone: 'attention',
        },
        { label: t('ec6.verified'), value: formatInteger(ec6.verified_ok, locale) },
      ]}
      caveat={
        <div className="space-y-[var(--govai-space-2)]">
          <p data-testid="ec6-never-green">{t('ec6.neverGreen')}</p>
          <div>
            <p className="font-semibold text-[var(--govai-text-secondary)]">{t('ec6.noteLabel')}</p>
            <p className="govai-mono break-words text-[var(--govai-text-primary)]" data-testid="ec6-note">
              {ec6.note}
            </p>
          </div>
          <p>{t('ec6.noDrillDown')}</p>
        </div>
      }
      // `gapsHref('ec6')` is undefined — EC-6 is outside the API's /gaps enum — so the tile
      // renders the no-drill-down explanation instead of a link to nowhere.
      to={gapsHref('ec6')}
      drillDownLabel={t('cockpit.tile.drillDown')}
      noDrillDownLabel={t('cockpit.tile.noDrillDown')}
    />
  );
}
