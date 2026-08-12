import { SliceModel } from "../../model/SliceModel.js";
import type { AccountFeatureModel, AccountModelState } from "./types.js";

const models = new Map<string, AccountFeatureModel>();

const emptySnapshot = (): AccountModelState => ({
  settings: null,
  sessions: [],
  pendingUsers: [],
  status: "idle",
});

export function ensureAccountModel(key: string): AccountFeatureModel {
  let model = models.get(key);
  if (!model) {
    model = { snapshot: new SliceModel(emptySnapshot()) };
    models.set(key, model);
  }
  return model;
}
