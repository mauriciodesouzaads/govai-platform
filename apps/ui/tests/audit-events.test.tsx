import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AuditEventsPage } from '../src/features/evidence/AuditEventsPage.js';
import { renderApp } from './render.js';
import { server, VALID_KEY } from './msw/server.js';
import { RUN_CHAIN_ID, auditEvent } from './msw/fixtures.js';
import { CATALOGS } from '../src/lib/i18n/catalogs/index.js';
import { CHAIN_CATEGORIES } from '../src/lib/contract/audit-events.js';

function renderChain(query = '', locale: 'pt-BR' | 'en-US' | 'es' = 'pt-BR') {
  return renderApp(<AuditEventsPage />, {
    credential: VALID_KEY,
    route: `/audit-events${query}`,
    locale,
  });
}

describe('audit chain — what this view is', () => {
  it('states permanently that it exposes metadata and hashes, not content', async () => {
    renderChain();
    await screen.findByRole('table');
    expect(screen.getByTestId('audit-metadata-only')).toHaveTextContent(
      CATALOGS['pt-BR']['audit.metadataOnly'],
    );
  });

  it.each(['pt-BR', 'en-US', 'es'] as const)(
    'keeps the integrity-not-content statement in %s',
    async (locale) => {
      const { unmount } = renderChain('', locale);
      await screen.findByRole('table');
      const text = screen.getByTestId('audit-metadata-only').textContent ?? '';
      expect(text).toBe(CATALOGS[locale]['audit.metadataOnly']);
      // The claim must never drift into promising reconstruction.
      expect(/reconstru/i.test(CATALOGS[locale]['audit.metadataOnly'])).toBe(true);
      unmount();
    },
  );

  it('never renders a payload column — the API does not return one', async () => {
    renderChain();
    const table = await screen.findByRole('table');
    for (const forbidden of ['payload', 'canonical_bytes', 'content']) {
      expect(
        within(table)
          .getAllByRole('columnheader')
          .some((h) => h.textContent === forbidden),
      ).toBe(false);
    }
    // payload_HASH is present — the hash is metadata, the payload is not.
    expect(within(table).getByRole('columnheader', { name: 'payload_hash' })).toBeInTheDocument();
  });
});

describe('audit chain — categories', () => {
  it('defaults to the run chain', async () => {
    renderChain();
    await screen.findByRole('table');
    expect(screen.getByTestId('chain-tab-run')).toHaveAttribute('aria-current', 'page');
  });

  it.each(CHAIN_CATEGORIES)('reads the %s chain from the URL', async (category) => {
    const { unmount } = renderChain(`?chain=${category}`);
    await screen.findByRole('table');
    expect(screen.getByTestId(`chain-tab-${category}`)).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('measurement-context')).toHaveTextContent(
      `${RUN_CHAIN_ID}:${category}`,
    );
    unmount();
  });

  it('falls back to the run chain for a category the API does not accept', async () => {
    renderChain('?chain=not-a-chain');
    await screen.findByRole('table');
    expect(screen.getByTestId('chain-tab-run')).toHaveAttribute('aria-current', 'page');
  });

  it('offers all four chains as links, so a specific chain is shareable', async () => {
    renderChain();
    await screen.findByRole('table');
    for (const category of CHAIN_CATEGORIES) {
      expect(screen.getByTestId(`chain-tab-${category}`)).toHaveAttribute(
        'href',
        `/audit-events?chain=${category}`,
      );
    }
  });
});

