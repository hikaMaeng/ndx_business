import type { EventQueueTransport } from "../queue/transport.js";
import { nextReadBackoff, wait } from "../broker/backoff.js";
import { DeliveryStore } from "./store.js";
import type { MetricsRegistry } from "../metrics/registry.js";
export type DeliveryPublisher = { stop(): void; done: Promise<void> };
export function startDeliveryPublisher(input: { queue: EventQueueTransport; store: DeliveryStore; maxAttempts: number; metrics: MetricsRegistry }): DeliveryPublisher {
  let stopped = false;
  const retry = async (claims: ReadonlyArray<{ eventId: string; attemptId: string }>, queueName: string, error: unknown): Promise<void> => {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const outcome = await input.store.retryMany(claims, input.maxAttempts, message);
      input.metrics.increment("outboxDeliveryRetries", outcome.ready);
      input.metrics.increment("outboxDeadLetters", outcome.dead);
      console.error(JSON.stringify({ event: "delivery.publish.retry", eventIds: claims.map((claim) => claim.eventId), queue: queueName, ready: outcome.ready, dead: outcome.dead, error: message }));
    } catch (retryError) { console.error(JSON.stringify({ event: "delivery.publisher.retry.persist.failed", queue: queueName, error: retryError instanceof Error ? retryError.message : String(retryError) })); }
  };
  const done = (async () => { let backoffMs = 50; while (!stopped) {
    let claims;
    try { claims = await input.store.claimMany(128); }
    catch (error) {
      console.error(JSON.stringify({ event: "delivery.publisher.claim.retry", backoffMs, error: error instanceof Error ? error.message : String(error) }));
      await wait(backoffMs); backoffMs = nextReadBackoff(backoffMs); continue;
    }
    if (!claims.length) { await wait(backoffMs); backoffMs = Math.min(1_000, backoffMs * 2); continue; }
    backoffMs = 50;
    const byQueue = new Map<string, typeof claims>();
    for (const claim of claims) byQueue.set(claim.queueName, [...(byQueue.get(claim.queueName) ?? []), claim]);
    for (const [queueName, queueClaims] of byQueue) {
      const fences = queueClaims.map(({ event, attemptId }) => ({ eventId: event.eventId, attemptId }));
      try {
      await Promise.all(queueClaims.map((claim) => input.queue.send(queueName, claim.event)));
        const completed = new Set(await input.store.completeMany(fences));
        const lost = fences.filter((claim) => !completed.has(claim.eventId));
        if (lost.length) await retry(lost, queueName, new Error("delivery attempt lost its fence"));
      } catch (error) { await retry(fences, queueName, error); }
    }
  } })();
  return { stop: () => { stopped = true; }, done };
}
