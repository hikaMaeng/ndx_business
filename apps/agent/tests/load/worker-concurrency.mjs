import assert from "node:assert/strict";

const baseUrl = process.env.AGENT_URL ?? "http://127.0.0.1:18081";
const total = Number(process.env.AGENT_DELAY_TOTAL ?? 8);
const workers = Number(process.env.AGENT_DELAY_WORKERS ?? 2);
const delayMs = Number(process.env.AGENT_DELAY_MS ?? 5_000);
const timeoutMs = Number(process.env.AGENT_DELAY_TIMEOUT_MS ?? 90_000);
const overheadMs = Number(process.env.AGENT_DELAY_SLO_OVERHEAD_MS ?? 15_000);
const token = process.env.AGENT_METRICS_TOKEN;
assert.ok(Number.isInteger(total) && total > 0); assert.ok(Number.isInteger(workers) && workers > 0); assert.ok(delayMs >= 1_000);

async function snapshot() {
  const response = await fetch(`${baseUrl}/metrics`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert.equal(response.status, 200, "a token-enabled metrics endpoint is required");
  return (await response.json()).metrics;
}

const before = await snapshot();
const prefix = `delay-${Date.now()}`; const started = performance.now();
await Promise.all(Array.from({ length: total }, (_, index) => fetch(`${baseUrl}/api/events`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "test.delay", transactionKey: `${prefix}-${index}`, channel: ["agent.requests", "orders", "telemetry", "notifications"][index % 4], replyChannel: "agent.results", payload: { simulateDelayMs: delayMs, sessionKey: `delay-session-${index % 4}` } }),
}).then((response) => assert.equal(response.status, 202))));

let after = before; const deadline = Date.now() + timeoutMs;
while (Date.now() < deadline) {
  after = await snapshot();
  if (after.workerCompleted - before.workerCompleted >= total && after.processingReady === 0 && after.processingRunning === 0 && after.inFlight === 0 && after.deliveryPending === 0) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
const settleMs = Math.round(performance.now() - started);
const expectedWorkerMs = Math.ceil(total / workers) * delayMs;
const maximumMs = expectedWorkerMs + overheadMs;
assert.equal(after.workerCompleted - before.workerCompleted, total);
assert.equal(after.workerFailed - before.workerFailed, 0); assert.equal(after.processingFailures - before.processingFailures, 0);
assert.equal(after.processingReady, 0); assert.equal(after.processingRunning, 0); assert.equal(after.inFlight, 0); assert.equal(after.deliveryPending, 0);
assert.equal(after.processingExpiredLeases, 0); assert.ok(settleMs <= maximumMs, `settled in ${settleMs}ms; expected <= ${maximumMs}ms (${expectedWorkerMs}ms worker critical path + ${overheadMs}ms budget)`);
console.log(JSON.stringify({ test: "worker-concurrency", prefix, total, workers, delayMs, expectedWorkerMs, overheadMs, settleMs, workerCompleted: after.workerCompleted - before.workerCompleted, metrics: after }));
