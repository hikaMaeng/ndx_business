import assert from "node:assert/strict";
import test from "node:test";
import { claimExecution } from "./store.js";

const event = { eventId: "conflict-event", eventVersion: 1 as const, streamId: "channel:agent.requests", sequence: "1", transactionKey: "conflict-transaction", correlationId: "conflict-transaction", kind: "command" as const, channel: "agent.requests", replyChannel: "orders", action: "hash.sha256", source: "client" as const, createdAt: new Date().toISOString(), payload: { input: "different" } };

test("a conflicting payload cannot reclaim an expired execution lease", async () => {
  const queries: string[] = [];
  const pool = { query: async (sql: string) => {
    queries.push(sql);
    if (sql.startsWith("INSERT INTO agent_execution (")) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [{ status: "running", result: null, payload_hash: "stored-other-payload", reclaimed: false }] };
  } } as never;
  const result = await claimExecution(pool, event, "attempt-2", 60);
  assert.deepEqual(result, { kind: "conflict", reason: "transactionKey reused with a different action or payload" });
  assert.match(queries[1] ?? "", /AND \(payload_hash IS NULL OR payload_hash = \$3\)/);
});

test("a matching payload reclaims and makes the reclaimer the canonical failure owner", async () => {
  const queries: string[] = [];
  const pool = { query: async (sql: string) => {
    queries.push(sql);
    if (sql.startsWith("INSERT INTO agent_execution (")) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [{ status: "running", result: null, payload_hash: null, request_event_id: "old-event", reclaimed: true }] };
  } } as never;
  const result = await claimExecution(pool, event, "attempt-2", 60);
  assert.deepEqual(result, { kind: "claimed" });
  assert.match(queries[1] ?? "", /request_event_id = \$7/);
});
