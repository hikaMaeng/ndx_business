import assert from "node:assert/strict";
import test from "node:test";
import { createSchedulerNotifier } from "./notifier.js";

test("a handoff notification wakes an idle scheduler without waiting for the timeout", async () => {
  const notifier = createSchedulerNotifier(); const started = performance.now(); const waiting = notifier.wait(1_000);
  notifier.notify(); await waiting;
  assert.ok(performance.now() - started < 100);
});
