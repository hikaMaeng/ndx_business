import assert from "node:assert/strict";
import test from "node:test";
import { startDeliveryPublisher } from "./publisher.js";

test("publisher batches by queue and retries only completion fences that were not confirmed", async () => {
  let calls = 0; const sent: string[] = []; const retried: string[][] = [];
  const publisher = startDeliveryPublisher({
    queue: { send: async (queue: string, event: { eventId: string }) => { sent.push(`${queue}:${event.eventId}`); return event.eventId; } } as never,
    store: {
      claimMany: async () => calls++ === 0 ? [
        { event: { eventId: "one" }, queueName: "results", attemptId: "a", attempts: 1 },
        { event: { eventId: "two" }, queueName: "results", attemptId: "b", attempts: 1 },
        { event: { eventId: "three" }, queueName: "audit", attemptId: "c", attempts: 1 },
      ] : [],
      completeMany: async (claims: Array<{ eventId: string }>) => claims.filter((claim) => claim.eventId !== "two").map((claim) => claim.eventId),
      retryMany: async (claims: Array<{ eventId: string }>) => { retried.push(claims.map((claim) => claim.eventId)); return { ready: claims.length, dead: 0 }; },
    } as never,
    maxAttempts: 5, metrics: { increment: () => undefined } as never,
  });
  await new Promise((resolve) => setTimeout(resolve, 20)); publisher.stop();
  assert.deepEqual(sent.sort(), ["audit:three", "results:one", "results:two"]);
  assert.deepEqual(retried, [["two"]]);
});
