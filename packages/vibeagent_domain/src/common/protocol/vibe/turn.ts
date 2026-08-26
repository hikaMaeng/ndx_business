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

export interface VibeTurnStarted extends TurnScoped { prompt: string; sessionKey: string }
export interface VibeIterationStarted extends TurnScoped { iterationIndex: number }

/**
 * A slice of the model's chain of thought, not the whole of it.
 *
 * Inference is streamed, so one iteration produces many of these and the client
 * concatenates them per `iterationIndex` — the same shape as a stdout chunk. A
 * single whole-text event is just the degenerate case of one slice.
 */
export interface VibeIterationReasoning extends TurnScoped { iterationIndex: number; reasoning: string }

/** A slice of the model's reply. Concatenated per `iterationIndex`, like reasoning. */
export interface VibeIterationMessage extends TurnScoped { iterationIndex: number; message: string }

export interface VibeToolStarted extends TurnScoped { toolCallKey: string; command: string }
export interface VibeToolChunk extends TurnScoped { toolCallKey: string; chunk: string }
export interface VibeToolCompleted extends TurnScoped { toolCallKey: string; exitCode: number | null; timedOut: boolean; durationMs: number }
export interface VibeToolFailed extends TurnScoped { toolCallKey: string; error: string }
export interface VibeTurnFinal extends TurnScoped { answer: string; stoppedBy?: VibeStopReason }

export type VibeStopReason = "final" | "iteration_budget" | "error";

/** `payload.value` of the broker's terminal result for a turn. */
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
