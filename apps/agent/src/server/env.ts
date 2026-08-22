import { cpus } from "node:os";

export interface AgentEnv {
  role: "gateway" | "worker" | "router";
  port: number;
  databaseUrl: string;
  queue: string;
  resultQueue: string;
  gatewayQueuePrefix: string;
  gatewayId: string;
  subscriptionLeaseSeconds: number;
  visibilityTimeoutSeconds: number;
  pollSeconds: number;
  pollBatchSize: number;
  cpuCount: number;
  minWorkerThreads: number;
  maxWorkerThreads: number;
  maxQueue: number;
  routerConcurrency: number;
  databasePoolMax: number;
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
  const role = source.AGENT_ROLE ?? "gateway";
  if (role !== "gateway" && role !== "worker" && role !== "router") throw new Error("AGENT_ROLE must be gateway, worker, or router");
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
    resultQueue: source.AGENT_RESULT_QUEUE ?? "agent_results",
    gatewayQueuePrefix: source.AGENT_GATEWAY_QUEUE_PREFIX ?? "agent_gateway_",
    gatewayId: source.AGENT_GATEWAY_ID ?? source.HOSTNAME ?? globalThis.crypto.randomUUID(),
    subscriptionLeaseSeconds: positive(source, "AGENT_SUBSCRIPTION_LEASE_SECONDS", 30),
    visibilityTimeoutSeconds,
    pollSeconds: positive(source, "QUEUE_POLL_SECONDS", 5),
    pollBatchSize: positive(source, "QUEUE_POLL_BATCH_SIZE", 8),
    cpuCount,
    minWorkerThreads,
    maxWorkerThreads,
    maxQueue: positive(source, "AGENT_MAX_QUEUE", 64),
    databasePoolMax,
    routerConcurrency: positive(source, "AGENT_ROUTER_CONCURRENCY", Math.min(12, databasePoolMax)),
    metricsToken: source.AGENT_METRICS_TOKEN ?? "",
    websocketMailboxMax: positive(source, "AGENT_WEBSOCKET_MAILBOX_MAX", 256),
    websocketReplayMax: positive(source, "AGENT_WEBSOCKET_REPLAY_MAX", 256),
    websocketBufferedBytes: positive(source, "AGENT_WEBSOCKET_BUFFERED_BYTES", 1_048_576),
  };
}