describe('audit chain — keyset pagination', () => {
  it('derives before_seq from the last loaded row and accumulates pages', async () => {
    const seen: Array<string | null> = [];
    server.use(
      http.get('*/v1/audit-events', ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen.push(params.get('before_seq'));
        const limit = Number(params.get('limit') ?? '50');
        const before = params.get('before_seq');
        const highest = before === null ? 100 : Number(before) - 1;
        const events = [];
        for (let seq = highest; seq >= 1 && events.length < limit; seq -= 1) {
          events.push(auditEvent(seq));
        }
        return HttpResponse.json({ chain_id: RUN_CHAIN_ID, events });
      }),
    );
    const { user } = renderChain();
    await screen.findByRole('table');
    // 100 down to 51 — a full page of 50.
    expect(screen.getByTestId('rows-loaded')).toHaveTextContent('50');

    await user.click(screen.getByTestId('load-more'));
    await waitFor(() => expect(screen.getByTestId('rows-loaded')).toHaveTextContent('100'));
    // The first request carries no bound; the second starts strictly below the last row loaded.
    expect(seen).toEqual([null, '51']);
  });

  it('the export records the before_seq of EVERY loaded page, not just the first', async () => {
    server.use(
      http.get('*/v1/audit-events', ({ request }) => {
        const params = new URL(request.url).searchParams;
        const limit = Number(params.get('limit') ?? '50');
        const before = params.get('before_seq');
        const highest = before === null ? 100 : Number(before) - 1;
        const events = [];
        for (let seq = highest; seq >= 1 && events.length < limit; seq -= 1) {
          events.push(auditEvent(seq));
        }
        return HttpResponse.json({ chain_id: RUN_CHAIN_ID, events });
      }),
    );
    const { user } = renderChain();
    await screen.findByRole('table');
    await user.click(screen.getByTestId('load-more'));
    await waitFor(() => expect(screen.getByTestId('rows-loaded')).toHaveTextContent('100'));

    await user.click(screen.getByTestId('query-export-open'));
    const json = (await screen.findByTestId('query-export-json')).textContent ?? '';
    const parsed = JSON.parse(json) as {
      govai_export: { pages?: Array<{ index: number; params: Record<string, unknown> }> };
      data: unknown[];
    };
    expect(parsed.govai_export.pages).toEqual([
      { index: 0, params: { chain_category: 'run', limit: 50 } },
      { index: 1, params: { chain_category: 'run', limit: 50, before_seq: 51 } },
    ]);
    expect(parsed.govai_export.pages).toHaveLength(parsed.data.length);
  });

  it('ends the list when a page comes back shorter than the limit', async () => {
    renderChain(); // the default handler returns 5 events for a limit of 50
    await screen.findByRole('table');
    expect(screen.queryByTestId('load-more')).toBeNull();
    expect(screen.getByText(CATALOGS['pt-BR']['table.endOfList'])).toBeInTheDocument();
  });

  it('explains that the API returns no cursor', async () => {
    renderChain();
    await screen.findByRole('table');
    expect(screen.getByTestId('measurement-context')).toHaveTextContent(
      CATALOGS['pt-BR']['audit.keysetNote'],
    );
  });
});

describe('audit chain — row rendering', () => {
  it('renders the genesis event’s null previous_hmac as a first link, not a break', async () => {
    renderChain();
    await screen.findByRole('table');
    expect(screen.getByTestId('genesis-link')).toHaveTextContent(
      CATALOGS['pt-BR']['audit.genesisLink'],
    );
  });

  it('truncates long hashes but keeps the full value reachable', async () => {
    renderChain();
    const table = await screen.findByRole('table');
    const truncated = `${'a'.repeat(8)}…${'a'.repeat(6)}`;
    const cells = within(table).getAllByText(truncated);
    expect(cells.length).toBeGreaterThan(0);
    // The full 64-character value is available without any interaction, as a title.
    expect(cells[0]).toHaveAttribute('title', 'a'.repeat(64));
  });

  it('renders sequence_number as the number the API returns', async () => {
    // ★ This route narrows sequence_number with Number() server-side, so it is a JSON number
    // here. The decimal-string rule belongs to the EC-2 gap sequences, not to this route.
    renderChain();
    const table = await screen.findByRole('table');
    // Read the first cell of every body row — the sequence column — rather than searching the
    // whole table, where `1` also appears as key_version.
    const sequences = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelector('td')?.textContent);
    expect(sequences).toEqual(['5', '4', '3', '2', '1']);
  });

  it('shows evidence_strength without dressing it as a certification', async () => {
    renderChain();
    const table = await screen.findByRole('table');
    const badges = within(table).getAllByText(
      CATALOGS['pt-BR']['status.evidenceStrength.hmac_internal'],
    );
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0]?.closest('[data-tone]')).toHaveAttribute('data-tone', 'neutral');
  });
});

describe('audit chain — empty and failure', () => {
  it('an empty chain says so', async () => {
    server.use(
      http.get('*/v1/audit-events', () =>
        HttpResponse.json({ chain_id: RUN_CHAIN_ID, events: [] }),
      ),
    );
    renderChain();
    expect(await screen.findByTestId('empty-state')).toHaveTextContent(
      CATALOGS['pt-BR']['audit.empty'],
    );
  });

  it('a 401 mid-session surfaces the session-expired message', async () => {
    server.use(
      http.get('*/v1/audit-events', () =>
        HttpResponse.json({ error: 'auth_error', message: 'invalid api key' }, { status: 401 }),
      ),
    );
    renderChain();
    expect(await screen.findByTestId('error-state')).toHaveTextContent(
      CATALOGS['pt-BR']['state.error.auth'],
    );
  });
});
