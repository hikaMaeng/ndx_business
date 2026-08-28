import { createServer, type RequestListener } from "node:http";
import type { Pool } from "pg";
import { readEnv, type AgentEnv } from "../env.js";
import { createDatabasePool, snapshotDatabasePool } from "../database.js";
import { EnqueueLease, leaseKeyFor } from "../loops/reaction-enqueue/lease.js";
import { PgmqClient } from "../pgmq/client.js";
import { MetricsRegistry } from "../metrics/registry.js";
import { writeMetrics } from "../metrics/endpoint.js";
import { EventStore } from "../event-store/store.js";
import { EventLogListener } from "../event-store/notify.js";
import { EventStreamHub } from "../stream/hub.js";
import { ExecutionStore } from "../idempotency/store.js";
import { startEventLogTail } from "../loops/log-tail/index.js";
import { startReactionEnqueue, type ReactionTable } from "../loops/reaction-enqueue/index.js";
import { startWorkerConsumer } from "../loops/worker-consumer/index.js";
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
 * broker — sockets, authentication, subscriptions, log tail, replay and
 * shutdown included. There is nothing to implement.
 *
 * `createWorkerServer` is a frame. It owns everything about *being* a worker
 * server — claiming an execution, holding the lease, recording terminal events
 * — and leaves exactly one hole: what a task actually does. The application
 * fills that hole with its own worker module, the way a Spring application
 * supplies controllers to a web framework it did not write.
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

/** Pools sized so broker and worker together stay under PostgreSQL's 100-client default. */
function createRuntime(env: AgentEnv): Runtime {
  const databasePoolLimit = env.role === "worker" ? Math.min(env.databasePoolMax, 24) : Math.min(env.databasePoolMax, 20);
  const database = createDatabasePool(env.databaseUrl, databasePoolLimit);
  /**
   * The queue pool follows the same budget.
   *
   * It was a fixed twelve however small the process had been told to be, which
   * meant a limit set on one pool was silently doubled by the other. Every
   * service now shares one database, so "how many connections may this process
   * hold" has to be answerable by reading one number.
   */
  const queueDatabase = createDatabasePool(env.databaseUrl, Math.max(2, Math.min(12, databasePoolLimit)));
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
  /**
   * Which queue an accepted client command goes on.
   *
   * A broker is not tied to one queue any more than a worker server is: two
   * kinds of command can land on two queues that two different worker servers
   * watch. Defaults to the environment's single ingress queue.
   */
  ingressQueueFor?(action: string): string;
  /** Every queue this broker may write to. Ensured at startup so the first send never races creation. */
  ingressQueues?: readonly string[];
  /** Decides whether a user may read a channel. Without it any authenticated user may replay any channel. */
  authorizeChannel?(channel: string, user: { id: string }): boolean;
  /** Extra HTTP routes this deployment needs. Mounted before the client bundle. */
  /**
   * Extra routes around the broker's own surface.
   *
   * The broker's database pool is handed over so the app does not open a
   * second one to the same database for the same reads.
   */
  extendHttp?(app: RequestListener, database: Pool): RequestListener;
  /**
   * action -> the reactor queues that should receive a copy.
   *
   * Given this, the broker also puts recorded facts where the workers will
   * find them. That is not a second component and never should have been one:
   * a broker that records a fact and does not say who should hear about it has
   * done half its job.
   *
   * Omit it and the broker is pure delivery: sockets and the log tail.
   */
  reactions?: ReactionTable;
  /** Distinguishes this deployment's durable enqueue position from any other's. */
  reactionsName?: string;
}

/**
 * A complete event broker. Connect it to PostgreSQL and launch it.
 *
 * It owns no durable state beyond the replay cursors it hands to clients. Its
 * working state is a tail position and a channel-to-socket map, both in memory,
 * which is why any number of these can run against the same database without
 * coordinating and why one dying costs nothing but its open sockets.
 *
 * Event history belongs to the worker that writes it, so a broker can run
 * against a domain it knows nothing about.
 */
