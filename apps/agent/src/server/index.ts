import { createApp } from "./app.js";
import { createDatabasePool } from "./database.js";
import { readEnv } from "./env.js";
import { PgmqClient } from "./pgmq/client.js";
import { createWorkerPool } from "./worker/pool.js";
import { startConsumer } from "./consumer.js";
import { EventStreamHub } from "./stream/hub.js";
import { ensureExecutionSchema } from "./execution/store.js";
import { attachWebSocketTransport } from "./transport/websocket.js";
import { EventStore } from "./event-store/store.js";
import { MetricsRegistry } from "./metrics/registry.js";
import { DeliveryStore } from "./delivery/store.js";

const env = readEnv();
const database = createDatabasePool(env.databaseUrl);
const pgmq = new PgmqClient(database);
const metrics = new MetricsRegistry();
const eventStore = new EventStore(database, metrics);
const deliveryStore = new DeliveryStore(database);
async function initializeDatabase(): Promise<void> {
  let delayMs = 250;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      await ensureExecutionSchema(database);
      await eventStore.ensureSchema();
      await deliveryStore.ensureSchema();
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
const pool = createWorkerPool({ minWorkerThreads: env.minWorkerThreads, maxWorkerThreads: env.maxWorkerThreads, maxQueue: env.maxQueue });
const hub = new EventStreamHub();
const consumer = startConsumer({ queueTransport: pgmq, database, pool, hub, eventStore, deliveryStore, metrics, queue: env.queue, resultQueue: env.resultQueue, visibilityTimeoutSeconds: env.visibilityTimeoutSeconds, pollSeconds: env.pollSeconds, batchSize: env.pollBatchSize });
const server = createApp(env, pgmq, hub, metrics).listen(env.port, () => console.log(JSON.stringify({ event: "agent.listening", port: env.port, cpuCount: env.cpuCount, minWorkerThreads: env.minWorkerThreads, maxWorkerThreads: env.maxWorkerThreads, metricsEndpoint: env.metricsToken ? "enabled" : "disabled" })));
const websocket = attachWebSocketTransport(server, env, pgmq, hub);

async function shutdown(): Promise<void> {
  consumer.stop();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  websocket.close();
  await database.end();
  await pool.destroy();
}

process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
