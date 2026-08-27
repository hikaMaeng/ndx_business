import { contentKey, sanitizeDiagram } from "./sanitize.js";

/**
 * Mermaid, loaded only if a diagram actually appears.
 *
 * It is by far the largest thing this client can pull in — larger than every
 * other dependency combined — and most transcripts never contain a diagram. So
 * it is imported on first sight of one and never before, which keeps the cost
 * on the sessions that asked for it.
 */
type MermaidApi = { initialize(config: Record<string, unknown>): void; render(id: string, text: string): Promise<{ svg: string }> };

let loading: Promise<MermaidApi | null> | null = null;

/**
 * Monochrome, to match the rest of the screen.
 *
 * `securityLevel: "strict"` is mermaid's own escaping of the labels inside a
 * diagram — the labels being model text, which is the whole reason this file
 * treats its own output as untrusted afterwards.
 */
async function load(): Promise<MermaidApi | null> {
  loading ??= import("mermaid")
    .then((module) => {
      const api = (module.default ?? module) as unknown as MermaidApi;
      api.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        /**
         * Labels as SVG text, not as HTML in a `foreignObject`.
         *
         * Mermaid's default puts every node's label in a `foreignObject`, which
         * is a hole in an SVG that arbitrary HTML falls through — and the label
         * text is the model's. Turning it off means the sanitizer can keep
         * refusing `foreignObject` outright instead of having to be talked into
         * trusting what is inside one.
         */
        htmlLabels: false,
        flowchart: { htmlLabels: false, useMaxWidth: true },
        theme: "base",
        fontFamily: '"Segoe UI Variable", "Malgun Gothic", sans-serif',
        themeVariables: {
          background: "#141414", primaryColor: "#1c1c1c", primaryTextColor: "#ededed", primaryBorderColor: "#4d4d4d",
          secondaryColor: "#242424", secondaryTextColor: "#ededed", secondaryBorderColor: "#4d4d4d",
          tertiaryColor: "#0a0a0a", tertiaryTextColor: "#a3a3a3", tertiaryBorderColor: "#2e2e2e",
          lineColor: "#a3a3a3", textColor: "#ededed", mainBkg: "#1c1c1c", nodeBorder: "#4d4d4d",
          clusterBkg: "#141414", clusterBorder: "#2e2e2e", titleColor: "#ededed",
          edgeLabelBackground: "#141414", labelBoxBkgColor: "#1c1c1c", labelBoxBorderColor: "#4d4d4d",
          actorBkg: "#1c1c1c", actorBorder: "#4d4d4d", actorTextColor: "#ededed", actorLineColor: "#6b6b6b",
          signalColor: "#ededed", signalTextColor: "#ededed", loopTextColor: "#ededed",
          noteBkgColor: "#242424", noteTextColor: "#ededed", noteBorderColor: "#4d4d4d",
          sequenceNumberColor: "#0a0a0a",
        },
      });
      return api;
    })
    .catch(() => null);
  return loading;
}

/** Rendered diagrams, by their source. Survives the re-render every delta causes. */
const drawn = new Map<string, string>();
const failed = new Map<string, string>();
const pending = new Set<string>();

export function diagramKey(source: string): string {
  return contentKey(source.trim());
}

export function drawnDiagram(key: string): string | undefined {
  return drawn.get(key);
}

export function diagramFailure(key: string): string | undefined {
  return failed.get(key);
}

/**
 * Draw one diagram, once.
 *
 * `whenReady` is how the result gets on screen: this cannot put it there
 * itself, because by the time mermaid answers the DOM it was asked about has
 * been thrown away and rebuilt several times over. It stores the result and
 * says "there is more to show now"; the caller re-renders and finds it cached.
 */
export function requestDiagram(source: string, whenReady: () => void): void {
  const key = diagramKey(source);
  if (drawn.has(key) || failed.has(key) || pending.has(key)) return;
  pending.add(key);
  void (async () => {
    try {
      const api = await load();
      if (!api) throw new Error("다이어그램 렌더러를 불러오지 못했습니다.");
      const { svg } = await api.render(`vibe-diagram-${key}`, source.trim());
      drawn.set(key, sanitizeDiagram(svg));
    } catch (error) {
      // A malformed diagram is the model's mistake, not a crash. Keep the
      // reason and show the source as code — never a blank space where a
      // picture was promised.
      failed.set(key, error instanceof Error ? error.message : String(error));
    } finally {
      pending.delete(key);
      whenReady();
    }
  })();
}
