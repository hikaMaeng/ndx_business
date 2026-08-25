import { createServer, type RequestListener } from "node:http";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { readEnv, type AgentEnv } from "../env.js";
import { createDatabasePool, snapshotDatabasePool } from "../database.js";
import { PgmqClient } from "../pgmq/client.js";
import { MetricsRegistry } from "../metrics/registry.js";
import { writeMetrics } from "../metrics/endpoint.js";
import { EventStore } from "../event-store/store.js";
import { EventStreamHub } from "../stream/hub.js";
import { GatewaySubscriptionStore } from "../subscription/store.js";
import { GatewayOutboxStore } from "../gateway-outbox/store.js";
import { ExecutionStore } from "../idempotency/store.js";
import { DeliveryStore } from "../delivery/store.js";
import { startDeliveryPublisher } from "../delivery/publisher.js";
import { startGatewayDelivery } from "../loops/gateway-delivery.js";
import { startResultRouter } from "../loops/result-router.js";
import { startWorkerConsumer } from "../loops/worker-consumer.js";
import { attachWebSocketTransport } from "../transport/websocket.js";
import { createGatewayStandby } from "../gateway/standby/index.js";
import { closeHttpServer, shutdownGateway } from "../gateway/lifecycle/index.js";
import { createWorkerPool } from "../worker/pool.js";
import { createInlinePool } from "../worker/inline.js";
import type { WorkerExecute } from "../worker/entry.js";
import { createSessionVerifier } from "../auth/index.js";
import { createSocketPolicy } from "../policy/index.js";
import { createWebBackend } from "../http/app.js";

/**
 * Launchable services.
 *
 * The two services are deliberately asymmetric, because their relationship to
 * an application is different.
 *
 * `createEventBroker` is a finished product. Give it a PGMQ/PostgreSQL
 * connection and the list of actions clients may submit, and it is a working
 * broker — sockets, authentication, subscriptions, fan-in, replay and shutdown
 * included. There is nothing to implement.
 *
 * `createWorkerServer` is a frame. It owns everything about *being* a worker
 * server — claiming an execution, holding the lease, recording terminal events,
 * publishing results — and leaves exactly one hole: what a task actually does.
 * The application fills that hole with its own worker module, the way a Spring
 * application supplies controllers to a web framework it did not write.
 */
