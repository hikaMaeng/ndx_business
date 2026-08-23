import assert from "node:assert/strict";
import test from "node:test";
import { readEnv } from "./env.js";

test("the default worker pool reserves the configured CPU concurrency at startup", () => {
  const env = readEnv({ PORT: "18081", AGENT_MAX_THREADS: "6" });
  assert.equal(env.maxWorkerThreads, 6);
  assert.equal(env.minWorkerThreads, 6);
});

test("a resident worker pool cannot be configured with zero workers", () => {
  assert.throws(() => readEnv({ AGENT_MIN_THREADS: "0" }), /AGENT_MIN_THREADS must be positive/);
});

test("terminal persistence alert threshold is explicit and positive", () => {
  assert.equal(readEnv({ AGENT_TERMINAL_PERSISTENCE_ALERT_ATTEMPTS: "7" }).terminalPersistenceAlertAttempts, 7);
  assert.throws(() => readEnv({ AGENT_TERMINAL_PERSISTENCE_ALERT_ATTEMPTS: "0" }), /AGENT_TERMINAL_PERSISTENCE_ALERT_ATTEMPTS must be positive/);
});
