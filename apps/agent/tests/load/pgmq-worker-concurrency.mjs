import assert from "node:assert/strict";
import WebSocket from "ws";

const baseUrl = process.env.AGENT_URL ?? "http://127.0.0.1:18081";
const total = Number(process.env.AGENT_DELAY_TOTAL ?? 2_048);
const workers = Number(process.env.AGENT_DELAY_WORKERS ?? 96);
const delayMs = Number(process.env.AGENT_DELAY_MS ?? 5_000);
const streams = Number(process.env.AGENT_DELAY_STREAMS ?? 512);
const timeoutMs = Number(process.env.AGENT_DELAY_TIMEOUT_MS ?? 150_000);
const overheadMs = Number(process.env.AGENT_DELAY_SLO_OVERHEAD_MS ?? 15_000);
assert.ok(Number.isInteger(total) && total > 0);
assert.ok(Number.isInteger(workers) && workers > 0);
assert.ok(Number.isInteger(delayMs) && delayMs >= 1_000);

const channels = ["load.results.0", "load.results.1", "load.results.2", "load.results.3"];
const prefix = `pgmq-load-${Date.now()}`;
const expected = new Set(Array.from({ length: total }, (_, index) => `${prefix}-${index}`));
const received = new Set();
const failures = [];

function connect(channel) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(baseUrl.replace(/^http/, "ws") + "/ws");
    const timeout = setTimeout(() => reject(new Error(`subscription timeout: ${channel}`)), 15_000);
    socket.on("error", reject);
    socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "ready") socket.send(JSON.stringify({ type: "subscribe", channels: [channel] }));
      if (frame.type === "subscribed") { clearTimeout(timeout); resolve(socket); }
      if (frame.type === "event" && expected.has(frame.event.transactionKey)) {
        if (frame.event.action !== "test.delay.result" || frame.event.payload.ok !== true) failures.push(frame.event);
        received.add(frame.event.transactionKey);
      }
    });
  });
}

const sockets = await Promise.all(channels.map(connect));
const started = performance.now();
try {
  const responses = await Promise.all(Array.from({ length: total }, async (_, index) => {
    const response = await fetch(`${baseUrl}/api/events`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "test.delay", transactionKey: `${prefix}-${index}`, channel: "load.requests", replyChannel: channels[index % channels.length], payload: { simulateDelayMs: delayMs, sessionKey: `load-session-${index % streams}` } }),
    });
    return response.status;
  }));
  assert.ok(responses.every((status) => status === 202), `non-202 ingress responses: ${responses.filter((status) => status !== 202).length}`);
  const deadline = Date.now() + timeoutMs;
  while (received.size < total && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  const elapsedMs = Math.round(performance.now() - started);
  assert.equal(received.size, total, `terminal result count ${received.size}/${total}`);
  assert.equal(failures.length, 0, `terminal failure count ${failures.length}`);
  const criticalPathMs = Math.ceil(total / workers) * delayMs;
  assert.ok(elapsedMs <= criticalPathMs + overheadMs, `elapsed=${elapsedMs} exceeds ${criticalPathMs + overheadMs}`);
  console.log(JSON.stringify({ test: "pgmq-worker-concurrency", prefix, total, workers, streams, delayMs, criticalPathMs, overheadMs, elapsedMs, terminalResults: received.size }));
} finally {
  for (const socket of sockets) socket.close();
}
