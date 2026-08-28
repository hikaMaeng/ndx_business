import { createModelCatalogModel } from "./catalog/index.js";
import { createModelEndpointSelectionModel } from "./selection/index.js";
import { createModelsProgressModel } from "./progress/index.js";
import type { ModelsFeatureModel } from "./types.js";

/**
 * One model per session key, living outside the component tree.
 *
 * A screen that unmounts only unsubscribes; the catalog it loaded is still here
 * when the screen comes back, so navigating away and returning shows what was
 * there instead of an empty panel and a refetch.
 */
const models = new Map<string, ModelsFeatureModel>();

export function ensureModelsFeatureModel(key: string): ModelsFeatureModel {
  let model = models.get(key);
  if (!model) {
    model = {
      catalog: createModelCatalogModel(),
      selection: createModelEndpointSelectionModel(),
      progress: createModelsProgressModel(),
    };
    models.set(key, model);
  }
  return model;
}
