import DOMPurify, { type Config } from "dompurify";

/**
 * Everything rendered here is hostile until proven otherwise.
 *
 * The text comes from a language model, and the model's text routinely contains
 * whatever it just read off disk. `cat README.md` on a repository nobody
 * audited is a perfectly ordinary thing for this agent to do, and its output
 * lands in a transcript that used to be escaped and is now parsed as markdown —
 * which passes raw HTML through by design. So an `<img onerror>` in a file the
 * agent happened to read would otherwise become script running in the operator's
 * session, holding the operator's token.
 *
 * Hence an allowlist rather than a blocklist: this names what may survive, and
 * anything not named dies whether or not we thought of it.
 */
const MARKDOWN_POLICY: Config = {
  ALLOWED_TAGS: [
    "p", "br", "hr", "span", "div",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "em", "del", "code", "pre", "blockquote",
    "ul", "ol", "li",
    "table", "thead", "tbody", "tr", "th", "td",
    "a", "img",
    "details", "summary", "sup", "sub",
  ],
  // No `data-*`, and no custom attribute either. `ALLOW_DATA_ATTR: false` is
  // worth keeping — it stops a model that just read a hostile file from
  // emitting a `data-testid` of its own choosing into a screen whose browser
  // tests select by exactly that attribute — and DOMPurify drops unknown
  // attribute names regardless of this list. Anything the renderer needs to
  // find its own markup by therefore travels in `class`, which survives.
  ALLOWED_ATTR: ["href", "title", "alt", "src", "class", "colspan", "rowspan", "start", "open"],
  // No `javascript:`, no `vbscript:`, and no `data:` payloads pretending to be
  // images. Remote images are allowed to load but can do nothing else.
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/|\.\/|\.\.\/)/i,
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "svg", "math"],
  ALLOW_DATA_ATTR: false,
};

/**
 * Diagram output is ours, not the model's — mermaid drew it. It still goes
 * through a sanitizer, because "we generated it" is a claim about the generator
 * and the generator's input came from the model. Mermaid has had its own
 * escaping bugs; this is the layer that makes those bugs boring.
 */
const DIAGRAM_POLICY: Config = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ["script", "foreignObject", "a"],
  ALLOW_DATA_ATTR: false,
};

export function sanitizeMarkup(html: string): string {
  return DOMPurify.sanitize(html, MARKDOWN_POLICY) as unknown as string;
}

export function sanitizeDiagram(svg: string): string {
  return DOMPurify.sanitize(svg, DIAGRAM_POLICY) as unknown as string;
}

/**
 * A stable name for a piece of text.
 *
 * Diagrams and highlighted code are cached by what they contain rather than by
 * where they sit, because the screen is rebuilt from scratch on every streamed
 * delta — a block has no identity that outlives one render, but its text does.
 * FNV-1a is enough: this is a cache key, not a signature, and a collision costs
 * one wrong diagram rather than anything a person could aim.
 */
export function contentKey(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16)}-${text.length.toString(36)}`;
}
