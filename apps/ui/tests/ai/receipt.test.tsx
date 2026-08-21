import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { AiConsolePage } from '../../src/features/ai/AiConsolePage.js';
import { renderApp } from '../render.js';
import { server, VALID_KEY } from '../msw/server.js';
import { CATALOGS } from '../../src/lib/i18n/catalogs/index.js';
import {
  PATHS,
  defaultModelHandlers,
  errorHandler,
  messagesScript,
  responsesScript,
  streamHandler,
} from './provider-msw.js';

// ★★ RECEIPT HONESTY.
//
// The receipt is the surface where an evidence product is most tempted to overclaim, so every
// forbidden claim is tested by NAME here rather than by inference. In particular:
//
//   • `decision: ask` + `applied: forwarded` must NOT read as approved, requested, or blocked;
//   • `decision: sandbox_required` + `applied: forwarded` must NOT say a sandbox was created;
//   • only `applied: blocked` may render as a block;
//   • the Native/Audited surface must invent NO governance value;
//   • no receipt says evidence was captured, and none links to a specific audit event.

const T = CATALOGS['pt-BR'];
const EN = CATALOGS['en-US'];
const ES = CATALOGS['es'];

function renderConsole(extra: Parameters<typeof server.use> = []) {
  server.use(...extra, ...defaultModelHandlers());
  return renderApp(<AiConsolePage />, { route: '/ai', credential: VALID_KEY });
}

async function converse(
  user: ReturnType<typeof renderApp>['user'],
  opts: { mode?: 'native_audited' | 'governed'; provider?: 'openai' | 'anthropic' } = {},
) {
  if (opts.provider) await user.selectOptions(screen.getByTestId('provider-select'), opts.provider);
  if (opts.mode) await user.selectOptions(screen.getByTestId('mode-select'), opts.mode);
  const input = await screen.findByTestId('model-input');
  await user.clear(input);
  await user.type(input, 'a-model');
  await user.type(screen.getByTestId('composer-input'), 'a question');
  await user.click(screen.getByTestId('composer-send'));
}

/** Open the receipt disclosure and return it. */
async function openReceipt(user: ReturnType<typeof renderApp>['user']): Promise<HTMLElement> {
  const receipt = await screen.findByTestId('interaction-receipt');
  await user.click(within(receipt).getByText(T['ai.receipt.title']));
  return receipt;
}

const GOVERNED_HEADERS = (decision: string, applied: string): Record<string, string> => ({
  'x-govai-capability-level': 'policy_governed',
  'x-govai-effective-risk-class': 'C',
  'x-govai-enforcement-decision': decision,
  'x-govai-enforcement-applied': applied,
});

