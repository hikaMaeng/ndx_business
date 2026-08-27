/**
 * Markdown for a transcript that is still being written.
 *
 * Three things make this different from rendering a document: the text arrives
 * a few characters at a time, the screen is rebuilt from scratch on every one
 * of those arrivals, and the text is written by a model that reads untrusted
 * files. So everything here is cached by content rather than by position,
 * anything slow is asynchronous and collected on a later render, and the output
 * is sanitized on the way out.
 */
export { renderMarkdown, type MarkdownOptions } from "./render.js";
export { hydrateMarkdown } from "./hydrate.js";
export { sanitizeMarkup, contentKey } from "./sanitize.js";
