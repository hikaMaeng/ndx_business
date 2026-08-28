import { textOf, type TextBlock, type ToolBlock } from "vibeagent_domain/front";
import { Markdown } from "../markdown/Markdown.js";

/**
 * A bash call the model asked for.
 *
 * The request and its output are labelled separately on purpose: "the model
 * wanted to run this" and "this is what the machine said back" are different
 * claims, and reading a transcript where they look alike is how people come
 * away believing the agent verified something it only proposed.
 *
 * Output stays preformatted text, never markdown. It is the bytes a command
 * emitted, not a document, and running `ls` through a markdown renderer
 * destroys the alignment that made it readable.
 */
export function ToolCall({ tool, live }: { tool: ToolBlock; live: boolean }): React.JSX.Element {
  const status = tool.done ? (tool.timedOut ? "timeout" : tool.exitCode === 0 ? "ok" : "fail") : "running";
  const body = [textOf(tool.stdout), textOf(tool.stderr)].filter((part) => part.trim()).join("\n");

  return (
    <section className="block tool" data-testid="tool-run" data-status={status}>
      <header className="block-head">
        <span className="block-kind kind-tool" data-testid="block-kind">도구 호출</span>
        <span className={`tool-badge ${status}`} data-testid="tool-status">{status}</span>
        {tool.done
          ? <span className="tool-meta">exit {tool.exitCode ?? "—"} · {tool.durationMs}ms</span>
          : <span className="tool-meta">{live ? "실행 중…" : "…"}</span>}
      </header>
      <code className="tool-command" data-testid="tool-command">{tool.command}</code>
      {body ? (
        <>
          <div className="block-sub"><span className="block-kind kind-output">출력</span></div>
          <pre className="tool-output" data-testid="tool-output">{body.slice(-4000)}</pre>
        </>
      ) : null}
      {tool.failure ? <p className="tool-failure" data-testid="tool-failure">호출 실패: {tool.failure}</p> : null}
    </section>
  );
}

/**
 * Reasoning is the model talking to itself; a message is it talking to you.
 * Both stream, so both are shown as they arrive — but never as the same thing.
 */
export function TextSection({ block, live }: { block: TextBlock; live: boolean }): React.JSX.Element | null {
  const text = textOf(block.slices);
  if (!text.trim()) return null;

  const streaming = live ? <span className="block-live" data-testid="block-live">스트리밍</span> : null;

  if (block.kind === "message") {
    return (
      <section className="block message" data-testid="block-message">
        <header className="block-head">
          <span className="block-kind kind-message" data-testid="block-kind">답변</span>{streaming}
        </header>
        <div className="assistant-note"><Markdown source={text} live={live} /></div>
      </section>
    );
  }

  // Open while it is still being written, folded away once it is finished:
  // reasoning is worth watching live and worth hiding afterwards.
  return (
    <section className="block reasoning" data-testid="block-reasoning">
      <details data-testid="reasoning" open={live}>
        <summary>
          <span className="block-kind kind-reasoning" data-testid="block-kind">추론</span>
          <span className="block-note">iteration {block.iterationIndex}</span>
          {streaming}
        </summary>
        <div className="reasoning-body"><Markdown source={text} live={live} /></div>
      </details>
    </section>
  );
}
