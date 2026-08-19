import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerPool } from "./pool.js";

test("a worker that exits with code zero rejects its active task", async () => {
  const pool = createWorkerPool({ minWorkerThreads: 0, maxWorkerThreads: 1, maxQueue: 1, workerUrl: new URL("./worker-exit-zero.fixture.mjs", import.meta.url) });
  await assert.rejects(
    pool.run({ eventId: "event-1", transactionKey: "transaction-1", kind: "request", channel: "agent.requests", action: "hash.sha256", source: "test", createdAt: new Date().toISOString(), payload: {} }),
    /worker exited with code 0/,
  );
  await pool.destroy();
});
