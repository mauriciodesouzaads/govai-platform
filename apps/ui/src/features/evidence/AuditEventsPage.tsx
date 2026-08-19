import { useMemo } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../lib/i18n/I18nProvider.js';
import { useAuditEvents } from '../../lib/api/hooks.js';
import { ContextItem, MeasurementContext, PageHeader } from '../../components/PageHeader.js';
import { DataTable, LoadMore, type U1ColumnDef } from '../../components/DataTable.js';
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/states.js';
import { CaveatNote } from '../../components/CaveatNote.js';
import { HashText } from '../../components/HashText.js';
import { StatusBadge } from '../../components/StatusBadge.js';
import { QueryExport } from '../../components/QueryExport.js';
import { formatDateTime, formatInteger } from '../../lib/format.js';
import {
  AUDIT_EVENTS_DEFAULT_LIMIT,
  CHAIN_CATEGORIES,
  type AuditEvent,
  type ChainCategory,
} from '../../lib/contract/audit-events.js';

// /audit-events — the HMAC chain.
//
// ★ PERMANENT, NON-DISMISSIBLE STATEMENT OF WHAT THIS IS: the endpoint returns chain metadata
// and cryptographic hashes. It does not return event payloads — `canonical_bytes` exists in the
// table and is deliberately not selected. This view therefore supports INTEGRITY INSPECTION,
// not content reconstruction, and it says so above the table on every category.
//
// The category is carried in the URL (?chain=…) so a link to a specific chain is shareable and
// a screenshot is unambiguous about which chain it shows.

function isChainCategory(value: string | null): value is ChainCategory {
  return (CHAIN_CATEGORIES as readonly string[]).includes(value ?? '');
}

