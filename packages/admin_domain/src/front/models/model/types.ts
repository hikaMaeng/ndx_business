import type { SliceModel } from "../../model/SliceModel.js";
import type { ModelCatalogSnapshot } from "../../../common/protocol/models/index.js";
import type { ModelsProgress } from "./progress/index.js";

/**
 * The feature, as slices.
 *
 * Three separate triggers, because three different regions read them: the list
 * reads the catalog, the detail pane reads the selection, and the toolbar reads
 * whether something is in flight. Selecting an endpoint does not re-render the
 * list, and a save finishing does not re-render either of them.
 */
export type ModelsFeatureModel = {
  catalog: SliceModel<ModelCatalogSnapshot>;
  selection: SliceModel<string | null>;
  progress: SliceModel<ModelsProgress>;
};
