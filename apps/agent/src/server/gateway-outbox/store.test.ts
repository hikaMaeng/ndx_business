import assert from "node:assert/strict";
import test from "node:test";
import { GatewayOutboxStore } from "./store.js";

const event = { eventId: "event-1", eventVersion: 1, streamId: "channel:orders", sequence: "1", action: "done", transactionKey: "tx", correlationId: "tx", kind: "result", channel: "orders", source: "worker", createdAt: "2026-08-24T00:00:00.000Z", payload: { ok: true } } as const;

test("Gateway outbox records every target before the result source is acknowledged", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new GatewayOutboxStore({ query: async (sql: string, values?: unknown[]) => { calls.push({ sql, values }); return { rowCount: 1, rows: [{ gateway_id: "gateway-b" }] }; } } as never);
  await store.record(event, [{ gatewayId: "gateway-a", queueName: "agent_gateway_gateway_a" }, { gatewayId: "gateway-b", queueName: "agent_gateway_gateway_b" }]);
  assert.deepEqual(await store.pending("event-1", ["gateway-a", "gateway-b"]), ["gateway-b"]);
  assert.equal(await store.delivered("event-1", "gateway-b"), true);
  assert.match(calls[0]!.sql, /agent_gateway_delivery/);
  assert.deepEqual(calls[0]!.values?.slice(2), [["gateway-a", "gateway-b"], ["agent_gateway_gateway_a", "agent_gateway_gateway_b"]]);
});
