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
  status: "idle" | "loading" | "ready";
};

export type AccountFeatureModel = {
  snapshot: SliceModel<AccountModelState>;
};
