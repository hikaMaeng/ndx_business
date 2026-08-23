import type { EventQueueTransport } from "../queue/transport.js";
import { nextReadBackoff, wait } from "../broker/backoff.js";
import { DeliveryStore } from "./store.js";
export type DeliveryPublisher = { stop(): void; done: Promise<void> };
export function startDeliveryPublisher(input: { queue: EventQueueTransport; store: DeliveryStore }): DeliveryPublisher {
  let stopped = false;
  const done = (async () => { let backoffMs = 100; while (!stopped) {
    let claims;
    try { claims = await input.store.claimMany(128); }
    catch (error) {
      console.error(JSON.stringify({ event: "delivery.publisher.claim.retry", backoffMs, error: error instanceof Error ? error.message : String(error) }));
      await wait(backoffMs); backoffMs = nextReadBackoff(backoffMs); continue;
    }
    if (!claims.length) { backoffMs = 100; await wait(50); continue; }
    const byQueue = new Map<string, typeof claims>();
    for (const claim of claims) byQueue.set(claim.queueName, [...(byQueue.get(claim.queueName) ?? []), claim]);
    for (const [queueName, queueClaims] of byQueue) try {
      await Promise.all(queueClaims.map((claim) => input.queue.send(queueName, claim.event)));
      if (await input.store.completeMany(queueClaims.map(({ event, attemptId }) => ({ eventId: event.eventId, attemptId }))) !== queueClaims.length) throw new Error("delivery attempt lost its fence");
    } catch (error) {
      console.error(JSON.stringify({ event: "delivery.publish.retry", eventIds: queueClaims.map((claim) => claim.event.eventId), queue: queueName, error: error instanceof Error ? error.message : String(error) }));
      await input.store.retryMany(queueClaims.map(({ event, attemptId }) => ({ eventId: event.eventId, attemptId })));
    }
  } })();
  return { stop: () => { stopped = true; }, done };
}
