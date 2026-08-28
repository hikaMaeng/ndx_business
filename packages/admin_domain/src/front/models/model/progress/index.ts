import { SliceModel } from "../../../model/SliceModel.js";

/**
 * How an operation on the catalog is going.
 *
 * This is not ephemeral UI state. "The catalog is being written to" is a fact
 * about the feature that several regions project at once — the list dims, the
 * buttons disable, a message appears — and it outlives the component that
 * started it. Ephemeral state is a half-typed field or an open dialog; this is
 * the operation's lifecycle, and it belongs with the thing being operated on.
 */
export interface ModelsProgress {
  /** A write or a load is in flight. */
  busy: boolean;
  /** The first load has finished, successfully or not. Distinguishes empty from unknown. */
  loaded: boolean;
  /** The last failure, in the caller's language. Empty when the last attempt succeeded. */
  error: string;
  /** What just succeeded. Empty until something does. */
  status: string;
}

export function createModelsProgressModel(): SliceModel<ModelsProgress> {
  return new SliceModel<ModelsProgress>({ busy: false, loaded: false, error: "", status: "" });
}
