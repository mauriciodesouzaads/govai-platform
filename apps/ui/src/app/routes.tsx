import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from './shell/AppShell.js';
import { useSession } from '../lib/session/SessionProvider.js';
import { EnterKeyPage } from '../features/auth/EnterKeyPage.js';
import { CockpitPage } from '../features/evidence/CockpitPage.js';
import { GapsPage } from '../features/evidence/GapsPage.js';
import { AuditEventsPage } from '../features/evidence/AuditEventsPage.js';
import { CapabilitiesPage } from '../features/evidence/CapabilitiesPage.js';

// The U1 route table. Exactly the surface this delivery implements:
//
//   /enter                        paste the API key
//   /                             evidence cockpit
//   /evidence/gaps/:invariant     ec1 | ec2 | ec3seal | ec3drop | ec4
//   /audit-events                 the HMAC chain (metadata + hashes)
//   /capabilities                 the capability × facet matrix
//
// There is deliberately no /workrooms, /regulatory, /admin, /runs/new, governance-settings or
// user-management route — not even a placeholder. A route that renders "coming soon" is a
// promise, and U1 does not make promises the backend cannot keep.

function RequireSession() {
  const { isAuthenticated } = useSession();
  if (!isAuthenticated) {
    // No return-path is carried — not in the URL, not in router state. After signing in the
    // reader lands on the cockpit, which is the home of U1; one fewer place for context to
    // accumulate is worth one extra click.
    return <Navigate to="/enter" replace />;
  }
  return <Outlet />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/enter" element={<EnterKeyPage />} />
      <Route element={<RequireSession />}>
        <Route element={<AppShell />}>
          <Route index element={<CockpitPage />} />
          <Route path="evidence/gaps/:invariant" element={<GapsPage />} />
          <Route path="audit-events" element={<AuditEventsPage />} />
          <Route path="capabilities" element={<CapabilitiesPage />} />
        </Route>
      </Route>
      {/* Anything else lands on the cockpit rather than on a fabricated 404 screen. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
