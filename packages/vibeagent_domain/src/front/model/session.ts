import { VIBE_PROGRESS_ACTIONS } from "../../common/index.js";

export type TurnPhase = "idle" | "running" | "done" | "failed";

export interface ToolRun {
  toolCallKey: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  done: boolean;
}

export interface TurnView {
  turnKey: string;
  prompt: string;
  phase: TurnPhase;
  reasoning: string[];
  messages: string[];
  tools: ToolRun[];
  answer: string;
  error: string;
}

export interface VibeSnapshot {
  connection: "online" | "offline" | "connecting";
  sessionKey: string;
  userEmail: string;
  turns: TurnView[];
}

type Listener = () => void;

/**
 * Folds the durable event stream into what the screen shows.
 *
 * Every field comes from a replayable event, so a reconnect that replays the
 * session from its cursor rebuilds the identical view — the model holds no
 * state the server has not already recorded.
 */
export class VibeSessionModel {
  private snapshot: VibeSnapshot = { connection: "connecting", sessionKey: "", userEmail: "", turns: [] };
  private readonly listeners = new Set<Listener>();
  private readonly seenEventIds = new Set<string>();

  getSnapshot(): VibeSnapshot { return this.snapshot; }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private commit(next: Partial<VibeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    this.listeners.forEach((listener) => listener());
  }

  setConnection(connection: VibeSnapshot["connection"]): void { this.commit({ connection }); }
  setIdentity(sessionKey: string, userEmail: string): void { this.commit({ sessionKey, userEmail }); }

  startTurn(turnKey: string, prompt: string): void {
    const turns = [...this.snapshot.turns, { turnKey, prompt, phase: "running" as TurnPhase, reasoning: [], messages: [], tools: [], answer: "", error: "" }];
    this.commit({ turns });
  }

  private patchTurn(turnKey: string, patch: (turn: TurnView) => TurnView): void {
    let found = false;
    const turns = this.snapshot.turns.map((turn) => {
      if (turn.turnKey !== turnKey) return turn;
      found = true;
      return patch(turn);
    });
    if (found) this.commit({ turns });
  }

  /**
   * Delivery is at-least-once, so the same event can arrive twice. `eventId`
   * dedupe is the client's half of that contract — without it a retried
   * delivery would double every stdout chunk on screen.
   */
  applyEvent(eventId: string, action: string, payload: Record<string, unknown>): void {
    if (this.seenEventIds.has(eventId)) return;
    this.seenEventIds.add(eventId);

    const turnKey = typeof payload.turnKey === "string" ? payload.turnKey : "";
    if (!turnKey) return;
    const text = (key: string): string => (typeof payload[key] === "string" ? payload[key] as string : "");
    const toolKey = text("toolCallKey");

    const upsertTool = (turn: TurnView, mutate: (tool: ToolRun) => ToolRun): TurnView => {
      const existing = turn.tools.find((tool) => tool.toolCallKey === toolKey);
      const base: ToolRun = existing ?? { toolCallKey: toolKey, command: "", stdout: "", stderr: "", exitCode: null, timedOut: false, durationMs: 0, done: false };
      const nextTool = mutate(base);
      const tools = existing ? turn.tools.map((tool) => (tool.toolCallKey === toolKey ? nextTool : tool)) : [...turn.tools, nextTool];
      return { ...turn, tools };
    };

    switch (action) {
      case VIBE_PROGRESS_ACTIONS.iterationReasoning:
        this.patchTurn(turnKey, (turn) => ({ ...turn, reasoning: [...turn.reasoning, text("reasoning")] }));
        return;
      case VIBE_PROGRESS_ACTIONS.iterationMessage:
        this.patchTurn(turnKey, (turn) => ({ ...turn, messages: [...turn.messages, text("message")] }));
        return;
      case VIBE_PROGRESS_ACTIONS.toolStarted:
        this.patchTurn(turnKey, (turn) => upsertTool(turn, (tool) => ({ ...tool, command: text("command") })));
        return;
      case VIBE_PROGRESS_ACTIONS.toolStdout:
        this.patchTurn(turnKey, (turn) => upsertTool(turn, (tool) => ({ ...tool, stdout: tool.stdout + text("chunk") })));
        return;
      case VIBE_PROGRESS_ACTIONS.toolStderr:
        this.patchTurn(turnKey, (turn) => upsertTool(turn, (tool) => ({ ...tool, stderr: tool.stderr + text("chunk") })));
        return;
      case VIBE_PROGRESS_ACTIONS.toolCompleted:
        this.patchTurn(turnKey, (turn) => upsertTool(turn, (tool) => ({
          ...tool, done: true,
          exitCode: typeof payload.exitCode === "number" ? payload.exitCode : null,
          timedOut: payload.timedOut === true,
          durationMs: typeof payload.durationMs === "number" ? payload.durationMs : 0,
        })));
        return;
      case VIBE_PROGRESS_ACTIONS.turnFinal:
        this.patchTurn(turnKey, (turn) => ({ ...turn, answer: text("answer") }));
        return;
      default:
        return;
    }
  }

  /** The broker's terminal result closes the turn; progress alone never does. */
  applyTerminal(turnKey: string, ok: boolean, value: unknown, error: string): void {
    this.patchTurn(turnKey, (turn) => ({
      ...turn,
      phase: ok ? "done" : "failed",
      error: ok ? "" : error,
      answer: turn.answer || (ok && value && typeof value === "object" && typeof (value as { answer?: unknown }).answer === "string" ? (value as { answer: string }).answer : turn.answer),
    }));
  }
}
