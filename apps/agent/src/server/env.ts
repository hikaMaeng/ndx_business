import { cpus } from "node:os";

export interface AgentEnv {
  port: number;
  databaseUrl: string;
  queue: string;
  resultQueue: string;
  visibilityTimeoutSeconds: number;
  pollSeconds: number;
  pollBatchSize: number;
  schedulerIdleMs: number;
  processingMaxAttempts: number;
  processingRetryBaseMs: number;
  operationalRetentionDays: number;
  cursorRetentionDays: number;
  ingressConsumers: number;
  cpuCount: number;
  minWorkerThreads: number;
  maxWorkerThreads: number;
  maxQueue: number;
  databasePoolMax: number;
  metricsToken: string;
  deliveryLeaseSeconds: number;
  websocketMailboxMax: number;
  websocketBufferedBytes: number;
}

function positive(source: NodeJS.ProcessEnv, name: string, fallback: number, allowZero = false): number {
  const value = Number(source[name] ?? fallback);
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`${name} must be ${allowZero ? "non-negative" : "positive"}`);
  return Math.floor(value);
}

export function readEnv(source = process.env): AgentEnv {
  const cpuCount = cpus().length;
  const minWorkerThreads = positive(source, "AGENT_MIN_THREADS", 0, true);
  const maxWorkerThreads = positive(source, "AGENT_MAX_THREADS", cpuCount * 2, false);
  if (minWorkerThreads > maxWorkerThreads) throw new Error("AGENT_MIN_THREADS must not exceed AGENT_MAX_THREADS");
  const visibilityTimeoutSeconds = positive(source, "QUEUE_VISIBILITY_TIMEOUT_SECONDS", 60);
  const deliveryLeaseSeconds = positive(source, "AGENT_DELIVERY_LEASE_SECONDS", 30);
  // A lease that outlives the queue visibility timeout turns a redelivery into a blocked delivery:
  // the redelivered message finds the lease still held and cannot make progress.
  if (deliveryLeaseSeconds >= visibilityTimeoutSeconds) throw new Error("AGENT_DELIVERY_LEASE_SECONDS must be shorter than QUEUE_VISIBILITY_TIMEOUT_SECONDS");
  return {
    port: positive(source, "PORT", 18081),
    databaseUrl: source.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/ndx_business",
    queue: source.AGENT_QUEUE ?? "agent_requests",
    resultQueue: source.AGENT_RESULT_QUEUE ?? "agent_results",
    visibilityTimeoutSeconds,
    pollSeconds: positive(source, "QUEUE_POLL_SECONDS", 5),
    pollBatchSize: positive(source, "QUEUE_POLL_BATCH_SIZE", 8),
    schedulerIdleMs: positive(source, "AGENT_SCHEDULER_IDLE_MS", 250),
    processingMaxAttempts: positive(source, "AGENT_PROCESSING_MAX_ATTEMPTS", 5),
    processingRetryBaseMs: positive(source, "AGENT_PROCESSING_RETRY_BASE_MS", 1_000),
    operationalRetentionDays: positive(source, "AGENT_OPERATIONAL_RETENTION_DAYS", 30),
    cursorRetentionDays: positive(source, "AGENT_CURSOR_RETENTION_DAYS", 7),
    ingressConsumers: positive(source, "AGENT_INGRESS_CONSUMERS", Math.min(32, maxWorkerThreads)),
    cpuCount,
    minWorkerThreads,
    maxWorkerThreads,
    maxQueue: positive(source, "AGENT_MAX_QUEUE", 64),
    databasePoolMax: positive(source, "AGENT_DATABASE_POOL_MAX", Math.min(48, Math.max(16, Math.ceil(maxWorkerThreads / 2)))),
    metricsToken: source.AGENT_METRICS_TOKEN ?? "",
    deliveryLeaseSeconds,
    websocketMailboxMax: positive(source, "AGENT_WEBSOCKET_MAILBOX_MAX", 256),
    websocketBufferedBytes: positive(source, "AGENT_WEBSOCKET_BUFFERED_BYTES", 1_048_576),
  };
}
