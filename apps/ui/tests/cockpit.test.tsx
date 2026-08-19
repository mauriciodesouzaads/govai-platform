import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { CockpitPage } from '../src/features/evidence/CockpitPage.js';
import { renderApp } from './render.js';
import { server, VALID_KEY } from './msw/server.js';
import {
  EC3DROP_EXCLUSION_REASON,
  EC3_DROP_BOUND,
  EC6_EXCLUSION_REASON,
  EC6_NOTE,
  SUMMARY_ALL_IN_FLIGHT,
  SUMMARY_EMPTY,
  SUMMARY_FULLY_COVERED,
  SUMMARY_WITH_GAPS,
} from './msw/fixtures.js';
import { CATALOGS } from '../src/lib/i18n/catalogs/index.js';

type SummaryBody = typeof SUMMARY_WITH_GAPS;

function serveSummary(body: SummaryBody) {
  server.use(http.get('*/v1/evidence/summary', () => HttpResponse.json(body)));
}

async function renderCockpit(
  body: SummaryBody = SUMMARY_WITH_GAPS,
  locale: 'pt-BR' | 'en-US' | 'es' = 'pt-BR',
) {
  serveSummary(body);
  const result = renderApp(<CockpitPage />, { credential: VALID_KEY, locale });
  await screen.findByTestId('coverage-panel');
  return result;
}

describe('cockpit — the qualifications are content, not footnotes', () => {
  it('renders every coverage term the API returned', async () => {
    await renderCockpit();
    const terms = screen.getByTestId('coverage-terms');
    for (const term of SUMMARY_WITH_GAPS.coverage_ratio.terms) {
      expect(within(terms).getByText(term.invariant)).toBeInTheDocument();
    }
  });

  it('renders every EXCLUDED invariant with the backend’s own reason', async () => {
    // The exclusions are what keep the ratio honest; hiding them turns 0.993 into a lie.
    await renderCockpit();
    const excluded = screen.getByTestId('coverage-excluded');
    expect(within(excluded).getByText('ec6')).toBeInTheDocument();
    expect(within(excluded).getByText('ec3drop')).toBeInTheDocument();
    expect(within(excluded).getByText(EC6_EXCLUSION_REASON)).toBeInTheDocument();
    expect(within(excluded).getByText(EC3DROP_EXCLUSION_REASON)).toBeInTheDocument();
  });

  it('shows the measurement window and T_seal as first-class context', async () => {
    await renderCockpit();
    const context = screen.getByTestId('measurement-context');
    expect(within(context).getByText('1 d')).toBeInTheDocument();
    expect(within(context).getByText('5 min')).toBeInTheDocument();
  });

  it('states that EC-5 is deferred rather than silently omitting it', async () => {
    await renderCockpit();
    expect(screen.getByText(CATALOGS['pt-BR']['cockpit.ec5Note'])).toBeInTheDocument();
  });
});

describe('cockpit — EC-6 is never green', () => {
  it('renders the pending tile in the attention tone', async () => {
    await renderCockpit();
    const tile = screen.getByTestId('tile-ec6');
    expect(tile).toHaveAttribute('data-tone', 'attention');
    expect(tile).not.toHaveAttribute('data-tone', 'ok');
  });

  it('renders the backend note VERBATIM', async () => {
    await renderCockpit();
    expect(screen.getByTestId('ec6-note')).toHaveTextContent(EC6_NOTE);
  });

  it('says explicitly that pending is not verified', async () => {
    await renderCockpit();
    expect(screen.getByTestId('ec6-never-green')).toHaveTextContent(
      CATALOGS['pt-BR']['ec6.neverGreen'],
    );
  });

  it('offers NO drill-down link, because the API has no gap list for EC-6', async () => {
    await renderCockpit();
    const tile = screen.getByTestId('tile-ec6');
    expect(within(tile).queryByRole('link')).toBeNull();
    expect(within(tile).getByText(CATALOGS['pt-BR']['cockpit.tile.noDrillDown'])).toBeInTheDocument();
  });

  it('stays out of the green even when no chain is in scope', async () => {
    await renderCockpit(SUMMARY_EMPTY);
    expect(screen.getByTestId('tile-ec6')).toHaveAttribute('data-tone', 'neutral');
  });
});

