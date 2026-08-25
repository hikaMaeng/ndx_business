import type { EventEnvelope } from "../../common/index.js";

export type StreamEvent = EventEnvelope;

interface Subscriber {
  channels: Set<string>;
  send: (event: StreamEvent) => void;
}

/**
 * The broker's entire subscription state.
 *
 * It is memory, not a table. Nothing outside this process needs to know which
 * channels this broker holds, because no one routes to it — every broker reads
 * the whole log and keeps what it has a socket for. That is what makes brokers
 * interchangeable: none of them has an identity worth recording.
 */
export class EventStreamHub {
  private nextId = 0;
  private readonly subscribers = new Map<number, Subscriber>();
  private readonly subscriberIdsByChannel = new Map<string, Set<number>>();
  private onChannelsChanged: (() => void) | undefined;

  /** Called when the active channel set gains or loses a channel, so a tail can react without polling for it. */
  watchChannels(listener: () => void): void { this.onChannelsChanged = listener; }

  /** Channels with at least one local subscriber. The tail reads these and nothing else. */
  activeChannels(): string[] { return [...this.subscriberIdsByChannel.keys()]; }

  subscribe(channels: string[], send: Subscriber["send"]): () => void {
    const id = this.nextId++;
    const subscribedChannels = new Set(channels);
    this.subscribers.set(id, { channels: subscribedChannels, send });
    let added = false;
    for (const channel of subscribedChannels) {
      const ids = this.subscriberIdsByChannel.get(channel);
      if (ids) { ids.add(id); continue; }
      this.subscriberIdsByChannel.set(channel, new Set([id]));
      added = true;
    }
    if (added) this.onChannelsChanged?.();
    return () => {
      const subscriber = this.subscribers.get(id);
      if (!subscriber) return;
      this.subscribers.delete(id);
      let removed = false;
      for (const channel of subscriber.channels) {
        const ids = this.subscriberIdsByChannel.get(channel);
        if (!ids) continue;
        ids.delete(id);
        if (ids.size === 0) { this.subscriberIdsByChannel.delete(channel); removed = true; }
      }
      if (removed) this.onChannelsChanged?.();
    };
  }

  publish(event: StreamEvent): void {
    for (const id of this.subscriberIdsByChannel.get(event.channel) ?? []) this.subscribers.get(id)?.send(event);
  }
}
