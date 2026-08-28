import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { VibeClient, TurnModel } from "vibeagent_domain/front";
import { useModel } from "../model/useModel.js";
import { Turn } from "./Turn.js";

/** How close to the bottom still counts as being at the bottom. */
const STICK_MARGIN_PX = 80;

/**
 * Is this turn showing its working?
 *
 * A running turn always is — it is the thing being watched. So is the newest,
 * because that is the one just answered. Everything older is folded unless it
 * was opened by hand.
 *
 * The answer is never folded away, only the process behind it. What a reader
 * scrolling back wants is what the agent concluded; how it got there is
 * available on request.
 */
const isShowing = (turn: TurnModel, index: number, total: number, opened: ReadonlySet<string>): boolean =>
  turn.phase === "running" || index === total - 1 || opened.has(turn.turnKey);

/**
 * The turn list, and the scrolling that follows it.
 *
 * It subscribes to `turns` — the list — and not to any turn's contents. A
 * streaming token changes a `TurnModel`, which this component does not read, so
 * it is not re-rendered by one; only the `Turn` showing that model is.
 */
export function Transcript({ client, pinnedAt }: { client: VibeClient; pinnedAt: number }): React.JSX.Element {
  const turns = useModel(client.model.turns).value;
  const sessionError = useModel(client.model.sessionError).value;
  const loading = useModel(client.loadingHistory).value;
  const sessionId = useModel(client.sessionId).value;

  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Opening another session starts a different conversation; carrying the
  // previous one's expanded rows into it would be meaningless.
  useEffect(() => { setOpened(new Set()); }, [sessionId]);

  /**
   * Memory follows the screen, in both directions.
   *
   * Folding a turn hides it; dropping its bodies is what makes folding worth
   * anything. And a reopened session arrives as summaries with no bodies at
   * all, so whatever is showing has to ask for its own content. One rule
   * covers both: what is showing is loaded, what is not is released.
   */
  useEffect(() => {
    turns.forEach((turn, index) => {
      if (isShowing(turn, index, turns.length, opened)) {
        if (!turn.bodiesLoaded) void client.expandTurn(turn.turnKey);
      } else {
        client.collapseTurn(turn.turnKey);
      }
    });
  });

  /**
   * Following the stream means the bottom; reading something further up means
   * exactly where you were. Measured before the browser paints, so the answer
   * is about the layout the reader last saw.
   */
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (stick.current) el.scrollTop = el.scrollHeight;
  });

  // Sending a prompt and opening a session are requests to see the newest
  // thing, whatever the scroll said a moment ago.
  useLayoutEffect(() => { stick.current = true; }, [pinnedAt, sessionId]);

  const onScroll = (): void => {
    const el = box.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_MARGIN_PX;
  };

  const toggle = (turnKey: string): void => setOpened((current) => {
    const next = new Set(current);
    if (next.has(turnKey)) next.delete(turnKey); else next.add(turnKey);
    return next;
  });

  return (
    <div className="transcript" data-testid="transcript" ref={box} onScroll={onScroll}>
      {sessionError ? <p className="notice" role="status" data-testid="session-error">{sessionError}</p> : null}
      {loading ? <p className="loading" data-testid="loading-history">기록을 불러오는 중…</p> : null}

      {!turns.length && !loading ? (
        <div className="empty-state">
          <span className="empty-orbit">◎</span>
          <h3>{sessionId ? "무엇을 만들까요?" : "프로젝트를 고르세요"}</h3>
          <p>{sessionId ? "에이전트는 bash 하나만으로 작업합니다." : "왼쪽에서 프로젝트를 추가하고 그 안에 세션을 만드세요."}</p>
        </div>
      ) : turns.map((turn, index) => (
        <Turn
          key={turn.turnKey}
          turn={turn}
          showing={isShowing(turn, index, turns.length, opened)}
          foldable={turn.phase !== "running" && index !== turns.length - 1}
          onToggle={toggle}
        />
      ))}
    </div>
  );
}
