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

test("terminal persistence retry backoff has an explicit positive ceiling", () => {
  assert.equal(readEnv({ AGENT_TERMINAL_PERSISTENCE_BACKOFF_MAX_SECONDS: "90" }).terminalPersistenceBackoffMaxSeconds, 90);
  assert.throws(() => readEnv({ AGENT_TERMINAL_PERSISTENCE_BACKOFF_MAX_SECONDS: "0" }), /AGENT_TERMINAL_PERSISTENCE_BACKOFF_MAX_SECONDS must be positive/);
});

test("the log tail has an explicit fallback interval and batch size", () => {
  assert.equal(readEnv({ AGENT_LOG_TAIL_POLL_MS: "250" }).logTailPollMs, 250);
  assert.equal(readEnv({ AGENT_LOG_TAIL_BATCH: "64" }).logTailBatch, 64);
  assert.throws(() => readEnv({ AGENT_LOG_TAIL_POLL_MS: "0" }), /AGENT_LOG_TAIL_POLL_MS must be positive/);
});

/**
 * There are two kinds of server, and the ones that are gone stay gone.
 *
 * `router` was removed once. `dispatcher` was the same shape returning under
 * another name two days later — a third kind of server for something that is
 * half of the broker's job. This is the test that noticed, so it now guards
 * both names.
 */
test("broker and worker are the only roles", () => {
  assert.equal(readEnv({}).role, "broker");
  assert.equal(readEnv({ AGENT_ROLE: "worker" }).role, "worker");
  for (const gone of ["router", "dispatcher"]) {
    assert.throws(() => readEnv({ AGENT_ROLE: gone }), /AGENT_ROLE must be broker or worker/, gone + " must not be a role");
  }
});

test("gateway still starts, because that is what deployed containers say", () => {
  assert.equal(readEnv({ AGENT_ROLE: "gateway" }).role, "broker");
});

test("a worker server is given a list of queues to watch, not one name", () => {
  assert.deepEqual(readEnv({ AGENT_QUEUES: "a, b ,c" }).queues, ["a", "b", "c"]);
  assert.deepEqual(readEnv({ AGENT_QUEUE: "solo" }).queues, ["solo"]);
  assert.deepEqual(readEnv({}).queues, ["agent_requests"]);
});
