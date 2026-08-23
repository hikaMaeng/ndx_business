import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Agent, request } from "node:http";
import WebSocket from "ws";

// See ../../docs/testing.md#부하-검증 for the acceptance contract.

const baseUrl = process.env.AGENT_URL ?? "http://127.0.0.1:18081";
const total = Number(process.env.AGENT_COMPOSITE_TOTAL ?? 2_048);
const workers = Number(process.env.AGENT_COMPOSITE_WORKERS ?? 96);
const delayMs = Number(process.env.AGENT_COMPOSITE_DELAY_MS ?? 5_000);
const streams = Number(process.env.AGENT_COMPOSITE_STREAMS ?? 512);
const joinTotal = Number(process.env.AGENT_COMPOSITE_JOIN_TOTAL ?? 128);
const conflictTotal = Number(process.env.AGENT_COMPOSITE_CONFLICT_TOTAL ?? 32);
const leaseDelayMs = Number(process.env.AGENT_COMPOSITE_LEASE_DELAY_MS ?? 65_000);
const visibilitySeconds = Number(process.env.QUEUE_VISIBILITY_TIMEOUT_SECONDS ?? 60);
const executionLeaseSeconds = Number(process.env.AGENT_EXECUTION_LEASE_SECONDS ?? visibilitySeconds * 2);
const subscribersPerChannel = Number(process.env.AGENT_COMPOSITE_SUBSCRIBERS ?? 2);
const concurrency = Number(process.env.AGENT_COMPOSITE_INGRESS_CONCURRENCY ?? 128);
const timeoutMs = Number(process.env.AGENT_COMPOSITE_TIMEOUT_MS ?? 180_000);
const overheadMs = Number(process.env.AGENT_COMPOSITE_SLO_OVERHEAD_MS ?? 20_000);
const databaseContainer = process.env.AGENT_PGMQ_DB_CONTAINER ?? "admin";
const workerContainer = process.env.AGENT_WORKER_CONTAINER ?? "ndx-business-agent-worker-1";
const commandQueue = process.env.AGENT_QUEUE ?? "agent_requests";
const resultQueue = process.env.AGENT_RESULT_QUEUE ?? "agent_results";
const gatewayQueue = `${process.env.AGENT_GATEWAY_QUEUE_PREFIX ?? "agent_gateway_"}${process.env.AGENT_GATEWAY_ID ?? "agent"}`;
const metricsToken = process.env.AGENT_METRICS_TOKEN;

for (const [name, value, minimum] of [["total", total, 1], ["workers", workers, 1], ["delayMs", delayMs, 1_000], ["streams", streams, 1], ["joinTotal", joinTotal, 0], ["conflictTotal", conflictTotal, 1], ["leaseDelayMs", leaseDelayMs, 1_000], ["subscribersPerChannel", subscribersPerChannel, 1], ["concurrency", concurrency, 1]]) assert.ok(Number.isInteger(value) && value >= minimum, `${name} must be an integer >= ${minimum}`);
assert.ok(joinTotal <= total, "joinTotal must not exceed total");
assert.ok(leaseDelayMs > visibilitySeconds * 1_000, "lease probe must exceed PGMQ visibility timeout");
assert.ok(executionLeaseSeconds > visibilitySeconds, "lease proof requires an execution lease longer than PGMQ visibility");

const prefix = `pgmq-composite-${Date.now()}`;
const delayChannels = Array.from({ length: 4 }, (_, index) => `${prefix}.delay.${index}`);
const conflictOkChannel = `${prefix}.conflict.ok`;
const conflictErrorChannel = `${prefix}.conflict.error`;
const leaseChannel = `${prefix}.lease`;
const channels = [...delayChannels, conflictOkChannel, conflictErrorChannel, leaseChannel];
const expectedByChannel = new Map(channels.map((channel) => [channel, new Map()]));
const ingressAgent = new Agent({ keepAlive: true, maxSockets: concurrency });
const subscribers = [];
const ingressLatencies = [];

