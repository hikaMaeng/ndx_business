import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequestEvent } from "agent_domain/common";
import type { AgentEnv } from "./env.js";
import type { EventQueueTransport } from "./queue/transport.js";
import { EventStreamHub } from "./stream/hub.js";
import type { EventLog } from "./event-log.js";

export function createApp(env: AgentEnv, queue: EventQueueTransport, hub: EventStreamHub, eventLog: EventLog): express.Express {
  const app = express();
  const frontDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../front");
  app.use(express.json({ limit: "256kb" }));
  app.get("/health", (_request, response) => response.json({ status: "ok", service: "agent" }));
  app.get("/ready", async (_request, response) => { try { await queue.check(); response.json({ status: "ready" }); } catch { response.status(503).json({ status: "unavailable" }); } });
  app.post("/api/events", async (request, response) => {
    try {
      const body = request.body as { action?: unknown; payload?: unknown; transactionKey?: unknown; channel?: unknown; source?: unknown; replyChannel?: unknown };
      if (typeof body.action !== "string" || !body.action) return response.status(400).json({ error: "action is required" });
      const event = createRequestEvent({ action: body.action, payload: (body.payload && typeof body.payload === "object" ? body.payload : {}) as Record<string, unknown>, transactionKey: typeof body.transactionKey === "string" ? body.transactionKey : undefined, channel: typeof body.channel === "string" ? body.channel : "agent.requests", source: typeof body.source === "string" ? body.source : "http" , replyChannel: typeof body.replyChannel === "string" ? body.replyChannel : "agent.results" });
      const messageId = await queue.send(env.queue, event);
      console.log(JSON.stringify({ event: "event.enqueued", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, channel: event.channel, replyChannel: event.replyChannel, messageId }));
      await eventLog.append(event);
      hub.publish(event);
      return response.status(202).json({ accepted: true, messageId, eventId: event.eventId, transactionKey: event.transactionKey });
    } catch (error) { return response.status(503).json({ error: error instanceof Error ? error.message : "Event enqueue failed" }); }
  });
  app.use(express.static(frontDir));
  app.get("/{*path}", (_request, response) => response.sendFile(path.join(frontDir, "index.html")));
  return app;
}
