import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventEnvelope } from "agent/common";
import { VIBE_ACTIONS } from "../../common/index.js";
import { Sequencer, SessionContext, type ReactorGlobals } from "./context.js";
import { joinTools } from "./tool-join.js";

/**
 * The join is where a turn's parallel branches come back together, and it is
 * the one place the chain's ordering guarantee does not reach: two reactors
 * answering two tool calls are not a causal chain, they are a race.
 *
 * An end-to-end run cannot test this. It would need the model to ask for two
 * commands at once, and whether it does is up to the model — every iteration
 * observed in verification asked for exactly one, so the race never occurred
 * and the bug it hides would have shipped. That is what these are for.
 */

interface Progress { requested: number; completed: number }

function stubSession(progress: Progress, claims: string[]): SessionContext {
  const store = {
    async toolProgress(): Promise<Progress> { return progress; },
    async claimIterationReady(sessionKey: string, turnKey: string, iterationIndex: number): Promise<boolean> {
      const key = `${sessionKey}:${turnKey}:${iterationIndex}`;
      if (claims.includes(key)) return false;
      claims.push(key);
      return true;
    },
  };
  return new SessionContext("s1", "proj", store as unknown as SessionContext["store"], new Sequencer(1, 64));
}

const completedEvent = (iterationIndex: number): EventEnvelope => ({
  eventId: `e${iterationIndex}`, eventVersion: 1, streamId: "vibe.s1", sequence: "1",
  transactionKey: "t", correlationId: "t", kind: "progress", channel: "vibe.s1",
  action: VIBE_ACTIONS.toolCompleted, source: "worker", createdAt: new Date().toISOString(),
  payload: { turnKey: "turn-1", iterationIndex },
} as unknown as EventEnvelope);

const globals = {} as ReactorGlobals;

test("an iteration with calls still outstanding is not declared ready", async () => {
  const emitted: Record<string, unknown>[] = [];
  const result = await joinTools(globals, stubSession({ requested: 3, completed: 2 }, []), completedEvent(0), (p) => emitted.push(p));

  assert.equal(result.ready, false);
  assert.deepEqual(emitted, []);
});

test("two reactors that both see every call answered declare it ready once", async () => {
  // The situation the counts cannot resolve: both read after both writes
  // landed, so both are correct that 2 of 2 are in.
  const claims: string[] = [];
  const progress = { requested: 2, completed: 2 };
  const emitted: Record<string, unknown>[] = [];

  const first = await joinTools(globals, stubSession(progress, claims), completedEvent(0), (p) => emitted.push(p));
  const second = await joinTools(globals, stubSession(progress, claims), completedEvent(0), (p) => emitted.push(p));

  assert.equal(first.ready, true);
  assert.equal(second.ready, false, "the second reactor is right about the counts and still must not say so");
  assert.equal(emitted.length, 1, "two iteration.ready facts would run inference twice on one iteration");
  assert.equal(emitted[0]!.action, VIBE_ACTIONS.iterationReady);
});

test("the fact it records points at the next iteration, not the one that just closed", async () => {
  const emitted: Record<string, unknown>[] = [];
  await joinTools(globals, stubSession({ requested: 1, completed: 1 }, []), completedEvent(4), (p) => emitted.push(p));

  assert.equal(emitted[0]!.iterationIndex, 5);
  assert.equal(emitted[0]!.turnKey, "turn-1");
  // Worker-to-worker: a client has no use for it and the broker never carries it.
  assert.equal(emitted[0]!.audience, "worker");
});

test("a redelivered tool.completed cannot declare the same iteration ready twice", async () => {
  const claims: string[] = [];
  const emitted: Record<string, unknown>[] = [];
  const event = completedEvent(0);

  await joinTools(globals, stubSession({ requested: 1, completed: 1 }, claims), event, (p) => emitted.push(p));
  await joinTools(globals, stubSession({ requested: 1, completed: 1 }, claims), event, (p) => emitted.push(p));

  assert.equal(emitted.length, 1);
});

test("an iteration that asked for nothing is not a completed iteration", async () => {
  const emitted: Record<string, unknown>[] = [];
  const result = await joinTools(globals, stubSession({ requested: 0, completed: 0 }, []), completedEvent(0), (p) => emitted.push(p));

  assert.equal(result.ready, false);
  assert.deepEqual(emitted, [], "0 of 0 is equal, and would otherwise loop the turn back into inference");
});
