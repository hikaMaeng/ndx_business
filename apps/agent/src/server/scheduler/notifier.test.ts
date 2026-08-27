import assert from "node:assert/strict";
import test from "node:test";
import { createSchedulerNotifier } from "./notifier.js";

test("a handoff notification wakes an idle scheduler without waiting for the timeout", async () => {
  const notifier = createSchedulerNotifier(); const started = performance.now(); const waiting = notifier.wait(1_000);
  notifier.notify(); await waiting;
  assert.ok(performance.now() - started < 100);
});

test("bursty notifications retain one wakeup permit, not one empty claim per event", async () => {
  const notifier = createSchedulerNotifier();
  for (let index = 0; index < 100; index += 1) notifier.notify();
  await notifier.wait(1);
  const started = performance.now(); await notifier.wait(20);
  assert.ok(performance.now() - started >= 15);
});
