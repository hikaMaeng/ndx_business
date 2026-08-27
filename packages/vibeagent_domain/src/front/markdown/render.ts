import { Marked, type Tokens } from "marked";
import { codeKey, litCode, requestHighlight } from "./code.js";
import { diagramFailure, diagramKey, drawnDiagram, requestDiagram } from "./diagrams.js";
import { contentKey, sanitizeMarkup } from "./sanitize.js";

export interface MarkdownOptions {
  /**
   * The text is still arriving.
   *
   * A half-typed fence is not a diagram and a half-typed function is not code
   * worth colouring, so both are left alone until the block is finished. This
   * also stops a torn fence from being cached as a failure that then never
   * gets another chance.
   */
  live?: boolean;
  /** Called when an async diagram or highlight finished and there is more to show. */
  whenReady?: () => void;
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Rendered markdown, keyed by the text that produced it.
 *
 * The screen is rebuilt from scratch on every streamed delta — over a thousand
 * times in a long turn — and re-parsing every finished block each time is work
 * whose answer cannot have changed. Only the one block still being written
 * misses this cache.
 */
const parsed = new Map<string, string>();
const PARSE_LIMIT = 600;

function remember(key: string, html: string): string {
  if (parsed.size >= PARSE_LIMIT) {
    // Insertion-ordered, so the oldest key is the first one. Old blocks are the
    // ones scrolled far out of view; the live block is always the newest.
    const oldest = parsed.keys().next().value;
    if (oldest !== undefined) parsed.delete(oldest);
  }
  parsed.set(key, html);
  return html;
}

/**
 * Set while a parse emitted something that is not finished yet — an empty
 * diagram slot, or code still waiting to be coloured.
 *
 * Such a parse must not be cached. Its HTML is correct only for this instant,
 * and caching it would freeze the transcript in the state where the picture
 * never arrives: the slot would be handed back on every later render and the
 * finished diagram, already drawn and sitting in its own cache, would have
 * nowhere to go.
 */
let unresolved = false;

function buildRenderer(options: MarkdownOptions): Marked {
  const live = options.live === true;
  const whenReady = options.whenReady ?? (() => {});
  const marked = new Marked({ gfm: true, breaks: true });

  marked.use({
    renderer: {
      /**
       * A fence is one of three things and they are not interchangeable: a
       * diagram to draw, code to colour, or text nobody claimed. The slot a
       * diagram leaves behind is filled after the HTML is in the document,
       * because mermaid answers long after this function has returned.
       */
      code({ text, lang }: Tokens.Code): string {
        const language = (lang ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";

        if (language === "mermaid") {
          if (live) return `<pre class="md-code"><span class="md-code-lang">mermaid</span><code>${escapeHtml(text)}</code></pre>`;
          const key = diagramKey(text);
          const failure = diagramFailure(key);
          if (failure) {
            return `<div class="md-diagram-failed"><p>다이어그램을 그리지 못했습니다: ${escapeHtml(failure)}</p>
              <pre class="md-code"><span class="md-code-lang">mermaid</span><code>${escapeHtml(text)}</code></pre></div>`;
          }
          if (!drawnDiagram(key)) { requestDiagram(text, whenReady); unresolved = true; }
          // Empty on purpose. The SVG is put here by `hydrate`, which runs
          // against the live document; returning it as a string would mean
          // sending unparsed SVG through a sanitizer tuned for prose.
          return `<div class="md-diagram md-key-${key}"></div>`;
        }

        if (language && !live) {
          const key = codeKey(language, text);
          const already = litCode(key);
          if (!already) { requestHighlight(language, text, whenReady); unresolved = true; }
          // The lit HTML is highlight.js's own span markup; it goes in as a
          // slot for the same reason the diagram does — the prose sanitizer
          // would have to be widened to let it through, and it should not be.
          if (already) return `<pre class="md-code"><span class="md-code-lang">${escapeHtml(language)}</span><code class="md-lit md-key-${key}">${escapeHtml(text)}</code></pre>`;
        }

        return `<pre class="md-code">${language ? `<span class="md-code-lang">${escapeHtml(language)}</span>` : ""}<code>${escapeHtml(text)}</code></pre>`;
      },

      /**
       * Every link leaves this page. The transcript is full of URLs the model
       * produced, so they open in a new tab and carry no referrer and no
       * `window.opener` back to a session that holds a token.
       */
      link({ href, title, tokens }: Tokens.Link): string {
        const text = this.parser.parseInline(tokens);
        return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ""} target="_blank" rel="noopener noreferrer nofollow">${text}</a>`;
      },
    },
  });

  return marked;
}

/**
 * Markdown to HTML that is safe to assign.
 *
 * Parse, then sanitize — in that order and never the reverse. Sanitizing the
 * source first would mangle the markdown; sanitizing the output is the only
 * point at which the raw HTML that markdown deliberately passes through can be
 * caught.
 */
export function renderMarkdown(source: string, options: MarkdownOptions = {}): string {
  const text = source ?? "";
  if (!text.trim()) return "";
  const key = `${options.live ? "L" : "F"}:${contentKey(text)}`;
  const cached = parsed.get(key);
  if (cached !== undefined) return cached;

  try {
    unresolved = false;
    const html = sanitizeMarkup(buildRenderer(options).parse(text, { async: false }));
    // Live text is never cached either: the next delta changes it anyway, and
    // its key would just be another entry pushing finished blocks out.
    return unresolved || options.live ? html : remember(key, html);
  } catch {
    // Markdown that cannot be parsed is still text somebody needs to read.
    return remember(key, `<p>${escapeHtml(text)}</p>`);
  }
}