function expected(transactionKey, channel, action, ok, submittedAt = 0) {
  const entries = expectedByChannel.get(channel);
  assert.ok(entries, `unknown expected channel ${channel}`);
  entries.set(transactionKey, { action, ok, submittedAt });
}

function markExpected(transactionKey, channel) {
  const target = expectedByChannel.get(channel)?.get(transactionKey);
  if (target && target.submittedAt === 0) target.submittedAt = Date.now();
}

function submit(event) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(event);
    const startedAt = performance.now();
    const outgoing = request(new URL("/api/events", baseUrl), { method: "POST", agent: ingressAgent, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, (response) => {
      response.resume();
      response.on("end", () => {
        ingressLatencies.push(performance.now() - startedAt);
        resolve(response.statusCode);
      });
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

async function metrics() {
  assert.ok(metricsToken, "AGENT_METRICS_TOKEN is required to prove the deployed gateway metrics contract");
  const response = await fetch(new URL("/metrics", baseUrl), { headers: { authorization: `Bearer ${metricsToken}` } });
  assert.equal(response.status, 200, "metrics endpoint must be authenticated and available");
  return response.json();
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0);
}

function subscribe(channel, ordinal) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(baseUrl.replace(/^http/, "ws") + "/ws");
    const subscriber = { channel, ordinal, socket, seen: new Map(), duplicates: 0, failures: [] };
    const timeout = setTimeout(() => reject(new Error(`subscription timeout channel=${channel} subscriber=${ordinal}`)), 15_000);
    socket.once("error", reject);
    socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "ready") socket.send(JSON.stringify({ type: "subscribe", channels: [channel] }));
      if (frame.type === "subscribed") { clearTimeout(timeout); subscribers.push(subscriber); resolve(); return; }
      if (frame.type !== "event") return;
      const target = expectedByChannel.get(channel)?.get(frame.event.transactionKey);
      if (!target) { subscriber.failures.push({ unexpected: frame.event }); return; }
      if (frame.event.channel !== channel || frame.event.action !== target.action || frame.event.payload?.ok !== target.ok) subscriber.failures.push(frame.event);
      if (subscriber.seen.has(frame.event.transactionKey)) { subscriber.duplicates += 1; return; }
      subscriber.seen.set(frame.event.transactionKey, Date.now() - target.submittedAt);
    });
  });
}

function waitFor(label, ready) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (ready()) { resolve(); return; }
      if (Date.now() >= deadline) { reject(new Error(`${label} timed out`)); return; }
      setTimeout(poll, 50);
    };
    poll();
  });
}

function sql(query) {
  return execFileSync("docker", ["exec", databaseContainer, "psql", "-U", "postgres", "-d", "ndx_business", "-At", "-c", query], { encoding: "utf8" }).trim();
}

function deployedWorkerSettings() {
  const [container] = JSON.parse(execFileSync("docker", ["inspect", workerContainer], { encoding: "utf8" }));
  const values = new Map(container.Config.Env.map((entry) => entry.split("=", 2)));
  const deployedVisibilitySeconds = Number(values.get("QUEUE_VISIBILITY_TIMEOUT_SECONDS") ?? 60);
  const deployedExecutionLeaseSeconds = Number(values.get("AGENT_EXECUTION_LEASE_SECONDS") ?? deployedVisibilitySeconds * 2);
  return { deployedVisibilitySeconds, deployedExecutionLeaseSeconds };
}

function sqlLiteral(value) { return `'${value.replaceAll("'", "''")}'`; }

function queuePrefixCount(queue) {
  assert.match(queue, /^[a-z][a-z0-9_]*$/, `unsafe queue name ${queue}`);
  return Number(sql(`SELECT count(*) FROM pgmq.q_${queue} WHERE message->>'transactionKey' LIKE ${sqlLiteral(`${prefix}%`)}`));
}

const expectedTerminalCount = total + joinTotal + conflictTotal * 2 + 1;
const expectedCommandCount = total + joinTotal + conflictTotal * 2 + 1;
const expectedExecutionCount = total + conflictTotal + 1;
const lowerBoundMs = Math.ceil(total / workers) * delayMs;
let workloadStartedAt = 0;

