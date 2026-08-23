import { createApp } from "./app.js";
import { createDatabasePool, snapshotDatabasePool } from "./database.js";
import { readEnv } from "./env.js";
import { PgmqClient } from "./pgmq/client.js";
import { createWorkerPool } from "./worker/pool.js";
import { attachWebSocketTransport } from "./transport/websocket.js";
import { EventStore } from "./event-store/store.js";
import { MetricsRegistry } from "./metrics/registry.js";
import { EventStreamHub } from "./stream/hub.js";
import { GatewaySubscriptionStore } from "./subscription/store.js";
import { startGatewayDelivery } from "./broker/gateway-delivery.js";
import { startResultRouter } from "./broker/result-router.js";
import { startWorkerConsumer } from "./broker/worker-consumer.js";
import { ExecutionStore } from "./idempotency/store.js";
import { DeliveryStore } from "./delivery/store.js";
import { startDeliveryPublisher } from "./delivery/publisher.js";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { writeMetrics } from "./metrics/endpoint.js";

const env = readEnv();
// These three roles share one PostgreSQL instance. Their combined connection
// ceilings stay below its 100-client default: gateway 20+12, worker 24+12,
// router 12+13. This preserves a small operating reserve for PostgreSQL and
// administration while still allowing independent result fan-out.
const databasePoolLimit = env.role === "worker" ? Math.min(env.databasePoolMax, 24) : env.role === "router" ? Math.min(env.databasePoolMax, env.routerConcurrency) : Math.min(env.databasePoolMax, 20);
const queuePoolLimit = env.role === "router" ? env.routerConcurrency + 1 : 12;
const database = createDatabasePool(env.databaseUrl, databasePoolLimit);
const queueDatabase = createDatabasePool(env.databaseUrl, queuePoolLimit);
const queue = new PgmqClient(queueDatabase);
const metrics = new MetricsRegistry();
const eventStore = new EventStore(database, metrics);
const subscriptions = new GatewaySubscriptionStore(database, env.subscriptionLeaseSeconds);
const executions = new ExecutionStore(database, env.executionLeaseSeconds);
const deliveries = new DeliveryStore(database, env.executionLeaseSeconds);
const gatewayQueue = (): string => `${env.gatewayQueuePrefix}${env.gatewayId.replace(/[^a-zA-Z0-9_]/g, "_")}`;

await subscriptions.ensureSchema();
const gatewayInstanceId = env.role === "gateway" ? randomUUID() : undefined;
if (gatewayInstanceId) {
  for (;;) {
    const claim = await subscriptions.claimGateway(env.gatewayId, gatewayInstanceId);
    if (claim.owned) break;
    console.warn(JSON.stringify({ event: "gateway.identity.waiting", gatewayId: env.gatewayId, retryAfterMs: claim.retryAfterMs }));
    await new Promise<void>((resolve) => setTimeout(resolve, claim.retryAfterMs));
  }
}
await eventStore.ensureSchema();
await executions.ensureSchema();
await deliveries.ensureSchema();
await queue.ensure(env.queue);
await queue.ensure(env.resultQueue);
if (env.role === "gateway") await queue.ensure(gatewayQueue());
const observeExpiredExecutions = async (): Promise<void> => {
  const expired = await executions.expiredRunningCount();
  metrics.setGauge("expiredExecutionLeases", expired);
  if (expired) console.warn(JSON.stringify({ event: "execution.lease.expired", rows: expired }));
};
if (env.role === "gateway") {
  await observeExpiredExecutions();
  await Promise.all([subscriptions.pruneExpired(), eventStore.pruneChannelCursors(env.retentionDays), eventStore.prune(env.retentionDays), executions.prune(env.retentionDays), deliveries.prune(env.retentionDays)]);
}

const refreshMetrics = (): void => {
  for (const [name, pool] of [["databasePool", snapshotDatabasePool(database)], ["queuePool", snapshotDatabasePool(queueDatabase)]] as const) {
    metrics.setGauge(`${name}Total` as "databasePoolTotal" | "queuePoolTotal", pool.total);
    metrics.setGauge(`${name}Idle` as "databasePoolIdle" | "queuePoolIdle", pool.idle);
    metrics.setGauge(`${name}Waiting` as "databasePoolWaiting" | "queuePoolWaiting", pool.waiting);
  }
};
refreshMetrics();
const metricsTimer = setInterval(refreshMetrics, 1000);

