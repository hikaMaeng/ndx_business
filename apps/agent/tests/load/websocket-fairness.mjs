import assert from "node:assert/strict";
import { WebSocket } from "ws";

const baseUrl = process.env.AGENT_URL ?? "http://127.0.0.1:18081";
const websocketUrl = process.env.AGENT_WS_URL ?? baseUrl.replace(/^http/, "ws") + "/ws";
const channels = Number(process.env.AGENT_WS_CHANNELS ?? 4);
const perChannel = Number(process.env.AGENT_WS_PER_CHANNEL ?? 128);
const concurrency = Number(process.env.AGENT_WS_CONCURRENCY ?? 64);
const timeoutMs = Number(process.env.AGENT_WS_TIMEOUT_MS ?? 90_000);
const p99BudgetMs = Number(process.env.AGENT_WS_P99_BUDGET_MS ?? 5_000);
const token = process.env.AGENT_METRICS_TOKEN;
assert.ok(Number.isInteger(channels) && channels > 1);
assert.ok(Number.isInteger(perChannel) && perChannel > 0);
assert.ok(Number.isInteger(concurrency) && concurrency > 0);

async function metrics() {
  const response = await fetch(`${baseUrl}/metrics`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert.equal(response.status, 200, "a token-enabled metrics endpoint is required");
  return (await response.json()).metrics;
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

const before = await metrics();
const prefix = `ws-fair-${Date.now()}`;
const replyChannels = Array.from({ length: channels }, (_, index) => `${prefix}.result.${index}`);
const expected = new Map();
const received = new Map(replyChannels.map((channel) => [channel, []]));
const sockets = [];

await Promise.all(replyChannels.map((channel) => new Promise((resolve, reject) => {
  const socket = new WebSocket(websocketUrl);
  const timeout = setTimeout(() => reject(new Error(`subscription timeout: ${channel}`)), 10_000);
  socket.once("error", reject);
  socket.on("open", () => socket.send(JSON.stringify({ type: "subscribe", channels: [channel] })));
  socket.on("message", (raw) => {
    const frame = JSON.parse(String(raw));
    if (frame.type === "subscribed" && frame.replayComplete) { clearTimeout(timeout); sockets.push(socket); resolve(); return; }
    if (frame.type !== "event" || frame.event?.kind !== "result") return;
    if (frame.event.channel !== channel) throw new Error(`cross-channel event ${frame.event.channel} on ${channel}`);
    const started = expected.get(frame.event.transactionKey);
    if (started === undefined) throw new Error(`unexpected result ${frame.event.transactionKey} on ${channel}`);
    received.get(channel).push({ transactionKey: frame.event.transactionKey, latencyMs: Date.now() - started });
  });
})));

const total = channels * perChannel;
let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (true) {
    const index = next++;
    if (index >= total) return;
    const channel = replyChannels[index % channels];
    const transactionKey = `${prefix}-${index}`;
    expected.set(transactionKey, Date.now());
    const response = await fetch(`${baseUrl}/api/events`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "hash.sha256", transactionKey, channel: "fairness.requests", replyChannel: channel, payload: { input: `fairness-${index}`, sessionKey: `${prefix}-session-${index}` } }),
    });
    assert.equal(response.status, 202);
  }
}));

const deadline = Date.now() + timeoutMs;
while (Date.now() < deadline && [...received.values()].reduce((count, values) => count + values.length, 0) < total) await new Promise((resolve) => setTimeout(resolve, 25));
const all = [...received.values()].flat();
for (const channel of replyChannels) {
  const values = received.get(channel);
  assert.equal(values.length, perChannel, `channel=${channel} expected=${perChannel} received=${values.length}`);
  assert.equal(new Set(values.map((value) => value.transactionKey)).size, perChannel, `channel=${channel} has duplicate terminal events`);
}
assert.equal(all.length, total);
const after = await metrics();
assert.equal(after.processingReady, 0); assert.equal(after.processingRunning, 0); assert.equal(after.inFlight, 0); assert.equal(after.outboxPending, 0);
assert.equal(after.workerFailed - before.workerFailed, 0); assert.equal(after.outboxDlqTotal - before.outboxDlqTotal, 0);
const latencyMs = all.map((value) => value.latencyMs);
const p50Ms = percentile(latencyMs, 0.50); const p95Ms = percentile(latencyMs, 0.95); const p99Ms = percentile(latencyMs, 0.99);
assert.ok(p99Ms <= p99BudgetMs, `p99=${p99Ms}ms exceeds ${p99BudgetMs}ms`);
sockets.forEach((socket) => socket.close());
console.log(JSON.stringify({ test: "websocket-fairness", prefix, total, channels, perChannel, p50Ms, p95Ms, p99Ms, p99BudgetMs, received: Object.fromEntries([...received.entries()].map(([channel, values]) => [channel, values.length])), metrics: after }));
