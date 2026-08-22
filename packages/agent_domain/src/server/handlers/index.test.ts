import assert from "node:assert/strict";
import test from "node:test";
import { createEventDraft } from "../../common/protocol/event/index.js";
import { executeHandler } from "./index.js";

const event = (action: string, payload: Record<string, unknown> = {}) => ({ ...createEventDraft({ action, transactionKey: "worker-test", channel: "agent.requests", payload }), sequence: "1" });

test("the static registry selects hash and generic handlers", async () => {
  assert.equal(await executeHandler(event("hash.sha256", { input: "abc" }), new AbortController().signal), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.deepEqual(await executeHandler(event("session.create.request", { value: 1 }), new AbortController().signal), { acknowledgedAction: "session.create.request", payload: { value: 1 }, worker: "agent-worker" });
});

test("an aborted handler fails before side effects", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(executeHandler(event("hash.sha256", { input: "abc" }), controller.signal), /worker operation aborted/);
});

test("the benchmark delay handler honours its requested duration", async () => {
  const signal = new AbortController();
  const started = performance.now();
  const value = await executeHandler({ action: "test.delay", payload: { simulateDelayMs: 10 } } as never, signal.signal);
  assert.deepEqual(value, { delayedMs: 10 });
  assert.ok(performance.now() - started >= 8);
});
