import assert from "node:assert/strict";
import test from "node:test";
import { EventStreamHub } from "./hub.js";

const event = (channel: string, eventId: string) => ({ eventId, eventVersion: 1 as const, streamId: `channel:${channel}`, sequence: "1", transactionKey: eventId, correlationId: eventId, kind: "result" as const, channel, action: "test", source: "worker" as const, createdAt: "2026-08-21T00:00:00.000Z", payload: {} });

test("channel reverse index delivers once to interested subscribers and removes empty entries", () => {
  const hub = new EventStreamHub();
  const orders: string[] = []; const telemetry: string[] = [];
  const stopOrders = hub.subscribe(["orders", "orders"], (value) => orders.push(value.eventId));
  hub.subscribe(["telemetry"], (value) => telemetry.push(value.eventId));
  hub.publish(event("orders", "orders-1"));
  hub.publish(event("telemetry", "telemetry-1"));
  assert.deepEqual(orders, ["orders-1"]);
  assert.deepEqual(telemetry, ["telemetry-1"]);
  stopOrders();
  hub.publish(event("orders", "orders-2"));
  assert.deepEqual(orders, ["orders-1"]);
});