describe('cockpit — EC-3.drop is not observed, and says so', () => {
  it('shows no number as the headline when nothing was observed', async () => {
    await renderCockpit();
    const tile = screen.getByTestId('tile-ec3drop');
    expect(tile).toHaveAttribute('data-tone', 'neutral');
    // A large "0" would read as "no loss". The tile shows the word instead.
    expect(within(tile).getByText(CATALOGS['pt-BR']['ec3drop.unobserved'])).toBeInTheDocument();
  });

  it('explains that the OTLP collector holds the authoritative signal', async () => {
    await renderCockpit();
    expect(screen.getByTestId('ec3drop-unobserved')).toHaveTextContent(
      CATALOGS['pt-BR']['ec3drop.unobservedDetail'],
    );
  });

  it('renders the backend’s declared bound VERBATIM', async () => {
    await renderCockpit();
    expect(screen.getByTestId('ec3drop-bound')).toHaveTextContent(EC3_DROP_BOUND);
  });
});

describe('cockpit — an empty window is not a clean bill of health', () => {
  it('flags a 1.000 ratio computed over an empty population', async () => {
    await renderCockpit(SUMMARY_EMPTY);
    expect(screen.getByTestId('coverage-no-units')).toHaveTextContent(
      CATALOGS['pt-BR']['cockpit.coverage.noUnits'],
    );
    expect(screen.getByTestId('coverage-panel')).toHaveAttribute('data-tone', 'neutral');
  });

  it('does not show the empty-population caveat when there IS a population', async () => {
    await renderCockpit();
    expect(screen.queryByTestId('coverage-no-units')).toBeNull();
  });

  it('renders every tile in the neutral tone when nothing happened in the window', async () => {
    await renderCockpit(SUMMARY_EMPTY);
    for (const id of ['tile-ec1', 'tile-ec2', 'tile-ec3seal', 'tile-ec4', 'tile-ec6']) {
      expect(screen.getByTestId(id)).toHaveAttribute('data-tone', 'neutral');
    }
  });
});

describe('cockpit — tones follow the facts', () => {
  it('a failed capture makes EC-1 a failure and a chain gap makes EC-2 a failure', async () => {
    await renderCockpit();
    expect(screen.getByTestId('tile-ec1')).toHaveAttribute('data-tone', 'failure');
    expect(screen.getByTestId('tile-ec2')).toHaveAttribute('data-tone', 'failure');
    expect(screen.getByTestId('tile-ec3seal')).toHaveAttribute('data-tone', 'attention');
    expect(screen.getByTestId('tile-ec4')).toHaveAttribute('data-tone', 'attention');
  });

  it('a window with captures but NOTHING sealed is in-flight, never green', async () => {
    // The tile would otherwise read green beside a badge saying "sealed: 0".
    await renderCockpit(SUMMARY_ALL_IN_FLIGHT);
    for (const id of ['tile-ec1', 'tile-ec3seal']) {
      expect(screen.getByTestId(id)).toHaveAttribute('data-tone', 'info');
      expect(screen.getByTestId(id)).not.toHaveAttribute('data-tone', 'ok');
    }
    expect(
      screen.getAllByText(CATALOGS['pt-BR']['seal.inFlightNoneSealed']).length,
    ).toBeGreaterThan(0);
  });

  it('a fully covered window is green — but EC-6 still is not', async () => {
    await renderCockpit(SUMMARY_FULLY_COVERED);
    expect(screen.getByTestId('coverage-panel')).toHaveAttribute('data-tone', 'ok');
    expect(screen.getByTestId('tile-ec1')).toHaveAttribute('data-tone', 'ok');
    expect(screen.getByTestId('tile-ec6')).toHaveAttribute('data-tone', 'attention');
  });
});

