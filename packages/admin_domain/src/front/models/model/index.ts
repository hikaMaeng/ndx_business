/**
 * The models feature, as a model.
 *
 * | folder | holds |
 * | --- | --- |
 * | `catalog/` | endpoints and definitions, as the server last stated them |
 * | `selection/` | which endpoint the detail pane is showing |
 * | `progress/` | whether an operation is in flight, and how the last one ended |
 * | `drafts/` | what an empty form starts as, and how an edit is opened |
 * | `commands/` | every write, and the one shape they share |
 */
export { ensureModelsFeatureModel } from "./store.js";
export { ModelsCommands, type ModelsFetch, type CommandText } from "./commands/index.js";
export { createEndpointDraft, createModelDefinitionDraft, type EndpointDraft, type ModelDefinitionDraft } from "./drafts/index.js";
export type { ModelsProgress } from "./progress/index.js";
export type { ModelsFeatureModel } from "./types.js";
