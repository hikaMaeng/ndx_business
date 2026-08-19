import assert from "node:assert/strict";
import test from "node:test";
import { DeliveryStore } from "./store.js";

test("a completed delivery cannot be claimed again by source redelivery", async () => {
  let delivered = false;
  const store = new DeliveryStore({ query: async (sql: string) => {
    if (sql.startsWith("INSERT INTO event_delivery")) return { rowCount: delivered ? 0 : 1, rows: [] };
    if (sql.startsWith("UPDATE event_delivery SET delivered_at")) { delivered = true; return { rowCount: 1, rows: [] }; }
    return { rowCount: 0, rows: [] };
  } } as never);
  assert.equal(await store.claim("result-1"), true);
  await store.complete("result-1");
  assert.equal(await store.claim("result-1"), false);
});

test("a live delivery lease prevents concurrent duplicate claims", async () => {
  const statements: string[] = [];
  const store = new DeliveryStore({ query: async (sql: string) => { statements.push(sql); return { rowCount: 0, rows: [] }; } } as never);
  assert.equal(await store.claim("result-1"), false);
  assert.ok(statements[0].includes("lease_until < now()"));
});
