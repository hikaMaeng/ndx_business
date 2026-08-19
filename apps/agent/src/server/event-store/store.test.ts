import assert from "node:assert/strict";
import test from "node:test";
import type { EventDraft } from "agent_domain/common";
import { EventStore } from "./store.js";

const draft: EventDraft = {
  eventId: "event-1", eventVersion: 1, kind: "command", streamId: "session:one", action: "turn.start",
  transactionKey: "tx-1", channel: "agent.requests", correlationId: "tx-1", source: "client",
  createdAt: "2026-08-19T00:00:00.000Z", payload: { input: "value" },
};

test("append returns the already persisted envelope without reserving another sequence", async () => {
  const queries: string[] = [];
  const storedRow = {
    event_id: draft.eventId, stream_id: draft.streamId, sequence: 4, action: draft.action,
    transaction_key: draft.transactionKey, event_version: 1 as const, kind: draft.kind, channel: draft.channel, reply_channel: null,
    session_id: null, run_id: null, turn_id: null, correlation_id: draft.correlationId, source: draft.source, payload: draft.payload, created_at: draft.createdAt,
  };
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("FROM event_store WHERE")) return { rowCount: 1, rows: [storedRow] };
      return { rowCount: 0, rows: [] };
    },
    release: () => undefined,
  };
  const store = new EventStore({ connect: async () => client } as never);
  const result = await store.append(draft);
  assert.equal(result.sequence, 4);
  assert.equal(result.streamId, "session:one");
  assert.equal(queries.some((sql) => sql.includes("pg_advisory_xact_lock")), true);
  assert.equal(queries.some((sql) => sql.includes("RETURNING last_sequence")), false);
  assert.equal(queries.some((sql) => sql.includes("ON CONFLICT (event_id) DO NOTHING")), false);
});
