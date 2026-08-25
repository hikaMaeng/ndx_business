import assert from "node:assert/strict";
import test from "node:test";
import { GatewaySubscriptionStore } from "./store.js";

test("a Gateway identity held by another live instance stays passive until its lease can be retried", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new GatewaySubscriptionStore({ query: async (sql: string, values?: unknown[]) => { queries.push({ sql, values }); return { rowCount: 0, rows: [] }; } } as never, 30);
  const claim = await store.claimGateway("agent", "a2c63d50-b2e3-4b1c-8be5-cc8c87c1b606");
  assert.deepEqual(claim, { owned: false, retryAfterMs: 100 });
  assert.match(queries[0]!.sql, /WHERE agent_gateway_instance\.instance_id=\$2::uuid OR agent_gateway_instance\.lease_until < now\(\)/);
  assert.match(queries[1]!.sql, /lease_until - now\(\)/);
});

test("only the owning Gateway instance can renew its identity lease", async () => {
  const queries: string[] = [];
  const store = new GatewaySubscriptionStore({ query: async (sql: string) => { queries.push(sql); return { rowCount: 0, rows: [] }; } } as never, 30);
  assert.equal(await store.renewGateway("agent", "a2c63d50-b2e3-4b1c-8be5-cc8c87c1b606"), false);
  assert.equal(queries.length, 1);
  assert.match(queries[0]!, /instance_id = \$2::uuid/);
});

test("expired instance leases are pruned with their expired subscriptions", async () => {
  const queries: string[] = [];
  const store = new GatewaySubscriptionStore({ query: async (sql: string) => { queries.push(sql); return { rowCount: 2, rows: [] }; } } as never, 30);
  assert.equal(await store.pruneExpired(), 4);
  assert.match(queries[0]!, /agent_gateway_subscription/);
  assert.match(queries[1]!, /agent_gateway_instance/);
});
