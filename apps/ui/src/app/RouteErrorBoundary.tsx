import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useI18n } from '../lib/i18n/I18nProvider.js';

// The failure mode that route splitting introduces.
//
// `React.lazy` + `Suspense` handles the PENDING half of a dynamic import and nothing else: a
// REJECTED import — a deployment replaced the hashed assets under an open tab, a proxy dropped
// the chunk request, the network blinked — propagates as a render error. With no boundary above
// it React unmounts the tree, so a reader who clicked a nav link loses the whole authenticated
// application and their in-memory conversation, and is left on a blank page with no way back
// except a manual reload they have not been told to do.
//
// Splitting every screen (UI-PERF-01) is what made this reachable, so the boundary ships with it.
//
// ★ IT MUST NOT SWALLOW. A boundary that renders a friendly panel for EVERY error would hide
// real bugs behind "something went wrong" — the same dishonesty this UI refuses everywhere else.
// This one only handles a chunk-load failure, which is transient, has an obvious remedy, and is
// identifiable; anything else is re-thrown to whatever is above.

/**
 * A rejected dynamic import, as the browsers actually report it. Chrome/Edge and Firefox and
 * Safari each phrase it differently, and Vite's preload helper wraps it in its own error, so the
 * match is over the union rather than one engine's string. Matching on the MESSAGE is unpleasant
 * but is the only signal the platform gives: there is no error code for this.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const err = error as { name?: unknown; message?: unknown };
  if (err.name === 'ChunkLoadError') return true; // webpack-style, and Vite plugins that mimic it
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  if (message.length === 0) return false;
  return (
    message.includes('failed to fetch dynamically imported module') || // Chrome, Edge
    message.includes('error loading dynamically imported module') || // Firefox
    message.includes('importing a module script failed') || // Safari
    message.includes('unable to preload css') || // Vite's preload helper
    message.includes('failed to load module script') // strict-MIME failure after a redeploy
  );
}

function ChunkLoadFailure() {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className="rounded-[var(--govai-radius-card)] border border-[var(--govai-attention-border)] bg-[var(--govai-attention-bg)] p-[var(--govai-space-6)]"
      data-testid="chunk-load-error"
    >
      <p className="font-medium text-[var(--govai-attention-text)]">{t('app.chunkError.title')}</p>
      <p className="mt-[var(--govai-space-2)] max-w-prose text-[var(--govai-text-primary)]">
        {t('app.chunkError.description')}
      </p>
      <button
        type="button"
        className="govai-focus mt-[var(--govai-space-4)] rounded-[var(--govai-radius-control)] border border-[var(--govai-border-strong)] bg-[var(--govai-bg-surface)] px-[var(--govai-space-3)] py-[var(--govai-space-1)] font-medium"
        data-testid="chunk-load-reload"
        onClick={() => {
          window.location.reload();
        }}
      >
        {t('app.chunkError.reload')}
      </button>
    </div>
  );
}

type Props = { children: ReactNode };
type State = { failed: boolean };

export class RouteErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(error: unknown): State {
    // Not a chunk-load failure ⇒ do not claim it. Re-throwing from the static lifecycle would
    // be swallowed by React, so the state stays clean here and componentDidCatch re-throws.
    return { failed: isChunkLoadError(error) };
  }

  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    if (!isChunkLoadError(error)) throw error;
  }

  override render(): ReactNode {
    return this.state.failed ? <ChunkLoadFailure /> : this.props.children;
  }
}
