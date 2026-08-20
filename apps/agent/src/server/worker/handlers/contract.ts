import type { EventEnvelope } from "agent_domain/common";

export interface WorkerActionHandler {
  readonly name: string;
  matches(action: string): boolean;
  execute(event: EventEnvelope, signal: AbortSignal): Promise<unknown>;
}
