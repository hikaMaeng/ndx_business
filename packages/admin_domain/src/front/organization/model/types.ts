import type { SliceModel } from "../../model/SliceModel.js";
import type { OrganizationSnapshot } from "../../../common/protocol/organization/index.js";
import type { UserSummary } from "../../../common/protocol/auth/index.js";

export type OrganizationFeatureModel = {
  snapshot: SliceModel<OrganizationSnapshot>;
  accounts: SliceModel<UserSummary[]>;
  selection: SliceModel<string | null>;
};
