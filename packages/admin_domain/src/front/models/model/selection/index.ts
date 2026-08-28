import { SliceModel } from "../../../model/SliceModel.js";

export function createModelEndpointSelectionModel(): SliceModel<string | null> {
  return new SliceModel<string | null>(null);
}
