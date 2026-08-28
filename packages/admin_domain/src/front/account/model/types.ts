import type {
  AuthSettings,
  PendingUser,
  SessionSummary,
} from "../../../common/protocol/auth/index.js";
import type { SliceModel } from "../../model/SliceModel.js";

export type AccountModelState = {
  settings: AuthSettings | null;
  sessions: SessionSummary[];
  pendingUsers: PendingUser[];
  /**
   * `failed` exists so a failure is not spelled `idle`.
   *
   * It used to be. `idle` means "nobody has tried yet", which is exactly the
   * condition the load effect waits for — so putting a failure back into it
   * asked the effect to run again, immediately, for ever. A refused request
   * became an unbounded retry against a server already in trouble.
   *
   * Only a deliberate retry returns the screen to `idle`.
   */
  status: "idle" | "loading" | "ready" | "failed";
};

export type AccountFeatureModel = {
  snapshot: SliceModel<AccountModelState>;
};
