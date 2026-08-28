import { blocksOf, type TurnModel } from "vibeagent_domain/front";
import { useModel } from "../model/useModel.js";
import { Markdown } from "../markdown/Markdown.js";
import { TextSection, ToolCall } from "./blocks.js";

/**
 * One turn, subscribed to its own model and nothing else.
 *
 * This component is where the whole refactor pays off. It reads one
 * `TurnModel`, so a streamed token re-renders this turn and leaves every other
 * turn, the project list and the session list untouched. Previously one
 * emitter woke the document and the document was rebuilt.
 *
 * Folding is handled by the caller: a turn that is not showing gets no bodies
 * to draw, and the caller is also what drops them from memory. This component
 * only reports what it has.
 */
export function Turn({
  turn, showing, foldable, onToggle,
}: {
  turn: TurnModel;
  showing: boolean;
  foldable: boolean;
  onToggle: (turnKey: string) => void;
}): React.JSX.Element {
  useModel(turn);

  const running = turn.phase === "running";
  const blocks = showing ? blocksOf(turn) : [];
  const last = blocks[blocks.length - 1];
  const counts = [
    turn.iterations ? `이터레이션 ${turn.iterations}` : "",
    turn.toolCalls ? `도구 ${turn.toolCalls}` : "",
  ].filter(Boolean).join(" · ");

  return (
    <article className="turn" data-testid="turn" data-turn-key={turn.turnKey} data-phase={turn.phase} data-showing={showing}>
      <div className="bubble user"><Markdown source={turn.prompt} /></div>
      <div className="bubble agent">
        <span className={`phase-pill ${turn.phase}`} data-testid="turn-phase">{turn.phase}</span>

        {foldable && showing ? (
          <button className="turn-toggle" data-testid="turn-toggle" aria-expanded="true" onClick={() => onToggle(turn.turnKey)}>
            ▾ 과정 접기
          </button>
        ) : null}

        {showing && !turn.bodiesLoaded ? <p className="loading" data-testid="turn-loading">과정을 불러오는 중…</p> : null}

        {blocks.map((block) => (block.kind === "tool"
          ? <ToolCall key={`tool:${block.toolCallKey}`} tool={block} live={running && !block.done} />
          : <TextSection key={`${block.kind}:${block.iterationIndex}`} block={block} live={running && block === last} />))}

        {!showing ? (
          <div className="turn-folded">
            <button className="turn-toggle" data-testid="turn-toggle" aria-expanded="false" onClick={() => onToggle(turn.turnKey)}>
              ▸ 과정 펼치기
            </button>
            {counts ? <span className="turn-counts" data-testid="turn-counts">{counts}</span> : null}
          </div>
        ) : null}

        {turn.answer ? (
          <div className="answer" data-testid="turn-answer">
            <span className="block-kind kind-answer">최종 답변</span>
            <Markdown source={turn.answer} />
          </div>
        ) : null}

        {turn.error ? <div className="turn-error" data-testid="turn-error">{turn.error}</div> : null}
      </div>
    </article>
  );
}
