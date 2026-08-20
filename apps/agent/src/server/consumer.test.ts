import assert from "node:assert/strict";
import test from "node:test";
import { startIngressConsumer, startScheduler } from "./consumer.js";

const event = { eventId: "event-1", transactionKey: "transaction-1", kind: "request" as const, channel: "agent.requests", action: "hash.sha256", source: "test", createdAt: new Date().toISOString(), payload: { input: "value" } };
const metrics = { increment: () => undefined } as never;

test("ingress persists and hands off without awaiting worker completion", async () => {
  const deleted: string[] = []; const jobs: string[] = []; let reads = 0;
  const ingress = startIngressConsumer({
    queueTransport: { read: async () => ++reads === 1 ? [{ id: "message-1", event, headers: null }] : await new Promise<never>(() => undefined), delete: async (_q: string, id: string) => { deleted.push(id); }, send: async () => "", extendVisibility: async () => undefined, check: async () => undefined },
    eventStore: { append: async (draft: Record<string, unknown>) => ({ ...draft, sequence: "1" }) } as never,
    processingStore: { enqueue: async (value: typeof event) => { jobs.push(value.eventId); } } as never,
    metrics, queue: "agent_requests", visibilityTimeoutSeconds: 1, pollSeconds: 1, batchSize: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 20)); ingress.stop();
  assert.deepEqual(jobs, ["event-1"]); assert.deepEqual(deleted, ["message-1"]);
});

test("scheduler alone dispatches a durable job and completes it", async () => {
  let claims = 0; const completed: string[] = [];
  const scheduler = startScheduler({
    queueTransport: { send: async () => "result", read: async () => [], delete: async () => undefined, extendVisibility: async () => undefined, check: async () => undefined },
    database: { query: async (sql: string) => sql.startsWith("INSERT") ? { rowCount: 1, rows: [] } : { rowCount: 1, rows: [] } } as never,
    pool: { run: async () => ({ value: "ok" }), destroy: async () => undefined }, hub: { publish: () => undefined } as never,
    eventStore: { append: async (draft: Record<string, unknown>) => ({ ...draft, sequence: "1" }) } as never,
    deliveryStore: { claim: async () => "claimed", complete: async () => undefined } as never,
    processingStore: { claimNext: async () => ++claims === 1 ? { eventId: event.eventId, event } : undefined, complete: async (id: string) => { completed.push(id); }, renew: async () => true, retryLater: async () => undefined } as never,
    metrics, resultQueue: "agent_results", pollSeconds: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 30)); scheduler.stop();
  assert.deepEqual(completed, ["event-1"]);
});
