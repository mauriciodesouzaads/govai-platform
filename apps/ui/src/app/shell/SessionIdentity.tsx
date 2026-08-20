import { useI18n } from '../../lib/i18n/I18nProvider.js';
import { useSession } from '../../lib/session/SessionProvider.js';
import { StatusBadge } from '../../components/StatusBadge.js';
import type { Principal } from '../../lib/session/SessionProvider.js';

// The authenticated principal, as the server resolved it (EP-B2 — GET /v1/me).
//
// ★ WHAT CHANGED, AND WHAT DID NOT. Until EP-B2 this shell showed only the `org_id`, and said
// so out loud: no route serialized roles, tier or operational mode, so displaying any of them
// would have been fabrication. `/v1/me` now serializes exactly those, resolved per request by
// the same `authenticateApiKey` every read surface already runs. So the rule did not change —
// the shell still displays ONLY what a response actually carried. What changed is what the
// responses carry.
//
// ★ EVERY VALUE IS RENDERED VERBATIM, IN MONOSPACE, NEXT TO A TRANSLATED FIELD LABEL. There is
// no table that maps `starter` or `production` onto a friendlier word, because inventing one
// would be inventing a meaning: `tier` and `operational_mode` are backend enum values, and an
// auditor reading a screenshot must see the value the API returned. The single exception is
// `principal_type`, which resolves through vocab.ts — it is a CLAIM about what kind of
// authentication this is, and an unrecognised value must degrade to an explicit unknown rather
// than inherit copy written for an API key.
//
// ★ TIER IS COMMERCIAL CONTEXT AND IS LABELLED AS SUCH (Foundation V1 residual R13). It is
// carried next to an explicit qualifier and an explicit note, and it is deliberately NOT in
// the header cluster: a plan name sitting beside an operational mode invites exactly the
// reading — "regulated is stricter than starter" — that R13 forbids. Governance strictness is
// decided by the enforcement matrix, not by what the organization pays for.
//
// ★ NOTHING HERE IS AN AUTHORITY. The server re-derives identity on every request; this is a
// rendering of one response. There is no admin affordance, no role editor, no organization
// switcher and no user management — none of those exist in the runtime, and a control that
// implied they did would be a promise the backend cannot keep.

/** One `label: value` pair. `value` is the backend's own string, never re-worded. */
function Field({
  label,
  children,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-[var(--govai-space-2)]" data-testid={testId}>
      <dt className="text-[var(--govai-text-secondary)]">{label}</dt>
      <dd className="govai-mono break-all text-[var(--govai-text-primary)]">{children}</dd>
    </div>
  );
}

/** The compact header cluster: the operational mode the server reported, the kind of principal
 *  in use, and — only when the key actually carries them — its roles. */
export function IdentityChips() {
  const { t } = useI18n();
  const { principal } = useSession();
  if (!principal) return null;
  return (
    <span
      className="flex flex-wrap items-center gap-x-[var(--govai-space-3)] gap-y-[var(--govai-space-1)] text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]"
      data-testid="identity-cluster"
    >
      <span data-testid="identity-operational-mode">
        {t('identity.operationalMode')}{' '}
        <code className="govai-mono text-[var(--govai-text-primary)]">
          {principal.operational_mode}
        </code>
      </span>
      <span data-testid="identity-principal">
        {t('identity.principal')}{' '}
        <StatusBadge domain="principalType" value={principal.principal_type} />
      </span>
      {principal.roles.length > 0 && (
        <span data-testid="identity-roles">
          {t('identity.roles')}{' '}
          <code className="govai-mono text-[var(--govai-text-primary)]">
            {principal.roles.join(' ')}
          </code>
        </span>
      )}
    </span>
  );
}

/** The account/details affordance. A native `<details>`: no overlay, no focus trap, no
 *  dependency — and closed by default, so the everyday chrome stays an evidence interface
 *  rather than an account console. */
export function SessionDetails({ principal }: { principal: Principal }) {
  const { t } = useI18n();
  return (
    <details className="basis-full" data-testid="session-details">
      <summary className="cursor-pointer text-[var(--govai-text-secondary)]">
        {t('identity.details')}
      </summary>
      <dl className="mt-[var(--govai-space-2)] flex flex-col gap-[var(--govai-space-1)]">
        <Field label={t('identity.principal')} testId="session-details-principal">
          {principal.principal_type}
        </Field>
        <Field label={t('session.org')} testId="session-details-org">
          {principal.org_id}
        </Field>
        <Field label={t('identity.user')} testId="session-details-user">
          {principal.user_id}
        </Field>
        <Field label={t('identity.roles')} testId="session-details-roles">
          {principal.roles.length > 0 ? (
            principal.roles.join(' ')
          ) : (
            // An empty array is a FACT the server asserted about this key, not a value the
            // interface failed to obtain — so it is stated, not left blank.
            <span className="text-[var(--govai-text-secondary)]">{t('identity.roles.none')}</span>
          )}
        </Field>
        <Field label={t('identity.operationalMode')} testId="session-details-operational-mode">
          {principal.operational_mode}
        </Field>
        <Field label={t('identity.tier')} testId="session-details-tier">
          {principal.tier}{' '}
          <span className="text-[var(--govai-text-secondary)]">
            ({t('identity.tier.qualifier')})
          </span>
        </Field>
      </dl>
      <div className="mt-[var(--govai-space-2)] flex max-w-prose flex-col gap-[var(--govai-space-1)] text-[var(--govai-text-tertiary)]">
        <p data-testid="identity-tier-note">{t('identity.tier.note')}</p>
        <p>{t('identity.operationalMode.note')}</p>
        <p data-testid="identity-server-authoritative">{t('identity.serverAuthoritative')}</p>
        <p data-testid="identity-no-production-auth">{t('identity.noProductionAuth')}</p>
      </div>
    </details>
  );
}
