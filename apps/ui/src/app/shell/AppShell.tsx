import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useI18n } from '../../lib/i18n/I18nProvider.js';
import { useSession } from '../../lib/session/SessionProvider.js';
import { uiBuildSha } from '../../lib/query-export.js';
import { LanguageSelector } from './LanguageSelector.js';
import { WindowSelector } from './WindowSelector.js';

// The U1 application shell.
//
// ★ It displays ONLY facts it actually knows. At this base no route returns the caller's
// roles, commercial tier or operational mode (apps/api/src/pipeline/auth.ts resolves them but
// never serializes them; there is no /v1/me — the named backend follow-up EP-B2). So there is
// no role badge, no tier badge and no environment badge here: inventing one would be a
// fabricated fact, and coupling a commercial tier to a governance posture is exactly the
// conflation the Foundation V1 residual register forbids.
//
// The org id shown below is not chosen or typed by anyone: it is read from the authenticated
// response, which is also why there is no organization selector.
//
// Workroom, regulatory and admin navigation are NOT rendered. Those areas are not part of this
// delivery, and a disabled menu item promising them would be a promise the product cannot keep.
//
// ★ The evidence-window control is rendered ONLY on the routes it actually scopes. `?window=`
// is a real parameter of /v1/evidence/summary and /v1/evidence/gaps; /v1/audit-events and
// /v1/capabilities take no window at all. Leaving the selector visible on those screens would
// let a reader pick "1 h", see events from days earlier, and take a screenshot implying a time
// scope that was never applied — exactly the kind of misreading this interface exists to
// prevent. So the control appears where it means something and is absent where it does not.

const NAV = [
  { to: '/', end: true, labelKey: 'app.nav.cockpit' },
  { to: '/audit-events', end: false, labelKey: 'app.nav.auditEvents' },
  { to: '/capabilities', end: false, labelKey: 'app.nav.capabilities' },
] as const;

/** The routes whose data is actually scoped by `?window=`. */
function windowScopesRoute(pathname: string): boolean {
  return pathname === '/' || pathname.startsWith('/evidence/gaps');
}

export function AppShell() {
  const { t } = useI18n();
  const { orgId, signOut } = useSession();
  const { pathname } = useLocation();
  const build = uiBuildSha();
  const showWindowSelector = windowScopesRoute(pathname);

  return (
    <div className="flex min-h-screen flex-col bg-[var(--govai-bg-app)]">
      <a className="govai-skip-link" href="#main">
        {t('app.skipToContent')}
      </a>

      <header
        data-testid="app-header"
        className="border-b border-[var(--govai-border)] bg-[var(--govai-bg-surface)]"
      >
        <div className="mx-auto flex w-full max-w-[var(--govai-content-max)] flex-wrap items-center gap-x-[var(--govai-space-6)] gap-y-[var(--govai-space-2)] px-[var(--govai-space-6)] py-[var(--govai-space-3)]">
          <span className="text-[length:var(--govai-text-md)] font-semibold tracking-tight text-[var(--govai-text-primary)]">
            {t('app.name')}
          </span>

          <nav aria-label={t('app.nav.label')} className="flex items-center gap-[var(--govai-space-1)]">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-[var(--govai-radius-control)] px-[var(--govai-space-3)] py-[var(--govai-space-1)] text-[length:var(--govai-text-base)] ${
                    isActive
                      ? 'bg-[var(--govai-bg-inset)] font-semibold text-[var(--govai-brand)]'
                      : 'text-[var(--govai-text-secondary)] hover:bg-[var(--govai-bg-inset)]'
                  }`
                }
              >
                {t(item.labelKey)}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex flex-wrap items-center gap-x-[var(--govai-space-4)] gap-y-[var(--govai-space-2)]">
            {showWindowSelector && <WindowSelector />}
            <LanguageSelector />
            {orgId && (
              <span className="text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]">
                {t('session.org')}{' '}
                <code className="govai-mono text-[var(--govai-text-primary)]">{orgId}</code>
              </span>
            )}
            <button
              type="button"
              onClick={signOut}
              title={t('session.signOut.description')}
              className="rounded-[var(--govai-radius-control)] border border-[var(--govai-border-strong)] px-[var(--govai-space-3)] py-[var(--govai-space-1)] text-[length:var(--govai-text-xs)] hover:bg-[var(--govai-bg-inset)]"
              data-testid="sign-out"
            >
              {t('session.signOut')}
            </button>
          </div>
        </div>
      </header>

      <main
        id="main"
        className="mx-auto w-full max-w-[var(--govai-content-max)] flex-1 px-[var(--govai-space-6)] py-[var(--govai-space-6)]"
      >
        <Outlet />
      </main>

      <footer className="border-t border-[var(--govai-border)] bg-[var(--govai-bg-surface)]">
        <div className="mx-auto flex w-full max-w-[var(--govai-content-max)] flex-wrap items-center gap-x-[var(--govai-space-4)] gap-y-[var(--govai-space-1)] px-[var(--govai-space-6)] py-[var(--govai-space-3)] text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]">
          <span>
            {t('app.footer.build')}:{' '}
            <code className="govai-mono">{build ?? t('app.footer.buildUnavailable')}</code>
          </span>
          {orgId && (
            <span>
              {t('app.footer.org')}: <code className="govai-mono">{orgId}</code>
            </span>
          )}
          <span className="text-[var(--govai-text-tertiary)]">{t('session.memoryOnly')}</span>
          <span className="basis-full text-[var(--govai-text-tertiary)]">
            {t('app.footer.scope')}
          </span>
        </div>
      </footer>
    </div>
  );
}
