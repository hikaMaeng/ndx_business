import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerPool, WorkerLostError } from "./pool.js";

test("a worker that exits with code zero rejects its active task", async () => {
  const pool = createWorkerPool({ minWorkerThreads: 0, maxWorkerThreads: 1, maxQueue: 1, workerUrl: new URL("./worker-exit-zero.fixture.mjs", import.meta.url) });
  await assert.rejects(
    pool.run({ eventId: "event-1", eventVersion: 1, streamId: "channel:agent.requests", sequence: "1", transactionKey: "transaction-1", correlationId: "transaction-1", kind: "command", channel: "agent.requests", action: "hash.sha256", source: "client", createdAt: new Date().toISOString(), payload: {} }),
    /worker exited with code 0/,
  );
  await pool.destroy();
});

test("shutdown rejects an active task so its durable attempt can be retried", async () => {
  const pool = createWorkerPool({ minWorkerThreads: 0, maxWorkerThreads: 1, maxQueue: 1, workerUrl: new URL("./worker-hang.fixture.mjs", import.meta.url) });
  const pending = pool.run({ eventId: "event-1", eventVersion: 1, streamId: "channel:agent.requests", sequence: "1", transactionKey: "transaction-1", correlationId: "transaction-1", kind: "command", channel: "agent.requests", action: "hash.sha256", source: "client", createdAt: new Date().toISOString(), payload: {} });
  const rejected = assert.rejects(pending, WorkerLostError);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await pool.destroy();
  await rejected;
});
