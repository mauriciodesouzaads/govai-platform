import { tableFeatures, useTable } from '@tanstack/react-table';
import type { ColumnDef, RowData } from '@tanstack/react-table';
import { useI18n } from '../lib/i18n/I18nProvider.js';

// The dense evidence table.
//
// ★ NO FEATURES ARE REGISTERED. `tableFeatures({})` gives the core row model and nothing else,
// which is deliberate: every list in U1 is SERVER-ordered and cursor-paginated (gaps:
// captured_at DESC or chain_id ASC; audit events: sequence_number DESC), so a client-side sort
// would reorder only the rows that happen to be loaded and quietly contradict the ordering the
// cursor depends on. Filtering the already-loaded set is a different thing and is done by the
// one screen where it is safe — the unpaginated capability matrix filters its own array before
// handing it here, so no row can be hidden that the browser never fetched.
//
// Semantic structure is preserved — <table>, <thead>, <th scope="col">, <caption> — so screen
// readers and keyboard users get the row/column relationships for free.

/** The feature set every U1 table shares. Module scope: a fresh object each render would
 *  invalidate the table's data-dependent models on every pass. */
export const u1TableFeatures = tableFeatures({});
export type U1Features = typeof u1TableFeatures;

/** Column definition for a U1 table. */
export type U1ColumnDef<TData extends RowData> = ColumnDef<U1Features, TData>;

export type DataTableProps<TData extends RowData> = {
  columns: U1ColumnDef<TData>[];
  rows: TData[];
  /** Accessible caption. Visually hidden, but always present. */
  caption: string;
  getRowId?: (row: TData, index: number) => string;
};

export function DataTable<TData extends RowData>({
  columns,
  rows,
  caption,
  getRowId,
}: DataTableProps<TData>) {
  const table = useTable({
    features: u1TableFeatures,
    data: rows,
    columns,
    ...(getRowId ? { getRowId } : {}),
  });

  return (
    // The horizontal scroll lives on the table's own container so a wide evidence matrix never
    // makes the page body scroll sideways.
    <div className="overflow-x-auto rounded-[var(--govai-radius-card)] border border-[var(--govai-border)] bg-[var(--govai-bg-surface)]">
      <table className="w-full border-collapse text-[length:var(--govai-text-sm)]">
        <caption className="govai-sr-only">{caption}</caption>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="bg-[var(--govai-bg-inset)]">
              {group.headers.map((header) => (
                <th
                  key={header.id}
                  scope="col"
                  className="border-b border-[var(--govai-border)] px-[var(--govai-space-3)] py-[var(--govai-space-2)] text-left text-[length:var(--govai-text-xs)] font-semibold whitespace-nowrap text-[var(--govai-text-secondary)]"
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-[var(--govai-border)] last:border-b-0 hover:bg-[var(--govai-bg-inset)]"
            >
              {row.getAllCells().map((cell) => (
                <td
                  key={cell.id}
                  className="h-[var(--govai-row-height)] px-[var(--govai-space-3)] py-[var(--govai-space-2)] align-middle"
                >
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The "load more"/"load older" control plus an honest end-of-list statement. Rendered for
 *  every paginated list so a reader always knows whether they are looking at everything. */
export function LoadMore({
  hasMore,
  isLoading,
  onLoadMore,
  loadedCount,
  variant = 'more',
}: {
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  loadedCount: number;
  variant?: 'more' | 'older';
}) {
  const { t } = useI18n();
  return (
    <div className="mt-[var(--govai-space-3)] flex flex-wrap items-center gap-[var(--govai-space-3)]">
      {hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoading}
          className="rounded-[var(--govai-radius-control)] border border-[var(--govai-border-strong)] bg-[var(--govai-bg-surface)] px-[var(--govai-space-3)] py-[var(--govai-space-1)] hover:bg-[var(--govai-bg-inset)] disabled:opacity-60"
          data-testid="load-more"
        >
          {isLoading
            ? t('table.loadingMore')
            : variant === 'older'
              ? t('table.loadOlder')
              : t('table.loadMore')}
        </button>
      ) : (
        <span className="text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]">
          {t('table.endOfList')}
        </span>
      )}
      <span
        className="govai-tabular text-[length:var(--govai-text-xs)] text-[var(--govai-text-tertiary)]"
        data-testid="rows-loaded"
      >
        {t('table.rowsLoaded')}: {loadedCount}
      </span>
    </div>
  );
}
