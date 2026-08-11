import { createModelCatalogModel } from "./catalog.js";
import { createModelEndpointSelectionModel } from "./selection.js";
import type { ModelsFeatureModel } from "./types.js";

const models = new Map<string, ModelsFeatureModel>();

export function ensureModelsFeatureModel(key: string): ModelsFeatureModel {
  let model = models.get(key);
  if (!model) {
    model = {
      catalog: createModelCatalogModel(),
      selection: createModelEndpointSelectionModel(),
    };
    models.set(key, model);
  }
  return model;
}
