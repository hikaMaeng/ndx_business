import { createApp } from "./app.js";
import { createDatabasePool } from "./database.js";
import { readEnv } from "./env.js";
import { PgmqClient } from "./pgmq/client.js";
import { createWorkerPool } from "./worker/pool.js";
import { startIngressConsumer, startScheduler } from "./consumer.js";
import { EventStreamHub } from "./stream/hub.js";
import { ensureExecutionSchema, recoverExpiredExecutions } from "./execution/store.js";
import { attachWebSocketTransport } from "./transport/websocket.js";
import { EventStore } from "./event-store/store.js";
import { MetricsRegistry } from "./metrics/registry.js";
import { DeliveryStore } from "./delivery/store.js";
import { ProcessingStore } from "./processing/store.js";
import { createSchedulerNotifier } from "./scheduler/notifier.js";

const env = readEnv();
const database = createDatabasePool(env.databaseUrl, env.databasePoolMax);
const ingressQueueDatabase = createDatabasePool(env.databaseUrl, env.ingressConsumers);
const queueDatabase = createDatabasePool(env.databaseUrl, 16);
const ingressPgmq = new PgmqClient(ingressQueueDatabase);
const pgmq = new PgmqClient(queueDatabase);
const metrics = new MetricsRegistry();
const eventStore = new EventStore(database, metrics);
const deliveryStore = new DeliveryStore(database, env.deliveryLeaseSeconds);
const processingStore = new ProcessingStore(database, Math.max(2, env.visibilityTimeoutSeconds));
async function initializeDatabase(): Promise<void> {
  let delayMs = 250;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      await ensureExecutionSchema(database);
      const recovered = await recoverExpiredExecutions(database);
      if (recovered) console.log(JSON.stringify({ event: "execution.recovered", rows: recovered }));
      await eventStore.ensureSchema();
      await deliveryStore.ensureSchema();
      await processingStore.ensureSchema();
      return;
    } catch (error) {
      if (attempt === 12) throw error;
      console.error(JSON.stringify({ event: "agent.database.retry", attempt, delayMs, error: error instanceof Error ? error.message : String(error) }));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, 5000);
    }
  }
}

await initializeDatabase();
const refreshMetrics = async (): Promise<void> => {
  const processing = await processingStore.counts();
  metrics.setGauge("processingReady", processing.ready); metrics.setGauge("processingRunning", processing.running);
  metrics.setGauge("processingReadyOldestMs", processing.readyOldestMs); metrics.setGauge("processingExpiredLeases", processing.expiredLeases);
  metrics.setGauge("deliveryPending", await deliveryStore.pendingCount());
};
void refreshMetrics();
const metricsTimer = setInterval(() => { void refreshMetrics().catch((error) => console.error(JSON.stringify({ event: "metrics.refresh.failed", error: error instanceof Error ? error.message : String(error) }))); }, 1000);
const pool = createWorkerPool({ minWorkerThreads: env.minWorkerThreads, maxWorkerThreads: env.maxWorkerThreads, maxQueue: env.maxQueue });
const hub = new EventStreamHub();
const schedulerNotifier = createSchedulerNotifier();
const ingress = startIngressConsumer({ queueTransport: ingressPgmq, eventStore, processingStore, metrics, notifyScheduler: () => schedulerNotifier.notify(), queue: env.queue, visibilityTimeoutSeconds: env.visibilityTimeoutSeconds, pollSeconds: env.pollSeconds, batchSize: env.pollBatchSize, maxConcurrentHandoffs: env.ingressConsumers });
const scheduler = startScheduler({ queueTransport: pgmq, database, pool, hub, eventStore, deliveryStore, processingStore, metrics, resultQueue: env.resultQueue, schedulerIdleMs: env.schedulerIdleMs, executionLeaseSeconds: env.visibilityTimeoutSeconds, waitForWork: () => schedulerNotifier.wait(env.schedulerIdleMs), maxConcurrentDispatches: env.maxWorkerThreads });
const server = createApp(env, pgmq, hub, metrics).listen(env.port, () => console.log(JSON.stringify({ event: "agent.listening", port: env.port, cpuCount: env.cpuCount, minWorkerThreads: env.minWorkerThreads, maxWorkerThreads: env.maxWorkerThreads, metricsEndpoint: env.metricsToken ? "enabled" : "disabled" })));
const websocket = attachWebSocketTransport(server, env, pgmq, hub);

async function shutdown(): Promise<void> {
  ingress.stop();
  scheduler.stop();
  clearInterval(metricsTimer);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  websocket.close();
  await ingressQueueDatabase.end();
  await queueDatabase.end();
  await database.end();
  await pool.destroy();
}

process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
