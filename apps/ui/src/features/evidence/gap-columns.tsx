import type { I18nValue } from '../../lib/i18n/I18nProvider.js';
import type { U1ColumnDef } from '../../components/DataTable.js';
import { StatusBadge } from '../../components/StatusBadge.js';
import { HashText } from '../../components/HashText.js';
import { exactDigits, formatDateTime, formatInteger } from '../../lib/format.js';
import type {
  Ec1GapRow,
  Ec2GapRow,
  Ec3SealRow,
  Ec4Row,
} from '../../lib/contract/evidence.js';

// Column definitions per invariant, using the EXACT field set each report returns
// (apps/api/src/pipeline/evidence-reports.ts). Column headers keep the backend field names so
// a reader can map a cell straight onto the API response and onto a query export.

function nullable(value: string | null, fallback: string) {
  return value === null ? (
    <span className="text-[var(--govai-text-tertiary)]">{fallback}</span>
  ) : (
    <span>{value}</span>
  );
}

function timestamp(iso: string, i18n: I18nValue) {
  const formatted = formatDateTime(iso, i18n.locale);
  return (
    <time dateTime={iso} title={iso} className="govai-tabular whitespace-nowrap">
      {formatted ?? iso}
    </time>
  );
}

export function ec1Columns(i18n: I18nValue): U1ColumnDef<Ec1GapRow>[] {
  const { t } = i18n;
  return [
    {
      id: 'status',
      header: t('gaps.column.status'),
      cell: ({ row }) => <StatusBadge domain="capture" value={row.original.status} showRaw={false} />,
    },
    {
      id: 'capture_id',
      header: t('gaps.column.captureId'),
      cell: ({ row }) => <HashText value={row.original.capture_id} label="capture_id" head={8} tail={4} />,
    },
    {
      id: 'chain_id',
      header: t('gaps.column.chainId'),
      cell: ({ row }) => <HashText value={row.original.chain_id} label="chain_id" head={16} tail={8} />,
    },
    {
      id: 'chain_category',
      header: t('gaps.column.chainCategory'),
      cell: ({ row }) => <code className="govai-mono">{row.original.chain_category}</code>,
    },
    {
      id: 'captured_at',
      header: t('gaps.column.capturedAt'),
      cell: ({ row }) => timestamp(row.original.captured_at, i18n),
    },
    {
      id: 'attempts',
      header: t('gaps.column.attempts'),
      cell: ({ row }) => (
        <span className="govai-tabular">{formatInteger(row.original.attempts, i18n.locale)}</span>
      ),
    },
    {
      id: 'last_error',
      header: t('gaps.column.lastError'),
      cell: ({ row }) => (
        <span className="block max-w-[28rem] break-words">
          {nullable(row.original.last_error, t('gaps.nullValue'))}
        </span>
      ),
    },
  ];
}

export function ec2Columns(i18n: I18nValue): U1ColumnDef<Ec2GapRow>[] {
  const { t } = i18n;
  // ★ first_gap_seq and gap_count are bigint DECIMAL STRINGS. They are rendered digit for
  // digit — no Number(), no grouping — because they can exceed the safe integer range and a
  // rounded sequence number points an auditor at the wrong event.
  const digits = (raw: string) => {
    const exact = exactDigits(raw);
    return exact === null ? (
      <span className="text-[var(--govai-failure-text)]">{t('gaps.unreadableValue')}</span>
    ) : (
      <code className="govai-mono govai-tabular">{exact}</code>
    );
  };
  return [
    {
      id: 'chain_id',
      header: t('gaps.column.chainId'),
      cell: ({ row }) => <HashText value={row.original.chain_id} label="chain_id" head={16} tail={8} />,
    },
    {
      id: 'first_gap_seq',
      header: t('gaps.column.firstGapSeq'),
      cell: ({ row }) => digits(row.original.first_gap_seq),
    },
    {
      id: 'gap_count',
      header: t('gaps.column.gapCount'),
      cell: ({ row }) => digits(row.original.gap_count),
    },
  ];
}

export function ec3SealColumns(i18n: I18nValue): U1ColumnDef<Ec3SealRow>[] {
  const { t } = i18n;
  return [
    {
      id: 'status',
      header: t('gaps.column.status'),
      cell: ({ row }) => <StatusBadge domain="capture" value={row.original.status} showRaw={false} />,
    },
    {
      id: 'capture_id',
      header: t('gaps.column.captureId'),
      cell: ({ row }) => <HashText value={row.original.capture_id} label="capture_id" head={8} tail={4} />,
    },
    {
      id: 'chain_id',
      header: t('gaps.column.chainId'),
      cell: ({ row }) => <HashText value={row.original.chain_id} label="chain_id" head={16} tail={8} />,
    },
    {
      id: 'chain_category',
      header: t('gaps.column.chainCategory'),
      cell: ({ row }) => <code className="govai-mono">{row.original.chain_category}</code>,
    },
    {
      id: 'captured_at',
      header: t('gaps.column.capturedAt'),
      cell: ({ row }) => timestamp(row.original.captured_at, i18n),
    },
  ];
}

export function ec4Columns(i18n: I18nValue): U1ColumnDef<Ec4Row>[] {
  const { t } = i18n;
  return [
    {
      id: 'run_id',
      header: t('gaps.column.runId'),
      cell: ({ row }) => <HashText value={row.original.run_id} label="run_id" head={8} tail={4} />,
    },
    {
      id: 'provider_invocation_id',
      header: t('gaps.column.providerInvocationId'),
      cell: ({ row }) => (
        <HashText
          value={row.original.provider_invocation_id}
          label="provider_invocation_id"
          head={8}
          tail={4}
        />
      ),
    },
    {
      id: 'provider',
      header: t('gaps.column.provider'),
      cell: ({ row }) => <code className="govai-mono">{row.original.provider}</code>,
    },
    {
      id: 'native_endpoint',
      header: t('gaps.column.nativeEndpoint'),
      cell: ({ row }) => <code className="govai-mono">{row.original.native_endpoint}</code>,
    },
    {
      id: 'status_code',
      header: t('gaps.column.statusCode'),
      cell: ({ row }) => (
        <span className="govai-tabular">
          {row.original.status_code === null
            ? nullable(null, t('gaps.nullValue'))
            : formatInteger(row.original.status_code, i18n.locale)}
        </span>
      ),
    },
    {
      id: 'error_class',
      header: t('gaps.column.errorClass'),
      cell: ({ row }) => nullable(row.original.error_class, t('gaps.nullValue')),
    },
    {
      id: 'created_at',
      header: t('gaps.column.createdAt'),
      cell: ({ row }) => timestamp(row.original.created_at, i18n),
    },
  ];
}
