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
import { closeHttpServer, shutdownGateway } from "./gateway/lifecycle/index.js";
import { createGatewayStandby, type GatewayStandby } from "./gateway/standby/index.js";
import { GatewayOutboxStore } from "./gateway-outbox/store.js";

function listen(server: ReturnType<typeof createServer>, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => { server.off("error", reject); resolve(); });
  });
}

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
const gatewayOutbox = new GatewayOutboxStore(database);
const gatewayQueue = (): string => `${env.gatewayQueuePrefix}${env.gatewayId.replace(/[^a-zA-Z0-9_]/g, "_")}`;

await subscriptions.ensureSchema();
const gatewayInstanceId = env.role === "gateway" ? randomUUID() : undefined;
let gatewayShutdown: (() => Promise<void>) | undefined;
let gatewayStandby: GatewayStandby | undefined;
const signalGateway = () => { void gatewayShutdown?.().then(() => process.exit(0)).catch((error) => { console.error(JSON.stringify({ event: "gateway.shutdown.failed", error: error instanceof Error ? error.message : String(error) })); process.exit(1); }); };
if (gatewayInstanceId) {
  const standby = createGatewayStandby();
  gatewayStandby = standby;
  await listen(standby.server, env.port);
  let standbyClosed = false;
  const closeStandby = async (): Promise<void> => {
    if (standbyClosed) return;
    standbyClosed = true;
    await closeHttpServer(standby.server);
  };
  gatewayShutdown = closeStandby;
  process.once("SIGTERM", signalGateway);
  process.once("SIGINT", signalGateway);
  for (;;) {
    const claim = await subscriptions.claimGateway(env.gatewayId, gatewayInstanceId);
    if (claim.owned) break;
    console.warn(JSON.stringify({ event: "gateway.identity.waiting", gatewayId: env.gatewayId, retryAfterMs: claim.retryAfterMs }));
    await new Promise<void>((resolve) => setTimeout(resolve, claim.retryAfterMs));
  }
  gatewayShutdown = async () => { await closeStandby(); await subscriptions.releaseGateway(env.gatewayId, gatewayInstanceId); };
}
await eventStore.ensureSchema();
await executions.ensureSchema();
await deliveries.ensureSchema();
await gatewayOutbox.ensureSchema();
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
  await subscriptions.pruneExpired(); await eventStore.pruneChannelCursors(env.retentionDays); await eventStore.prune(env.retentionDays); await eventStore.pruneStreamWatermarks(env.retentionDays); await Promise.all([executions.prune(env.retentionDays), deliveries.prune(env.retentionDays), gatewayOutbox.prune(env.retentionDays)]);
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
  const consumer = startWorkerConsumer({ queue, commandQueue: env.queue, resultQueue: env.resultQueue, eventStore, deliveries, executions, pool, metrics, visibilitySeconds: env.visibilityTimeoutSeconds, pollSeconds: env.pollSeconds, batchSize: env.pollBatchSize, maxInFlight: env.maxWorkerThreads + env.maxQueue, maxExecutionAttempts: env.maxExecutionAttempts, terminalPersistenceAlertAttempts: env.terminalPersistenceAlertAttempts, terminalPersistenceBackoffMaxSeconds: env.terminalPersistenceBackoffMaxSeconds, onTerminalPersisted: publisher.wake });
  const server = createServer((request, response) => { if (writeMetrics(request, response, env, metrics)) return; response.writeHead(request.url === "/health" || request.url === "/ready" ? 200 : 404); response.end(); }).listen(env.port);
  console.log(JSON.stringify({ event: "agent.worker.started", commandQueue: env.queue, resultQueue: env.resultQueue }));
  const shutdown = async (): Promise<void> => { consumer.stop(); publisher.stop(); server.close(); await Promise.all([consumer.done, publisher.done]); await pool.destroy(); clearInterval(metricsTimer); await queueDatabase.end(); await database.end(); };
  process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
  process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
} else if (env.role === "router") {
  const router = startResultRouter({ queue, resultQueue: env.resultQueue, gatewayQueuePrefix: env.gatewayQueuePrefix, subscriptions, outbox: gatewayOutbox, metrics, visibilitySeconds: env.visibilityTimeoutSeconds, pollSeconds: env.pollSeconds, maxInFlight: env.routerConcurrency, maxDeliveryReads: env.maxDeliveryReads, maxGatewayDeliveryAttempts: env.maxGatewayDeliveryAttempts });
  const server = createServer((request, response) => { if (writeMetrics(request, response, env, metrics)) return; response.writeHead(request.url === "/health" || request.url === "/ready" ? 200 : 404); response.end(); }).listen(env.port);
  console.log(JSON.stringify({ event: "agent.router.started", resultQueue: env.resultQueue }));
  const shutdown = async (): Promise<void> => { router.stop(); server.close(); await router.done; clearInterval(metricsTimer); await queueDatabase.end(); await database.end(); };
  process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
  process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
} else {
  if (!gatewayInstanceId || !gatewayStandby) throw new Error("Gateway identity was not initialised");
  const hub = new EventStreamHub();
  const delivery = startGatewayDelivery({ queue, queueName: gatewayQueue(), hub, metrics, visibilitySeconds: env.visibilityTimeoutSeconds, pollSeconds: env.pollSeconds });
  const server = gatewayStandby.server;
  gatewayStandby.activate(createApp(env, queue, hub, metrics, async () => { await Promise.all([queue.check(), database.query("SELECT 1")]); }));
  console.log(JSON.stringify({ event: "agent.gateway.listening", port: env.port, gatewayId: env.gatewayId, commandQueue: env.queue }));
  const websocket = attachWebSocketTransport(server, env, queue, hub, eventStore, metrics, { replace: (connectionId, channels) => subscriptions.replaceConnection(env.gatewayId, connectionId, channels), remove: (connectionId) => subscriptions.removeConnection(env.gatewayId, connectionId) });
  const renewTimer = setInterval(() => { void subscriptions.renewGateway(env.gatewayId, gatewayInstanceId).then((owned) => {
    if (!owned) { console.error(JSON.stringify({ event: "gateway.identity.lost", gatewayId: env.gatewayId })); process.exit(1); }
  }).catch((error) => console.error(JSON.stringify({ event: "gateway.subscription.renew.failed", error: error instanceof Error ? error.message : String(error) }))); }, Math.max(1_000, Math.floor(env.subscriptionLeaseSeconds * 500)));
  const retentionTimer = setInterval(() => { void (async () => {
    await observeExpiredExecutions();
    await subscriptions.pruneExpired(); await eventStore.pruneChannelCursors(env.retentionDays); await eventStore.prune(env.retentionDays); await eventStore.pruneStreamWatermarks(env.retentionDays); await Promise.all([executions.prune(env.retentionDays), deliveries.prune(env.retentionDays), gatewayOutbox.prune(env.retentionDays)]);
  })().catch((error) => console.error(JSON.stringify({ event: "agent.retention.failed", error: error instanceof Error ? error.message : String(error) }))); }, 60 * 60 * 1_000);
  const shutdown = async (): Promise<void> => {
    clearInterval(metricsTimer); clearInterval(renewTimer); clearInterval(retentionTimer);
    await shutdownGateway({
      stopReader: delivery.stop,
      waitForReader: async () => delivery.done,
      closeSocketsAndRemoveSubscriptions: websocket.closeClientsAndRemoveSubscriptions,
      closeHttp: async () => closeHttpServer(server),
      releaseOwnership: async () => subscriptions.releaseGateway(env.gatewayId, gatewayInstanceId),
    });
    await queueDatabase.end(); await database.end();
  };
  gatewayShutdown = shutdown;
}
