import { useCallback, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useI18n } from '../lib/i18n/I18nProvider.js';
import { useSession } from '../lib/session/SessionProvider.js';
import { buildQueryExport, type QueryExportContext } from '../lib/query-export.js';

// "Export this query (JSON)" — the low-risk evidence primitive.
//
// It serializes EXACTLY what the API returned for the query on screen, plus the non-secret
// context needed to reproduce it. It is not a dossier, not a compliance report and not a
// certification artifact, and its own metadata says so.

export function QueryExport({
  endpoint,
  params,
  data,
  fileStem,
}: {
  endpoint: string;
  params: Record<string, string | number | undefined>;
  /** The parsed response(s) exactly as received. */
  data: unknown;
  /** Basename for the downloaded file, e.g. "evidence-summary". */
  fileStem: string;
}) {
  const { t, locale } = useI18n();
  const { orgId } = useSession();
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const [open, setOpen] = useState(false);

  const context: QueryExportContext = useMemo(
    () => ({ endpoint, params, orgId, locale, exportedAt: new Date().toISOString() }),
    // `exportedAt` must be stamped when the dialog opens, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endpoint, params, orgId, locale, open],
  );

  const json = useMemo(
    () => JSON.stringify(buildQueryExport(context, data), null, 2),
    [context, data],
  );

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  }, [json]);

  const href = useMemo(
    () => `data:application/json;charset=utf-8,${encodeURIComponent(json)}`,
    [json],
  );

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="rounded-[var(--govai-radius-control)] border border-[var(--govai-border-strong)] bg-[var(--govai-bg-surface)] px-[var(--govai-space-3)] py-[var(--govai-space-1)] text-[length:var(--govai-text-xs)] font-medium hover:bg-[var(--govai-bg-inset)]"
          data-testid="query-export-open"
        >
          {t('export.button')}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-[rgb(15_23_42_/_35%)]" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 flex max-h-[86vh] w-[min(60rem,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[var(--govai-radius-card)] border border-[var(--govai-border)] bg-[var(--govai-bg-surface)] p-[var(--govai-space-6)] shadow-[var(--govai-shadow-dialog)]"
        >
          <Dialog.Title className="text-[length:var(--govai-text-md)] font-semibold">
            {t('export.title')}
          </Dialog.Title>
          <Dialog.Description className="mt-[var(--govai-space-1)] max-w-prose text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]">
            {t('export.description')}
          </Dialog.Description>
          <p className="mt-[var(--govai-space-2)] max-w-prose text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]">
            {t('export.hint')}
          </p>
          <pre
            className="govai-mono mt-[var(--govai-space-3)] min-h-0 flex-1 overflow-auto rounded-[var(--govai-radius-control)] border border-[var(--govai-border)] bg-[var(--govai-bg-inset)] p-[var(--govai-space-3)]"
            data-testid="query-export-json"
          >
            {json}
          </pre>
          <div className="mt-[var(--govai-space-4)] flex flex-wrap items-center justify-end gap-[var(--govai-space-2)]">
            {copied !== 'idle' && (
              <span
                role="status"
                className="mr-auto text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]"
              >
                {copied === 'ok' ? t('export.copied') : t('export.failed')}
              </span>
            )}
            <button
              type="button"
              onClick={onCopy}
              className="rounded-[var(--govai-radius-control)] border border-[var(--govai-border-strong)] px-[var(--govai-space-3)] py-[var(--govai-space-1)] hover:bg-[var(--govai-bg-inset)]"
              data-testid="query-export-copy"
            >
              {t('hash.copy')}
            </button>
            <a
              href={href}
              download={`govai-${fileStem}.json`}
              className="rounded-[var(--govai-radius-control)] border border-[var(--govai-brand)] bg-[var(--govai-brand)] px-[var(--govai-space-3)] py-[var(--govai-space-1)] font-medium text-[var(--govai-brand-contrast)] hover:bg-[var(--govai-brand-hover)]"
              data-testid="query-export-download"
            >
              {t('export.button')}
            </a>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-[var(--govai-radius-control)] border border-[var(--govai-border-strong)] px-[var(--govai-space-3)] py-[var(--govai-space-1)] hover:bg-[var(--govai-bg-inset)]"
              >
                {t('export.close')}
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
