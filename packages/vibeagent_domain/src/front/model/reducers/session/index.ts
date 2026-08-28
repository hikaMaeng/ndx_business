import type { VibeSessionOpened } from "../../../../common/index.js";
import type { VibeSessionModel } from "../../VibeSessionModel.js";

/** The session's folder, which is the one thing that makes it usable. */
export function sessionOpened(model: VibeSessionModel, event: VibeSessionOpened): void {
  model.setWorkspace(event.workspace);
}
