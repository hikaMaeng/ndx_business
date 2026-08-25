/**
 * Vibe coding wire contract. Both the worker that produces these events and the
 * web client that renders them import from here, so neither side can drift.
 *
 * The identity hierarchy is User → Session → Turn → Iteration. Session and Turn
 * map onto broker primitives (`streamId` and `transactionKey`); Iteration is an
 * ordinal inside one Turn and has no broker identity of its own.
 */

export const VIBE_TURN_ACTION = "vibe.turn.run" as const;

/** Emitted while a Turn runs. `.result` / `.conflict` are appended by the broker. */
export const VIBE_PROGRESS_ACTIONS = {
  turnStarted: "vibe.turn.started",
  iterationStarted: "vibe.iteration.started",
  iterationReasoning: "vibe.iteration.reasoning",
  iterationMessage: "vibe.iteration.message",
  toolStarted: "vibe.tool.started",
  toolStdout: "vibe.tool.stdout",
  toolStderr: "vibe.tool.stderr",
  toolCompleted: "vibe.tool.completed",
  toolFailed: "vibe.tool.failed",
  turnFinal: "vibe.turn.final",
} as const;

export type VibeProgressAction = (typeof VIBE_PROGRESS_ACTIONS)[keyof typeof VIBE_PROGRESS_ACTIONS];

/** The one command a client submits. `transactionKey` carries the turn id. */
export interface VibeTurnRequest {
  sessionKey: string;
  turnKey: string;
  userId: string;
  prompt: string;
}

export interface VibeToolCall {
  toolCallKey: string;
  command: string;
}

export interface VibeToolResult {
  toolCallKey: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface VibeTurnOutcome {
  sessionKey: string;
  turnKey: string;
  iterations: number;
  toolCalls: number;
  answer: string;
  stoppedBy: "final" | "iteration_budget" | "error";
}

export function isVibeProgressAction(action: string): action is VibeProgressAction {
  return (Object.values(VIBE_PROGRESS_ACTIONS) as string[]).includes(action);
}

/** Rejects anything the worker would have to guess at. */
export function parseVibeTurnRequest(value: unknown): VibeTurnRequest | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const text = (key: string): string | null => (typeof input[key] === "string" && (input[key] as string).length > 0 ? (input[key] as string) : null);
  const sessionKey = text("sessionKey");
  const turnKey = text("turnKey");
  const userId = text("userId");
  const prompt = text("prompt");
  if (!sessionKey || !turnKey || !userId || !prompt) return null;
  return { sessionKey, turnKey, userId, prompt };
}