describe('cockpit — drill-down targets', () => {
  it('links each tile that has a gap list to its own invariant', async () => {
    await renderCockpit();
    const expected: Array<[string, string]> = [
      ['tile-ec1', '/evidence/gaps/ec1'],
      ['tile-ec2', '/evidence/gaps/ec2'],
      ['tile-ec3seal', '/evidence/gaps/ec3seal'],
      ['tile-ec3drop', '/evidence/gaps/ec3drop'],
      ['tile-ec4', '/evidence/gaps/ec4'],
    ];
    for (const [testId, href] of expected) {
      const link = within(screen.getByTestId(testId)).getByRole('link');
      expect(link).toHaveAttribute('href', href);
    }
  });
});

describe('cockpit — failure states', () => {
  it('shows a localized error state rather than an empty page', async () => {
    server.use(
      http.get('*/v1/evidence/summary', () =>
        HttpResponse.json({ error: 'internal' }, { status: 500 }),
      ),
    );
    renderApp(<CockpitPage />, { credential: VALID_KEY });
    const error = await screen.findByTestId('error-state');
    expect(error).toHaveTextContent(CATALOGS['pt-BR']['state.error.server']);
  });

  it('refuses to render a response that violates the contract', async () => {
    // A shape change must surface as an explicit failure, never as blank tiles that a reader
    // would take for zeros.
    server.use(
      http.get('*/v1/evidence/summary', () =>
        HttpResponse.json({ org_id: 'x', counts: { ec1: 'not-an-object' } }),
      ),
    );
    renderApp(<CockpitPage />, { credential: VALID_KEY });
    expect(await screen.findByTestId('error-state')).toHaveTextContent(
      CATALOGS['pt-BR']['state.error.malformedResponse'],
    );
    expect(screen.queryByTestId('coverage-panel')).toBeNull();
  });
});

describe('cockpit — an additive backend field survives into the export', () => {
  it('renders normally and carries the unknown field through', async () => {
    const withNewField = {
      ...SUMMARY_WITH_GAPS,
      future_invariant_ec7: { total: 3, covered: 3 },
    } as unknown as typeof SUMMARY_WITH_GAPS;
    server.use(http.get('*/v1/evidence/summary', () => HttpResponse.json(withNewField)));
    const { user } = renderApp(<CockpitPage />, { credential: VALID_KEY });
    await screen.findByTestId('coverage-panel');

    await user.click(screen.getByTestId('query-export-open'));
    const json = (await screen.findByTestId('query-export-json')).textContent ?? '';
    expect(JSON.parse(json).data).toMatchObject({
      future_invariant_ec7: { total: 3, covered: 3 },
    });
  });
});

describe('cockpit — every language', () => {
  it.each(['pt-BR', 'en-US', 'es'] as const)('renders and stays honest in %s', async (locale) => {
    await renderCockpit(SUMMARY_WITH_GAPS, locale);
    expect(screen.getByText(CATALOGS[locale]['cockpit.title'])).toBeInTheDocument();
    // The two hardest-to-read facts must be present in every language.
    expect(screen.getByTestId('ec6-never-green')).toHaveTextContent(
      CATALOGS[locale]['ec6.neverGreen'],
    );
    expect(screen.getByTestId('ec3drop-unobserved')).toHaveTextContent(
      CATALOGS[locale]['ec3drop.unobservedDetail'],
    );
    // The backend's own note and bound are never translated away.
    expect(screen.getByTestId('ec6-note')).toHaveTextContent(EC6_NOTE);
    expect(screen.getByTestId('ec3drop-bound')).toHaveTextContent(EC3_DROP_BOUND);
  });
});
