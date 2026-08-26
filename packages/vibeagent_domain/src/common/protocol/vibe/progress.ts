import { VIBE_ACTIONS, VIBE_SESSION_SCOPED_ACTIONS, isVibeAction, type VibeAction } from "./actions.js";
import type { VibeSessionOpened } from "./session.js";
import type {
  VibeIterationMessage, VibeIterationReasoning, VibeIterationStarted,
  VibeToolChunk, VibeToolCompleted, VibeToolFailed, VibeToolStarted,
  VibeTurnFinal, VibeTurnStarted,
} from "./turn.js";

/** Every fact the worker appends, keyed by its action. One map, both sides. */
export interface VibeProgressMap {
  [VIBE_ACTIONS.sessionOpened]: VibeSessionOpened;
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

/** A fact as it appears on the wire: its action plus that action's payload. */
export type VibeProgressEvent = { [K in VibeAction]: { action: K } & VibeProgressMap[K] }[VibeAction];

/**
 * Narrows a received event to the agreed shape.
 *
 * A turn-scoped payload without a `turnKey` cannot be placed in any turn, so it
 * is dropped rather than guessed at. Session-scoped facts belong to no turn and
 * are exempt from that check.
 */
export function parseVibeProgressEvent(action: string, payload: Record<string, unknown>): VibeProgressEvent | null {
  if (!isVibeAction(action)) return null;
  if (VIBE_SESSION_SCOPED_ACTIONS.has(action)) return { ...payload, action } as VibeProgressEvent;
  if (typeof payload.turnKey !== "string" || !payload.turnKey) return null;
  return { ...payload, action } as VibeProgressEvent;
}