for (let index = 0; index < total; index += 1) {
  const transactionKey = `${prefix}-delay-${index}`;
  const primary = delayChannels[index % delayChannels.length];
  expected(transactionKey, primary, "test.delay.result", true);
  if (index < joinTotal) expected(transactionKey, delayChannels[(index + 1) % delayChannels.length], "test.delay.result", true);
}
for (let index = 0; index < conflictTotal; index += 1) {
  const transactionKey = `${prefix}-conflict-${index}`;
  expected(transactionKey, conflictOkChannel, "test.delay.result", true);
  expected(transactionKey, conflictErrorChannel, "test.delay.conflict", false);
}
const leaseTransaction = `${prefix}-lease`;
expected(leaseTransaction, leaseChannel, "test.delay.result", true);

try {
  const deployed = deployedWorkerSettings();
  assert.equal(visibilitySeconds, deployed.deployedVisibilitySeconds, "harness visibility setting must match the deployed Worker");
  assert.equal(executionLeaseSeconds, deployed.deployedExecutionLeaseSeconds, "harness execution lease setting must match the deployed Worker");
  const baselineMetrics = (await metrics()).metrics;
  await Promise.all(channels.flatMap((channel) => Array.from({ length: subscribersPerChannel }, (_, ordinal) => subscribe(channel, ordinal))));

  const conflictOriginals = await Promise.all(Array.from({ length: conflictTotal }, (_, index) => {
    const transactionKey = `${prefix}-conflict-${index}`;
    markExpected(transactionKey, conflictOkChannel);
    return submit({ action: "test.delay", transactionKey, channel: "composite.requests", replyChannel: conflictOkChannel, payload: { simulateDelayMs: delayMs, sessionKey: `${prefix}-conflict-session-${index}` } });
  }));
  assert.ok(conflictOriginals.every((status) => status === 202), "conflict originals must be accepted");
  const conflictRetries = await Promise.all(Array.from({ length: conflictTotal }, (_, index) => {
    const transactionKey = `${prefix}-conflict-${index}`;
    markExpected(transactionKey, conflictErrorChannel);
    return submit({ action: "test.delay", transactionKey, channel: "composite.requests", replyChannel: conflictErrorChannel, payload: { simulateDelayMs: delayMs + 1, sessionKey: `${prefix}-conflict-session-${index}` } });
  }));
  assert.ok(conflictRetries.every((status) => status === 202), "conflict retries must be accepted");

  markExpected(leaseTransaction, leaseChannel);
  assert.equal(await submit({ action: "test.delay", transactionKey: leaseTransaction, channel: "composite.requests", replyChannel: leaseChannel, payload: { simulateDelayMs: leaseDelayMs, sessionKey: `${prefix}-lease-session` } }), 202);
  // Start the visibility probe before the throughput workload. Its purpose is
  // lease renewal, not adding a serial 65-second tail to the worker benchmark.
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  const commands = [];
  for (let index = 0; index < total; index += 1) {
    const transactionKey = `${prefix}-delay-${index}`;
    const primary = delayChannels[index % delayChannels.length];
    commands.push({ action: "test.delay", transactionKey, channel: "composite.requests", replyChannel: primary, payload: { simulateDelayMs: delayMs, sessionKey: `${prefix}-session-${index % streams}` } });
    if (index < joinTotal) commands.push({ action: "test.delay", transactionKey, channel: "composite.requests", replyChannel: delayChannels[(index + 1) % delayChannels.length], payload: { simulateDelayMs: delayMs, sessionKey: `${prefix}-session-${index % streams}` } });
  }
  workloadStartedAt = performance.now();
  let next = 0;
  const statuses = await Promise.all(Array.from({ length: concurrency }, async () => {
    const local = [];
    while (next < commands.length) {
      const index = next++;
      const command = commands[index];
      markExpected(command.transactionKey, command.replyChannel);
      local.push(await submit(command));
    }
    return local;
  }));
  assert.ok(statuses.flat().every((status) => status === 202), "all composite commands must be accepted");

  await waitFor("terminal results", () => subscribers.every((subscriber) => subscriber.seen.size === expectedByChannel.get(subscriber.channel).size));
  const elapsedMs = Math.round(performance.now() - workloadStartedAt);
  const allSubscribers = subscribers.flatMap((subscriber) => [...subscriber.seen.values()]);
  assert.ok(elapsedMs <= lowerBoundMs + overheadMs, `elapsed=${elapsedMs} exceeds ${lowerBoundMs + overheadMs}`);
  assert.equal(subscribers.reduce((sum, subscriber) => sum + subscriber.failures.length, 0), 0, "terminal payload, action, and channel must match");
  assert.equal(subscribers.reduce((sum, subscriber) => sum + subscriber.duplicates, 0), 0, "healthy run must not redeliver a terminal event to a live subscriber");

  const eventRows = Number(sql(`SELECT count(*) FROM event_store WHERE transaction_key LIKE ${sqlLiteral(`${prefix}%`)}`));
  const completedExecutions = Number(sql(`SELECT count(*) FROM agent_execution WHERE transaction_key LIKE ${sqlLiteral(`${prefix}%`)} AND status = 'completed'`));
  const runningExecutions = Number(sql(`SELECT count(*) FROM agent_execution WHERE transaction_key LIKE ${sqlLiteral(`${prefix}%`)} AND status = 'running'`));
  const leaseAttempts = Number(sql(`SELECT attempts FROM agent_execution WHERE transaction_key = ${sqlLiteral(leaseTransaction)}`));
  const leaseRedeliveries = Number(sql(`SELECT queue_redeliveries FROM agent_execution WHERE transaction_key = ${sqlLiteral(leaseTransaction)}`));
  const queues = Object.fromEntries([commandQueue, resultQueue, gatewayQueue].map((queue) => [queue, queuePrefixCount(queue)]));
  assert.equal(eventRows, expectedCommandCount + expectedTerminalCount, "event store must contain every command and terminal event");
  assert.equal(completedExecutions, expectedExecutionCount, "every logical execution must complete");
  assert.equal(runningExecutions, 0, "no execution may remain running");
  assert.equal(leaseAttempts, 1, "visibility heartbeat must prevent long-handler reclaim");
  assert.equal(leaseRedeliveries, 0, "visibility heartbeat must prevent PGMQ redelivery while the independent execution lease stays valid");
  assert.deepEqual(queues, Object.fromEntries(Object.keys(queues).map((queue) => [queue, 0])), "all PGMQ paths must drain this workload");
  const gatewayMetrics = await metrics();
  for (const name of ["brokerReadFailures", "routerUnmatchedResults", "routerArchivedUnmatchedResults", "processingDlqTotal", "queueVisibilityRenewFailures"]) {
    assert.equal(gatewayMetrics.metrics[name] - baselineMetrics[name], 0, `healthy workload must not increment ${name}`);
  }

  console.log(JSON.stringify({ test: "pgmq-composite-workload", prefix, total, joinTotal, conflictTotal, leaseDelayMs, visibilitySeconds, executionLeaseSeconds, workers, streams, channels: channels.length, subscribers: subscribers.length, ingressP50Ms: percentile(ingressLatencies, 0.50), ingressP95Ms: percentile(ingressLatencies, 0.95), terminalP50Ms: percentile(allSubscribers, 0.50), terminalP95Ms: percentile(allSubscribers, 0.95), terminalP99Ms: percentile(allSubscribers, 0.99), lowerBoundMs, overheadMs, elapsedMs, expectedTerminalCount, eventRows, completedExecutions, leaseAttempts, leaseRedeliveries, gatewayMetrics, queues }));
} finally {
  await Promise.all(subscribers.map((subscriber) => new Promise((resolve) => { subscriber.socket.once("close", resolve); subscriber.socket.close(); })));
  ingressAgent.destroy();
}
