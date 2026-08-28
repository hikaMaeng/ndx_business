import type { VibeTurnFinal, VibeTurnStarted } from "../../../../common/index.js";
import type { VibeSessionModel } from "../../VibeSessionModel.js";

/** The prompt, which the client may already have shown, and may not have. */
export function turnStarted(model: VibeSessionModel, event: VibeTurnStarted): void {
  model.ensureTurn(event.turnKey).change((turn) => {
    if (event.prompt) turn.prompt = event.prompt;
    turn.phase = "running";
  });
}

/** The turn is over. `stoppedBy` distinguishes an answer from a budget stop. */
export function turnFinal(model: VibeSessionModel, event: VibeTurnFinal): void {
  model.ensureTurn(event.turnKey).change((turn) => {
    turn.phase = "done";
    turn.answer = event.answer ?? "";
  });
}
