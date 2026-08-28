import type { EventStore } from "../../event-store/store.js";
import type { EventStreamHub } from "../../stream/hub.js";
import type { MetricsRegistry } from "../../metrics/registry.js";
import { CoalescedWakeup } from "../notifier.js";
import { nextReadBackoff, wait } from "../backoff.js";

export type BrokerLoop = { stop(): void; done: Promise<void> };

/**
 * Delivery, without a queue.
 *
 * A queue hands each message to exactly one consumer — that is what it is for,
 * and it is right for work. Delivery is the opposite shape: every broker
 * holding a socket on a channel has to see the same event. Forcing fan-out
 * through a queue is what once required a router to copy results into
 * per-broker queues, plus a second outbox to hand them over durably.
 *
 * None of that is needed, because events are immutable. Nothing is consumed
 * here: this reads forward from a position and leaves the row exactly as it
 * was. Any number of brokers can do that at once without coordinating, because
 * none of them can affect what another one sees.
 *
 * Reading forward is safe on `(stream_id, sequence)` specifically. Those
 * sequences are handed out under the `event_stream_sequence` row lock inside
 * the appending transaction, so within one stream commit order *is* sequence
 * order and a reader cannot step over a row that is about to appear. A global
 * auto-increment column would not give that: positions are assigned before
 * commit and commits finish out of order, so a tail could skip a gap that
 * later fills in.
 */
export function startEventLogTail(input: {
  eventStore: EventStore;
  hub: EventStreamHub;
  metrics: MetricsRegistry;
  /** Fallback interval. A dropped notification should cost latency, not delivery. */
  pollMs: number;
  batchSize: number;
}): BrokerLoop & { wake(channel?: string): void } {
  let stopped = false;
  const notifier = new CoalescedWakeup();
  // Per channel, the last sequence handed to the hub for each of its streams.
  const positions = new Map<string, Record<string, string>>();

  const wake = (channel?: string): void => {
    // A broker with no socket on that channel has nothing to do about it.
    if (channel && channel.length > 0 && !positions.has(channel)) return;
    notifier.notify();
  };

  const syncChannels = async (active: string[]): Promise<void> => {
    for (const channel of positions.keys()) if (!active.includes(channel)) positions.delete(channel);
    const fresh = active.filter((channel) => !positions.has(channel));
    if (!fresh.length) return;
    // A newly watched channel starts at now. History is not this loop's job —
    // a connection replays its own past through its cursor, and delivering it
    // here as well would only duplicate what the socket already sent.
    for (const channel of fresh) positions.set(channel, {});
    const highWater = await input.eventStore.channelHighWaterByChannel(fresh);
    for (const channel of fresh) positions.set(channel, highWater[channel] ?? {});
  };

  const drain = async (): Promise<boolean> => {
    const active = [...positions.keys()];
    if (!active.length) return true;
    const merged: Record<string, string> = {};
    for (const streams of positions.values()) for (const [streamId, sequence] of Object.entries(streams)) {
      if (!merged[streamId] || BigInt(sequence) > BigInt(merged[streamId])) merged[streamId] = sequence;
    }
    const highWater = await input.eventStore.channelHighWater(active);
    if (!Object.keys(highWater).length) return true;
    const batch = await input.eventStore.replayChannels(active, merged, highWater, input.batchSize);
    input.metrics.increment("logTailReads");
    input.metrics.increment("logTailEvents", batch.events.length);
    for (const event of batch.events) {
      input.hub.publish(event);
      const streams = positions.get(event.channel);
      if (streams) streams[event.streamId] = event.sequence;
    }
    return batch.complete;
  };

  const run = async (): Promise<void> => {
    let backoffMs = 100;
    while (!stopped) {
      try {
        await syncChannels(input.hub.activeChannels());
        const caughtUp = await drain();
        backoffMs = 100;
        if (caughtUp) await notifier.wait(input.pollMs);
      } catch (error) {
        input.metrics.increment("logTailFailures");
        console.error(JSON.stringify({ event: "broker.log.tail.retry", backoffMs, error: error instanceof Error ? error.message : String(error) }));
        await wait(backoffMs);
        backoffMs = nextReadBackoff(backoffMs);
      }
    }
  };

  const done = run();
  return { stop: () => { stopped = true; notifier.notify(); }, done, wake };
}
