import type { EventEnvelope, IngressEvent } from "../../common/index.js";

export interface EventQueueMessage<TEvent extends IngressEvent | EventEnvelope = IngressEvent | EventEnvelope> {
  id: string;
  event: TEvent;
  headers: Record<string, unknown> | null;
  readCount: number;
}

export interface EventQueueTransport {
  send(queue: string, event: IngressEvent | EventEnvelope): Promise<string>;
  read(queue: string, options: { visibilityTimeoutSeconds: number; quantity: number; pollSeconds: number }): Promise<EventQueueMessage[]>;
  delete(queue: string, id: string): Promise<void>;
  archive(queue: string, id: string): Promise<void>;
  extendVisibility(queue: string, id: string, seconds: number): Promise<void>;
  ensure(queue: string): Promise<void>;
  check(): Promise<void>;
}
