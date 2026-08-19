import type { ReactNode } from 'react';

// A qualification the backend itself published, rendered as first-class content.
//
// `verbatim` marks text that came from the API (EC-6's note, EC-3.drop's bound). It is
// rendered exactly as received, in monospace, with a label saying so — paraphrasing a
// backend's own statement of its limits is how a limit quietly disappears.

export function CaveatNote({
  label,
  children,
  verbatim = false,
  tone = 'neutral',
}: {
  label?: string;
  children: ReactNode;
  verbatim?: boolean;
  tone?: 'neutral' | 'attention';
}) {
  const border =
    tone === 'attention' ? 'var(--govai-attention-border)' : 'var(--govai-border)';
  const background = tone === 'attention' ? 'var(--govai-attention-bg)' : 'var(--govai-bg-inset)';
  return (
    <div
      className="rounded-[var(--govai-radius-control)] border p-[var(--govai-space-3)] text-[length:var(--govai-text-xs)]"
      style={{ borderColor: border, backgroundColor: background }}
      data-testid="caveat-note"
    >
      {label && (
        <p className="mb-[var(--govai-space-1)] font-semibold text-[var(--govai-text-secondary)]">
          {label}
        </p>
      )}
      <div
        className={
          verbatim
            ? 'govai-mono break-words text-[var(--govai-text-primary)]'
            : 'max-w-prose text-[var(--govai-text-secondary)]'
        }
        data-verbatim={verbatim ? 'true' : undefined}
      >
        {children}
      </div>
    </div>
  );
}
