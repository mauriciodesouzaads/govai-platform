import { Suspense, lazy, type ComponentType, type ReactElement } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from './shell/AppShell.js';
import { useSession } from '../lib/session/SessionProvider.js';
import { useI18n } from '../lib/i18n/I18nProvider.js';
import { EnterKeyPage } from '../features/auth/EnterKeyPage.js';
import { LoadingSkeleton } from '../components/states.js';
import { RouteErrorBoundary } from './RouteErrorBoundary.js';

// The route table. Exactly the surface this application implements:
//
//   /enter                        paste the API key
//   /                             evidence cockpit
//   /evidence/gaps/:invariant     ec1 | ec2 | ec3seal | ec3drop | ec4
//   /audit-events                 the HMAC chain (metadata + hashes)
//   /capabilities                 the capability × facet matrix
//   /ai                           the AI Console (U1.5)
//
// There is deliberately no /workrooms, /regulatory, /admin, /runs/new, governance-settings or
// user-management route — not even a placeholder. A route that renders "coming soon" is a
// promise, and this build does not make promises the backend cannot keep.
//
// ── ★ EVERY SCREEN IS A LAZY CHUNK (named class UI-PERF-01) ────────────────────────────────
// The AI Console had to be split: it carries a Markdown renderer, an SSE parser and three
// provider adapters, and a reader who only opens the evidence screens should not download any
// of it. Splitting the EVIDENCE screens too was the same argument pointed the other way, and
// it turned out to matter more: the shell was already over the bundler's 500 kB warning before
// this feature existed, and the tables, the export machinery and the hashing helpers were all
// in it whether or not the reader ever opened a table.
//
// Measured at this base (minified / gzip, `pnpm --filter @govai/ui build`):
//   before U1.5, everything eager        517 kB / 151 kB   — one chunk, over the warning
//   U1.5 with only /ai split             541 kB / 159 kB   — the console's copy is in the
//                                                            shared i18n catalogs, which are
//                                                            eager, so the shell still grew
//   U1.5 with every screen split         415 kB / 124 kB   — the shell now ships LESS than it
//                                                            did before the console existed
//
// `/enter` stays eager on purpose: it is the first thing an unauthenticated reader sees, and
// making the sign-in screen wait on a second round trip to render a password field would trade
// a real interaction cost for a byte count nobody is measuring at that moment.

function RequireSession() {
  const { isAuthenticated } = useSession();
  if (!isAuthenticated) {
    // No return-path is carried — not in the URL, not in router state. After signing in the
    // reader lands on the cockpit, which is the home of this build; one fewer place for
    // context to accumulate is worth one extra click.
    return <Navigate to="/enter" replace />;
  }
  return <Outlet />;
}

/** `React.lazy` over a NAMED export. The pages are named exports (the file convention here),
 *  so each import is mapped to the `{ default }` shape lazy expects. */
function lazyNamed(load: () => Promise<Record<string, unknown>>, name: string): ComponentType {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}

const CockpitPage = lazyNamed(() => import('../features/evidence/CockpitPage.js'), 'CockpitPage');
const GapsPage = lazyNamed(() => import('../features/evidence/GapsPage.js'), 'GapsPage');
const AuditEventsPage = lazyNamed(
  () => import('../features/evidence/AuditEventsPage.js'),
  'AuditEventsPage',
);
const CapabilitiesPage = lazyNamed(
  () => import('../features/evidence/CapabilitiesPage.js'),
  'CapabilitiesPage',
);
const AiConsolePage = lazyNamed(() => import('../features/ai/AiConsolePage.js'), 'AiConsolePage');

/** The fallback while a screen's chunk loads. A skeleton with a polite busy status — not a
 *  spinner, and not an empty frame that reads as "there is nothing here". */
function RouteFallback() {
  const { t } = useI18n();
  return <LoadingSkeleton rows={4} label={t('table.loading')} />;
}

/**
 * One split screen: a boundary OUTSIDE the Suspense, then the Suspense, then the lazy element.
 *
 * The order matters. `Suspense` owns the pending import; it does nothing for a REJECTED one, and
 * an unhandled rejection there unmounts the whole authenticated application rather than the one
 * screen that failed to load. The boundary sits above it so a chunk that cannot be fetched costs
 * the reader a panel with a reload button, not the app. It handles ONLY a chunk-load failure —
 * see RouteErrorBoundary.
 */
function chunk(element: ReactElement): ReactElement {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<RouteFallback />}>{element}</Suspense>
    </RouteErrorBoundary>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/enter" element={<EnterKeyPage />} />
      <Route element={<RequireSession />}>
        <Route element={<AppShell />}>
          <Route index element={chunk(<CockpitPage />)} />
          <Route path="evidence/gaps/:invariant" element={chunk(<GapsPage />)} />
          <Route path="audit-events" element={chunk(<AuditEventsPage />)} />
          <Route path="capabilities" element={chunk(<CapabilitiesPage />)} />
          <Route path="ai" element={chunk(<AiConsolePage />)} />
        </Route>
      </Route>
      {/* Anything else lands on the cockpit rather than on a fabricated 404 screen. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