export function createEventBroker(options: EventBrokerOptions): Service {
  const env = options.env ?? readEnv();
  const runtime = createRuntime(env);
  let stopService: (() => Promise<void>) | undefined;

  return {
    async start(): Promise<void> {
      const { queue, metrics, database, queueDatabase } = runtime;
      const eventStore = new EventStore(database, metrics);

      // Bind the port first so the process answers /health while it wires up.
      const standby = createGatewayStandby();
      await new Promise<void>((resolve, reject) => {
        standby.server.once("error", reject);
        standby.server.listen(env.port, () => { standby.server.off("error", reject); resolve(); });
      });

      for (const name of new Set([env.queue, ...(options.ingressQueues ?? [])])) await queue.ensure(name);

      const accountBaseUrl = options.accountBaseUrl ?? "http://admin:18080";
      const verifier = createSessionVerifier({ adminBaseUrl: accountBaseUrl, cacheMs: options.sessionCacheMs ?? 5_000 });
      const hub = new EventStreamHub();

      // Delivery is a read of the log, not a consumption of a queue. Nothing
      // here removes or hides anything, so brokers never contend.
      const tail = startEventLogTail({ eventStore, hub, metrics, pollMs: env.logTailPollMs, batchSize: env.logTailBatch });
      hub.watchChannels(() => tail.wake());
      const listener = new EventLogListener(env.databaseUrl, (channel) => tail.wake(channel));
      await listener.start();

      /**
       * The other half: facts in, work out.
       *
       * Every broker runs it and the lease decides which one is doing it at any
       * moment. Reading the log needs no coordination, which is the point of a
       * log; enqueuing does, because two brokers acting on the same fact would
       * buy the same inference twice.
       */
      const enqueue = options.reactions ? await startEnqueue(runtime, env, eventStore, options) : undefined;

      const backend = createWebBackend({
        env, queue, metrics, verifier, accountBaseUrl,
        checkDatabase: async () => { await Promise.all([queue.check(), database.query("SELECT 1")]); },
        openCursor: (channels, from) => (from === "start" ? eventStore.openChannelCursorAtStart(channels) : eventStore.openChannelCursor(channels)),
        ...(options.authorizeChannel ? { authorizeChannel: options.authorizeChannel } : {}),
        ...(options.clientDir === undefined ? {} : { clientDir: options.clientDir }),
        ...(options.assetDir === undefined ? {} : { assetDir: options.assetDir }),
      });
      standby.activate(options.extendHttp ? options.extendHttp(backend, database) : backend);
      console.log(JSON.stringify({ event: "broker.gateway.listening", port: env.port, gatewayId: env.gatewayId, allowedActions: options.allowedActions }));

      const websocket = attachWebSocketTransport(
        standby.server, env, queue, hub, eventStore, metrics,
        createSocketPolicy({
          verifier,
          allowedActions: options.allowedActions,
          replyChannelFor: options.replyChannelFor ?? ((sessionId) => sessionId),
        }),
        options.ingressQueueFor,
      );

      // Only the broker's own state. Domain history is not its to delete.
      const retentionTimer = setInterval(() => { void eventStore.pruneChannelCursors(env.retentionDays)
        .catch((error) => console.error(JSON.stringify({ event: "broker.retention.failed", error: error instanceof Error ? error.message : String(error) }))); }, 60 * 60 * 1_000);

      stopService = async () => {
        runtime.stopMetrics(); clearInterval(retentionTimer);
        await listener.stop();
        await shutdownGateway({
          stopReader: tail.stop,
          waitForReader: async () => tail.done,
          closeSocketsAndRemoveSubscriptions: websocket.closeClientsAndRemoveSubscriptions,
          closeHttp: async () => closeHttpServer(standby.server),
          releaseOwnership: async () => undefined,
        });
        if (enqueue) { enqueue.stop(); await enqueue.done; await enqueue.release(); }
        await queueDatabase.end(); await database.end();
      };
    },
    async stop(): Promise<void> { await stopService?.(); },
  };
}

/**
 * Wires the reaction table into the broker's own runtime.
 *
 * A function rather than a service, because it is not something that runs on
 * its own. It is something the broker does.
 */
async function startEnqueue(
  runtime: Runtime, env: AgentEnv, eventStore: EventStore, options: EventBrokerOptions,
): Promise<{ stop(): void; done: Promise<void>; release(): Promise<void> }> {
  const table = options.reactions!;
  const name = options.reactionsName ?? "reactions";
  const { queue, metrics, database } = runtime;

  for (const queueName of new Set(Object.values(table).flat())) await queue.ensure(queueName);

  // Read to tell a reaction that finished from one that never ran. Without it
  // nothing is recovered.
  const executions = new ExecutionStore(database, env.executionLeaseSeconds);
  await executions.ensureSchema();

  const lease = new EnqueueLease(database, leaseKeyFor(name));
  const loop = startReactionEnqueue({
    name, eventStore, queue, table, metrics,
    pollMs: env.logTailPollMs, batchSize: env.logTailBatch,
    executions,
    reconcileGraceSeconds: env.reconcileGraceSeconds,
    reconcileLookbackSeconds: env.reconcileLookbackSeconds,
    reconcileMs: env.reconcileMs,
    lease,
  });
  console.log(JSON.stringify({ event: "broker.reactions.armed", name, actions: Object.keys(table).length }));
  return { stop: loop.stop, done: loop.done, release: () => lease.release() };
}

// ===================================================== removed: dispatcher ====

