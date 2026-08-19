import assert from "node:assert/strict";
import test from "node:test";
import type { EventDraft } from "agent_domain/common";
import { EventStore } from "./store.js";

const draft: EventDraft = {
  eventId: "event-1", eventVersion: 1, kind: "command", streamId: "session:one", action: "turn.start",
  transactionKey: "tx-1", channel: "agent.requests", correlationId: "tx-1", source: "client",
  createdAt: "2026-08-19T00:00:00.000Z", payload: { input: "value" },
};

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: draft.eventId, stream_id: draft.streamId, sequence: 4, action: draft.action,
    transaction_key: draft.transactionKey, event_version: 1, kind: draft.kind, channel: draft.channel, reply_channel: null,
    session_id: null, run_id: null, turn_id: null, causation_event_id: null, correlation_id: draft.correlationId,
    source: draft.source, payload: draft.payload, created_at: draft.createdAt, ...overrides,
  };
}

function stubClient(stored: Record<string, unknown> | undefined, queries: string[]): { query: (sql: string) => Promise<unknown>; release: () => void } {
  return {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("FROM event_store WHERE")) return stored ? { rowCount: 1, rows: [stored] } : { rowCount: 0, rows: [] };
      if (sql.includes("RETURNING last_sequence")) return { rowCount: 1, rows: [{ sequence: "12" }] };
      if (sql.includes("INSERT INTO event_store")) return { rowCount: 1, rows: [row({ sequence: "12", causation_event_id: "cause-1" })] };
      return { rowCount: 0, rows: [] };
    },
    release: () => undefined,
  };
}

test("append returns the already persisted envelope without reserving another sequence", async () => {
  const queries: string[] = [];
  const client = stubClient(row(), queries);
  const store = new EventStore({ connect: async () => client } as never);
  const result = await store.append(draft);
  assert.equal(result.sequence, "4");
  assert.equal(result.streamId, "session:one");
  assert.equal(queries.some((sql) => sql.includes("pg_advisory_xact_lock")), true);
  assert.equal(queries.some((sql) => sql.includes("RETURNING last_sequence")), false);
  assert.equal(queries.some((sql) => sql.includes("ON CONFLICT (event_id) DO NOTHING")), false);
});

test("a bigint sequence remains an exact decimal string on the envelope", async () => {
  const queries: string[] = [];
  const store = new EventStore({ connect: async () => stubClient(undefined, queries) } as never);
  const result = await store.append({ ...draft, causationEventId: "cause-1" });
  assert.equal(typeof result.sequence, "string");
  assert.equal(result.sequence, "12");
  assert.equal(result.causationEventId, "cause-1");
});

test("sequence counter migration starts after every existing stream position", async () => {
  const statements: string[] = [];
  const pool = { query: async (sql: string) => { statements.push(sql); return { rowCount: 0, rows: [] }; } };
  await new EventStore(pool as never).ensureSchema();
  assert.ok(statements.some((sql) => sql.includes("SELECT stream_id, max(sequence) FROM event_store GROUP BY stream_id")));
});

test("append records duplicate and latency metrics", async () => {
  const counts: Record<string, number> = {};
  const metrics = { increment: (name: string, amount = 1) => { counts[name] = (counts[name] ?? 0) + amount; } };
  const store = new EventStore({ connect: async () => stubClient(row(), []) } as never, metrics as never);
  await store.append(draft);
  assert.equal(counts.appendDuplicates, 1);
  assert.equal(counts.appendTotal, 1);
});
