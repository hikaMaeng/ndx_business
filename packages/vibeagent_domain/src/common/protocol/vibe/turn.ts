/**
 * One turn: a prompt, the iterations it takes, and the answer it ends with.
 *
 * Identity is User → Session → Turn → Iteration. Session and Turn map onto
 * envelope fields (`sessionId`, `transactionKey`/`turnId`); Iteration is an
 * ordinal inside one Turn and has no envelope identity.
 */

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

/**
 * Every turn-scoped fact carries the position its emitter gave it.
 *
 * Neither side asks the queue or the log to preserve order. A burst of deltas
 * out of one handler is not a causal chain — nothing was received and processed
 * to produce the next one — so the emitter numbers them and each side places a
 * late arrival back where it belongs. Transport is then free to deliver in any
 * order it likes.
 */
export interface TurnScoped { turnKey: string; seq: number }

/** A step inside a turn. Everything after the prompt happens in one. */
export interface IterationScoped extends TurnScoped { iterationIndex: number }

export interface VibeTurnRequested extends TurnScoped { sessionKey: string; prompt: string }
export interface VibeTurnStarted extends TurnScoped { prompt: string; sessionKey: string }
export interface VibeIterationStarted extends IterationScoped {}

/**
 * A slice of the model's chain of thought, not the whole of it.
 *
 * Inference is streamed, so one iteration produces many of these and the client
 * concatenates them per `iterationIndex` — the same shape as a stdout chunk. A
 * single whole-text event is just the degenerate case of one slice.
 */
export interface VibeIterationReasoning extends IterationScoped { reasoning: string }

/** A slice of the model's reply. Concatenated per `iterationIndex`, like reasoning. */
export interface VibeIterationMessage extends IterationScoped { message: string }

/**
 * The model answered.
 *
 * Its message is already in the session history — this fact says so, it does
 * not carry it. `toolCalls` is a count, not the calls: whoever decides what
 * happens next reads them from the history, so this fact stays small.
 */
export interface VibeModelReplied extends IterationScoped { toolCalls: number; answered: boolean }

/** The model asked for exactly one command. One fact per call. */
export interface VibeToolRequested extends IterationScoped { toolCallKey: string; toolCallId: string; command: string }

export interface VibeToolStarted extends TurnScoped { toolCallKey: string; command: string }
export interface VibeToolChunk extends TurnScoped { toolCallKey: string; chunk: string }

/** This one command finished and its result is recorded in the session history. */
export interface VibeToolCompleted extends IterationScoped { toolCallKey: string; exitCode: number | null; timedOut: boolean; durationMs: number }
export interface VibeToolFailed extends IterationScoped { toolCallKey: string; error: string }

/** Every tool call this iteration asked for now has a result. Nothing more is claimed. */
export interface VibeIterationReady extends IterationScoped { toolCalls: number }

export interface VibeTurnFinal extends TurnScoped { answer: string; stoppedBy?: VibeStopReason }

export type VibeStopReason = "final" | "iteration_budget" | "error";

/** `payload.value` of the broker's terminal result for one reactor's work. */
export interface VibeTurnOutcome {
  sessionKey: string;
  turnKey: string;
  workspace: string;
  iterations: number;
  toolCalls: number;
  answer: string;
  stoppedBy: VibeStopReason;
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

/** The instruction a reactor needs: which turn, which iteration. Everything else is in the database. */
export function parseIterationScope(value: unknown): { turnKey: string; iterationIndex: number } | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const turnKey = typeof input.turnKey === "string" && input.turnKey ? input.turnKey : null;
  const iterationIndex = typeof input.iterationIndex === "number" && Number.isInteger(input.iterationIndex) && input.iterationIndex >= 0 ? input.iterationIndex : null;
  if (!turnKey || iterationIndex === null) return null;
  return { turnKey, iterationIndex };
}
