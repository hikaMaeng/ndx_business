import assert from "node:assert/strict";
import test from "node:test";
import { ExecutionStore } from "./store.js";

test("expired execution leases are observed without converting retryable work into a terminal result", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new ExecutionStore({ query: async (sql: string, values?: unknown[]) => { queries.push({ sql, values }); return { rowCount: 1, rows: [{ count: "2" }] }; } } as never, 120);
  assert.equal(await store.expiredRunningCount(), 2);
  assert.match(queries[0]!.sql, /SELECT count\(\*\)/);
  assert.doesNotMatch(queries[0]!.sql, /UPDATE agent_execution/);
});

test("execution schema indexes terminal retention and expired lease observation", async () => {
  const statements: string[] = [];
  const store = new ExecutionStore({ query: async (sql: string) => { statements.push(sql); return { rowCount: 0, rows: [] }; } } as never, 120);
  await store.ensureSchema();
  assert.ok(statements.some((sql) => sql.includes("agent_execution_completed_idx")));
  assert.ok(statements.some((sql) => sql.includes("agent_execution_running_lease_idx")));
});
