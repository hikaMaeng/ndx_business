import type { Pool } from "pg";
import type { EventEnvelope } from "agent/common";
import type { WorkerEmit } from "agent/broker/worker";
import { readLoopConfig } from "../config/index.js";
import { SessionContexts, sessionKeyOf, type WorkerGlobals } from "./context.js";
import { ROUTER } from "./router.js";

/**
 * The worker, as a router.
 *
 * ```
 * worker(event) {
 *   router[event.action](globals, context[event.sessionId], event, emit)
 * }
 * ```
 *
 * There is no loop and no branch here. An event arrives, its handler is looked
 * up, it is given the impure things it needs as context, and it runs. What the
 * agent *does* is the chain of events those handlers produce, not a control
 * structure that any one of them owns.
 *
 * | file | holds |
 * | --- | --- |
 * | `context.ts` | the worker server's memory: globals, and one singleton per session |
 * | `router.ts` | the action → handler table |
 * | `handlers/*.ts` | one file per action |
 */
export function createVibeWorker(pool: Pool): (event: EventEnvelope, signal: AbortSignal, emit: WorkerEmit) => Promise<unknown> {
  const globals: WorkerGlobals = { pool, config: readLoopConfig() };
  const contexts = new SessionContexts(pool);

  return async (event, signal, emit) => {
    const handle = ROUTER[event.action];
    // An agent that pretends to have run an unknown action is worse than one
    // that fails loudly.
    if (!handle) throw new Error(`No worker handler for ${event.action}`);
    const session = await contexts.load(sessionKeyOf(event));
    return handle({ globals, session, event, emit, signal });
  };
}

export { SessionContext, SessionContexts, sessionKeyOf, type WorkerGlobals } from "./context.js";
export { ROUTER, type Handler, type HandlerInput } from "./router.js";