export function AuditEventsPage() {
  const { t, locale } = useI18n();
  const [searchParams] = useSearchParams();
  const raw = searchParams.get('chain');
  // `run` is the default: it is the chain the direct provider routes and the run lifecycle
  // write to, so it is where an auditor arriving from the cockpit expects to land.
  const category: ChainCategory = isChainCategory(raw) ? raw : 'run';

  const query = useAuditEvents(category, AUDIT_EVENTS_DEFAULT_LIMIT);
  const pages = useMemo(() => query.data?.pages ?? [], [query.data]);
  const events = useMemo(() => pages.flatMap((p) => p.events), [pages]);
  const chainId = pages[0]?.chain_id ?? null;

  const columns = useMemo<U1ColumnDef<AuditEvent>[]>(
    () => [
      {
        id: 'sequence_number',
        header: t('audit.column.sequence'),
        cell: ({ row }) => (
          // The API returns this as a JSON number (audit-events.ts:84 narrows it with
          // Number()), so it is formatted as a number here. The decimal-string rule applies to
          // the EC-2 gap sequences, which this route does not serve.
          <span className="govai-tabular font-medium">
            {formatInteger(row.original.sequence_number, locale)}
          </span>
        ),
      },
      {
        id: 'event_type',
        header: t('audit.column.eventType'),
        cell: ({ row }) => <code className="govai-mono">{row.original.event_type}</code>,
      },
      {
        id: 'event_version',
        header: t('audit.column.eventVersion'),
        cell: ({ row }) => <code className="govai-mono">{row.original.event_version}</code>,
      },
      {
        id: 'subject_type',
        header: t('audit.column.subjectType'),
        cell: ({ row }) => <code className="govai-mono">{row.original.subject_type}</code>,
      },
      {
        id: 'subject_id',
        header: t('audit.column.subjectId'),
        cell: ({ row }) => (
          <HashText value={row.original.subject_id} label="subject_id" head={8} tail={4} />
        ),
      },
      {
        id: 'occurred_at',
        header: t('audit.column.occurredAt'),
        cell: ({ row }) => (
          <time
            dateTime={row.original.occurred_at}
            title={row.original.occurred_at}
            className="govai-tabular whitespace-nowrap"
          >
            {formatDateTime(row.original.occurred_at, locale) ?? row.original.occurred_at}
          </time>
        ),
      },
      {
        id: 'payload_hash',
        header: t('audit.column.payloadHash'),
        cell: ({ row }) => <HashText value={row.original.payload_hash} label="payload_hash" />,
      },
      {
        id: 'previous_hmac',
        header: t('audit.column.previousHmac'),
        cell: ({ row }) =>
          row.original.previous_hmac === null ? (
            // A null previous link is the genesis event of the chain, not a broken chain.
            <span
              className="text-[length:var(--govai-text-xs)] text-[var(--govai-text-tertiary)] italic"
              data-testid="genesis-link"
            >
              {t('audit.genesisLink')}
            </span>
          ) : (
            <HashText value={row.original.previous_hmac} label="previous_hmac" />
          ),
      },
      {
        id: 'hmac',
        header: t('audit.column.hmac'),
        cell: ({ row }) => <HashText value={row.original.hmac} label="hmac" />,
      },
      {
        id: 'canonical_hash',
        header: t('audit.column.canonicalHash'),
        cell: ({ row }) => <HashText value={row.original.canonical_hash} label="canonical_hash" />,
      },
      {
        id: 'evidence_strength',
        header: t('audit.column.evidenceStrength'),
        cell: ({ row }) => (
          <StatusBadge domain="evidenceStrength" value={row.original.evidence_strength} showRaw={false} />
        ),
      },
      {
        id: 'key_id',
        header: t('audit.column.keyId'),
        cell: ({ row }) => <code className="govai-mono">{row.original.key_id}</code>,
      },
      {
        id: 'key_version',
        header: t('audit.column.keyVersion'),
        cell: ({ row }) => (
          <span className="govai-tabular">{formatInteger(row.original.key_version, locale)}</span>
        ),
      },
    ],
    [t, locale],
  );

  return (
    <div className="space-y-[var(--govai-space-4)]">
      <PageHeader
        title={t('audit.title')}
        description={t('audit.subtitle')}
        actions={
          query.data ? (
            <QueryExport
              endpoint="/v1/audit-events"
              params={{ chain_category: category, limit: AUDIT_EVENTS_DEFAULT_LIMIT }}
              data={pages}
              fileStem={`audit-events-${category}`}
            />
          ) : null
        }
        context={
          chainId ? (
            <MeasurementContext
              items={<ContextItem label={t('audit.chainId')} value={chainId} />}
              note={t('audit.keysetNote')}
            />
          ) : null
        }
      />

      <CaveatNote tone="attention">
        <span data-testid="audit-metadata-only">{t('audit.metadataOnly')}</span>
      </CaveatNote>

      <nav
        aria-label={t('audit.category.label')}
        className="flex flex-wrap items-center gap-[var(--govai-space-1)]"
      >
        {CHAIN_CATEGORIES.map((c) => (
          <NavLink
            key={c}
            to={`/audit-events?chain=${c}`}
            aria-current={c === category ? 'page' : undefined}
            className={`rounded-[var(--govai-radius-control)] border px-[var(--govai-space-3)] py-[var(--govai-space-1)] text-[length:var(--govai-text-sm)] ${
              c === category
                ? 'border-[var(--govai-brand)] bg-[var(--govai-bg-inset)] font-semibold text-[var(--govai-brand)]'
                : 'border-[var(--govai-border)] text-[var(--govai-text-secondary)] hover:bg-[var(--govai-bg-inset)]'
            }`}
            data-testid={`chain-tab-${c}`}
          >
            {t(`audit.category.${c}` as const)}
          </NavLink>
        ))}
      </nav>

      {query.isPending && <LoadingSkeleton rows={8} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

      {query.data &&
        (events.length === 0 ? (
          <EmptyState description={t('audit.empty')} />
        ) : (
          <>
            <DataTable caption={`${t('audit.title')} — ${category}`} columns={columns} rows={events} />
            <LoadMore
              variant="older"
              hasMore={query.hasNextPage}
              isLoading={query.isFetchingNextPage}
              onLoadMore={() => void query.fetchNextPage()}
              loadedCount={events.length}
            />
          </>
        ))}
    </div>
  );
}
