import { cpus } from "node:os";

export interface AgentEnv {
  port: number;
  databaseUrl: string;
  queue: string;
  resultQueue: string;
  visibilityTimeoutSeconds: number;
  pollSeconds: number;
  pollBatchSize: number;
  cpuCount: number;
  minWorkerThreads: number;
  maxWorkerThreads: number;
  maxQueue: number;
}

function positive(source: NodeJS.ProcessEnv, name: string, fallback: number, allowZero = false): number {
  const value = Number(source[name] ?? fallback);
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`${name} must be ${allowZero ? "non-negative" : "positive"}`);
  return Math.floor(value);
}

export function readEnv(source = process.env): AgentEnv {
  const cpuCount = cpus().length;
  const minWorkerThreads = positive(source, "AGENT_MIN_THREADS", 0, true);
  const maxWorkerThreads = positive(source, "AGENT_MAX_THREADS", Math.min(2, cpuCount), false);
  if (minWorkerThreads > maxWorkerThreads) throw new Error("AGENT_MIN_THREADS must not exceed AGENT_MAX_THREADS");
  return {
    port: positive(source, "PORT", 18081),
    databaseUrl: source.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/ndx_business",
    queue: source.AGENT_QUEUE ?? "agent_requests",
    resultQueue: source.AGENT_RESULT_QUEUE ?? "agent_results",
    visibilityTimeoutSeconds: positive(source, "QUEUE_VISIBILITY_TIMEOUT_SECONDS", 60),
    pollSeconds: positive(source, "QUEUE_POLL_SECONDS", 5),
    pollBatchSize: positive(source, "QUEUE_POLL_BATCH_SIZE", 1),
    cpuCount,
    minWorkerThreads,
    maxWorkerThreads,
    maxQueue: positive(source, "AGENT_MAX_QUEUE", 64),
  };
}
