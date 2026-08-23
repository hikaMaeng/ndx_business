import assert from "node:assert/strict";
import test from "node:test";
import { DeliveryStore } from "./store.js";

test("outbox claims ready and expired leases through separately indexed branches", async () => {
  const queries: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const store = new DeliveryStore({ query: async (sql: string, values?: unknown[]) => {
    queries.push({ sql, values });
    return { rowCount: 2, rows: [{ event: { eventId: "one" }, queue_name: "results", attempt_id: "attempt-one", attempts: 2 }, { event: { eventId: "two" }, queue_name: "results", attempt_id: "attempt-two", attempts: 3 }] };
  } } as never, 30);
  const claims = await store.claimMany(128);
  assert.deepEqual(claims.map((claim) => [claim.event.eventId, claim.attempts]), [["one", 2], ["two", 3]]);
  assert.match(queries[0]!.sql, /WITH ready AS/);
  assert.match(queries[0]!.sql, /expired AS/);
  assert.doesNotMatch(queries[0]!.sql, / OR /);
  assert.deepEqual(queries[0]!.values, [30, 128]);
});

test("outbox completion returns exact fenced event ids so only lost fences are retried", async () => {
  const store = new DeliveryStore({ query: async () => ({ rowCount: 1, rows: [{ event_id: "one" }] }) } as never, 30);
  assert.deepEqual(await store.completeMany([{ eventId: "one", attemptId: "a" }, { eventId: "two", attemptId: "b" }]), ["one"]);
  assert.equal(await store.complete("one", "a"), true);
});

test("outbox retry makes the final failed delivery dead and preserves its reason", async () => {
  const values: unknown[][] = [];
  const store = new DeliveryStore({ query: async (_sql: string, parameters?: unknown[]) => {
    values.push(parameters ?? []);
    return { rowCount: 2, rows: [{ status: "ready" }, { status: "dead" }] };
  } } as never, 30);
  const outcome = await store.retryMany([{ eventId: "one", attemptId: "a" }, { eventId: "two", attemptId: "b" }], 5, "queue missing");
  assert.deepEqual(outcome, { ready: 1, dead: 1 });
  assert.deepEqual(values[0], [["one", "two"], ["a", "b"], 5, "queue missing"]);
});
