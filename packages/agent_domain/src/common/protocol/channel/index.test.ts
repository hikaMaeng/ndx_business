import assert from "node:assert/strict";
import test from "node:test";
import { parseChannelCursor, parseChannelClientFrame } from "./index.js";

test("channel cursor only accepts an opaque UUID reference", () => {
  assert.equal(parseChannelCursor("716c013a-bb36-4b1e-a99f-d59af19e27f3"), "716c013a-bb36-4b1e-a99f-d59af19e27f3");
  assert.equal(parseChannelCursor("not-a-cursor"), undefined);
});

test("channel ingress frames reject server-issued envelope fields", () => {
  assert.equal(parseChannelClientFrame({ type: "event", action: "hash.sha256", payload: {}, eventId: "client-id", sequence: "1" }), undefined);
  assert.equal(parseChannelClientFrame({ type: "subscribe", channels: ["orders"], cursor: 1 }), undefined);
});
