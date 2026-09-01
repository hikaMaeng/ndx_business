import assert from "node:assert/strict";
import test from "node:test";
import {
  parseModelCatalogSnapshot,
  parseModelDefinitionRequest,
  parseSetModelDefaultRequest,
  type ModelDefinition,
} from "./index.js";

const definition: ModelDefinition = {
  id: "model", endpointId: "endpoint", identifier: "chat-primary", contextSize: 131072,
  temperature: 0.3, minP: 0, topP: 0.9, topK: 20, repeatPenalty: 1.05, reasoning: false,
  supportsText: true, supportsImage: false, supportsSound: false, supportsVideo: false,
  isDefault: true, createdAt: "now", updatedAt: "now",
};

test("the catalog snapshot round-trips which model is the default", () => {
  const snapshot = parseModelCatalogSnapshot(JSON.parse(JSON.stringify({ endpoints: [], models: [definition] })));
  assert.equal(snapshot?.models[0]?.isDefault, true);
  assert.equal(parseModelCatalogSnapshot({ endpoints: [], models: [{ ...definition, isDefault: false }] })?.models[0]?.isDefault, false);
});

test("a definition missing the default flag is not a definition", () => {
  // Rejected rather than defaulted, because a snapshot that silently reads as
  // "no model is the default" would put the screen's empty state — the one that
  // says sessions cannot be opened — in front of an administrator whose
  // deployment is configured correctly.
  const { isDefault: _omitted, ...withoutFlag } = definition;
  assert.equal(parseModelCatalogSnapshot({ endpoints: [], models: [withoutFlag] }), null);
});

test("the default request carries only the flag, and demands it", () => {
  assert.deepEqual(parseSetModelDefaultRequest({ isDefault: true }), { isDefault: true });
  assert.deepEqual(parseSetModelDefaultRequest({ isDefault: false }), { isDefault: false });
  // A body without the flag would otherwise read as a request to clear the
  // deployment default.
  assert.equal(parseSetModelDefaultRequest({}), null);
  assert.equal(parseSetModelDefaultRequest({ isDefault: "true" }), null);
});

test("saving a model definition cannot carry the default with it", () => {
  // The one property the update request must not have: every save of a model's
  // sampling would otherwise state an opinion about the deployment default, and
  // unsetting it by accident looks identical to not touching it.
  const parsed = parseModelDefinitionRequest({ ...definition, isDefault: false });
  assert.ok(parsed);
  assert.equal("isDefault" in parsed, false);
});
