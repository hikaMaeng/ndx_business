// Target: apps/<service>/src/front/lib/useModel.ts   (React glue, app side)
//
// The ONLY bridge between pure models and React. `getVersion` is the snapshot,
// so React re-renders on the trigger and reads the live model in the render body.
// No immutable state, no context provider holding model data.

import { useSyncExternalStore } from "react";
// Import the Emitter type via the domain workspace package name, e.g.
//   import type { Emitter } from "<service>_domain/front/model/Emitter";
import type { Emitter } from "admin_domain/front";

/**
 * Subscribe a component to a model (or submodel) and return the live instance.
 *
 * TEARING CONTRACT: subscribe to every slice you read in render.
 * - read `session.messages`        -> useModel(getSession(id))
 * - read only `session.connection` -> useModel(getSession(id).connection)
 * Reading a slice whose Emitter you did not subscribe to causes stale/torn UI.
 */
export function useModel<T extends Emitter>(model: T): T {
  useSyncExternalStore(model.subscribe, model.getVersion, model.getVersion);
  return model;
}
