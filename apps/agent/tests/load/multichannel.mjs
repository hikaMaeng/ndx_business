import assert from "node:assert/strict";

const baseUrl = process.env.AGENT_URL ?? "http://127.0.0.1:18081";
const total = Number(process.env.AGENT_LOAD_TOTAL ?? 400);
const concurrency = Number(process.env.AGENT_LOAD_CONCURRENCY ?? 32);
const timeoutMs = Number(process.env.AGENT_LOAD_TIMEOUT_MS ?? 300_000);
const channels = ["agent.requests", "orders", "telemetry", "notifications"];
let next = 0; let accepted = 0; const started = performance.now();
const transactions = Array.from({ length: total }, (_, index) => `load-${Date.now()}-${index}`);

async function worker() {
  while (true) {
    const index = next++; if (index >= total) return;
    const response = await fetch(`${baseUrl}/api/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "hash.sha256", transactionKey: transactions[index], channel: channels[index % channels.length], replyChannel: "agent.results", payload: { input: `load-${index}`, sessionKey: `load-session-${index % 40}` } }) });
    assert.equal(response.status, 202); accepted += 1;
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
const submitMs = Math.round(performance.now() - started);
const token = process.env.AGENT_METRICS_TOKEN;
const deadline = Date.now() + timeoutMs; let snapshot;
while (Date.now() < deadline) {
  const response = await fetch(`${baseUrl}/metrics`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (response.ok) { snapshot = (await response.json()).metrics; if (snapshot.processingReady === 0 && snapshot.processingRunning === 0 && snapshot.inFlight === 0) break; }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.equal(accepted, total); assert.ok(snapshot, "metrics endpoint must be enabled");
assert.equal(snapshot.processingReady, 0); assert.equal(snapshot.processingRunning, 0); assert.equal(snapshot.deliveryPending, 0);
console.log(JSON.stringify({ test: "multichannel-load", total, concurrency, channels: channels.length, submitMs, settleMs: Math.round(performance.now() - started), accepted, metrics: snapshot }));
