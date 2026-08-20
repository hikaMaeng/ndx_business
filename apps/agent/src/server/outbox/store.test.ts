import assert from "node:assert/strict";
import test from "node:test";
import type { EventEnvelope } from "agent_domain/common";
import { OutboxStore } from "./store.js";

const event: EventEnvelope = { eventId: "result-1", streamId: "session:one", sequence: "2", action: "hash.sha256.result", transactionKey: "tx-1", eventVersion: 1, kind: "result", channel: "agent.results", correlationId: "tx-1", source: "worker", createdAt: "2026-08-21T00:00:00.000Z", payload: { ok: true } };

test("outbox enqueue uses its caller transaction and claim completion is fenced", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const client = { query: async (sql: string, values?: unknown[]) => { queries.push({ sql, values }); return { rowCount: 1, rows: [{ event_id: event.eventId, attempt_id: "attempt-1", event }] }; } };
  const store = new OutboxStore(client as never, 30);
  await store.enqueue(client as never, event);
  const claimed = await store.claimNext();
  const completed = await store.complete(event.eventId, "attempt-1");
  assert.equal(claimed?.eventId, event.eventId);
  assert.equal(completed, true);
  assert.match(queries[0].sql, /ON CONFLICT \(event_id\) DO NOTHING/);
  assert.match(queries[1].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(queries[2].sql, /attempt_id = \$2/);
});
