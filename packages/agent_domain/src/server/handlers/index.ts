import type { EventEnvelope } from "../../common/protocol/event/index.js";
import { acknowledgeHandler } from "./acknowledge.js";
import type { WorkerActionHandler } from "./contract.js";
import { hashSha256Handler } from "./hash-sha256.js";

const handlers: readonly WorkerActionHandler[] = [hashSha256Handler, acknowledgeHandler];

/** Static domain-action registry; the final handler is the deliberate generic fallback. */
export async function executeHandler(event: EventEnvelope, signal: AbortSignal): Promise<unknown> {
  const handler = handlers.find((candidate) => candidate.matches(event.action));
  if (!handler) throw new Error(`No worker handler for ${event.action}`);
  return handler.execute(event, signal);
}
