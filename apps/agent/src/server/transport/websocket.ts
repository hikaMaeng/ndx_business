import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { createRequestEvent } from "agent_domain/common";
import type { AgentEnv } from "../env.js";
import type { EventQueueTransport } from "../queue/transport.js";
import { EventStreamHub } from "../stream/hub.js";

type ClientFrame =
  | { type: "subscribe"; channels: string[] }
  | { type: "event"; action: string; payload?: Record<string, unknown>; transactionKey?: string; channel?: string; replyChannel?: string; source?: string };

export function attachWebSocketTransport(server: Server, env: AgentEnv, queue: EventQueueTransport, hub: EventStreamHub): WebSocketServer {
  const websocket = new WebSocketServer({ server, path: "/ws" });
  websocket.on("connection", (socket) => {
    let unsubscribe = hub.subscribe(["agent.requests", "agent.results"], (event) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "event", event }));
    });
    socket.send(JSON.stringify({ type: "ready", channels: ["agent.requests", "agent.results"] }));
    console.log(JSON.stringify({ event: "websocket.connected" }));
    socket.on("message", (raw) => {
      let frame: ClientFrame;
      try { frame = JSON.parse(String(raw)) as ClientFrame; } catch { return; }
      if (frame.type === "subscribe") {
        unsubscribe();
        const channels = frame.channels.filter((channel) => channel.length > 0).slice(0, 32);
        unsubscribe = hub.subscribe(channels, (event) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "event", event })); });
        socket.send(JSON.stringify({ type: "subscribed", channels }));
        return;
      }
      if (frame.type !== "event" || !frame.action) return;
      const event = createRequestEvent({ action: frame.action, payload: frame.payload ?? {}, transactionKey: frame.transactionKey, channel: frame.channel ?? "agent.requests", source: frame.source ?? "websocket", replyChannel: frame.replyChannel ?? "agent.results" });
      void queue.send(env.queue, event).then(async (messageId) => {
        console.log(JSON.stringify({ event: "event.enqueued", transport: "websocket", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, messageId }));
        hub.publish(event);
      }).catch((error) => console.error(JSON.stringify({ event: "websocket.enqueue.failed", action: event.action, transactionKey: event.transactionKey, error: error instanceof Error ? error.message : String(error) })));
    });
    socket.on("close", () => { unsubscribe(); console.log(JSON.stringify({ event: "websocket.disconnected" })); });
    socket.on("error", (error) => console.error(JSON.stringify({ event: "websocket.error", error: error.message })));
  });
  return websocket;
}