describe('★ recommendation and applied are TWO facts, never one', () => {
  it('renders decision=ask + applied=forwarded without a word of approval or blocking', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesGoverned, {
        chunks: responsesScript('an answer'),
        headers: GOVERNED_HEADERS('ask', 'forwarded'),
      }),
    ]);
    await converse(user, { mode: 'governed' });
    await screen.findByText('an answer');
    const receipt = await openReceipt(user);

    const recommendation = within(receipt).getByTestId('receipt-recommendation');
    const applied = within(receipt).getByTestId('receipt-applied');

    // The recommendation says what the matrix said AND that nobody was asked.
    expect(recommendation).toHaveTextContent(T['enforcement.ask']);
    expect(recommendation.textContent ?? '').toMatch(/ninguém foi consultado/i);
    // The applied row says the request reached the provider.
    expect(applied).toHaveTextContent(T['ai.receipt.applied.forwarded']);

    // ★ Forbidden readings, by name.
    const text = (receipt.textContent ?? '').toLowerCase();
    expect(text).not.toContain('aprovado');
    expect(text).not.toContain('aprovação concedida');
    expect(text).not.toContain('humano aprovou');
    expect(text).not.toMatch(/requisição bloqueada/);
  });

  it('renders decision=sandbox_required + applied=forwarded without claiming a sandbox exists', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.anthropicMessagesGoverned, {
        chunks: messagesScript('an answer'),
        headers: GOVERNED_HEADERS('sandbox_required', 'forwarded'),
      }),
    ]);
    await converse(user, { mode: 'governed', provider: 'anthropic' });
    await screen.findByText('an answer');
    const receipt = await openReceipt(user);

    expect(within(receipt).getByTestId('receipt-recommendation')).toHaveTextContent(
      T['enforcement.sandbox_required'],
    );
    expect(within(receipt).getByTestId('receipt-applied')).toHaveTextContent(
      T['ai.receipt.applied.forwarded'],
    );
    // The copy states the precondition was DECLARED and not verified — never that one was made.
    const text = receipt.textContent ?? '';
    expect(text).toMatch(/precondição declarada, não verificada/i);
    expect(text.toLowerCase()).not.toMatch(/sandbox criad|sandbox provisionad/);
  });

  it.each(['observe', 'warn', 'enforce'])(
    'renders decision=%s + applied=forwarded as forwarded',
    async (decision) => {
      const { user } = renderConsole([
        streamHandler(PATHS.openaiResponsesGoverned, {
          chunks: responsesScript('an answer'),
          headers: GOVERNED_HEADERS(decision, 'forwarded'),
        }),
      ]);
      await converse(user, { mode: 'governed' });
      await screen.findByText('an answer');
      const receipt = await openReceipt(user);
      expect(within(receipt).getByTestId('receipt-applied')).toHaveTextContent(
        T['ai.receipt.applied.forwarded'],
      );
      expect(within(receipt).getByTestId('receipt-recommendation').textContent ?? '').toMatch(
        /encaminhad/i,
      );
    },
  );

  it('★ ONLY applied=blocked renders as a block', async () => {
    const { user } = renderConsole([
      errorHandler(PATHS.openaiResponsesGoverned, {
        status: 403,
        body: {
          error: 'governed_blocked',
          reason: 'enforcement_blocked:D',
          block_trigger: 'governance_enforcement',
        },
        headers: GOVERNED_HEADERS('blocked', 'blocked'),
      }),
    ]);
    await converse(user, { mode: 'governed' });
    await screen.findByTestId('attempt-state-badge');
    const receipt = await openReceipt(user);

    expect(within(receipt).getByTestId('receipt-applied')).toHaveTextContent(
      T['ai.receipt.applied.blocked'],
    );
    expect(within(receipt).getByTestId('receipt-recommendation')).toHaveTextContent(
      T['enforcement.blocked.matrix'],
    );
    expect(within(receipt).getByTestId('receipt-state')).toHaveTextContent(T['ai.state.blocked']);
  });

  it('names the tool-validation trigger when that is what applied the block', async () => {
    const { user } = renderConsole([
      errorHandler(PATHS.openaiResponsesGoverned, {
        status: 403,
        body: { error: 'governed_blocked', reason: 'tool_blocked', block_trigger: 'tool_validation' },
        // Note the decision is `observe` and the APPLIED result is `blocked` — the exact
        // combination the F2 HTTP contract exposes for a tool-floor block.
        headers: GOVERNED_HEADERS('observe', 'blocked'),
      }),
    ]);
    await converse(user, { mode: 'governed' });
    await screen.findByTestId('attempt-state-badge');
    const receipt = await openReceipt(user);
    expect(within(receipt).getByTestId('receipt-recommendation')).toHaveTextContent(
      T['enforcement.blocked.toolValidation'],
    );
    expect(within(receipt).getByTestId('receipt-applied')).toHaveTextContent(
      T['ai.receipt.applied.blocked'],
    );
  });

  it('shows an unrecognised decision as unrecognised, with its raw value', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesGoverned, {
        chunks: responsesScript('an answer'),
        headers: GOVERNED_HEADERS('quarantine_required', 'forwarded'),
      }),
    ]);
    await converse(user, { mode: 'governed' });
    await screen.findByText('an answer');
    const receipt = await openReceipt(user);
    const recommendation = within(receipt).getByTestId('receipt-recommendation');
    expect(recommendation).toHaveTextContent(T['status.unknown']);
    // The raw value stays visible so a backend change is legible rather than silent.
    expect(recommendation).toHaveTextContent('quarantine_required');
  });
});

