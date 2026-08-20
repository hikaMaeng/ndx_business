import type { EventQueueTransport } from "../queue/transport.js";
import type { EventStreamHub } from "../stream/hub.js";
import type { MetricsRegistry } from "../metrics/registry.js";
import type { OutboxStore } from "./store.js";

export type OutboxLoop = { stop: () => void };

/** Publishes only rows that committed with their canonical event. */
export function startOutboxDispatcher(input: { outbox: OutboxStore; queue: EventQueueTransport; resultQueue: string; hub: EventStreamHub; metrics: MetricsRegistry; idleMs: number; retryMs: number; lanes: number }): OutboxLoop {
  let stopped = false;
  const lane = async (): Promise<void> => { while (!stopped) {
    try {
      const message = await input.outbox.claimNext();
      if (!message) { await new Promise((resolve) => setTimeout(resolve, input.idleMs)); continue; }
      try {
        await input.queue.send(input.resultQueue, message.event);
        if (!await input.outbox.complete(message.eventId, message.attemptId)) throw new Error(`outbox attempt ${message.attemptId} lost its lease`);
        try { input.hub.publish(message.event); }
        catch (error) { console.error(JSON.stringify({ event: "outbox.live-projection.failed", eventId: message.eventId, error: error instanceof Error ? error.message : String(error) })); }
      } catch (error) {
        input.metrics.increment("processingFailures");
        await input.outbox.retry(message.eventId, message.attemptId, input.retryMs);
        console.error(JSON.stringify({ event: "outbox.retry", eventId: message.eventId, error: error instanceof Error ? error.message : String(error) }));
      }
    } catch (error) { input.metrics.increment("processingFailures"); await new Promise((resolve) => setTimeout(resolve, input.idleMs)); }
  } };
  for (let index = 0; index < input.lanes; index += 1) void lane();
  return { stop: () => { stopped = true; } };
}
