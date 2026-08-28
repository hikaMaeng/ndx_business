/**
 * The wiring all three roles read, and the only thing they share.
 *
 * | file | holds |
 * | --- | --- |
 * | `queues.ts` | queue names, and where a client command is admitted |
 * | `table.ts` | fact → reactor queues. The cycle, in one place |
 * | `groups.ts` | queue → the reactors that answer on it |
 */
export { QUEUES, ingressQueueFor } from "./queues.js";
export { REACTIONS } from "./table.js";
export { GROUPS, REACTOR_QUEUES } from "./groups.js";
