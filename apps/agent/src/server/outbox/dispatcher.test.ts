import assert from "node:assert/strict";
import test from "node:test";
import type { EventEnvelope } from "agent_domain/common";
import { startOutboxDispatcher } from "./dispatcher.js";

const event: EventEnvelope = { eventId: "result-1", streamId: "session:one", sequence: "2", action: "hash.sha256.result", transactionKey: "tx-1", eventVersion: 1, kind: "result", channel: "agent.results", correlationId: "tx-1", source: "worker", createdAt: "2026-08-21T00:00:00.000Z", payload: { ok: true } };

test("outbox dispatcher publishes only a claimed committed event", async () => {
  let claimed = false; const sent: string[] = []; const published: string[] = []; const completed: string[] = [];
  const loop = startOutboxDispatcher({
    outbox: { claimNext: async () => claimed ? undefined : (claimed = true, { eventId: event.eventId, attemptId: "attempt-1", event }), complete: async (eventId: string, attemptId: string) => { completed.push(`${eventId}:${attemptId}`); return true; }, retry: async () => true } as never,
    queue: { send: async (_queue: string, value: EventEnvelope) => { sent.push(value.eventId); return "message-1"; } } as never,
    resultQueue: "agent_results", hub: { publish: (value: EventEnvelope) => published.push(value.eventId) } as never,
    metrics: { increment: () => undefined } as never, idleMs: 1, retryMs: 1, lanes: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 20)); loop.stop();
  assert.deepEqual(sent, [event.eventId]); assert.deepEqual(published, [event.eventId]); assert.deepEqual(completed, ["result-1:attempt-1"]);
});
