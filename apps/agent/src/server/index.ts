import { createApp } from "./app.js";
import { createDatabasePool, snapshotDatabasePool } from "./database.js";
import { readEnv } from "./env.js";
import { PgmqClient } from "./pgmq/client.js";
import { createWorkerPool } from "./worker/pool.js";
import { startIngressConsumer, startScheduler } from "./consumer.js";
import { EventStreamHub } from "./stream/hub.js";
import { ensureExecutionSchema, recoverExpiredExecutions } from "./execution/store.js";
import { attachWebSocketTransport } from "./transport/websocket.js";
import { EventStore } from "./event-store/store.js";
import { MetricsRegistry } from "./metrics/registry.js";
import { ProcessingStore } from "./processing/store.js";
import { createSchedulerNotifier } from "./scheduler/notifier.js";
import { OutboxStore } from "./outbox/store.js";
import { startOutboxDispatcher } from "./outbox/dispatcher.js";
import { ProjectionStore } from "./projection/store.js";
import { startProjectionRunners } from "./projection/runner.js";
import { ProjectionNotifier } from "./projection/notifier.js";

const env = readEnv();
const database = createDatabasePool(env.databaseUrl, env.databasePoolMax);
const ingressQueueDatabase = createDatabasePool(env.databaseUrl, env.ingressConsumers);
const queueDatabase = createDatabasePool(env.databaseUrl, 16);
const ingressPgmq = new PgmqClient(ingressQueueDatabase);
const pgmq = new PgmqClient(queueDatabase);
const metrics = new MetricsRegistry();
const eventStore = new EventStore(database, metrics);
const outboxStore = new OutboxStore(database, env.outboxLeaseSeconds);
const projectionStore = new ProjectionStore(database);
const processingStore = new ProcessingStore(database, Math.max(2, env.visibilityTimeoutSeconds));
async function initializeDatabase(): Promise<void> {
  let delayMs = 250;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      await ensureExecutionSchema(database);
      const recovered = await recoverExpiredExecutions(database);
      if (recovered) console.log(JSON.stringify({ event: "execution.recovered", rows: recovered }));
      await eventStore.ensureSchema();
      await outboxStore.ensureSchema();
      await projectionStore.ensureSchema();
      await processingStore.ensureSchema();
      const pruned = await processingStore.pruneOperationalLedgers(env.operationalRetentionDays);
      if (pruned.processingJobs || pruned.outbox) console.log(JSON.stringify({ event: "operational-ledger.pruned", retentionDays: env.operationalRetentionDays, ...pruned }));
      const cursors = await eventStore.pruneChannelCursors(env.cursorRetentionDays);
      if (cursors) console.log(JSON.stringify({ event: "channel-cursor.pruned", retentionDays: env.cursorRetentionDays, cursors }));
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
  metrics.setGauge("processingReady", processing.ready); metrics.setGauge("processingRunning", processing.running); metrics.setGauge("processingDlq", processing.failed);
  metrics.setGauge("processingReadyOldestMs", processing.readyOldestMs); metrics.setGauge("processingExpiredLeases", processing.expiredLeases);
  const outbox = await outboxStore.counts();
  metrics.setGauge("outboxPending", outbox.pending);
  metrics.setGauge("outboxFailed", outbox.failed);
  const pools = [
    ["databasePool", snapshotDatabasePool(database)],
    ["ingressQueuePool", snapshotDatabasePool(ingressQueueDatabase)],
    ["queuePool", snapshotDatabasePool(queueDatabase)],
  ] as const;
  for (const [name, pool] of pools) {
    metrics.setGauge(`${name}Total` as "databasePoolTotal" | "ingressQueuePoolTotal" | "queuePoolTotal", pool.total);
    metrics.setGauge(`${name}Idle` as "databasePoolIdle" | "ingressQueuePoolIdle" | "queuePoolIdle", pool.idle);
    metrics.setGauge(`${name}Waiting` as "databasePoolWaiting" | "ingressQueuePoolWaiting" | "queuePoolWaiting", pool.waiting);
  }
};
void refreshMetrics();
const metricsTimer = setInterval(() => { void refreshMetrics().catch((error) => console.error(JSON.stringify({ event: "metrics.refresh.failed", error: error instanceof Error ? error.message : String(error) }))); }, 1000);
const retentionTimer = setInterval(() => { void Promise.all([processingStore.pruneOperationalLedgers(env.operationalRetentionDays), eventStore.pruneChannelCursors(env.cursorRetentionDays)]).catch((error) => console.error(JSON.stringify({ event: "retention.prune.failed", error: error instanceof Error ? error.message : String(error) }))); }, 24 * 60 * 60 * 1000);
const recoveryTimer = setInterval(() => { void recoverExpiredExecutions(database).then((rows) => { if (rows) console.log(JSON.stringify({ event: "execution.recovered", rows })); }).catch((error) => console.error(JSON.stringify({ event: "execution.recovery.failed", error: error instanceof Error ? error.message : String(error) }))); }, Math.max(1000, Math.floor(env.visibilityTimeoutSeconds * 500)));
const pool = createWorkerPool({ minWorkerThreads: env.minWorkerThreads, maxWorkerThreads: env.maxWorkerThreads, maxQueue: env.maxQueue });
const hub = new EventStreamHub();
const schedulerNotifier = createSchedulerNotifier();
const projectionNotifier = new ProjectionNotifier();
const ingress = startIngressConsumer({ queueTransport: ingressPgmq, eventStore, processingStore, metrics, notifyScheduler: () => schedulerNotifier.notify(), notifyProjection: () => projectionNotifier.notify(), publishLive: (event) => hub.publish(event), queue: env.queue, visibilityTimeoutSeconds: env.visibilityTimeoutSeconds, pollSeconds: env.pollSeconds, batchSize: env.pollBatchSize, maxConcurrentHandoffs: env.ingressConsumers });
const scheduler = startScheduler({ database, pool, eventStore, outboxStore, processingStore, metrics, notifyProjection: () => projectionNotifier.notify(), schedulerIdleMs: env.schedulerIdleMs, executionLeaseSeconds: env.visibilityTimeoutSeconds, processingMaxAttempts: env.processingMaxAttempts, processingRetryBaseMs: env.processingRetryBaseMs, waitForWork: () => schedulerNotifier.wait(env.schedulerIdleMs), maxConcurrentDispatches: env.maxWorkerThreads });
const outbox = startOutboxDispatcher({ outbox: outboxStore, queue: pgmq, resultQueue: env.resultQueue, hub, metrics, idleMs: env.schedulerIdleMs, retryMs: env.outboxRetryBaseMs, maxAttempts: env.outboxMaxAttempts, lanes: env.outboxDispatchers });
const projections = startProjectionRunners({ store: projectionStore, metrics, waitForWork: (projection) => projectionNotifier.wait(projection, 30_000) });
const server = createApp(env, pgmq, hub, metrics, async () => { await database.query("SELECT 1"); }).listen(env.port, () => console.log(JSON.stringify({ event: "agent.listening", port: env.port, cpuCount: env.cpuCount, minWorkerThreads: env.minWorkerThreads, maxWorkerThreads: env.maxWorkerThreads, metricsEndpoint: env.metricsToken ? "enabled" : "disabled" })));
const websocket = attachWebSocketTransport(server, env, pgmq, hub, eventStore, metrics);

const waitWithin = async (work: Promise<unknown>, timeoutMs: number): Promise<boolean> => {
  const completed = await Promise.race([work.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs))]);
  return completed;
};

async function shutdown(): Promise<void> {
  console.log(JSON.stringify({ event: "agent.shutdown.started", graceMs: env.shutdownGraceMs }));
  ingress.stop();
  for (const client of websocket.clients) client.close(1001, "server shutdown");
  websocket.close();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!await waitWithin(ingress.done, env.shutdownGraceMs)) console.error(JSON.stringify({ event: "agent.shutdown.ingress.timeout" }));
  scheduler.stop();
  outbox.stop();
  projections.stop();
  schedulerNotifier.notify();
  projectionNotifier.notify();
  clearInterval(metricsTimer);
  clearInterval(retentionTimer);
  clearInterval(recoveryTimer);
  const drained = await waitWithin(Promise.all([scheduler.done, outbox.done, projections.done]), env.shutdownGraceMs);
  if (!drained) console.error(JSON.stringify({ event: "agent.shutdown.drain.timeout" }));
  await pool.destroy();
  await ingressQueueDatabase.end();
  await queueDatabase.end();
  await database.end();
  console.log(JSON.stringify({ event: "agent.shutdown.completed", drained }));
}

process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
