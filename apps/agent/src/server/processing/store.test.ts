import assert from "node:assert/strict";
import test from "node:test";
import { ProcessingStore } from "./store.js";

test("operational retention prunes published outbox rows without touching immutable events", async () => {
  const queries: string[] = [];
  const store = new ProcessingStore({ query: async (sql: string) => { queries.push(sql); return { rowCount: 3, rows: [] }; } } as never, 60);
  assert.deepEqual(await store.pruneOperationalLedgers(30), { processingJobs: 3, processingAttempts: 3, outbox: 3 });
  assert.match(queries[1], /DELETE FROM event_processing_attempt/);
  assert.match(queries[2], /DELETE FROM event_outbox WHERE status = 'published'/);
  assert.equal(queries.some((sql) => sql.includes("DELETE FROM event_store")), false);
});

test("attempt ledger records worker ownership and keeps one active attempt per event", async () => {
  const queries: string[] = [];
  const store = new ProcessingStore({ query: async (sql: string) => { queries.push(sql); return { rowCount: 1, rows: [] }; } } as never, 60);
  await store.ensureSchema();
  await store.startAttempt("event-1", "attempt-1", "worker-1");
  assert.ok(queries.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS event_processing_attempt")));
  assert.ok(queries.some((sql) => sql.includes("event_processing_attempt_active_idx")));
  assert.ok(queries.at(-1)?.includes("worker_id = $3"));
});
