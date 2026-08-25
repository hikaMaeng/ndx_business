import assert from "node:assert/strict";
import test from "node:test";
import { shutdownGateway } from "./index.js";

test("Gateway ownership is released only after reader stop, HTTP close, and durable subscription removal", async () => {
  const order: string[] = [];
  let allowSocketRemoval: (() => void) | undefined;
  const socketRemoval = new Promise<void>((resolve) => { allowSocketRemoval = resolve; });
  const done = shutdownGateway({
    stopReader: () => order.push("reader.stop"),
    waitForReader: async () => { order.push("reader.done"); },
    closeSocketsAndRemoveSubscriptions: async () => { order.push("sockets.close"); await socketRemoval; order.push("subscriptions.removed"); },
    closeHttp: async () => { order.push("http.closed"); },
    releaseOwnership: async () => { order.push("ownership.released"); },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["reader.stop", "reader.done", "sockets.close", "http.closed"]);
  assert.equal(order.includes("ownership.released"), false);
  allowSocketRemoval?.();
  await done;
  assert.deepEqual(order, ["reader.stop", "reader.done", "sockets.close", "http.closed", "subscriptions.removed", "ownership.released"]);
});
