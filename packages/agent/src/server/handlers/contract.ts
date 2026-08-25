import type { EventEnvelope } from "../../common/protocol/event/index.js";

export interface WorkerActionHandler {
  readonly name: string;
  matches(action: string): boolean;
  execute(event: EventEnvelope, signal: AbortSignal): Promise<unknown>;
}
