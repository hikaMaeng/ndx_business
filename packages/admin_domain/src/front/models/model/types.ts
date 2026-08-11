import type { SliceModel } from "../../model/SliceModel.js";
import type { ModelCatalogSnapshot } from "../../../common/protocol/models/index.js";

export type ModelsFeatureModel = {
  catalog: SliceModel<ModelCatalogSnapshot>;
  selection: SliceModel<string | null>;
};
