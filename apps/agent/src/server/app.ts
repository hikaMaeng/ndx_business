import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createIngressEvent } from "agent_domain/common";
import type { AgentEnv } from "./env.js";
import type { EventQueueTransport } from "./queue/transport.js";
import { EventStreamHub } from "./stream/hub.js";
import type { MetricsRegistry } from "./metrics/registry.js";

export function createApp(env: AgentEnv, queue: EventQueueTransport, hub: EventStreamHub, metrics: MetricsRegistry, checkDatabase: () => Promise<void>): express.Express {
  const app = express();
  const frontDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../front");
  app.use(express.json({ limit: "256kb" }));
  app.get("/health", (_request, response) => response.json({ status: "ok", service: "agent" }));
  app.get("/ready", async (_request, response) => { try { await Promise.all([queue.check(), checkDatabase()]); response.json({ status: "ready" }); } catch { response.status(503).json({ status: "unavailable" }); } });
  app.get("/metrics", (request, response) => {
    if (!env.metricsToken) return response.status(404).json({ error: "metrics endpoint is disabled" });
    if (request.get("authorization") !== `Bearer ${env.metricsToken}`) return response.status(401).json({ error: "metrics token required" });
    return response.json({ service: "agent", metrics: metrics.snapshot() });
  });
  app.post("/api/events", async (request, response) => {
    try {
      const body = request.body as { action?: unknown; payload?: unknown; transactionKey?: unknown; channel?: unknown; source?: unknown; replyChannel?: unknown };
      if (typeof body.action !== "string" || !body.action) return response.status(400).json({ error: "action is required" });
      const event = createIngressEvent({ action: body.action, payload: (body.payload && typeof body.payload === "object" ? body.payload : {}) as Record<string, unknown>, transactionKey: typeof body.transactionKey === "string" ? body.transactionKey : undefined, channel: typeof body.channel === "string" ? body.channel : "agent.requests", replyChannel: typeof body.replyChannel === "string" ? body.replyChannel : "agent.results" });
      const messageId = await queue.send(env.queue, event);
      metrics.increment("ingressAccepted");
      console.log(JSON.stringify({ event: "event.enqueued", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, channel: event.channel, replyChannel: event.replyChannel, messageId }));
      return response.status(202).json({ accepted: true, messageId, eventId: event.eventId, transactionKey: event.transactionKey });
    } catch (error) { return response.status(503).json({ error: error instanceof Error ? error.message : "Event enqueue failed" }); }
  });
  app.use(express.static(frontDir));
  app.get("/{*path}", (_request, response) => response.sendFile(path.join(frontDir, "index.html")));
  return app;
}
