/**
 * The session's context, in the database rather than in worker memory.
 *
 * | file | holds |
 * | --- | --- |
 * | `schema.ts` | the two tables and why there are two |
 * | `store.ts` | opening, position blocks, the conversation, and the tool-call count |
 */
export { ensureSessionSchema } from "./schema.js";
export { SessionStore, type SessionRow, type PendingMessage } from "./store.js";
