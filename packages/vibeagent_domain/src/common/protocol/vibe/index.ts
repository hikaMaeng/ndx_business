/**
 * The vibe coding wire contract.
 *
 * This file is the agreement between two implementations that never call each
 * other: the worker server that produces these events, and the web client that
 * renders them. The broker in between moves envelopes and reads none of this.
 *
 * Because both sides import these types, a payload change that only one side
 * honours fails to compile rather than failing in production.
 *
 * Identity is User → Session → Turn → Iteration. Session and Turn map onto
 * envelope fields (`sessionId`, `transactionKey`/`turnId`); Iteration is an
 * ordinal inside one Turn and has no envelope identity.
 */

/** The single action a client may submit. */
export const VIBE_TURN_ACTION = "vibe.turn.run" as const;

export const VIBE_ACTIONS = {
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

export type VibeAction = (typeof VIBE_ACTIONS)[keyof typeof VIBE_ACTIONS];

// ------------------------------------------------------------- submission ----

/** Payload of `vibe.turn.run`. `userId` is stamped by the broker, never trusted from a client. */
export interface VibeTurnRequest {
  sessionKey: string;
  turnKey: string;
  userId: string;
  prompt: string;
}

/** What a client puts on the wire. Session and turn identity travel in the envelope. */
export interface VibeTurnSubmission {
  sessionId: string;
  turnKey: string;
  prompt: string;
}

// -------------------------------------------------------------- progress ----

interface TurnScoped { turnKey: string }

export interface VibeTurnStarted extends TurnScoped { prompt: string; sessionKey: string }
export interface VibeIterationStarted extends TurnScoped { iterationIndex: number }
export interface VibeIterationReasoning extends TurnScoped { iterationIndex: number; reasoning: string }
export interface VibeIterationMessage extends TurnScoped { iterationIndex: number; message: string }
export interface VibeToolStarted extends TurnScoped { toolCallKey: string; command: string }
export interface VibeToolChunk extends TurnScoped { toolCallKey: string; chunk: string }
export interface VibeToolCompleted extends TurnScoped { toolCallKey: string; exitCode: number | null; timedOut: boolean; durationMs: number }
export interface VibeToolFailed extends TurnScoped { toolCallKey: string; error: string }
export interface VibeTurnFinal extends TurnScoped { answer: string; stoppedBy?: VibeStopReason }

export type VibeStopReason = "final" | "iteration_budget" | "error";

/** Every progress event, keyed by its action. One map, both sides. */
export interface VibeProgressMap {
  [VIBE_ACTIONS.turnStarted]: VibeTurnStarted;
  [VIBE_ACTIONS.iterationStarted]: VibeIterationStarted;
  [VIBE_ACTIONS.iterationReasoning]: VibeIterationReasoning;
  [VIBE_ACTIONS.iterationMessage]: VibeIterationMessage;
  [VIBE_ACTIONS.toolStarted]: VibeToolStarted;
  [VIBE_ACTIONS.toolStdout]: VibeToolChunk;
  [VIBE_ACTIONS.toolStderr]: VibeToolChunk;
  [VIBE_ACTIONS.toolCompleted]: VibeToolCompleted;
  [VIBE_ACTIONS.toolFailed]: VibeToolFailed;
  [VIBE_ACTIONS.turnFinal]: VibeTurnFinal;
}

/** A progress event as it appears on the wire: its action plus that action's payload. */
export type VibeProgressEvent = { [K in VibeAction]: { action: K } & VibeProgressMap[K] }[VibeAction];

// --------------------------------------------------------------- terminal ----

/** `payload.value` of the broker's terminal result for a turn. */
export interface VibeTurnOutcome {
  sessionKey: string;
  turnKey: string;
  iterations: number;
  toolCalls: number;
  answer: string;
  stoppedBy: VibeStopReason;
}

// ---------------------------------------------------------------- parsers ----

export function isVibeAction(action: string): action is VibeAction {
  return (Object.values(VIBE_ACTIONS) as string[]).includes(action);
}

/** Rejects anything the worker would otherwise have to guess at. */
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

/**
 * Narrows a received event to the agreed shape. A payload that does not carry a
 * `turnKey` cannot be placed in any turn, so it is dropped rather than guessed at.
 */
export function parseVibeProgressEvent(action: string, payload: Record<string, unknown>): VibeProgressEvent | null {
  if (!isVibeAction(action)) return null;
  if (typeof payload.turnKey !== "string" || !payload.turnKey) return null;
  return { ...payload, action } as VibeProgressEvent;
}
