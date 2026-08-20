import assert from "node:assert/strict";
import test from "node:test";
import type { IngressEvent } from "agent_domain/common";
import { toEventDraft, toResultDraft } from "./event-draft.js";

const request: IngressEvent = {
  eventId: "request-1", transactionKey: "tx-1", channel: "agent.requests",
  action: "turn.start", replyChannel: "agent.results",
  createdAt: "2026-08-19T00:00:00.000Z", payload: { sessionKey: "s-1", runKey: "r-1", turnKey: "t-1" },
};

test("a request draft takes its stream and identity from the session payload keys", () => {
  const draft = toEventDraft(request);
  assert.equal(draft.streamId, "session:s-1");
  assert.deepEqual([draft.sessionId, draft.runId, draft.turnId], ["s-1", "r-1", "t-1"]);
});

test("a result draft stays in the request stream and records causation", () => {
  const persisted = { ...toEventDraft(request), sequence: "1" };
  const draft = toResultDraft(persisted, { eventId: "result-1", action: "turn.start.result", channel: "agent.results", createdAt: request.createdAt, payload: { ok: true } });
  assert.equal(draft.streamId, "session:s-1");
  assert.equal(draft.sessionId, "s-1");
  assert.equal(draft.runId, "r-1");
  assert.equal(draft.turnId, "t-1");
  assert.equal(draft.causationEventId, "request-1");
  assert.equal(draft.correlationId, "tx-1");
  assert.equal(draft.kind, "result");
  assert.equal(draft.channel, "agent.results");
});
