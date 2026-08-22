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
import { createServer } from "node:http";

const env = readEnv();
const database = createDatabasePool(env.databaseUrl, env.databasePoolMax);
// The router has many short, independent PGMQ sends. Give its bounded fan-out
// enough queue connections without increasing worker long-poll pressure.
const queueDatabase = createDatabasePool(env.databaseUrl, env.role === "router" ? env.routerConcurrency + 1 : 16);
const queue = new PgmqClient(queueDatabase);
const metrics = new MetricsRegistry();
const eventStore = new EventStore(database, metrics);
const subscriptions = new GatewaySubscriptionStore(database, env.subscriptionLeaseSeconds);
const executions = new ExecutionStore(database, env.visibilityTimeoutSeconds);
const gatewayQueue = (): string => `${env.gatewayQueuePrefix}${env.gatewayId.replace(/[^a-zA-Z0-9_]/g, "_")}`;

await eventStore.ensureSchema();
await subscriptions.ensureSchema();
await executions.ensureSchema();
await queue.ensure(env.queue);
await queue.ensure(env.resultQueue);
if (env.role === "gateway") await queue.ensure(gatewayQueue());

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
  const consumer = startWorkerConsumer({ queue, commandQueue: env.queue, resultQueue: env.resultQueue, eventStore, executions, pool, metrics, visibilitySeconds: env.visibilityTimeoutSeconds, pollSeconds: env.pollSeconds, batchSize: env.pollBatchSize, maxInFlight: env.maxWorkerThreads + env.maxQueue });
  const server = createServer((request, response) => { response.writeHead(request.url === "/health" ? 200 : 404); response.end(); }).listen(env.port);
  console.log(JSON.stringify({ event: "agent.worker.started", commandQueue: env.queue, resultQueue: env.resultQueue }));
  const shutdown = async (): Promise<void> => { consumer.stop(); server.close(); await consumer.done; await pool.destroy(); clearInterval(metricsTimer); await queueDatabase.end(); await database.end(); };
  process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
  process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
} else if (env.role === "router") {
  const router = startResultRouter({ queue, resultQueue: env.resultQueue, gatewayQueuePrefix: env.gatewayQueuePrefix, subscriptions, metrics, visibilitySeconds: env.visibilityTimeoutSeconds, pollSeconds: env.pollSeconds, maxInFlight: env.routerConcurrency });
  const server = createServer((request, response) => { response.writeHead(request.url === "/health" ? 200 : 404); response.end(); }).listen(env.port);
  console.log(JSON.stringify({ event: "agent.router.started", resultQueue: env.resultQueue }));
  const shutdown = async (): Promise<void> => { router.stop(); server.close(); await router.done; clearInterval(metricsTimer); await queueDatabase.end(); await database.end(); };
  process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
  process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
} else {
  const hub = new EventStreamHub();
  const delivery = startGatewayDelivery({ queue, queueName: gatewayQueue(), hub, metrics, visibilitySeconds: env.visibilityTimeoutSeconds, pollSeconds: env.pollSeconds });
  const server = createApp(env, queue, hub, metrics, async () => { await Promise.all([queue.check(), database.query("SELECT 1")]); }).listen(env.port, () => console.log(JSON.stringify({ event: "agent.gateway.listening", port: env.port, gatewayId: env.gatewayId, commandQueue: env.queue })));
  const websocket = attachWebSocketTransport(server, env, queue, hub, eventStore, metrics, { replace: (connectionId, channels) => subscriptions.replaceConnection(env.gatewayId, connectionId, channels), remove: (connectionId) => subscriptions.removeConnection(env.gatewayId, connectionId) });
  const renewTimer = setInterval(() => { void subscriptions.renewGateway(env.gatewayId).catch((error) => console.error(JSON.stringify({ event: "gateway.subscription.renew.failed", error: error instanceof Error ? error.message : String(error) }))); }, Math.max(1_000, Math.floor(env.subscriptionLeaseSeconds * 500)));
  const shutdown = async (): Promise<void> => {
    delivery.stop(); clearInterval(metricsTimer); clearInterval(renewTimer);
    for (const client of websocket.clients) client.close(1001, "gateway shutdown"); websocket.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await delivery.done; await queueDatabase.end(); await database.end();
  };
  process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
  process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
}
