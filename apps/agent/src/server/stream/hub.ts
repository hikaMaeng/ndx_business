import type { AgentEvent } from "agent_domain/common";

interface Subscriber {
  channels: Set<string>;
  send: (event: AgentEvent) => void;
}

export class EventStreamHub {
  private nextId = 0;
  private readonly subscribers = new Map<number, Subscriber>();

  subscribe(channels: string[], send: Subscriber["send"]): () => void {
    const id = this.nextId++;
    this.subscribers.set(id, { channels: new Set(channels), send });
    return () => this.subscribers.delete(id);
  }

  publish(event: AgentEvent): void {
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.channels.has(event.channel)) subscriber.send(event);
    }
  }
}
