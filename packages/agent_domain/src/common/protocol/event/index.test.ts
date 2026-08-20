import assert from "node:assert/strict";
import test from "node:test";
import { createDerivedDraft, createEventDraft, createIngressEvent } from "./index.js";

test("a session command derives one server-owned stream and correlation", () => {
  const event = createEventDraft({ action: "turn.start", transactionKey: "tx-1", channel: "agent.requests", sessionId: "session-1", payload: {} }, "2026-08-19T00:00:00.000Z");
  assert.equal(event.streamId, "session:session-1");
  assert.equal("sequence" in event, false);
  assert.equal(event.correlationId, "tx-1");
  assert.equal(event.kind, "command");
});

test("a derived draft inherits stream identity and records its cause", () => {
  const cause = { ...createEventDraft({ action: "turn.start", transactionKey: "tx-1", channel: "agent.requests", replyChannel: "agent.results", sessionId: "session-1", runId: "run-1", turnId: "turn-1", payload: {} }, "2026-08-19T00:00:00.000Z"), sequence: "3" };
  const derived = createDerivedDraft(cause, { eventId: "derived-1", action: "turn.start.result", kind: "result", payload: { ok: true } });
  assert.equal(derived.streamId, cause.streamId);
  assert.deepEqual([derived.sessionId, derived.runId, derived.turnId], ["session-1", "run-1", "turn-1"]);
  assert.equal(derived.causationEventId, cause.eventId);
  assert.equal(derived.correlationId, "tx-1");
  assert.equal(derived.channel, "agent.results");
});

test("an ingress event has a server-issued id but no canonical stream position", () => {
  const ingress = createIngressEvent({ action: "hash.sha256", transactionKey: "tx-1", channel: "agent.requests", payload: {} }, "2026-08-21T00:00:00.000Z");
  assert.equal(ingress.transactionKey, "tx-1");
  assert.equal(ingress.createdAt, "2026-08-21T00:00:00.000Z");
  assert.ok(ingress.eventId.length > 0);
  assert.equal("sequence" in ingress, false);
  assert.equal("streamId" in ingress, false);
});
