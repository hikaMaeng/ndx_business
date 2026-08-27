import assert from "node:assert/strict";
import test from "node:test";
import { ProjectionNotifier } from "./notifier.js";

test("projection notification wakes every independent checkpoint runner", async () => {
  const notifier = new ProjectionNotifier();
  const projections = ["session", "run", "turn", "tool"] as const;
  const pending = projections.map(async (projection) => { await notifier.wait(projection, 1000); return projection; });
  notifier.notify();
  assert.deepEqual((await Promise.all(pending)).sort(), [...projections].sort());
});
