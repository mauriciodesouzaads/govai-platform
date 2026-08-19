import { useCallback, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useI18n } from '../lib/i18n/I18nProvider.js';
import { truncateHex } from '../lib/format.js';

// Technical identifiers and hashes are rendered truncated so a dense table stays scannable,
// but the FULL value is always reachable: a copy button, and a dialog that shows every
// character selectably (for a reader who cannot use the clipboard, or who is verifying by eye).
// Radix Dialog is used for the focus trap and focus restoration that mission §17 requires.

async function writeClipboard(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Clipboard access can be denied; the dialog remains the fallback affordance.
  }
  return false;
}

export function HashText({
  value,
  label,
  head = 8,
  tail = 6,
}: {
  /** The full value. `null` renders an explicit "absent" marker — never an empty cell. */
  value: string | null;
  /** Accessible name for the copy/expand controls, e.g. "payload_hash". */
  label: string;
  head?: number;
  tail?: number;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');

  const onCopy = useCallback(async () => {
    if (value === null) return;
    setCopied((await writeClipboard(value)) ? 'ok' : 'failed');
  }, [value]);

  if (value === null) {
    return (
      <span className="text-[var(--govai-text-tertiary)] text-[length:var(--govai-text-xs)] italic">
        {t('hash.absent')}
      </span>
    );
  }

  const shortened = truncateHex(value, head, tail);
  const isTruncated = shortened !== value;

  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <code className="govai-mono text-[var(--govai-text-primary)]" title={value}>
        {shortened}
      </code>
      <button
        type="button"
        onClick={onCopy}
        aria-label={`${t('hash.copy')} — ${label}`}
        className="rounded-[var(--govai-radius-control)] border border-transparent px-1 text-[length:var(--govai-text-2xs)] text-[var(--govai-text-secondary)] hover:border-[var(--govai-border-strong)] hover:text-[var(--govai-brand)]"
      >
        {copied === 'ok' ? t('hash.copied') : copied === 'failed' ? t('hash.copyFailed') : '⧉'}
      </button>
      {isTruncated && (
        <Dialog.Root>
          <Dialog.Trigger asChild>
            <button
              type="button"
              aria-label={`${t('hash.showFull')} — ${label}`}
              className="rounded-[var(--govai-radius-control)] border border-transparent px-1 text-[length:var(--govai-text-2xs)] text-[var(--govai-text-secondary)] hover:border-[var(--govai-border-strong)] hover:text-[var(--govai-brand)]"
            >
              ⤢
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-[rgb(15_23_42_/_35%)]" />
            <Dialog.Content
              className="fixed top-1/2 left-1/2 w-[min(46rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--govai-radius-card)] border border-[var(--govai-border)] bg-[var(--govai-bg-surface)] p-[var(--govai-space-6)] shadow-[var(--govai-shadow-dialog)]"
              aria-describedby={undefined}
            >
              <Dialog.Title className="text-[length:var(--govai-text-md)] font-semibold">
                {t('hash.fullValueTitle')} — {label}
              </Dialog.Title>
              <p className="mt-[var(--govai-space-4)] rounded-[var(--govai-radius-control)] border border-[var(--govai-border)] bg-[var(--govai-bg-inset)] p-[var(--govai-space-3)] break-all govai-mono">
                {value}
              </p>
              <div className="mt-[var(--govai-space-4)] flex justify-end">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-[var(--govai-radius-control)] border border-[var(--govai-border-strong)] px-[var(--govai-space-3)] py-[var(--govai-space-1)] text-[length:var(--govai-text-base)] hover:bg-[var(--govai-bg-inset)]"
                  >
                    {t('hash.close')}
                  </button>
                </Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </span>
  );
}