describe('★ the Native/Audited surface invents no governance', () => {
  it('states that the surface exposes no per-request decision', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('an answer') }),
    ]);
    await converse(user);
    await screen.findByText('an answer');
    const receipt = await openReceipt(user);

    expect(within(receipt).getByTestId('receipt-no-governance')).toHaveTextContent(
      T['ai.receipt.governance.nativeSurface'],
    );
    // Not a decision, not a risk class, not an applied value — none was returned.
    expect(within(receipt).queryByTestId('receipt-recommendation')).toBeNull();
    expect(within(receipt).queryByTestId('receipt-applied')).toBeNull();
    expect(receipt.textContent ?? '').not.toContain('effective_risk_class');
  });

  it('still names the mode the reader selected', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('an answer') }),
    ]);
    await converse(user);
    await screen.findByText('an answer');
    const receipt = await openReceipt(user);
    expect(receipt).toHaveTextContent(T['ai.mode.native']);
    expect(receipt).toHaveTextContent('/passthrough/openai/v1/responses');
  });
});

describe('★ evidence is never overclaimed', () => {
  it('says exact turn-to-audit correlation is not exposed, and links only to the screens', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('an answer') }),
    ]);
    await converse(user);
    await screen.findByText('an answer');
    const receipt = await openReceipt(user);

    expect(within(receipt).getByTestId('receipt-correlation-caveat')).toHaveTextContent(
      T['ai.receipt.correlationCaveat'],
    );
    // Generic navigation, not a link to one record.
    const links = within(receipt).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href')).sort()).toEqual(['/', '/audit-events']);
  });

  it('never claims evidence was captured, sealed, verified or certified — in any language', async () => {
    for (const [locale, catalog] of [
      ['pt-BR', T],
      ['en-US', EN],
      ['es', ES],
    ] as const) {
      const forbidden =
        locale === 'en-US'
          ? [/evidence captured/i, /\bsealed\b/i, /\bverified\b/i, /\bcertified\b/i, /\bproof\b/i]
          : [/evidência capturad|evidencia capturad/i, /selad/i, /verificad[ao]\b/i, /certificad/i, /\bprova\b/i];
      for (const key of Object.keys(catalog).filter((k) => k.startsWith('ai.receipt.'))) {
        const text = catalog[key as keyof typeof catalog];
        for (const pattern of forbidden) {
          expect(pattern.test(text), `${locale} ${key}: "${text}"`).toBe(false);
        }
      }
    }
  });

  it('carries no field that could be read as an audit event id', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, {
        chunks: responsesScript('an answer'),
        headers: { 'openai-request-id': 'req_abc123' },
      }),
    ]);
    await converse(user);
    await screen.findByText('an answer');
    const receipt = await openReceipt(user);
    const text = receipt.textContent ?? '';
    expect(text).not.toMatch(/audit_event_id|capture_id|evidence_id/i);
    // The provider's own request id IS shown, because the provider sent it in a header.
    expect(text).toContain('req_abc123');
  });
});

describe('the facts the browser can actually prove', () => {
  it('shows the provider request id when one was returned', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.anthropicMessagesNative, {
        chunks: messagesScript('an answer'),
        headers: { 'request-id': 'req_real_anthropic' },
      }),
    ]);
    await converse(user, { provider: 'anthropic' });
    await screen.findByText('an answer');
    const receipt = await openReceipt(user);
    expect(receipt).toHaveTextContent('req_real_anthropic');
  });

  it('says "not exposed in this response" rather than showing an empty id', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('an answer') }),
    ]);
    await converse(user);
    await screen.findByText('an answer');
    const receipt = await openReceipt(user);
    expect(within(receipt).getByTestId('receipt-request-id-absent')).toHaveTextContent(
      T['ai.receipt.notExposed'],
    );
  });

  it('labels the duration as client-observed, never as provider or backend latency', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('an answer') }),
    ]);
    await converse(user);
    await screen.findByText('an answer');
    const receipt = await openReceipt(user);
    expect(receipt).toHaveTextContent(T['ai.receipt.duration']);
    await waitFor(() =>
      expect(within(receipt).getByTestId('receipt-duration').textContent ?? '').toMatch(/\d+ ms/),
    );
    const text = (receipt.textContent ?? '').toLowerCase();
    expect(text).not.toMatch(/latência do provedor|latência do backend|latência do govai/);
  });

  it('records the HTTP status, or says no response was received', async () => {
    const { user } = renderConsole([
      errorHandler(PATHS.openaiResponsesNative, { status: 500, body: { error: {} } }),
    ]);
    await converse(user);
    await screen.findByTestId('attempt-state-badge');
    const receipt = await openReceipt(user);
    expect(receipt).toHaveTextContent('HTTP 500');
  });
});
