import assert from "node:assert/strict";
import test from "node:test";
import { DeliveryStore } from "./store.js";

test("a completed delivery reports delivered so its source can be acknowledged", async () => {
  let delivered = false;
  const store = new DeliveryStore({ query: async (sql: string) => {
    if (sql.startsWith("INSERT INTO event_delivery")) return { rowCount: delivered ? 0 : 1, rows: delivered ? [] : [{ attempt_id: "attempt-1" }] };
    if (sql.startsWith("UPDATE event_delivery SET delivered_at")) { delivered = true; return { rowCount: 1, rows: [] }; }
    return { rowCount: 1, rows: [{ delivered }] };
  } } as never, 30);
  const claim = await store.claim("result-1");
  assert.equal(claim.kind, "claimed");
  if (claim.kind === "claimed") assert.equal(await store.complete("result-1", claim.attemptId), true);
  assert.deepEqual(await store.claim("result-1"), { kind: "delivered" });
});

test("an unexpired lease on an undelivered result reports leased, not delivered", async () => {
  const statements: string[] = [];
  const store = new DeliveryStore({ query: async (sql: string) => {
    statements.push(sql);
    if (sql.startsWith("INSERT INTO event_delivery")) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [{ delivered: false }] };
  } } as never, 30);
  assert.deepEqual(await store.claim("result-1"), { kind: "leased" });
  assert.ok(statements[0].includes("lease_until < now()"));
});

test("the lease window comes from configuration, not a hard-coded interval", async () => {
  const values: unknown[][] = [];
  const store = new DeliveryStore({ query: async (_sql: string, parameters?: unknown[]) => { values.push(parameters ?? []); return { rowCount: 1, rows: [{ attempt_id: "attempt-1" }] }; } } as never, 7);
  await store.claim("result-1");
  assert.equal(values[0]?.[0], "result-1"); assert.equal(values[0]?.[1], 7); assert.equal(typeof values[0]?.[2], "string");
});
