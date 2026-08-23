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
  assert.ok(statements.some((sql) => sql.includes("event_store_channel_stream_sequence_idx")));
  assert.ok(statements.some((sql) => sql.includes("event_store_stored_at_idx")));
  assert.ok(statements.some((sql) => sql.includes("COALESCE(NULLIF(payload->>'sessionKey','')")));
});

test("append records duplicate and latency metrics", async () => {
  const counts: Record<string, number> = {};
  const metrics = { increment: (name: string, amount = 1) => { counts[name] = (counts[name] ?? 0) + amount; } };
  const store = new EventStore({ connect: async () => stubClient(row(), []) } as never, metrics as never);
  await store.append(draft);
  assert.equal(counts.appendDuplicates, 1);
  assert.equal(counts.appendTotal, 1);
});

test("append invokes its durable side effect on the same transaction client", async () => {
  const queries: string[] = []; const client = stubClient(undefined, queries); let callbackClient: unknown;
  const store = new EventStore({ connect: async () => client } as never);
  await store.append(draft, async (received) => { callbackClient = received; await received.query("INSERT INTO event_outbox"); });
  assert.equal(callbackClient, client);
  assert.ok(queries.indexOf("INSERT INTO event_outbox") < queries.findIndex((sql) => sql === "COMMIT"));
});

test("related terminal events and execution completion commit in one transaction", async () => {
  const queries: string[] = []; let sequence = 0;
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      queries.push(sql);
      if (sql.includes("FROM event_store WHERE")) return { rowCount: 0, rows: [] };
      if (sql.includes("RETURNING last_sequence")) return { rowCount: 1, rows: [{ sequence: String(++sequence) }] };
      if (sql.includes("INSERT INTO event_store")) return { rowCount: 1, rows: [row({ event_id: values?.[0], sequence, action: values?.[3], channel: values?.[7], reply_channel: values?.[8] })] };
      return { rowCount: 1, rows: [] };
    }, release: () => undefined,
  };
  const store = new EventStore({ connect: async () => client } as never);
  const events = await store.appendMany([draft, { ...draft, eventId: "event-2", channel: "orders" }], async (received, persisted) => {
    assert.equal(received, client);
    assert.equal(persisted.length, 2);
    await received.query("INSERT INTO event_outbox");
    await received.query("UPDATE agent_execution SET status = 'completed'");
  });
  assert.deepEqual(events.map((event) => event.eventId).sort(), ["event-1", "event-2"]);
  const commit = queries.findIndex((sql) => sql === "COMMIT");
  assert.ok(queries.findIndex((sql) => sql.includes("INSERT INTO event_outbox")) < commit);
  assert.ok(queries.findIndex((sql) => sql.includes("UPDATE agent_execution")) < commit);
});

test("channel replay compares stream positions in PostgreSQL and cursor pruning has a retention bound", async () => {
  const queries: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const store = new EventStore({ query: async (sql: string, values?: unknown[]) => { queries.push({ sql, values }); return { rowCount: 1, rows: [] }; } } as never);
  await store.replayChannels(["orders"], { "session:one": "9007199254740992" }, { "session:one": "9007199254740994" }, 256);
  await store.pruneChannelCursors(7);
  assert.match(queries[0].sql, /jsonb_each_text\(\$3::jsonb\)/);
  assert.match(queries[0].sql, /event_store\.stream_id = bounds\.stream_id/);
  assert.match(queries[0].sql, /LIMIT \$4/);
  assert.deepEqual(queries[0].values, [["orders"], JSON.stringify({ "session:one": "9007199254740992" }), JSON.stringify({ "session:one": "9007199254740994" }), 257]);
  assert.match(queries[1].sql, /event_subscription_cursor/);
  assert.deepEqual(queries[1].values, [7]);
});

test("channel replay reports a bounded page before live routing is allowed", async () => {
  const rows = Array.from({ length: 257 }, (_, index) => row({ event_id: `event-${index}`, sequence: index + 1 }));
  const store = new EventStore({ query: async () => ({ rowCount: rows.length, rows }) } as never);
  const page = await store.replayChannels(["agent.requests"], {}, { "session:one": "257" }, 256);
  assert.equal(page.events.length, 256);
  assert.equal(page.complete, false);
  assert.equal(page.events.at(-1)?.sequence, "256");
});

test("event retention never deletes the durable stream watermark", async () => {
  const statements: string[] = [];
  const store = new EventStore({ query: async (sql: string) => { statements.push(sql); return { rowCount: 3, rows: [] }; } } as never);
  assert.equal(await store.prune(30), 3);
  assert.equal(statements.length, 1);
  assert.match(statements[0]!, /DELETE FROM event_store/);
  assert.doesNotMatch(statements[0]!, /event_stream_sequence/);
});
