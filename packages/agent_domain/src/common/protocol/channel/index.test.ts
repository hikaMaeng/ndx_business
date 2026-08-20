import assert from "node:assert/strict";
import test from "node:test";
import { encodeChannelCursor, parseChannelCursor, parseChannelClientFrame } from "./index.js";

test("channel cursor is bound to its normalized subscription", () => {
  const cursor = encodeChannelCursor(["orders", "agent.results"], { "session:one": "9007199254740993" });
  assert.deepEqual(parseChannelCursor(cursor, ["agent.results", "orders"]), { "session:one": "9007199254740993" });
  assert.equal(parseChannelCursor(cursor, ["orders"]), undefined);
});

test("channel ingress frames reject server-issued envelope fields", () => {
  assert.equal(parseChannelClientFrame({ type: "event", action: "hash.sha256", payload: {}, eventId: "client-id", sequence: "1" }), undefined);
  assert.equal(parseChannelClientFrame({ type: "subscribe", channels: ["orders"], cursor: 1 }), undefined);
});
