import assert from "node:assert/strict";
import test from "node:test";
import { createEventEnvelope } from "./index.js";

test("a session command derives one server-owned stream and correlation", () => {
  const event = createEventEnvelope({ action: "turn.start", transactionKey: "tx-1", channel: "agent.requests", sessionId: "session-1", payload: {} }, 7, "2026-08-19T00:00:00.000Z");
  assert.equal(event.streamId, "session:session-1");
  assert.equal(event.sequence, 7);
  assert.equal(event.correlationId, "tx-1");
  assert.equal(event.kind, "command");
});
