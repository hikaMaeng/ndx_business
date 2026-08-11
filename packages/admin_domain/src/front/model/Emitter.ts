// Target: packages/<service>_domain/src/front/model/Emitter.ts
//
// The render trigger. Pure in-memory, zero React, zero immutable copies.
// A model extends Emitter, mutates its own fields in place, then calls emit().
// `getVersion` is the ONLY value React reads as a snapshot; the data itself is
// read directly off the live model during render.

export type Unsubscribe = () => void;

export class Emitter {
  #version = 0;
  #listeners = new Set<() => void>();

  /** useSyncExternalStore `subscribe`. Returns an unsubscribe. */
  readonly subscribe = (onChange: () => void): Unsubscribe => {
    this.#listeners.add(onChange);
    return () => {
      this.#listeners.delete(onChange);
    };
  };

  /** useSyncExternalStore `getSnapshot`. A monotonic trigger, NOT the data. */
  readonly getVersion = (): number => this.#version;

  /** Call once after every mutation. Bumps the trigger and notifies subscribers. */
  protected emit(): void {
    this.#version++;
    for (const fn of this.#listeners) fn();
  }
}
