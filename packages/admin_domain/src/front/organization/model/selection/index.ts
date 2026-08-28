import { SliceModel } from "../../../model/SliceModel.js";

export function createOrganizationSelectionModel(): SliceModel<string | null> {
  return new SliceModel<string | null>(null);
}
