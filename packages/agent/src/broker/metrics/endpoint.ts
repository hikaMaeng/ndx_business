import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentEnv } from "../env.js";
import type { MetricsRegistry } from "./registry.js";

export function writeMetrics(request: IncomingMessage, response: ServerResponse, env: AgentEnv, metrics: MetricsRegistry): boolean {
  if (request.url !== "/metrics") return false;
  if (!env.metricsToken) { response.writeHead(404, { "content-type": "application/json" }); response.end(JSON.stringify({ error: "metrics endpoint is disabled" })); return true; }
  if (request.headers.authorization !== `Bearer ${env.metricsToken}`) { response.writeHead(401, { "content-type": "application/json" }); response.end(JSON.stringify({ error: "metrics token required" })); return true; }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ service: "agent", configuration: {
    visibilityTimeoutSeconds: env.visibilityTimeoutSeconds, executionLeaseSeconds: env.executionLeaseSeconds,
    maxExecutionAttempts: env.maxExecutionAttempts, terminalPersistenceAlertAttempts: env.terminalPersistenceAlertAttempts, terminalPersistenceBackoffMaxSeconds: env.terminalPersistenceBackoffMaxSeconds,
    retentionDays: env.retentionDays, logTailPollMs: env.logTailPollMs, logTailBatch: env.logTailBatch,
  }, metrics: metrics.snapshot() }));
  return true;
}
