import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { CapabilitiesPage } from '../src/features/evidence/CapabilitiesPage.js';
import { renderApp } from './render.js';
import { server, VALID_KEY } from './msw/server.js';
import { CAPABILITIES, ORG_ID } from './msw/fixtures.js';
import { CATALOGS } from '../src/lib/i18n/catalogs/index.js';

function renderCapabilities(locale: 'pt-BR' | 'en-US' | 'es' = 'pt-BR') {
  return renderApp(<CapabilitiesPage />, { credential: VALID_KEY, locale });
}

describe('capability matrix — the shape the route actually returns', () => {
  it('flattens capability × facet into one row per facet', async () => {
    renderCapabilities();
    const table = await screen.findByRole('table');
    // 3 capabilities → 2 + 1 + 2 facets = 5 rows, plus the header row.
    expect(within(table).getAllByRole('row')).toHaveLength(6);
  });

  it('renders the backend field names as headers', async () => {
    renderCapabilities();
    const table = await screen.findByRole('table');
    for (const header of [
      'capability_id',
      'provider',
      'facet_id',
      'evidence_strength',
      'reason',
      'last_live_test_at',
      'docs_url',
    ]) {
      expect(within(table).getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
  });

  it('renders null optional fields as an explicit dash, never as a blank cell', async () => {
    renderCapabilities();
    const table = await screen.findByRole('table');
    // reason, last_live_test_at, docs_url and evidence_strength are null on several facets.
    expect(within(table).getAllByText('—').length).toBeGreaterThanOrEqual(10);
  });

  it('links docs only where the registry actually provides a URL', async () => {
    renderCapabilities();
    const table = await screen.findByRole('table');
    const links = within(table).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://example.invalid/docs/final-hash');
    expect(links[0]).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});

describe('capability matrix — effective vs baseline', () => {
  it('shows both the effective and the baseline status for an overridden facet', async () => {
    renderCapabilities();
    const table = await screen.findByRole('table');
    const row = within(table)
      .getAllByRole('row')
      .find((r) => r.textContent?.includes('openai.responses.create') && r.textContent?.includes('pre_dlp'));
    expect(row).toBeDefined();
    // Effective = blocked (the org downgraded it) at BOTH the capability rollup and the facet;
    // baseline = supported at both. Effective and baseline are shown side by side so the
    // downgrade is visible rather than implied.
    expect(
      within(row!).getAllByText(CATALOGS['pt-BR']['status.capability.blocked']),
    ).toHaveLength(2);
    expect(within(row!).getAllByText('supported')).toHaveLength(2);
    expect(within(row!).getByText('0')).toBeInTheDocument(); // level floored by the override
    expect(within(row!).getByText(CATALOGS['pt-BR']['capabilities.override.yes'])).toBeInTheDocument();
  });

  it('marks a facet with no override as such', async () => {
    renderCapabilities();
    const table = await screen.findByRole('table');
    expect(
      within(table).getAllByText(CATALOGS['pt-BR']['capabilities.override.no']).length,
    ).toBeGreaterThan(0);
  });

  it('states that an override can only downgrade', async () => {
    renderCapabilities();
    await screen.findByRole('table');
    expect(screen.getByText(CATALOGS['pt-BR']['capabilities.overrideNote'])).toBeInTheDocument();
  });
});

describe('capability matrix — planned is not available', () => {
  it('renders a planned capability in the attention tone, never green', async () => {
    renderCapabilities();
    const table = await screen.findByRole('table');
    const badges = within(table).getAllByText(CATALOGS['pt-BR']['status.capability.planned']);
    expect(badges.length).toBeGreaterThan(0);
    for (const badge of badges) {
      expect(badge.closest('[data-tone]')).toHaveAttribute('data-tone', 'attention');
    }
  });

  it('states in words that a planned capability is not available for use', async () => {
    renderCapabilities();
    await screen.findByRole('table');
    expect(screen.getByText(CATALOGS['pt-BR']['capabilities.plannedNote'])).toBeInTheDocument();
  });
});

describe('capability matrix — the level column is not a provider surface mode', () => {
  it('says the level is the registry governance level 0–3', async () => {
    // ★ The July plan described this screen as showing policy_governed vs passthrough_audited.
    // This route serves a DIFFERENT registry, whose level is a numeric governance level.
    renderCapabilities();
    await screen.findByRole('table');
    expect(screen.getByText(CATALOGS['pt-BR']['capabilities.levelNote'])).toBeInTheDocument();
  });

  it('never renders the provider-surface vocabulary this endpoint does not return', async () => {
    renderCapabilities();
    await screen.findByRole('table');
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('policy_governed');
    expect(body).not.toContain('passthrough_audited');
    expect(body).not.toContain('base_risk_class');
  });

  it('renders evidence_strength as neutral, and says it is not certification', async () => {
    renderCapabilities();
    const table = await screen.findByRole('table');
    const badges = within(table).getAllByText(
      CATALOGS['pt-BR']['status.evidenceStrength.hmac_internal'],
    );
    for (const badge of badges) {
      expect(badge.closest('[data-tone]')).toHaveAttribute('data-tone', 'neutral');
    }
    expect(screen.getByText(CATALOGS['pt-BR']['capabilities.evidenceNote'])).toBeInTheDocument();
  });
});

describe('capability matrix — filtering the loaded rows', () => {
  it('filters the already-loaded set without hiding an unfetched page', async () => {
    // Safe because this endpoint is not paginated: the whole registry arrives in one response.
    const { user } = renderCapabilities();
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(6);

    await user.type(screen.getByTestId('capability-filter'), 'openai');
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3); // header + 2
  });

  it('a filter that matches nothing shows an empty state, not a blank table', async () => {
    const { user } = renderCapabilities();
    await screen.findByRole('table');
    await user.type(screen.getByTestId('capability-filter'), 'zzzz-no-such-capability');
    expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('capability matrix — empty and failure', () => {
  it('an empty registry says so', async () => {
    server.use(
      http.get('*/v1/capabilities', () =>
        HttpResponse.json({ org_id: ORG_ID, capabilities: [] }),
      ),
    );
    renderCapabilities();
    expect(await screen.findByTestId('empty-state')).toHaveTextContent(
      CATALOGS['pt-BR']['capabilities.empty'],
    );
  });

  it('a malformed response fails safely instead of rendering partial rows', async () => {
    server.use(
      http.get('*/v1/capabilities', () =>
        HttpResponse.json({
          org_id: ORG_ID,
          capabilities: [{ id: 'x', provider: 'anthropic', status: 'not-a-status', baseline_status: 'supported', facets: [] }],
        }),
      ),
    );
    renderCapabilities();
    expect(await screen.findByTestId('error-state')).toHaveTextContent(
      CATALOGS['pt-BR']['state.error.malformedResponse'],
    );
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders in every supported language', async () => {
    for (const locale of ['pt-BR', 'en-US', 'es'] as const) {
      const { unmount } = renderCapabilities(locale);
      await screen.findByRole('table');
      expect(
        screen.getByRole('heading', { name: CATALOGS[locale]['capabilities.title'] }),
      ).toBeInTheDocument();
      expect(screen.getByText(CATALOGS[locale]['capabilities.levelNote'])).toBeInTheDocument();
      unmount();
    }
    expect(CAPABILITIES.capabilities).toHaveLength(3);
  });
});
