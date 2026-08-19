import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { CockpitPage } from '../src/features/evidence/CockpitPage.js';
import { HashText } from '../src/components/HashText.js';
import { StatusBadge } from '../src/components/StatusBadge.js';
import { renderApp } from './render.js';
import { VALID_KEY } from './msw/server.js';
import { ORG_ID, SUMMARY_WITH_GAPS } from './msw/fixtures.js';
import { CATALOGS } from '../src/lib/i18n/catalogs/index.js';
import { buildQueryExport } from '../src/lib/query-export.js';

const FULL_HASH = 'a'.repeat(40) + 'b'.repeat(24);

describe('HashText — bounded by default, complete on demand', () => {
  it('shows a truncated value but exposes the full one as a title', () => {
    renderApp(<HashText value={FULL_HASH} label="payload_hash" />);
    const code = screen.getByTitle(FULL_HASH);
    expect(code.textContent).toBe(`${'a'.repeat(8)}…${'b'.repeat(6)}`);
    expect(code.textContent).not.toBe(FULL_HASH);
  });

  it('copies the FULL value, not the truncated display', async () => {
    // userEvent.setup() installs the clipboard stub, so this reads back what the component
    // actually put on the clipboard — the complete value, not the ellipsised one on screen.
    const { user } = renderApp(<HashText value={FULL_HASH} label="payload_hash" />);
    await user.click(
      screen.getByRole('button', {
        name: `${CATALOGS['pt-BR']['hash.copy']} — payload_hash`,
      }),
    );
    expect(await screen.findByText(CATALOGS['pt-BR']['hash.copied'])).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(FULL_HASH);
  });

  it('offers an accessible dialog with every character, for a reader who cannot use the clipboard', async () => {
    const { user } = renderApp(<HashText value={FULL_HASH} label="hmac" />);
    await user.click(screen.getByRole('button', { name: `${CATALOGS['pt-BR']['hash.showFull']} — hmac` }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(FULL_HASH)).toBeInTheDocument();
    expect(within(dialog).getByRole('heading')).toHaveTextContent('hmac');
  });

  it('renders an explicit marker for an absent value rather than an empty cell', () => {
    renderApp(<HashText value={null} label="previous_hmac" />);
    expect(screen.getByText(CATALOGS['pt-BR']['hash.absent'])).toBeInTheDocument();
  });

  it('does not offer the expand affordance for a value that already fits', () => {
    renderApp(<HashText value="abc123" label="short" />);
    expect(
      screen.queryByRole('button', { name: new RegExp(CATALOGS['pt-BR']['hash.showFull']) }),
    ).toBeNull();
  });
});

describe('StatusBadge — an unrecognized value never hides itself', () => {
  it('prints the raw value even when the caller suppressed it', () => {
    // The gap-row `status` and the audit `evidence_strength` are typed as free strings on
    // purpose, so a NEW backend enum member passes contract validation. Rendering only
    // "unrecognized value" would hide exactly what an auditor needs to see.
    renderApp(<StatusBadge domain="capture" value="quarantined_v2" showRaw={false} />);
    expect(screen.getByTestId('status-raw')).toHaveTextContent('quarantined_v2');
    expect(screen.getByText(CATALOGS['pt-BR']['status.unknown'])).toBeInTheDocument();
    expect(screen.getByTestId('status-raw').closest('[data-tone]')).toHaveAttribute(
      'data-tone',
      'neutral',
    );
  });

  it('still honours showRaw={false} for a value it does recognize', () => {
    renderApp(<StatusBadge domain="capture" value="sealed" showRaw={false} />);
    expect(screen.queryByTestId('status-raw')).toBeNull();
    expect(screen.getByText(CATALOGS['pt-BR']['status.capture.sealed'])).toBeInTheDocument();
  });
});

describe('query export — only what the API returned, plus non-secret context', () => {
  it('builds a payload with the endpoint, parameters and org, and nothing else', () => {
    const payload = buildQueryExport(
      {
        endpoint: '/v1/evidence/summary',
        params: { window: 86_400 },
        orgId: ORG_ID,
        locale: 'pt-BR',
        exportedAt: '2026-08-19T12:00:00.000Z',
      },
      SUMMARY_WITH_GAPS,
    );
    expect(payload.govai_export.endpoint).toBe('/v1/evidence/summary');
    expect(payload.govai_export.params).toEqual({ window: 86_400 });
    expect(payload.govai_export.org_id).toBe(ORG_ID);
    expect(payload.govai_export.locale).toBe('pt-BR');
    expect(payload.govai_export.exported_at).toBe('2026-08-19T12:00:00.000Z');
    expect(payload.data).toBe(SUMMARY_WITH_GAPS);
  });

  it('carries a disclaimer saying what it is NOT', () => {
    const payload = buildQueryExport(
      { endpoint: '/v1/capabilities', params: {}, orgId: ORG_ID, locale: 'en-US', exportedAt: 'x' },
      {},
    );
    const disclaimer = payload.govai_export.disclaimer.toLowerCase();
    expect(disclaimer).toContain('not a compliance report');
    expect(disclaimer).toContain('not a certification');
    expect(disclaimer).toContain('not a legal dossier');
  });

  it('never contains a credential, a header or a storage dump', () => {
    const serialized = JSON.stringify(
      buildQueryExport(
        {
          endpoint: '/v1/evidence/gaps',
          params: { invariant: 'ec2', window: 86_400 },
          orgId: ORG_ID,
          locale: 'es',
          exportedAt: 'x',
        },
        SUMMARY_WITH_GAPS,
      ),
    );
    expect(serialized).not.toContain(VALID_KEY);
    expect(serialized).not.toMatch(/govai_sk_/);
    expect(serialized).not.toMatch(/x-govai-api-key/i);
    expect(serialized).not.toMatch(/authorization/i);
    expect(serialized).not.toMatch(/localStorage/i);
    expect(serialized).not.toMatch(/cookie/i);
  });

  it('omits the pages block entirely for an unpaginated read', () => {
    const payload = buildQueryExport(
      {
        endpoint: '/v1/evidence/summary',
        params: { window: 86_400 },
        orgId: ORG_ID,
        locale: 'pt-BR',
        exportedAt: 'x',
      },
      SUMMARY_WITH_GAPS,
    );
    expect(payload.govai_export.pages).toBeUndefined();
  });

  it('records the COMPLETE parameter set of every page of a paginated export', () => {
    // Without this the artifact would label several requests with the first one's parameters
    // and could not reproduce which request produced which page.
    const payload = buildQueryExport(
      {
        endpoint: '/v1/audit-events',
        params: { chain_category: 'run', limit: 50 },
        pageParams: [
          { chain_category: 'run', limit: 50 },
          { chain_category: 'run', limit: 50, before_seq: 51 },
          { chain_category: 'run', limit: 50, before_seq: 1 },
        ],
        orgId: ORG_ID,
        locale: 'pt-BR',
        exportedAt: 'x',
      },
      [{ events: [] }, { events: [] }, { events: [] }],
    );
    expect(payload.govai_export.pages).toEqual([
      { index: 0, params: { chain_category: 'run', limit: 50 } },
      { index: 1, params: { chain_category: 'run', limit: 50, before_seq: 51 } },
      { index: 2, params: { chain_category: 'run', limit: 50, before_seq: 1 } },
    ]);
    // Index-aligned with `data`, so page i's parameters describe data[i].
    expect(payload.govai_export.pages).toHaveLength((payload.data as unknown[]).length);
    expect(payload.govai_export.disclaimer).toContain('pages[]');
  });

  it('records server-reported measurement context separately from request parameters', () => {
    // T_seal defines the EC-1 / EC-3.seal gap population but is NOT a request parameter, so
    // it must be recorded without being claimed as one.
    const payload = buildQueryExport(
      {
        endpoint: '/v1/evidence/gaps',
        params: { invariant: 'ec1', window: 86_400, limit: 100 },
        serverContext: { t_seal_seconds: 300 },
        orgId: ORG_ID,
        locale: 'pt-BR',
        exportedAt: 'x',
      },
      [],
    );
    expect(payload.govai_export.server_context).toEqual({ t_seal_seconds: 300 });
    expect(payload.govai_export.params).not.toHaveProperty('t_seal_seconds');
  });

  it('omits server_context when the read has none', () => {
    const payload = buildQueryExport(
      { endpoint: '/v1/capabilities', params: {}, orgId: ORG_ID, locale: 'es', exportedAt: 'x' },
      {},
    );
    expect(payload.govai_export.server_context).toBeUndefined();
  });

  it('reports an unavailable build SHA as null rather than fabricating one', () => {
    const payload = buildQueryExport(
      { endpoint: '/v1/capabilities', params: {}, orgId: null, locale: 'pt-BR', exportedAt: 'x' },
      {},
    );
    expect(payload.govai_export.ui_build_sha).toBeNull();
  });
});

describe('query export — in the cockpit', () => {
  it('serializes the response on screen, and carries no credential', async () => {
    const { user } = renderApp(<CockpitPage />, { credential: VALID_KEY });
    await screen.findByTestId('coverage-panel');
    await user.click(screen.getByTestId('query-export-open'));

    const json = (await screen.findByTestId('query-export-json')).textContent ?? '';
    const parsed = JSON.parse(json) as { govai_export: Record<string, unknown>; data: unknown };
    expect(parsed.govai_export['endpoint']).toBe('/v1/evidence/summary');
    expect(parsed.data).toMatchObject({ org_id: ORG_ID });
    expect(json).not.toContain(VALID_KEY);
    expect(json).not.toMatch(/govai_sk_/);
  });

  it('is not presented as a report or a dossier', async () => {
    const { user } = renderApp(<CockpitPage />, { credential: VALID_KEY });
    await screen.findByTestId('coverage-panel');
    await user.click(screen.getByTestId('query-export-open'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(CATALOGS['pt-BR']['export.description']);
    for (const locale of ['pt-BR', 'en-US', 'es'] as const) {
      const text = CATALOGS[locale]['export.description'].toLowerCase();
      expect(/dossiê|dossier|expediente/.test(text)).toBe(true);
      expect(/conformidade|compliance|cumplimiento/.test(text)).toBe(true);
    }
  });

  it('does not carry a stale "copied" into a freshly stamped artifact', async () => {
    // Reopening restamps `exported_at`, so the clipboard no longer holds what is on screen.
    const { user } = renderApp(<CockpitPage />, { credential: VALID_KEY });
    await screen.findByTestId('coverage-panel');

    await user.click(screen.getByTestId('query-export-open'));
    await screen.findByTestId('query-export-json');
    await user.click(screen.getByTestId('query-export-copy'));
    expect(await screen.findByText(CATALOGS['pt-BR']['export.copied'])).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('query-export-json')).toBeNull());
    await user.click(screen.getByTestId('query-export-open'));
    await screen.findByTestId('query-export-json');
    expect(screen.queryByText(CATALOGS['pt-BR']['export.copied'])).toBeNull();
  });

  it('offers a download named after the query', async () => {
    const { user } = renderApp(<CockpitPage />, { credential: VALID_KEY });
    await screen.findByTestId('coverage-panel');
    await user.click(screen.getByTestId('query-export-open'));
    const link = await screen.findByTestId('query-export-download');
    expect(link).toHaveAttribute('download', 'govai-evidence-summary.json');
    expect(link.getAttribute('href')).toMatch(/^data:application\/json/);
  });
});

describe('accessibility basics', () => {
  it('every table keeps a caption and column headers', async () => {
    renderApp(<CockpitPage />, { credential: VALID_KEY });
    await screen.findByTestId('coverage-panel');
    for (const table of screen.getAllByRole('table')) {
      expect(table.querySelector('caption')?.textContent?.length ?? 0).toBeGreaterThan(0);
      expect(within(table).getAllByRole('columnheader').length).toBeGreaterThan(0);
    }
  });

  it('states of the page are announced, not merely drawn', async () => {
    const { unmount } = renderApp(<CockpitPage />, { credential: VALID_KEY });
    // The loading state is a live region, so a screen reader hears that work is in flight.
    expect(screen.getByTestId('loading-skeleton')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('loading-skeleton')).toHaveAttribute('role', 'status');
    unmount();
  });

  it('status colour is always accompanied by text', async () => {
    renderApp(<CockpitPage />, { credential: VALID_KEY });
    await screen.findByTestId('coverage-panel');
    for (const toned of document.querySelectorAll('[data-tone]')) {
      expect((toned.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
  });
});
