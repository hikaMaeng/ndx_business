import type { AgentEvent, EventEnvelope } from "agent_domain/common";

export interface EventQueueMessage {
  id: string;
  event: AgentEvent;
  headers: Record<string, unknown> | null;
}

export interface EventQueueTransport {
  send(queue: string, event: AgentEvent | EventEnvelope): Promise<string>;
  read(queue: string, options: { visibilityTimeoutSeconds: number; quantity: number; pollSeconds: number }): Promise<EventQueueMessage[]>;
  delete(queue: string, id: string): Promise<void>;
  extendVisibility(queue: string, id: string, seconds: number): Promise<void>;
  check(): Promise<void>;
}
