import type { EventEnvelope } from "agent/common";
import { VIBE_ACTIONS, parseVibeProgressEvent, type VibeProgressEvent, type VibeTurnOutcome } from "../../common/index.js";

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
  sessionId: string;
  userEmail: string;
  turns: TurnView[];
}

type Listener = () => void;

/**
 * Folds the vibe coding event stream into what a screen shows.
 *
 * This is domain work, not transport: the broker hands over envelopes and has
 * no opinion about turns, tools or answers. Every field here comes from an
 * event defined in `common/protocol/vibe`, the same file the worker emits
 * against, so the two cannot drift without a compile error.
 */
export class VibeSessionModel {
  private snapshot: VibeSnapshot = { sessionId: "", userEmail: "", turns: [] };
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

  setIdentity(sessionId: string, userEmail: string): void { this.commit({ sessionId, userEmail }); }
  reset(): void { this.seenEventIds.clear(); this.commit({ sessionId: "", userEmail: "", turns: [] }); }

  startTurn(turnKey: string, prompt: string): void {
    this.commit({ turns: [...this.snapshot.turns, { turnKey, prompt, phase: "running", reasoning: [], messages: [], tools: [], answer: "", error: "" }] });
  }

  private patchTurn(turnKey: string, patch: (turn: TurnView) => TurnView): void {
    let found = false;
    const turns = this.snapshot.turns.map((turn) => { if (turn.turnKey !== turnKey) return turn; found = true; return patch(turn); });
    if (found) this.commit({ turns });
  }

  private upsertTool(turn: TurnView, toolCallKey: string, mutate: (tool: ToolRun) => ToolRun): TurnView {
    const existing = turn.tools.find((tool) => tool.toolCallKey === toolCallKey);
    const next = mutate(existing ?? { toolCallKey, command: "", stdout: "", stderr: "", exitCode: null, timedOut: false, durationMs: 0, done: false });
    return { ...turn, tools: existing ? turn.tools.map((tool) => (tool.toolCallKey === toolCallKey ? next : tool)) : [...turn.tools, next] };
  }

  /**
   * Applies one envelope.
   *
   * Delivery is at-least-once, so the same event can arrive twice; `eventId`
   * dedupe is the client's half of that contract. Without it a retried delivery
   * would double every stdout chunk on screen.
   */
  apply(envelope: EventEnvelope): void {
    if (this.seenEventIds.has(envelope.eventId)) return;
    this.seenEventIds.add(envelope.eventId);

    if (envelope.kind === "result" || envelope.kind === "failure") { this.applyTerminal(envelope); return; }
    const event = parseVibeProgressEvent(envelope.action, envelope.payload);
    if (event) this.applyProgress(event);
  }

  private applyProgress(event: VibeProgressEvent): void {
    switch (event.action) {
      case VIBE_ACTIONS.iterationReasoning:
        return this.patchTurn(event.turnKey, (turn) => ({ ...turn, reasoning: [...turn.reasoning, event.reasoning] }));
      case VIBE_ACTIONS.iterationMessage:
        return this.patchTurn(event.turnKey, (turn) => ({ ...turn, messages: [...turn.messages, event.message] }));
      case VIBE_ACTIONS.toolStarted:
        return this.patchTurn(event.turnKey, (turn) => this.upsertTool(turn, event.toolCallKey, (tool) => ({ ...tool, command: event.command })));
      case VIBE_ACTIONS.toolStdout:
        return this.patchTurn(event.turnKey, (turn) => this.upsertTool(turn, event.toolCallKey, (tool) => ({ ...tool, stdout: tool.stdout + event.chunk })));
      case VIBE_ACTIONS.toolStderr:
        return this.patchTurn(event.turnKey, (turn) => this.upsertTool(turn, event.toolCallKey, (tool) => ({ ...tool, stderr: tool.stderr + event.chunk })));
      case VIBE_ACTIONS.toolCompleted:
        return this.patchTurn(event.turnKey, (turn) => this.upsertTool(turn, event.toolCallKey, (tool) => ({ ...tool, done: true, exitCode: event.exitCode, timedOut: event.timedOut, durationMs: event.durationMs })));
      case VIBE_ACTIONS.toolFailed:
        return this.patchTurn(event.turnKey, (turn) => this.upsertTool(turn, event.toolCallKey, (tool) => ({ ...tool, done: true, stderr: `${tool.stderr}${event.error}\n` })));
      case VIBE_ACTIONS.turnFinal:
        return this.patchTurn(event.turnKey, (turn) => ({ ...turn, answer: event.answer }));
      default:
        return;
    }
  }

  /** Only the broker's terminal result closes a turn; a final-answer progress event does not. */
  private applyTerminal(envelope: EventEnvelope): void {
    const payload = envelope.payload as { ok?: unknown; value?: unknown; error?: { message?: unknown } };
    const ok = payload.ok === true;
    const outcome = ok ? payload.value as VibeTurnOutcome | undefined : undefined;
    const error = typeof payload.error?.message === "string" ? payload.error.message : "";
    this.patchTurn(envelope.transactionKey, (turn) => ({
      ...turn,
      phase: ok ? "done" : "failed",
      error: ok ? "" : error,
      answer: turn.answer || outcome?.answer || "",
    }));
  }
}
