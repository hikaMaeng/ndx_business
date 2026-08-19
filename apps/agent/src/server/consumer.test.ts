import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { startConsumer } from "./consumer.js";

test("a conflict acknowledges only its message and keeps the consumer loop alive", async () => {
  const event = { eventId: "event-1", transactionKey: "transaction-1", kind: "request" as const, channel: "agent.requests", action: "hash.sha256", source: "test", createdAt: new Date().toISOString(), payload: { input: "value" } };
  let reads = 0;
  const deleted: string[] = [];
  const queue = {
    send: async () => "result-message",
    read: async () => {
      reads += 1;
      if (reads === 1) return [{ id: "source-message", event, headers: null }];
      return await new Promise<never>(() => undefined);
    },
    delete: async (_queue: string, id: string) => { deleted.push(id); },
    extendVisibility: async () => undefined,
    check: async () => undefined,
  };
  const database = {
    query: async (sql: string) => sql.startsWith("INSERT")
      ? { rowCount: 0, rows: [] }
      : { rowCount: 1, rows: [{ status: "running", result: null, payload_hash: createHash("sha256").update("different").digest("hex") }] },
  };
  const consumer = startConsumer({
    queueTransport: queue,
    database: database as never,
    pool: { run: async () => ({ value: undefined }), destroy: async () => undefined },
    hub: { publish: () => undefined } as never,
    eventLog: { append: async () => undefined } as never,
    queue: "agent_requests",
    resultQueue: "agent_results",
    visibilityTimeoutSeconds: 1,
    pollSeconds: 1,
    batchSize: 1,
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  consumer.stop();
  assert.ok(reads >= 2);
  assert.deepEqual(deleted, ["source-message"]);
});
