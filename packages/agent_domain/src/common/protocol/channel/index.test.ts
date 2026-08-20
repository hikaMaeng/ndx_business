import assert from "node:assert/strict";
import test from "node:test";
import { parseChannelCursor, parseChannelClientFrame, parseChannelServerFrame } from "./index.js";

test("channel cursor only accepts an opaque UUID reference", () => {
  assert.equal(parseChannelCursor("716c013a-bb36-4b1e-a99f-d59af19e27f3"), "716c013a-bb36-4b1e-a99f-d59af19e27f3");
  assert.equal(parseChannelCursor("not-a-cursor"), undefined);
});

test("channel ingress frames reject server-issued envelope fields", () => {
  assert.equal(parseChannelClientFrame({ type: "event", action: "hash.sha256", payload: {}, eventId: "client-id", sequence: "1" }), undefined);
  assert.equal(parseChannelClientFrame({ type: "subscribe", channels: ["orders"], cursor: 1 }), undefined);
});

test("channel egress frames require every canonical envelope field", () => {
  const event = { eventId: "event-1", streamId: "session:one", sequence: "9007199254740993", action: "hash.sha256.result", transactionKey: "tx-1", eventVersion: 1, kind: "result", channel: "agent.results", correlationId: "tx-1", source: "worker", createdAt: "2026-08-21T00:00:00.000Z", payload: {} };
  assert.equal(parseChannelServerFrame({ type: "event", cursor: "716c013a-bb36-4b1e-a99f-d59af19e27f3", event })?.type, "event");
  assert.equal(parseChannelServerFrame({ type: "event", cursor: "716c013a-bb36-4b1e-a99f-d59af19e27f3", event: { ...event, source: "other" } }), undefined);
  assert.equal(parseChannelServerFrame({ type: "event", cursor: "716c013a-bb36-4b1e-a99f-d59af19e27f3", event: { ...event, correlationId: undefined } }), undefined);
});
