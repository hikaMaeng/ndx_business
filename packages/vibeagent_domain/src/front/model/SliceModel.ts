// Target: packages/vibeagent_domain/src/front/model/SliceModel.ts
//
// The reusable per-slice primitive. Every submodel that holds one value is a
// SliceModel<T>: its own Emitter, so a component that subscribes to it re-renders
// only when THAT slice changes (Invariant 5, the tearing contract). Compose a
// feature model out of several SliceModel fields instead of one giant model, so
// render impact stops at the slice a component actually reads.
//
// `set` replaces the value (skips the emit when Object.is-equal); `mutate`
// edits in place then emits — no immutable copy is required to trigger a render.

import { Emitter } from "./Emitter.js";

export type ModelUpdate<T> = T | ((current: T) => T);

export class SliceModel<T> extends Emitter {
  constructor(public value: T) {
    super();
  }

  /** Replace the slice value. No-op (no emit) when the next value is Object.is-equal. */
  set(update: ModelUpdate<T>): void {
    const next =
      typeof update === "function"
        ? (update as (current: T) => T)(this.value)
        : update;
    if (Object.is(next, this.value)) return;
    this.value = next;
    this.emit();
  }

  /** Mutate the slice value in place, then emit. Use for objects/arrays owned by this slice. */
  mutate(update: (current: T) => void): void {
    update(this.value);
    this.emit();
  }
}
