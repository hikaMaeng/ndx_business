import assert from "node:assert/strict";
import test from "node:test";
import { ProjectionStore } from "./store.js";

test("a projection checkpoint advances independently after its own view upsert", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const client = { query: async (sql: string, values?: unknown[]) => {
    queries.push({ sql, values });
    if (sql.startsWith("SELECT positions")) return { rowCount: 1, rows: [{ positions: { "session:one": "1" } }] };
    if (sql.includes("FROM event_store")) return { rowCount: 1, rows: [{ event_id: "event-2", stream_id: "session:one", sequence: "2", action: "turn.final.response", transaction_key: "tx-1", event_version: 1, kind: "result", channel: "agent.results", reply_channel: null, session_id: "one", run_id: "run-1", turn_id: "turn-1", causation_event_id: null, correlation_id: "tx-1", source: "worker", payload: { output: "ok" }, created_at: "2026-08-21T00:00:00.000Z" }] };
    return { rowCount: 1, rows: [] };
  }, release: () => undefined };
  const store = new ProjectionStore({ connect: async () => client } as never);
  assert.equal(await store.applyBatch("turn", 32), 1);
  const view = queries.find((query) => query.sql.includes("INSERT INTO turn_view"));
  const checkpoint = queries.find((query) => query.sql.includes("event_projection_checkpoint") && query.sql.includes("ON CONFLICT"));
  assert.ok(view); assert.ok(checkpoint);
  assert.deepEqual(checkpoint?.values, ["turn", JSON.stringify({ "session:one": "2" })]);
});
