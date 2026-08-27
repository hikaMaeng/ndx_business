import { litCode } from "./code.js";
import { drawnDiagram } from "./diagrams.js";

/**
 * Fills in the parts that could not be strings.
 *
 * Two things reach the screen after the HTML does: a diagram mermaid drew, and
 * a block of code highlight.js coloured. Both are markup produced by a library
 * rather than prose written by the model, and neither should be pushed through
 * the sanitizer that guards the prose — that sanitizer forbids `svg` and
 * strips the class names highlighting depends on, and widening it for these
 * two cases would widen it for the model's text as well.
 *
 * So they are put in here, against the real document, into slots the renderer
 * left empty. Run this immediately after assigning the HTML: everything already
 * cached appears in the same frame, so a re-render never flickers a diagram
 * that was on screen a moment ago.
 */
/** The hook the renderer left in the class list, since attributes do not survive. */
function keyOf(element: Element): string {
  for (const name of element.classList) if (name.startsWith("md-key-")) return name.slice(7);
  return "";
}

/**
 * Makes the frame match the drawing.
 *
 * Mermaid computes its `viewBox` from what it expects the labels to measure,
 * and with labels drawn as SVG text rather than HTML those two disagree —
 * enough that node boxes get their right edge cut off and the last row is
 * clipped away. The drawing is not wrong; the window onto it is.
 *
 * Here the diagram is in the document for the first time, so it can be
 * measured instead of predicted: `getBBox` reports what was actually painted,
 * and the frame is rebuilt around it. This is also why it cannot be done where
 * the SVG is produced — at that point it belongs to no document and has no
 * geometry to ask about.
 */
function fitToContent(svg: SVGSVGElement): void {
  try {
    const box = svg.getBBox();
    if (!Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width <= 0 || box.height <= 0) return;
    const pad = 8;
    const width = box.width + pad * 2;
    svg.setAttribute("viewBox", `${box.x - pad} ${box.y - pad} ${width} ${box.height + pad * 2}`);
    // Its natural size, not the column's. A diagram too wide to fit scrolls
    // inside its own box rather than shrinking to the point of being unreadable.
    svg.setAttribute("width", "100%");
    svg.removeAttribute("height");
    svg.style.maxWidth = `${width}px`;
  } catch {
    // A diagram that cannot be measured is left exactly as mermaid drew it.
  }
}

export function hydrateMarkdown(root: ParentNode): void {
  for (const slot of root.querySelectorAll<HTMLElement>(".md-diagram")) {
    if (slot.firstChild) continue;
    const svg = drawnDiagram(keyOf(slot));
    // Still being drawn. The slot stays empty and this runs again on the
    // re-render that finishing one triggers.
    if (!svg) continue;
    slot.innerHTML = svg;
    const drawing = slot.querySelector("svg");
    if (drawing) fitToContent(drawing);
  }

  for (const block of root.querySelectorAll<HTMLElement>("code.md-lit")) {
    const html = litCode(keyOf(block));
    if (html) block.innerHTML = html;
  }
}
