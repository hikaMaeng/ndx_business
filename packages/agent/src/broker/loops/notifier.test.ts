import assert from "node:assert/strict";
import test from "node:test";
import { CoalescedWakeup } from "./notifier.js";

test("delivery notifier coalesces a burst into one durable-poll wakeup", async () => {
  const notifier = new CoalescedWakeup();
  notifier.notify(); notifier.notify(); notifier.notify();
  const started = Date.now();
  await notifier.wait(100);
  assert.ok(Date.now() - started < 25);
  const delayed = Date.now();
  await notifier.wait(15);
  assert.ok(Date.now() - delayed >= 10);
});