export interface Service {
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface Runtime {
  env: AgentEnv;
  database: Pool;
  queueDatabase: Pool;
  queue: PgmqClient;
  metrics: MetricsRegistry;
  stopMetrics(): void;
}

/** Pools sized so broker, router and worker together stay under PostgreSQL's 100-client default. */
function createRuntime(env: AgentEnv): Runtime {
  const databasePoolLimit = env.role === "worker"
    ? Math.min(env.databasePoolMax, 24)
    : env.role === "router" ? Math.min(env.databasePoolMax, env.routerConcurrency) : Math.min(env.databasePoolMax, 20);
  const queuePoolLimit = env.role === "router" ? env.routerConcurrency + 1 : 12;
  const database = createDatabasePool(env.databaseUrl, databasePoolLimit);
  const queueDatabase = createDatabasePool(env.databaseUrl, queuePoolLimit);
  const metrics = new MetricsRegistry();
  const refresh = (): void => {
    for (const [name, pool] of [["databasePool", snapshotDatabasePool(database)], ["queuePool", snapshotDatabasePool(queueDatabase)]] as const) {
      metrics.setGauge(`${name}Total` as "databasePoolTotal" | "queuePoolTotal", pool.total);
      metrics.setGauge(`${name}Idle` as "databasePoolIdle" | "queuePoolIdle", pool.idle);
      metrics.setGauge(`${name}Waiting` as "databasePoolWaiting" | "queuePoolWaiting", pool.waiting);
    }
  };
  refresh();
  const timer = setInterval(refresh, 1_000);
  return { env, database, queueDatabase, queue: new PgmqClient(queueDatabase), metrics, stopMetrics: () => clearInterval(timer) };
}

function internalHealthServer(runtime: Runtime): ReturnType<typeof createServer> {
  return createServer((request, response) => {
    if (writeMetrics(request, response, runtime.env, runtime.metrics)) return;
    response.writeHead(request.url === "/health" || request.url === "/ready" ? 200 : 404);
    response.end();
  }).listen(runtime.env.port);
}

// ============================================================ event broker ====

export interface EventBrokerOptions {
  /** Actions a client may submit. The broker never learns what they mean. */
  allowedActions: readonly string[];
  /** Account service that owns sessions. Sessions are validated, never issued, here. */
  accountBaseUrl?: string;
  sessionCacheMs?: number;
  /** Reply channel for a session. Defaults to `<sessionId>` on the session prefix. */
  replyChannelFor?(sessionId: string): string;
  /** Client bundle served at `/`. Omit to serve no client. */
  clientDir?: string;
  /** Worker output served read-only at `/workspace`. Omit to serve none. */
  assetDir?: string;
  /** Overrides the environment schema; defaults to `process.env`. */
  env?: AgentEnv;
  /** Decides whether a user may read a channel. Without it any authenticated user may replay any channel. */
  authorizeChannel?(channel: string, user: { id: string }): boolean;
  /** Extra HTTP routes this deployment needs. Mounted before the client bundle. */
  extendHttp?(app: RequestListener): RequestListener;
}

/**
 * A complete event broker. Connect it to PGMQ and launch it.
 *
 * It creates only its own routing state; event history belongs to the worker
 * that writes it, so a broker can run against a domain it knows nothing about.
 */
export function createEventBroker(options: EventBrokerOptions): Service {
  const env = options.env ?? readEnv();
  const runtime = createRuntime(env);
  let stopService: (() => Promise<void>) | undefined;

  return {
    async start(): Promise<void> {
      const { queue, metrics, database, queueDatabase } = runtime;
      const subscriptions = new GatewaySubscriptionStore(database, env.subscriptionLeaseSeconds);
      const gatewayOutbox = new GatewayOutboxStore(database);
      const eventStore = new EventStore(database, metrics);
      const gatewayQueue = `${env.gatewayQueuePrefix}${env.gatewayId.replace(/[^a-zA-Z0-9_]/g, "_")}`;

      await subscriptions.ensureSchema();

      // Bind the port before claiming the identity, so a second process with
      // this id answers /health while it waits instead of racing for the queue.
      const standby = createGatewayStandby();
      await new Promise<void>((resolve, reject) => {
        standby.server.once("error", reject);
        standby.server.listen(env.port, () => { standby.server.off("error", reject); resolve(); });
      });

      const instanceId = randomUUID();
      for (;;) {
        const claim = await subscriptions.claimGateway(env.gatewayId, instanceId);
        if (claim.owned) break;
        console.warn(JSON.stringify({ event: "gateway.identity.waiting", gatewayId: env.gatewayId, retryAfterMs: claim.retryAfterMs }));
        await new Promise<void>((resolve) => setTimeout(resolve, claim.retryAfterMs));
      }

      await queue.ensure(env.queue);
      await queue.ensure(env.resultQueue);
      await queue.ensure(gatewayQueue);

      const accountBaseUrl = options.accountBaseUrl ?? "http://admin:18080";
      const verifier = createSessionVerifier({ adminBaseUrl: accountBaseUrl, cacheMs: options.sessionCacheMs ?? 5_000 });
      const hub = new EventStreamHub();
      const delivery = startGatewayDelivery({ queue, queueName: gatewayQueue, hub, metrics, visibilitySeconds: env.visibilityTimeoutSeconds, pollSeconds: env.pollSeconds });

      const backend = createWebBackend({
        env, queue, metrics, verifier, accountBaseUrl,
        checkDatabase: async () => { await Promise.all([queue.check(), database.query("SELECT 1")]); },
        openCursor: (channels, from) => (from === "start" ? eventStore.openChannelCursorAtStart(channels) : eventStore.openChannelCursor(channels)),
        ...(options.authorizeChannel ? { authorizeChannel: options.authorizeChannel } : {}),
        ...(options.clientDir === undefined ? {} : { clientDir: options.clientDir }),
        ...(options.assetDir === undefined ? {} : { assetDir: options.assetDir }),
      });
      standby.activate(options.extendHttp ? options.extendHttp(backend) : backend);
      console.log(JSON.stringify({ event: "broker.gateway.listening", port: env.port, gatewayId: env.gatewayId, allowedActions: options.allowedActions }));

      const websocket = attachWebSocketTransport(
        standby.server, env, queue, hub, eventStore, metrics,
        { replace: (connectionId, channels) => subscriptions.replaceConnection(env.gatewayId, connectionId, channels), remove: (connectionId) => subscriptions.removeConnection(env.gatewayId, connectionId) },
        createSocketPolicy({
          verifier,
          allowedActions: options.allowedActions,
          replyChannelFor: options.replyChannelFor ?? ((sessionId) => sessionId),
        }),
      );

      const renewTimer = setInterval(() => { void subscriptions.renewGateway(env.gatewayId, instanceId).then((owned) => {
        if (!owned) { console.error(JSON.stringify({ event: "gateway.identity.lost", gatewayId: env.gatewayId })); process.exit(1); }
      }).catch((error) => console.error(JSON.stringify({ event: "gateway.subscription.renew.failed", error: error instanceof Error ? error.message : String(error) }))); }, Math.max(1_000, Math.floor(env.subscriptionLeaseSeconds * 500)));

      // Only the broker's own state. Domain history is not its to delete.
      const retentionTimer = setInterval(() => { void (async () => {
        await subscriptions.pruneExpired();
        await eventStore.pruneChannelCursors(env.retentionDays);
        await gatewayOutbox.prune(env.retentionDays);
      })().catch((error) => console.error(JSON.stringify({ event: "broker.retention.failed", error: error instanceof Error ? error.message : String(error) }))); }, 60 * 60 * 1_000);

      stopService = async () => {
        runtime.stopMetrics(); clearInterval(renewTimer); clearInterval(retentionTimer);
        await shutdownGateway({
          stopReader: delivery.stop,
          waitForReader: async () => delivery.done,
          closeSocketsAndRemoveSubscriptions: websocket.closeClientsAndRemoveSubscriptions,
          closeHttp: async () => closeHttpServer(standby.server),
          releaseOwnership: async () => subscriptions.releaseGateway(env.gatewayId, instanceId),
        });
        await queueDatabase.end(); await database.end();
      };
    },
    async stop(): Promise<void> { await stopService?.(); },
  };
}

// =========================================================== result router ====

export interface ResultRouterOptions { env?: AgentEnv }

/**
 * Fans each result to every broker holding a matching subscription. Complete as
 * shipped: it is pure transport and has nothing for an application to fill in.
 */
export function createResultRouter(options: ResultRouterOptions = {}): Service {
  const env = options.env ?? readEnv();
  const runtime = createRuntime(env);
  let stopService: (() => Promise<void>) | undefined;

  return {
    async start(): Promise<void> {
      const { queue, metrics, database, queueDatabase } = runtime;
      const subscriptions = new GatewaySubscriptionStore(database, env.subscriptionLeaseSeconds);
      const gatewayOutbox = new GatewayOutboxStore(database);
      await subscriptions.ensureSchema();
      await gatewayOutbox.ensureSchema();
      await queue.ensure(env.resultQueue);

      const router = startResultRouter({ queue, resultQueue: env.resultQueue, gatewayQueuePrefix: env.gatewayQueuePrefix, subscriptions, outbox: gatewayOutbox, metrics, visibilitySeconds: env.visibilityTimeoutSeconds, pollSeconds: env.pollSeconds, maxInFlight: env.routerConcurrency, maxDeliveryReads: env.maxDeliveryReads, maxGatewayDeliveryAttempts: env.maxGatewayDeliveryAttempts });
      const server = internalHealthServer(runtime);
      console.log(JSON.stringify({ event: "broker.router.started", resultQueue: env.resultQueue }));

      stopService = async () => {
        router.stop(); server.close(); await router.done;
        runtime.stopMetrics(); await queueDatabase.end(); await database.end();
      };
    },
    async stop(): Promise<void> { await stopService?.(); },
  };
}

// =========================================================== worker server ====

export interface WorkerServerOptions {
  /**
   * CPU-bound work: the application's worker module, loaded inside a worker
   * thread. A function cannot be passed instead — the thread boundary is why
   * this is a URL. The module must call `startWorkerEntry(execute)`.
   */
  worker?: URL;
  /**
   * IO-bound work: the handler itself, run on the main thread.
   *
   * A handler that only awaits — inference, a child process, a database round
   * trip — does no CPU work, so a thread buys nothing and caps concurrency at
   * `cpus × 2`. Supply this instead and bound concurrency with `maxConcurrent`,
   * which should reflect what downstream services can absorb rather than how
   * many cores this machine happens to have.
   */
  execute?: WorkerExecute;
  /** In-flight ceiling for inline execution. Ignored in thread mode. */
  maxConcurrent?: number;
  env?: AgentEnv;
}

/**
 * A worker server frame.
 *
 * Everything about being a worker is here — claiming a transaction, renewing
 * both leases, recording terminal events with their outbox row, publishing
 * results, pruning domain history. What a task *does* is supplied by the
 * application through `worker`.
 */
export function createWorkerServer(options: WorkerServerOptions): Service {
  if (Boolean(options.worker) === Boolean(options.execute)) throw new Error("createWorkerServer needs exactly one of worker (CPU-bound, thread) or execute (IO-bound, inline)");
  const env = options.env ?? readEnv();
  const runtime = createRuntime(env);
  let stopService: (() => Promise<void>) | undefined;

  return {
    async start(): Promise<void> {
      const { queue, metrics, database, queueDatabase } = runtime;
      const eventStore = new EventStore(database, metrics);
      const executions = new ExecutionStore(database, env.executionLeaseSeconds);
      const deliveries = new DeliveryStore(database, env.executionLeaseSeconds);

      // The worker writes domain history, so it owns that schema and its retention.
      await eventStore.ensureSchema();
      await executions.ensureSchema();
      await deliveries.ensureSchema();
      await queue.ensure(env.queue);
      await queue.ensure(env.resultQueue);

      const prune = async (): Promise<void> => {
        const expired = await executions.expiredRunningCount();
        metrics.setGauge("expiredExecutionLeases", expired);
        if (expired) console.warn(JSON.stringify({ event: "execution.lease.expired", rows: expired }));
        await eventStore.prune(env.retentionDays);
        await eventStore.pruneStreamWatermarks(env.retentionDays);
        await Promise.all([executions.prune(env.retentionDays), deliveries.prune(env.retentionDays)]);
      };
      await prune();
      const retentionTimer = setInterval(() => { void prune().catch((error) => console.error(JSON.stringify({ event: "worker.retention.failed", error: error instanceof Error ? error.message : String(error) }))); }, 60 * 60 * 1_000);

      const inline = Boolean(options.execute);
      const maxInFlight = inline ? (options.maxConcurrent ?? 256) : env.maxWorkerThreads + env.maxQueue;
      const pool = options.execute
        ? createInlinePool(options.execute, maxInFlight)
        : createWorkerPool({ minWorkerThreads: env.minWorkerThreads, maxWorkerThreads: env.maxWorkerThreads, maxQueue: env.maxQueue, workerUrl: options.worker! });
      const publisher = startDeliveryPublisher({ queue, store: deliveries, maxAttempts: env.maxOutboxAttempts, metrics });
      const consumer = startWorkerConsumer({ queue, commandQueue: env.queue, resultQueue: env.resultQueue, eventStore, deliveries, executions, pool, metrics, visibilitySeconds: env.visibilityTimeoutSeconds, pollSeconds: env.pollSeconds, batchSize: env.pollBatchSize, maxInFlight, maxExecutionAttempts: env.maxExecutionAttempts, terminalPersistenceAlertAttempts: env.terminalPersistenceAlertAttempts, terminalPersistenceBackoffMaxSeconds: env.terminalPersistenceBackoffMaxSeconds, onTerminalPersisted: publisher.wake });
      const server = internalHealthServer(runtime);
      console.log(JSON.stringify({ event: "worker.server.started", mode: inline ? "inline" : "threads", maxInFlight, commandQueue: env.queue, resultQueue: env.resultQueue }));

      stopService = async () => {
        consumer.stop(); publisher.stop(); server.close(); clearInterval(retentionTimer);
        await Promise.all([consumer.done, publisher.done]);
        await pool.destroy();
        runtime.stopMetrics(); await queueDatabase.end(); await database.end();
      };
    },
    async stop(): Promise<void> { await stopService?.(); },
  };
}

/** Wires SIGTERM/SIGINT to a service so an app does not repeat the same block. */
export function runService(service: Service): Promise<void> {
  const stop = (): void => {
    void service.stop().then(() => process.exit(0)).catch((error) => {
      console.error(JSON.stringify({ event: "service.shutdown.failed", error: error instanceof Error ? error.message : String(error) }));
      process.exit(1);
    });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  return service.start();
}
