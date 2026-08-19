import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { startConsumer } from "./consumer.js";

test("a conflict acknowledges only its message and keeps the consumer loop alive", async () => {
  const event = { eventId: "event-1", transactionKey: "transaction-1", kind: "request" as const, channel: "agent.requests", action: "hash.sha256", source: "test", createdAt: new Date().toISOString(), payload: { input: "value" } };
  let reads = 0;
  const deleted: string[] = [];
  const persisted: string[] = [];
  const queue = {
    send: async () => "result-message",
    read: async () => {
      reads += 1;
      if (reads === 1) return [{ id: "source-message", event, headers: null }];
      return await new Promise<never>(() => undefined);
    },
    delete: async (_queue: string, id: string) => { deleted.push(id); },
    extendVisibility: async () => undefined,
    check: async () => undefined,
  };
  const database = {
    query: async (sql: string) => sql.startsWith("INSERT")
      ? { rowCount: 0, rows: [] }
      : { rowCount: 1, rows: [{ status: "running", result: null, payload_hash: createHash("sha256").update("different").digest("hex") }] },
  };
  const consumer = startConsumer({
    queueTransport: queue,
    database: database as never,
    pool: { run: async () => ({ value: undefined }), destroy: async () => undefined },
    hub: { publish: () => undefined } as never,
    eventStore: { append: async (draft: { eventId: string }) => { persisted.push(draft.eventId); return { ...draft, sequence: "1" }; } } as never,
    deliveryStore: { claim: async () => true, complete: async () => undefined } as never,
    metrics: { increment: () => undefined } as never,
    queue: "agent_requests",
    resultQueue: "agent_results",
    visibilityTimeoutSeconds: 1,
    pollSeconds: 1,
    batchSize: 1,
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  consumer.stop();
  assert.ok(reads >= 2);
  assert.equal(persisted[0], "event-1");
  assert.equal(persisted.length, 2);
  assert.deepEqual(deleted, ["source-message"]);
});

test("egress failure does not rewrite a completed execution or acknowledge its source", async () => {
  const event = { eventId: "event-success", transactionKey: "transaction-success", kind: "request" as const, channel: "agent.requests", action: "hash.sha256", source: "test", createdAt: new Date().toISOString(), payload: { input: "value" } };
  const updates: unknown[][] = [];
  const deleted: string[] = [];
  let reads = 0;
  const queue = {
    send: async () => { throw new Error("result queue unavailable"); },
    read: async () => ++reads === 1 ? [{ id: "source-message", event, headers: null }] : await new Promise<never>(() => undefined),
    delete: async (_queue: string, id: string) => { deleted.push(id); }, extendVisibility: async () => undefined, check: async () => undefined,
  };
  const database = { query: async (sql: string, values?: unknown[]) => {
    if (sql.startsWith("INSERT")) return { rowCount: 1, rows: [] };
    if (sql.startsWith("UPDATE")) { updates.push(values ?? []); return { rowCount: 1, rows: [] }; }
    return { rowCount: 0, rows: [] };
  } };
  const consumer = startConsumer({
    queueTransport: queue, database: database as never,
    pool: { run: async () => ({ value: "ok" }), destroy: async () => undefined }, hub: { publish: () => undefined } as never,
    eventStore: { append: async (draft: Record<string, unknown>) => ({ ...draft, sequence: "1" }) } as never,
    deliveryStore: { claim: async () => true, complete: async () => undefined } as never,
    metrics: { increment: () => undefined } as never, queue: "agent_requests", resultQueue: "agent_results", visibilityTimeoutSeconds: 1, pollSeconds: 1, batchSize: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  consumer.stop();
  assert.deepEqual(updates.map((values) => values[1]), ["completed"]);
  assert.deepEqual(deleted, []);
});

test("a durable-state failure releases the visibility timer instead of stranding the message", async () => {
  const event = { eventId: "event-strand", transactionKey: "transaction-strand", kind: "request" as const, channel: "agent.requests", action: "hash.sha256", source: "test", createdAt: new Date().toISOString(), payload: { input: "value" } };
  let reads = 0;
  let extendCalls = 0;
  const deleted: string[] = [];
  const queue = {
    send: async () => "result-message",
    read: async () => ++reads === 1 ? [{ id: "source-message", event, headers: null }] : await new Promise<never>(() => undefined),
    delete: async (_queue: string, id: string) => { deleted.push(id); },
    extendVisibility: async () => { extendCalls += 1; },
    check: async () => undefined,
  };
  const database = { query: async (sql: string) => {
    if (sql.startsWith("INSERT")) return { rowCount: 1, rows: [] };
    if (sql.startsWith("UPDATE")) throw new Error("durable state unavailable");
    return { rowCount: 0, rows: [] };
  } };
  const consumer = startConsumer({
    queueTransport: queue, database: database as never,
    pool: { run: async () => ({ value: "ok" }), destroy: async () => undefined }, hub: { publish: () => undefined } as never,
    eventStore: { append: async (draft: Record<string, unknown>) => ({ ...draft, sequence: "1" }) } as never,
    deliveryStore: { claim: async () => "claimed", complete: async () => undefined } as never,
    metrics: { increment: () => undefined } as never, queue: "agent_requests", resultQueue: "agent_results", visibilityTimeoutSeconds: 2, pollSeconds: 1, batchSize: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 2600));
  consumer.stop();
  const settled = extendCalls;
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.deepEqual(deleted, []);
  assert.equal(extendCalls, settled, "the visibility timer kept running after the failure");
});

test("a result leased by an unfinished attempt is neither sent nor acknowledged", async () => {
  const event = { eventId: "event-leased", transactionKey: "transaction-leased", kind: "request" as const, channel: "agent.requests", action: "hash.sha256", source: "test", createdAt: new Date().toISOString(), payload: { input: "value" } };
  let reads = 0;
  const sent: string[] = [];
  const deleted: string[] = [];
  const queue = {
    send: async (target: string) => { sent.push(target); return "result-message"; },
    read: async () => ++reads === 1 ? [{ id: "source-message", event, headers: null }] : await new Promise<never>(() => undefined),
    delete: async (_queue: string, id: string) => { deleted.push(id); }, extendVisibility: async () => undefined, check: async () => undefined,
  };
  const database = { query: async (sql: string) => sql.startsWith("INSERT") ? { rowCount: 1, rows: [] } : { rowCount: 1, rows: [] } };
  const consumer = startConsumer({
    queueTransport: queue, database: database as never,
    pool: { run: async () => ({ value: "ok" }), destroy: async () => undefined }, hub: { publish: () => undefined } as never,
    eventStore: { append: async (draft: Record<string, unknown>) => ({ ...draft, sequence: "1" }) } as never,
    deliveryStore: { claim: async () => "leased", complete: async () => undefined } as never,
    metrics: { increment: () => undefined } as never, queue: "agent_requests", resultQueue: "agent_results", visibilityTimeoutSeconds: 2, pollSeconds: 1, batchSize: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  consumer.stop();
  assert.deepEqual(sent, []);
  assert.deepEqual(deleted, []);
});

test("an already delivered result acknowledges its source without sending again", async () => {
  const event = { eventId: "event-delivered", transactionKey: "transaction-delivered", kind: "request" as const, channel: "agent.requests", action: "hash.sha256", source: "test", createdAt: new Date().toISOString(), payload: { input: "value" } };
  let reads = 0;
  const sent: string[] = [];
  const deleted: string[] = [];
  const queue = {
    send: async (target: string) => { sent.push(target); return "result-message"; },
    read: async () => ++reads === 1 ? [{ id: "source-message", event, headers: null }] : await new Promise<never>(() => undefined),
    delete: async (_queue: string, id: string) => { deleted.push(id); }, extendVisibility: async () => undefined, check: async () => undefined,
  };
  const database = { query: async () => ({ rowCount: 1, rows: [] }) };
  const consumer = startConsumer({
    queueTransport: queue, database: database as never,
    pool: { run: async () => ({ value: "ok" }), destroy: async () => undefined }, hub: { publish: () => undefined } as never,
    eventStore: { append: async (draft: Record<string, unknown>) => ({ ...draft, sequence: "1" }) } as never,
    deliveryStore: { claim: async () => "delivered", complete: async () => undefined } as never,
    metrics: { increment: () => undefined } as never, queue: "agent_requests", resultQueue: "agent_results", visibilityTimeoutSeconds: 2, pollSeconds: 1, batchSize: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  consumer.stop();
  assert.deepEqual(sent, []);
  assert.deepEqual(deleted, ["source-message"]);
});

test("a durable-state failure is not reported to the client as a worker failure", async () => {
  const event = { eventId: "event-infra", transactionKey: "transaction-infra", kind: "request" as const, channel: "agent.requests", action: "hash.sha256", source: "test", createdAt: new Date().toISOString(), payload: { input: "value" } };
  let reads = 0;
  const appended: Record<string, unknown>[] = [];
  const queue = {
    send: async () => "result-message",
    read: async () => ++reads === 1 ? [{ id: "source-message", event, headers: null }] : await new Promise<never>(() => undefined),
    delete: async () => undefined, extendVisibility: async () => undefined, check: async () => undefined,
  };
  const database = { query: async (sql: string) => {
    if (sql.startsWith("INSERT")) return { rowCount: 1, rows: [] };
    if (sql.startsWith("UPDATE")) throw new Error("durable state unavailable");
    return { rowCount: 0, rows: [] };
  } };
  const consumer = startConsumer({
    queueTransport: queue, database: database as never,
    pool: { run: async () => ({ value: "ok" }), destroy: async () => undefined }, hub: { publish: () => undefined } as never,
    eventStore: { append: async (draft: Record<string, unknown>) => { appended.push(draft); return { ...draft, sequence: "1" }; } } as never,
    deliveryStore: { claim: async () => "claimed", complete: async () => undefined } as never,
    metrics: { increment: () => undefined } as never, queue: "agent_requests", resultQueue: "agent_results", visibilityTimeoutSeconds: 2, pollSeconds: 1, batchSize: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  consumer.stop();
  assert.deepEqual(appended.map((draft) => draft.kind), ["command"]);
});
