import type { OrganizationSnapshot } from "../../../common/protocol/organization/index.js";
import { SliceModel } from "../../model/SliceModel.js";

export function createOrganizationSnapshotModel(): SliceModel<OrganizationSnapshot> {
  return new SliceModel<OrganizationSnapshot>({
    organizations: [],
    members: [],
    responsibilities: [],
    inferenceServiceOptions: [],
    inferenceServices: [],
    access: {
      isMasterAdmin: false,
      canCreateRoot: false,
      nodes: [],
    },
  });
}
