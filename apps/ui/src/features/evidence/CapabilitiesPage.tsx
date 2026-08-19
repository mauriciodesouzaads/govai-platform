import { useId, useMemo, useState } from 'react';
import { useI18n } from '../../lib/i18n/I18nProvider.js';
import { useCapabilities } from '../../lib/api/hooks.js';
import { PageHeader } from '../../components/PageHeader.js';
import { DataTable, type U1ColumnDef } from '../../components/DataTable.js';
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/states.js';
import { CaveatNote } from '../../components/CaveatNote.js';
import { StatusBadge } from '../../components/StatusBadge.js';
import { QueryExport } from '../../components/QueryExport.js';
import { formatDateTime } from '../../lib/format.js';
import { flattenCapabilities, type CapabilityFacetRow } from '../../lib/contract/capabilities.js';

// /capabilities — the capability × facet matrix.
//
// ★ WHAT THE `level` COLUMN IS AND IS NOT. This endpoint serves the governance registry
// (packages/core-governance/src/registry.ts), whose facets carry a NUMERIC governance level
// 0–3 (ADR-004 / ADR-005). It is NOT `policy_governed` vs `passthrough_audited` — that pair
// lives in a different registry which this route never touches — and it is not a risk class.
// The column is labelled as the governance level and nothing else.
//
// `evidence_strength` is orthogonal to the level and is never a certification claim: in the
// baseline only `hmac_internal` and `dev_signed` exist, and the stronger members are
// themselves planned.
//
// Filtering is over the rows ALREADY LOADED. That is safe here because this endpoint is not
// paginated — it returns the whole registry in one response — so filtering cannot hide rows
// that live on a page the browser never fetched. No sorting is offered anywhere in U1.

