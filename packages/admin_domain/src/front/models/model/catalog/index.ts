import type { ModelCatalogSnapshot } from "../../../../common/protocol/models/index.js";
import { SliceModel } from "../../../model/SliceModel.js";

export function createModelCatalogModel(): SliceModel<ModelCatalogSnapshot> {
  return new SliceModel<ModelCatalogSnapshot>({ endpoints: [], models: [] });
}
