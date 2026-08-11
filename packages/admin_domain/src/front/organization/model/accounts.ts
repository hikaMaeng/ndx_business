import type { UserSummary } from "../../../common/protocol/auth/index.js";
import { SliceModel } from "../../model/SliceModel.js";

export function createOrganizationAccountsModel(): SliceModel<UserSummary[]> {
  return new SliceModel<UserSummary[]>([]);
}
