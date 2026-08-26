import type { VibeTurnFinal, VibeTurnStarted } from "../../../common/index.js";
import type { VibeSnapshot } from "../state.js";
import { patchTurn } from "./helpers.js";

/** The only event carrying the prompt, so a replayed turn gets its title here. */
export function turnStarted(snapshot: VibeSnapshot, event: VibeTurnStarted): VibeSnapshot {
  return patchTurn(snapshot, event.turnKey, (turn) => ({ ...turn, prompt: turn.prompt || event.prompt }));
}

export function turnFinal(snapshot: VibeSnapshot, event: VibeTurnFinal): VibeSnapshot {
  return patchTurn(snapshot, event.turnKey, (turn) => ({ ...turn, answer: event.answer }));
}