export function CapabilitiesPage() {
  const { t, locale } = useI18n();
  const query = useCapabilities();
  const [filter, setFilter] = useState('');
  const filterId = useId();

  const allRows = useMemo<CapabilityFacetRow[]>(
    () => (query.data ? flattenCapabilities(query.data) : []),
    [query.data],
  );

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle.length === 0) return allRows;
    return allRows.filter((r) =>
      [r.capability_id, r.provider, r.facet.id, r.facet.status, r.capability_status]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [allRows, filter]);

  const columns = useMemo<U1ColumnDef<CapabilityFacetRow>[]>(
    () => [
      {
        id: 'capability_id',
        header: t('capabilities.column.capability'),
        cell: ({ row }) => (
          <code className="govai-mono whitespace-nowrap">{row.original.capability_id}</code>
        ),
      },
      {
        id: 'provider',
        header: t('capabilities.column.provider'),
        cell: ({ row }) => <code className="govai-mono">{row.original.provider}</code>,
      },
      {
        id: 'capability_status',
        header: t('capabilities.column.capabilityStatus'),
        cell: ({ row }) => (
          <StatusBadge domain="capability" value={row.original.capability_status} showRaw={false} />
        ),
      },
      {
        id: 'capability_baseline_status',
        header: t('capabilities.column.capabilityBaseline'),
        cell: ({ row }) => (
          <code className="govai-mono text-[var(--govai-text-secondary)]">
            {row.original.capability_baseline_status}
          </code>
        ),
      },
      {
        id: 'facet_id',
        header: t('capabilities.column.facet'),
        cell: ({ row }) => <code className="govai-mono">{row.original.facet.id}</code>,
      },
      {
        id: 'level',
        header: t('capabilities.column.level'),
        cell: ({ row }) => (
          <span className="govai-tabular font-medium">{row.original.facet.level}</span>
        ),
      },
      {
        id: 'facet_status',
        header: t('capabilities.column.facetStatus'),
        cell: ({ row }) => (
          <StatusBadge domain="capability" value={row.original.facet.status} showRaw={false} />
        ),
      },
      {
        id: 'facet_baseline_status',
        header: t('capabilities.column.facetBaseline'),
        cell: ({ row }) => (
          <code className="govai-mono text-[var(--govai-text-secondary)]">
            {row.original.facet.baseline_status}
          </code>
        ),
      },
      {
        id: 'evidence_strength',
        header: t('capabilities.column.evidenceStrength'),
        cell: ({ row }) =>
          row.original.facet.evidence_strength === null ? (
            <span className="text-[var(--govai-text-tertiary)]">{t('gaps.nullValue')}</span>
          ) : (
            <StatusBadge
              domain="evidenceStrength"
              value={row.original.facet.evidence_strength}
              showRaw={false}
            />
          ),
      },
      {
        id: 'reason',
        header: t('capabilities.column.reason'),
        cell: ({ row }) =>
          row.original.facet.reason === null ? (
            <span className="text-[var(--govai-text-tertiary)]">{t('gaps.nullValue')}</span>
          ) : (
            <span className="block max-w-[24rem] break-words">{row.original.facet.reason}</span>
          ),
      },
      {
        id: 'last_live_test_at',
        header: t('capabilities.column.lastLiveTest'),
        cell: ({ row }) => {
          const value = row.original.facet.last_live_test_at;
          if (value === null)
            return <span className="text-[var(--govai-text-tertiary)]">{t('gaps.nullValue')}</span>;
          return (
            <time dateTime={value} title={value} className="govai-tabular whitespace-nowrap">
              {formatDateTime(value, locale) ?? value}
            </time>
          );
        },
      },
      {
        id: 'docs_url',
        header: t('capabilities.column.docs'),
        cell: ({ row }) =>
          row.original.facet.docs_url === null ? (
            <span className="text-[var(--govai-text-tertiary)]">{t('gaps.nullValue')}</span>
          ) : (
            <a
              href={row.original.facet.docs_url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[var(--govai-link)] underline underline-offset-2"
            >
              {t('capabilities.docsLink')}
            </a>
          ),
      },
      {
        id: 'override_applied',
        header: t('capabilities.column.override'),
        cell: ({ row }) => (
          <span
            className={
              row.original.facet.override_applied
                ? 'font-medium text-[var(--govai-attention-text)]'
                : 'text-[var(--govai-text-tertiary)]'
            }
          >
            {row.original.facet.override_applied
              ? t('capabilities.override.yes')
              : t('capabilities.override.no')}
          </span>
        ),
      },
    ],
    [t, locale],
  );

  return (
    <div className="space-y-[var(--govai-space-4)]">
      <PageHeader
        title={t('capabilities.title')}
        description={t('capabilities.subtitle')}
        actions={
          query.data ? (
            <QueryExport
              endpoint="/v1/capabilities"
              params={{}}
              data={query.data}
              fileStem="capabilities"
            />
          ) : null
        }
      />

      <CaveatNote>
        <ul className="list-disc space-y-[var(--govai-space-1)] pl-[var(--govai-space-4)]">
          <li>{t('capabilities.levelNote')}</li>
          <li>{t('capabilities.evidenceNote')}</li>
          <li>{t('capabilities.plannedNote')}</li>
          <li>{t('capabilities.overrideNote')}</li>
        </ul>
      </CaveatNote>

      {query.isPending && <LoadingSkeleton rows={8} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

      {query.data && (
        <>
          <div className="flex items-center gap-[var(--govai-space-2)]">
            <label
              htmlFor={filterId}
              className="text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]"
            >
              {t('capabilities.filter.label')}
            </label>
            <input
              id={filterId}
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('capabilities.filter.placeholder')}
              className="w-[min(24rem,100%)] rounded-[var(--govai-radius-control)] border border-[var(--govai-border-strong)] bg-[var(--govai-bg-surface)] px-[var(--govai-space-2)] py-[var(--govai-space-1)] text-[length:var(--govai-text-sm)]"
              data-testid="capability-filter"
            />
          </div>

          {rows.length === 0 ? (
            <EmptyState
              description={allRows.length === 0 ? t('capabilities.empty') : t('state.empty.title')}
            />
          ) : (
            <DataTable
              caption={t('capabilities.title')}
              columns={columns}
              rows={rows}
              getRowId={(row) => `${row.capability_id}::${row.facet.id}`}
            />
          )}
        </>
      )}
    </div>
  );
}
