import assert from "node:assert/strict";
import test from "node:test";
import { ProcessingStore } from "./store.js";

test("operational retention prunes published outbox rows without touching immutable events", async () => {
  const queries: string[] = [];
  const store = new ProcessingStore({ query: async (sql: string) => { queries.push(sql); return { rowCount: 3, rows: [] }; } } as never, 60);
  assert.deepEqual(await store.pruneOperationalLedgers(30), { processingJobs: 3, outbox: 3 });
  assert.match(queries[1], /DELETE FROM event_outbox WHERE status = 'published'/);
  assert.equal(queries.some((sql) => sql.includes("DELETE FROM event_store")), false);
});