if (env.role === "worker") {
  const pool = createWorkerPool({ minWorkerThreads: env.minWorkerThreads, maxWorkerThreads: env.maxWorkerThreads, maxQueue: env.maxQueue });
  const publisher = startDeliveryPublisher({ queue, store: deliveries, maxAttempts: env.maxOutboxAttempts, metrics });
  const consumer = startWorkerConsumer({ queue, commandQueue: env.queue, resultQueue: env.resultQueue, eventStore, deliveries, executions, pool, metrics, visibilitySeconds: env.visibilityTimeoutSeconds, pollSeconds: env.pollSeconds, batchSize: env.pollBatchSize, maxInFlight: env.maxWorkerThreads + env.maxQueue, maxExecutionAttempts: env.maxExecutionAttempts, terminalPersistenceAlertAttempts: env.terminalPersistenceAlertAttempts, onTerminalPersisted: publisher.wake });
  const server = createServer((request, response) => { if (writeMetrics(request, response, env, metrics)) return; response.writeHead(request.url === "/health" ? 200 : 404); response.end(); }).listen(env.port);
  console.log(JSON.stringify({ event: "agent.worker.started", commandQueue: env.queue, resultQueue: env.resultQueue }));
  const shutdown = async (): Promise<void> => { consumer.stop(); publisher.stop(); server.close(); await Promise.all([consumer.done, publisher.done]); await pool.destroy(); clearInterval(metricsTimer); await queueDatabase.end(); await database.end(); };
  process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
  process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
} else if (env.role === "router") {
  const router = startResultRouter({ queue, resultQueue: env.resultQueue, gatewayQueuePrefix: env.gatewayQueuePrefix, subscriptions, metrics, visibilitySeconds: env.visibilityTimeoutSeconds, pollSeconds: env.pollSeconds, maxInFlight: env.routerConcurrency, maxDeliveryReads: env.maxDeliveryReads });
  const server = createServer((request, response) => { if (writeMetrics(request, response, env, metrics)) return; response.writeHead(request.url === "/health" ? 200 : 404); response.end(); }).listen(env.port);
  console.log(JSON.stringify({ event: "agent.router.started", resultQueue: env.resultQueue }));
  const shutdown = async (): Promise<void> => { router.stop(); server.close(); await router.done; clearInterval(metricsTimer); await queueDatabase.end(); await database.end(); };
  process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
  process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
} else {
  if (!gatewayInstanceId) throw new Error("Gateway identity was not initialised");
  const hub = new EventStreamHub();
  const delivery = startGatewayDelivery({ queue, queueName: gatewayQueue(), hub, metrics, visibilitySeconds: env.visibilityTimeoutSeconds, pollSeconds: env.pollSeconds });
  const server = createApp(env, queue, hub, metrics, async () => { await Promise.all([queue.check(), database.query("SELECT 1")]); }).listen(env.port, () => console.log(JSON.stringify({ event: "agent.gateway.listening", port: env.port, gatewayId: env.gatewayId, commandQueue: env.queue })));
  const websocket = attachWebSocketTransport(server, env, queue, hub, eventStore, metrics, { replace: (connectionId, channels) => subscriptions.replaceConnection(env.gatewayId, connectionId, channels), remove: (connectionId) => subscriptions.removeConnection(env.gatewayId, connectionId) });
  const renewTimer = setInterval(() => { void subscriptions.renewGateway(env.gatewayId, gatewayInstanceId).then((owned) => {
    if (!owned) { console.error(JSON.stringify({ event: "gateway.identity.lost", gatewayId: env.gatewayId })); process.exit(1); }
  }).catch((error) => console.error(JSON.stringify({ event: "gateway.subscription.renew.failed", error: error instanceof Error ? error.message : String(error) }))); }, Math.max(1_000, Math.floor(env.subscriptionLeaseSeconds * 500)));
  const retentionTimer = setInterval(() => { void (async () => {
    await observeExpiredExecutions();
    await Promise.all([subscriptions.pruneExpired(), eventStore.pruneChannelCursors(env.retentionDays), eventStore.prune(env.retentionDays), executions.prune(env.retentionDays), deliveries.prune(env.retentionDays)]);
  })().catch((error) => console.error(JSON.stringify({ event: "agent.retention.failed", error: error instanceof Error ? error.message : String(error) }))); }, 60 * 60 * 1_000);
  const shutdown = async (): Promise<void> => {
    delivery.stop(); clearInterval(metricsTimer); clearInterval(renewTimer); clearInterval(retentionTimer);
    // Stop the queue reader before releasing identity. This bounds normal handoff by one
    // PGMQ poll, instead of waiting for long-lived WebSocket connections to close.
    await delivery.done; await subscriptions.releaseGateway(env.gatewayId, gatewayInstanceId);
    for (const client of websocket.clients) client.close(1001, "gateway shutdown"); websocket.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await queueDatabase.end(); await database.end();
  };
  process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
  process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
}
