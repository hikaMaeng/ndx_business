/**
 * The read model.
 *
 * | file | holds |
 * | --- | --- |
 * | `schema.ts` | the two projection tables, and why they are disposable |
 * | `store.ts` | folding facts into rows, and reading them back |
 */
export { ensureViewSchema } from "./schema.js";
export { ViewStore, type TurnSummary, type BlockRow } from "./store.js";
