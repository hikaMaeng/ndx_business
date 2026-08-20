import assert from "node:assert/strict";
import test from "node:test";
import { createDerivedDraft, createEventDraft, createIngressEvent, deterministicEventId } from "./index.js";

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

test("a deterministic event id is stable per logical outcome and unique across outcomes", () => {
  assert.equal(deterministicEventId("result:tx-1"), deterministicEventId("result:tx-1"));
  assert.notEqual(deterministicEventId("result:tx-1"), deterministicEventId("result:tx-2"));
  assert.match(deterministicEventId("result:tx-1"), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("an ingress event has a server-issued id but no canonical stream position", () => {
  const ingress = createIngressEvent({ action: "hash.sha256", transactionKey: "tx-1", channel: "agent.requests", payload: {} }, "2026-08-21T00:00:00.000Z");
  assert.equal(ingress.transactionKey, "tx-1");
  assert.equal(ingress.createdAt, "2026-08-21T00:00:00.000Z");
  assert.ok(ingress.eventId.length > 0);
  assert.equal("sequence" in ingress, false);
  assert.equal("streamId" in ingress, false);
});
