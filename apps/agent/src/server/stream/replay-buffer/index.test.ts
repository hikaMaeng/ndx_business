import assert from "node:assert/strict";
import test from "node:test";
import { ReplayBuffer } from "./index.js";

const event = (kind: "result" | "progress", eventId: string) => ({ eventId, eventVersion: 1 as const, streamId: "session:one", sequence: eventId, transactionKey: eventId, correlationId: eventId, kind, channel: "orders", action: "test", source: "server" as const, createdAt: "2026-08-21T00:00:00.000Z", payload: {} });

test("replay buffer bounds live handoff without discarding terminal events", () => {
  const buffer = new ReplayBuffer(1);
  assert.equal(buffer.push(event("result", "1")), "queued");
  assert.equal(buffer.push(event("progress", "2")), "dropped");
  assert.equal(buffer.push(event("result", "3")), "overflow");
  assert.equal(buffer.push(event("result", "4")), "overflow");
  assert.deepEqual(buffer.drain().map((value) => value.eventId), ["1"]);
});
