import { useEffect, useRef, useState } from "react";
import { hydrateMarkdown, renderMarkdown } from "vibeagent_domain/front";

/**
 * Prose the model wrote, as the model meant it to look.
 *
 * The renderer is deliberately not a React component tree. It returns a string,
 * because the expensive parts — parsing, sanitising, drawing a diagram,
 * colouring code — are cached by content, and a cache keyed by content only
 * works if the same text produces the same output wherever it sits in a tree.
 *
 * Two things reach the screen after the HTML does: a diagram mermaid drew, and
 * a block highlight.js coloured. Both are asynchronous, so the renderer leaves
 * empty slots and fills them against the real document once React has
 * committed. The effect runs on every commit rather than once, because a slot
 * still being drawn last time may be ready now.
 *
 * `whenReady` closes the loop: when one of those finishes there is no event to
 * repaint on, so this asks for one. Without it a diagram would sit blank until
 * something unrelated happened to re-render the turn.
 */
export function Markdown({ source, live = false }: { source: string; live?: boolean }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [, setReady] = useState(0);
  const pending = useRef(false);

  const html = renderMarkdown(source, {
    live,
    whenReady: () => {
      // May fire synchronously from inside the render above; deferring keeps
      // the state update out of the render phase, and collapses a burst of
      // finished diagrams into one repaint.
      if (pending.current) return;
      pending.current = true;
      queueMicrotask(() => { pending.current = false; setReady((version) => version + 1); });
    },
  });

  useEffect(() => {
    if (host.current) hydrateMarkdown(host.current);
  });

  return <div ref={host} className="markdown" data-testid="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
