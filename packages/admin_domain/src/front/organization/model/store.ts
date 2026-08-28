import { createOrganizationAccountsModel } from "./accounts/index.js";
import { createOrganizationSelectionModel } from "./selection/index.js";
import { createOrganizationSnapshotModel } from "./snapshot/index.js";
import type { OrganizationFeatureModel } from "./types.js";

const models = new Map<string, OrganizationFeatureModel>();

export function ensureOrganizationModel(key: string): OrganizationFeatureModel {
  let model = models.get(key);
  if (!model) {
    model = {
      snapshot: createOrganizationSnapshotModel(),
      accounts: createOrganizationAccountsModel(),
      selection: createOrganizationSelectionModel(),
    };
    models.set(key, model);
  }
  return model;
}
