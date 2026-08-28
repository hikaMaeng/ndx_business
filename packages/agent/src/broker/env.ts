import { cpus } from "node:os";

export interface AgentEnv {
  /**
   * What this process is.
   *
   * Two, not three. `dispatcher` named a third kind of server for something
   * that is half of the broker's job — recording a fact and putting it where
   * the reactors will see it are the same job — and it was the `router`
   * process, removed days earlier, back under another name.
   */
  role: "broker" | "worker";
  port: number;
  databaseUrl: string;
  /** Where client ingress is written. */
  queue: string;
  /**
   * The queues a worker server watches.
   *
   * A list, not a name: one process can watch several, and scaling a busy kind
   * of work means running another process that watches only that one. Which
   * queues exist and what they mean is the application's business.
   */
  queues: readonly string[];
  /** Instance label for logs and metrics only. Brokers are interchangeable, so it grants nothing. */
  gatewayId: string;
  visibilityTimeoutSeconds: number;
  executionLeaseSeconds: number;
  reconcileGraceSeconds: number;
  reconcileLookbackSeconds: number;
  reconcileMs: number;
  maxExecutionAttempts: number;
  terminalPersistenceAlertAttempts: number;
  terminalPersistenceBackoffMaxSeconds: number;
  retentionDays: number;
  pollSeconds: number;
  pollBatchSize: number;
  cpuCount: number;
  minWorkerThreads: number;
  maxWorkerThreads: number;
  maxQueue: number;
  databasePoolMax: number;
  /** Fallback tail interval. LISTEN/NOTIFY normally wakes the tail sooner. */
  logTailPollMs: number;
  logTailBatch: number;
  metricsToken: string;
  websocketMailboxMax: number;
  websocketReplayMax: number;
  websocketBufferedBytes: number;
}

function positive(source: NodeJS.ProcessEnv, name: string, fallback: number, allowZero = false): number {
  const value = Number(source[name] ?? fallback);
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`${name} must be ${allowZero ? "non-negative" : "positive"}`);
  return Math.floor(value);
}

export function readEnv(source = process.env): AgentEnv {
  // `gateway` is still accepted: it is what deployed containers say today, and
  // a rename is not a reason to refuse to start.
  const requested = source.AGENT_ROLE ?? "broker";
  const role = requested === "gateway" ? "broker" : requested;
  if (role !== "broker" && role !== "worker") throw new Error("AGENT_ROLE must be broker or worker");
  const cpuCount = cpus().length;
  const maxWorkerThreads = positive(source, "AGENT_MAX_THREADS", cpuCount * 2, false);
  const minWorkerThreads = positive(source, "AGENT_MIN_THREADS", maxWorkerThreads);
  if (minWorkerThreads > maxWorkerThreads) throw new Error("AGENT_MIN_THREADS must not exceed AGENT_MAX_THREADS");
  const visibilityTimeoutSeconds = positive(source, "QUEUE_VISIBILITY_TIMEOUT_SECONDS", 60);
  const databasePoolMax = positive(source, "AGENT_DATABASE_POOL_MAX", Math.min(48, Math.max(16, Math.ceil(maxWorkerThreads / 2))));
  return {
    role,
    port: positive(source, "PORT", 18081),
    databaseUrl: source.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/ndx_business",
    queue: source.AGENT_QUEUE ?? "agent_requests",
    queues: (source.AGENT_QUEUES ?? source.AGENT_QUEUE ?? "agent_requests")
      .split(",").map((name) => name.trim()).filter((name) => name.length > 0),
    gatewayId: source.AGENT_GATEWAY_ID ?? source.HOSTNAME ?? globalThis.crypto.randomUUID(),
    visibilityTimeoutSeconds,
    // The execution fence must outlive a single PGMQ visibility lease so a visibility probe
    // can distinguish queue redelivery from a database ownership reclaim.
    executionLeaseSeconds: positive(source, "AGENT_EXECUTION_LEASE_SECONDS", visibilityTimeoutSeconds * 2),
    /**
     * How long a reaction is given before its absence counts as a failure.
     *
     * Must exceed the longest legitimate reaction, or the sweep re-sends work
     * that is merely slow. Being wrong is not harmful — the claim absorbs the
     * duplicate — but it is wasted inference.
     */
    reconcileGraceSeconds: positive(source, "AGENT_RECONCILE_GRACE_SECONDS", 600),
    /** Older than this is history, not a backlog worth re-driving. */
    reconcileLookbackSeconds: positive(source, "AGENT_RECONCILE_LOOKBACK_SECONDS", 86_400),
    reconcileMs: positive(source, "AGENT_RECONCILE_MS", 60_000),
    maxExecutionAttempts: positive(source, "AGENT_MAX_EXECUTION_ATTEMPTS", 5),
    terminalPersistenceAlertAttempts: positive(source, "AGENT_TERMINAL_PERSISTENCE_ALERT_ATTEMPTS", 10),
    terminalPersistenceBackoffMaxSeconds: positive(source, "AGENT_TERMINAL_PERSISTENCE_BACKOFF_MAX_SECONDS", 300),
    retentionDays: positive(source, "AGENT_RETENTION_DAYS", 30),
    pollSeconds: positive(source, "QUEUE_POLL_SECONDS", 5),
    pollBatchSize: positive(source, "QUEUE_POLL_BATCH_SIZE", 8),
    cpuCount,
    minWorkerThreads,
    maxWorkerThreads,
    maxQueue: positive(source, "AGENT_MAX_QUEUE", 64),
    databasePoolMax,
    logTailPollMs: positive(source, "AGENT_LOG_TAIL_POLL_MS", 1_000),
    logTailBatch: positive(source, "AGENT_LOG_TAIL_BATCH", 256),
    metricsToken: source.AGENT_METRICS_TOKEN ?? "",
    websocketMailboxMax: positive(source, "AGENT_WEBSOCKET_MAILBOX_MAX", 256),
    websocketReplayMax: positive(source, "AGENT_WEBSOCKET_REPLAY_MAX", 256),
    websocketBufferedBytes: positive(source, "AGENT_WEBSOCKET_BUFFERED_BYTES", 1_048_576),
  };
}
