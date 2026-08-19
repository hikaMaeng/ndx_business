import assert from "node:assert/strict";
import test from "node:test";
import { createEventDraft } from "./index.js";

test("a session command derives one server-owned stream and correlation", () => {
  const event = createEventDraft({ action: "turn.start", transactionKey: "tx-1", channel: "agent.requests", sessionId: "session-1", payload: {} }, "2026-08-19T00:00:00.000Z");
  assert.equal(event.streamId, "session:session-1");
  assert.equal("sequence" in event, false);
  assert.equal(event.correlationId, "tx-1");
  assert.equal(event.kind, "command");
});
