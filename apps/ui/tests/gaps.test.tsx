import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { GapsPage } from '../src/features/evidence/GapsPage.js';
import { renderApp } from './render.js';
import { server, VALID_KEY } from './msw/server.js';
import {
  EC1_ROWS,
  EC2_ROWS,
  EC3SEAL_ROWS,
  EC3_DROP_BOUND,
  EC4_ROWS,
  ORG_ID,
  UNOBSERVED_DROP,
} from './msw/fixtures.js';
import { CATALOGS } from '../src/lib/i18n/catalogs/index.js';

function renderGaps(invariant: string, locale: 'pt-BR' | 'en-US' | 'es' = 'pt-BR') {
  return renderApp(<GapsPage />, {
    credential: VALID_KEY,
    route: `/evidence/gaps/${invariant}`,
    path: '/evidence/gaps/:invariant',
    locale,
  });
}

describe('gap views — each invariant renders its own source-defined fields', () => {
  it('EC-1 shows status, attempts and the sanitized last_error', async () => {
    renderGaps('ec1');
    expect(await screen.findByRole('table')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText(EC1_ROWS[0]!.last_error!)).toBeInTheDocument();
    expect(within(table).getByText('5')).toBeInTheDocument(); // attempts
    // A stalled row has no error text; the cell shows an explicit dash, not blank space.
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('EC-3.seal shows the unsealed native captures', async () => {
    renderGaps('ec3seal');
    const table = await screen.findByRole('table');
    expect(within(table).getByText(CATALOGS['pt-BR']['status.capture.captured'])).toBeInTheDocument();
    expect(
      within(table).getByTitle(EC3SEAL_ROWS[0]!.chain_id),
    ).toBeInTheDocument();
  });

  it('EC-4 shows the run/provider fields and tolerates a null status_code', async () => {
    renderGaps('ec4');
    const table = await screen.findByRole('table');
    expect(within(table).getByText('/v1/messages')).toBeInTheDocument();
    expect(within(table).getByText('/v1/responses')).toBeInTheDocument();
    expect(within(table).getByText('timeout')).toBeInTheDocument();
    expect(within(table).getByText('200')).toBeInTheDocument();
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('EC-2 — bigint sequence values keep every digit', () => {
  it('renders a first_gap_seq beyond Number.MAX_SAFE_INTEGER exactly', async () => {
    renderGaps('ec2');
    const table = await screen.findByRole('table');
    // 9007199254740993 becomes 9007199254740992 the moment anything calls Number().
    expect(within(table).getByText('9007199254740993')).toBeInTheDocument();
    expect(within(table).queryByText('9007199254740992')).toBeNull();
  });

  it('renders a uint64-max gap_count exactly', async () => {
    renderGaps('ec2');
    const table = await screen.findByRole('table');
    // Every digit of every fixture row, verbatim — the fixture is the contract here.
    for (const row of EC2_ROWS) {
      expect(within(table).getByText(row.first_gap_seq)).toBeInTheDocument();
      expect(within(table).getByText(row.gap_count)).toBeInTheDocument();
    }
    expect(within(table).getByText('18446744073709551615')).toBeInTheDocument();
  });

  it('explains why those values are strings', async () => {
    renderGaps('ec2');
    await screen.findByRole('table');
    expect(screen.getByText(CATALOGS['pt-BR']['gaps.bigintNote'])).toBeInTheDocument();
  });

  it('refuses a malformed sequence value rather than rendering a plausible number', async () => {
    server.use(
      http.get('*/v1/evidence/gaps', () =>
        HttpResponse.json({
          org_id: ORG_ID,
          invariant: 'ec2',
          window_seconds: 86_400,
          items: [{ chain_id: 'c', first_gap_seq: '1.5e3', gap_count: '2' }],
          next_cursor: null,
        }),
      ),
    );
    renderGaps('ec2');
    // The contract schema rejects it, so the screen shows an honest failure — not a number
    // an auditor would follow to the wrong event.
    expect(await screen.findByTestId('error-state')).toHaveTextContent(
      CATALOGS['pt-BR']['state.error.malformedResponse'],
    );
  });
});

describe('EC-3.drop — a singleton, not a list', () => {
  it('renders an information card instead of a one-row table', async () => {
    renderGaps('ec3drop');
    expect(await screen.findByTestId('ec3drop-singleton')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says it is not observed, and renders the backend bound verbatim', async () => {
    renderGaps('ec3drop');
    expect(await screen.findByTestId('ec3drop-singleton-unobserved')).toHaveTextContent(
      CATALOGS['pt-BR']['ec3drop.unobservedDetail'],
    );
    expect(screen.getByText(EC3_DROP_BOUND)).toBeInTheDocument();
  });

  it('shows measured numbers only when the API reports them observed', async () => {
    server.use(
      http.get('*/v1/evidence/gaps', () =>
        HttpResponse.json({
          org_id: ORG_ID,
          invariant: 'ec3drop',
          window_seconds: 86_400,
          items: [{ ...UNOBSERVED_DROP, observed: true, drops: 3, captures: 97, drop_rate: 0.03 }],
          next_cursor: null,
        }),
      ),
    );
    renderGaps('ec3drop');
    const card = await screen.findByTestId('ec3drop-singleton');
    expect(within(card).getByText('3')).toBeInTheDocument();
    expect(within(card).getByText('97')).toBeInTheDocument();
    expect(within(card).getByText('3,00%')).toBeInTheDocument();
    expect(screen.queryByTestId('ec3drop-singleton-unobserved')).toBeNull();
  });

  it('never offers a next page (its next_cursor is always null)', async () => {
    renderGaps('ec3drop');
    await screen.findByTestId('ec3drop-singleton');
    expect(screen.queryByTestId('load-more')).toBeNull();
  });
});

describe('gap views — pagination', () => {
  it('offers "load more" while the API returns a full page, and accumulates rows', async () => {
    let call = 0;
    server.use(
      http.get('*/v1/evidence/gaps', ({ request }) => {
        const cursor = Number(new URL(request.url).searchParams.get('cursor') ?? '0');
        call += 1;
        const rows = cursor === 0 ? EC1_ROWS : [{ ...EC1_ROWS[0]!, capture_id: 'page-two-row' }];
        return HttpResponse.json({
          org_id: ORG_ID,
          invariant: 'ec1',
          window_seconds: 86_400,
          items: rows,
          next_cursor: cursor === 0 ? 100 : null,
        });
      }),
    );
    const { user } = renderGaps('ec1');
    await screen.findByRole('table');
    expect(screen.getByTestId('rows-loaded')).toHaveTextContent('2');

    await user.click(screen.getByTestId('load-more'));
    await waitFor(() => expect(screen.getByTestId('rows-loaded')).toHaveTextContent('3'));
    expect(screen.getByText('page-two-row')).toBeInTheDocument();
    expect(call).toBe(2);
    // The second page ended the list: the control is replaced by the end-of-list statement.
    expect(screen.queryByTestId('load-more')).toBeNull();
    expect(screen.getByText(CATALOGS['pt-BR']['table.endOfList'])).toBeInTheDocument();
  });
});

describe('gap views — empty and invalid', () => {
  it('an empty result says "no gaps returned", never "everything is verified"', async () => {
    server.use(
      http.get('*/v1/evidence/gaps', () =>
        HttpResponse.json({
          org_id: ORG_ID,
          invariant: 'ec1',
          window_seconds: 86_400,
          items: [],
          next_cursor: null,
        }),
      ),
    );
    renderGaps('ec1');
    const empty = await screen.findByTestId('empty-state');
    expect(empty).toHaveTextContent(CATALOGS['pt-BR']['gaps.empty']);
    // The honest copy must contain the qualification, in every language.
    for (const locale of ['pt-BR', 'en-US', 'es'] as const) {
      expect(CATALOGS[locale]['gaps.empty'].length).toBeGreaterThan(40);
    }
  });

  it('an invariant the API does not accept is explained, not 404-ed', async () => {
    renderGaps('ec5');
    expect(await screen.findByTestId('empty-state')).toHaveTextContent(
      CATALOGS['pt-BR']['gaps.unknownInvariant'],
    );
  });

  it('a server error renders a retryable error state', async () => {
    server.use(
      http.get('*/v1/evidence/gaps', () => HttpResponse.json({ error: 'x' }, { status: 502 })),
    );
    renderGaps('ec1');
    expect(await screen.findByTestId('error-state')).toHaveTextContent(
      CATALOGS['pt-BR']['state.error.server'],
    );
  });
});

describe('gap views — measurement context', () => {
  it('always states the window and the invariant that produced the rows', async () => {
    renderGaps('ec4');
    await screen.findByRole('table');
    const context = screen.getByTestId('measurement-context');
    expect(within(context).getByText('1 d')).toBeInTheDocument();
    expect(within(context).getByText('ec4')).toBeInTheDocument();
  });

  it('renders in every supported language', async () => {
    for (const locale of ['pt-BR', 'en-US', 'es'] as const) {
      const { unmount } = renderGaps('ec4', locale);
      await screen.findByRole('table');
      expect(
        screen.getByRole('heading', { name: CATALOGS[locale]['invariant.ec4'] }),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it('EC-4 rows carry the exact backend field names as headers', async () => {
    renderGaps('ec4');
    const table = await screen.findByRole('table');
    for (const header of [
      'run_id',
      'provider_invocation_id',
      'provider',
      'native_endpoint',
      'status_code',
      'error_class',
      'created_at',
    ]) {
      expect(within(table).getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    expect(EC4_ROWS).toHaveLength(2);
  });
});
