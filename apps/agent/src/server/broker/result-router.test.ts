import assert from "node:assert/strict";
import test from "node:test";
import type { EventEnvelope } from "agent_domain/common";
import { startResultRouter } from "./result-router.js";

const event: EventEnvelope = { eventId: "result-1", eventVersion: 1, streamId: "channel:orders", sequence: "2", action: "hash.sha256.result", transactionKey: "tx-1", correlationId: "tx-1", kind: "result", channel: "orders", source: "worker", createdAt: "2026-08-22T00:00:00.000Z", payload: { ok: true } };

test("router fans one result into only the subscribed Gateway queues", async () => {
  let read = false; const sends: string[] = []; const ensures: string[] = []; const deleted: string[] = [];
  const loop = startResultRouter({
    queue: { read: async () => read ? await new Promise<never>(() => undefined) : (read = true, [{ id: "42", event, headers: null }, { id: "43", event, headers: null }]), ensure: async (queue: string) => { ensures.push(queue); }, send: async (queue: string) => { sends.push(queue); return "x"; }, delete: async (_queue: string, id: string) => { deleted.push(id); } } as never,
    resultQueue: "agent_results", gatewayQueuePrefix: "agent_gateway_",
    subscriptions: { gatewaysFor: async (channel: string) => channel === "orders" ? ["gateway-a", "gateway-b"] : [] } as never,
    metrics: { increment: () => undefined } as never, visibilitySeconds: 60, pollSeconds: 1, maxInFlight: 2,
  });
  await new Promise((resolve) => setTimeout(resolve, 15)); loop.stop();
  assert.deepEqual(new Set(ensures), new Set(["agent_gateway_gateway_a", "agent_gateway_gateway_b"]));
  assert.equal(ensures.length, 2);
  assert.deepEqual(sends.sort(), ["agent_gateway_gateway_a", "agent_gateway_gateway_a", "agent_gateway_gateway_b", "agent_gateway_gateway_b"]);
  assert.deepEqual(deleted.sort(), ["42", "43"]);
});
