import type { EventEnvelope } from "agent_domain/common";

export type StreamEvent = EventEnvelope;

interface Subscriber {
  channels: Set<string>;
  send: (event: StreamEvent) => void;
}

export class EventStreamHub {
  private nextId = 0;
  private readonly subscribers = new Map<number, Subscriber>();
  private readonly subscriberIdsByChannel = new Map<string, Set<number>>();

  subscribe(channels: string[], send: Subscriber["send"]): () => void {
    const id = this.nextId++;
    const subscribedChannels = new Set(channels);
    this.subscribers.set(id, { channels: subscribedChannels, send });
    for (const channel of subscribedChannels) {
      const ids = this.subscriberIdsByChannel.get(channel) ?? new Set<number>();
      ids.add(id);
      this.subscriberIdsByChannel.set(channel, ids);
    }
    return () => {
      const subscriber = this.subscribers.get(id);
      if (!subscriber) return;
      this.subscribers.delete(id);
      for (const channel of subscriber.channels) {
        const ids = this.subscriberIdsByChannel.get(channel);
        if (!ids) continue;
        ids.delete(id);
        if (ids.size === 0) this.subscriberIdsByChannel.delete(channel);
      }
    };
  }

  publish(event: StreamEvent): void {
    for (const id of this.subscriberIdsByChannel.get(event.channel) ?? []) this.subscribers.get(id)?.send(event);
  }
}