//
// `createFactDispatcher` stood here. It made a third kind of server out of the
// broker's second half, which is how a `dispatcher` container came to exist: the
// same shape as the `router` process removed days before it. The loop it ran now
// runs inside `createEventBroker`, given a reaction table.

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
  /**
   * The same, built with this server's database pool.
   *
   * Prefer it. A handler that opens its own pool makes the process hold two
   * sets of connections to one database for the same kind of traffic, and
   * that is how a process came to hold three. The reactors inside a worker
   * server were never the problem — they share whatever pool they are given.
   * The process was.
   */
  executeWith?(database: Pool): WorkerExecute;
  /** In-flight ceiling for inline execution. Ignored in thread mode. */
  maxConcurrent?: number;
  /**
   * The queues this server watches. Defaults to the environment's list.
   *
   * A worker server is not tied to one queue: give it several and one process
   * covers several kinds of work, or give two processes one each and they scale
   * apart. Nothing about the handler changes either way.
   */
  queues?: readonly string[];
  env?: AgentEnv;
}

/**
 * A worker server frame.
 *
 * Everything about being a worker is here — claiming a transaction, renewing
 * both leases, recording terminal events, pruning domain history. What a task
 * *does* is supplied by the application through `worker` or `execute`.
 *
 * Results are not sent anywhere. Appending an event to the log is what
 * publishing means now, so there is no second system to hand it to and
 * therefore no outbox bridging the two.
 */
export function createWorkerServer(options: WorkerServerOptions): Service {
  const inlineCount = Number(Boolean(options.execute)) + Number(Boolean(options.executeWith));
  if (Number(Boolean(options.worker)) + inlineCount !== 1) throw new Error("createWorkerServer needs exactly one of worker (CPU-bound, thread), execute or executeWith (IO-bound, inline)");
  const env = options.env ?? readEnv();
  const runtime = createRuntime(env);
  let stopService: (() => Promise<void>) | undefined;

  return {
    async start(): Promise<void> {
      const { queue, metrics, database, queueDatabase } = runtime;
      const eventStore = new EventStore(database, metrics);
      const executions = new ExecutionStore(database, env.executionLeaseSeconds);

      // The worker writes domain history, so it owns that schema and its retention.
      const commandQueues = options.queues?.length ? options.queues : env.queues;

      await eventStore.ensureSchema();
      await executions.ensureSchema();
      for (const name of new Set(commandQueues)) await queue.ensure(name);

      const prune = async (): Promise<void> => {
        const expired = await executions.expiredRunningCount();
        metrics.setGauge("expiredExecutionLeases", expired);
        if (expired) console.warn(JSON.stringify({ event: "execution.lease.expired", rows: expired }));
        await eventStore.prune(env.retentionDays);
        await eventStore.pruneStreamWatermarks(env.retentionDays);
        await executions.prune(env.retentionDays);
      };
      await prune();
      const retentionTimer = setInterval(() => { void prune().catch((error) => console.error(JSON.stringify({ event: "worker.retention.failed", error: error instanceof Error ? error.message : String(error) }))); }, 60 * 60 * 1_000);

      const execute = options.executeWith ? options.executeWith(database) : options.execute;
      const inline = Boolean(execute);
      const maxInFlight = inline ? (options.maxConcurrent ?? 256) : env.maxWorkerThreads + env.maxQueue;
      const pool = execute
        ? createInlinePool(execute, maxInFlight)
        : createWorkerPool({ minWorkerThreads: env.minWorkerThreads, maxWorkerThreads: env.maxWorkerThreads, maxQueue: env.maxQueue, workerUrl: options.worker! });
      const consumer = startWorkerConsumer({ queue, commandQueues, eventStore, executions, pool, metrics, visibilitySeconds: env.visibilityTimeoutSeconds, pollSeconds: env.pollSeconds, batchSize: env.pollBatchSize, maxInFlight, maxExecutionAttempts: env.maxExecutionAttempts, terminalPersistenceAlertAttempts: env.terminalPersistenceAlertAttempts, terminalPersistenceBackoffMaxSeconds: env.terminalPersistenceBackoffMaxSeconds });
      const server = internalHealthServer(runtime);
      console.log(JSON.stringify({ event: "worker.server.started", mode: inline ? "inline" : "threads", maxInFlight, queues: commandQueues }));

      stopService = async () => {
        consumer.stop(); server.close(); clearInterval(retentionTimer);
        await consumer.done;
        await pool.destroy();
        runtime.stopMetrics(); await queueDatabase.end(); await database.end();
      };
    },
    async stop(): Promise<void> { await stopService?.(); },
  };
}

/** Wires SIGTERM/SIGINT to a service so an app does not repeat the same block. */
/**
 * Presents several services as one.
 *
 * A process that is two things still gets a single shutdown: `runService`
 * installs its signal handlers once, and two calls would install two, each
 * racing to `process.exit` and cutting the other's stop short. Composing first
 * means the halves stop in reverse order and the process leaves when both are
 * done.
 */
export function combineServices(...services: readonly Service[]): Service {
  const started: Service[] = [];
  return {
    async start(): Promise<void> {
      for (const service of services) { await service.start(); started.push(service); }
    },
    async stop(): Promise<void> {
      for (const service of started.reverse()) await service.stop();
    },
  };
}

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
