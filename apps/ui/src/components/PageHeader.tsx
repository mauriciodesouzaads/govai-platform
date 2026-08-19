import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
  context,
}: {
  title: string;
  description?: string;
  /** Right-aligned controls (export, filters). */
  actions?: ReactNode;
  /** Measurement context — the window and T_seal that produced the numbers below. Never
   *  optional in spirit: an evidence screen that hides its measurement context is dishonest. */
  context?: ReactNode;
}) {
  return (
    <header className="border-b border-[var(--govai-border)] pb-[var(--govai-space-4)]">
      <div className="flex flex-wrap items-start justify-between gap-[var(--govai-space-4)]">
        <div className="min-w-0">
          <h1 className="text-[length:var(--govai-text-lg)] font-semibold tracking-tight text-[var(--govai-text-primary)]">
            {title}
          </h1>
          {description && (
            <p className="mt-[var(--govai-space-1)] max-w-prose text-[var(--govai-text-secondary)]">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-[var(--govai-space-2)]">{actions}</div>}
      </div>
      {context && <div className="mt-[var(--govai-space-3)]">{context}</div>}
    </header>
  );
}

/** The measurement-context strip. Rendered as content, never as a footnote. */
export function MeasurementContext({ items, note }: { items: ReactNode; note?: string }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-[var(--govai-space-4)] gap-y-[var(--govai-space-1)] rounded-[var(--govai-radius-control)] border border-[var(--govai-border)] bg-[var(--govai-bg-inset)] px-[var(--govai-space-3)] py-[var(--govai-space-2)] text-[length:var(--govai-text-xs)]"
      data-testid="measurement-context"
    >
      {items}
      {note && <span className="text-[var(--govai-text-secondary)]">{note}</span>}
    </div>
  );
}

export function ContextItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-[var(--govai-space-1)]">
      <span className="text-[var(--govai-text-secondary)]">{label}</span>
      <span className="govai-mono govai-tabular font-medium text-[var(--govai-text-primary)]">
        {value}
      </span>
    </span>
  );
}
