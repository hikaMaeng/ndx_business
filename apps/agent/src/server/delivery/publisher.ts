import type { EventQueueTransport } from "../queue/transport.js";
import { wait } from "../broker/backoff.js";
import { DeliveryStore } from "./store.js";
export type DeliveryPublisher = { stop(): void; done: Promise<void> };
export function startDeliveryPublisher(input: { queue: EventQueueTransport; store: DeliveryStore }): DeliveryPublisher {
  let stopped = false;
  const done = (async () => { while (!stopped) {
    const claim = await input.store.claim();
    if (!claim) { await wait(50); continue; }
    try {
      await input.queue.send(claim.queueName, claim.event);
      if (!await input.store.complete(claim.event.eventId, claim.attemptId)) throw new Error("delivery attempt lost its fence");
    } catch (error) {
      console.error(JSON.stringify({ event: "delivery.publish.retry", eventId: claim.event.eventId, queue: claim.queueName, error: error instanceof Error ? error.message : String(error) }));
      await input.store.retry(claim.event.eventId, claim.attemptId);
    }
  } })();
  return { stop: () => { stopped = true; }, done };
}
