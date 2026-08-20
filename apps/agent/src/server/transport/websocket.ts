import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { createRequestEvent, encodeChannelCursor, parseChannelClientFrame, parseChannelCursor, type ChannelServerFrame } from "agent_domain/common";
import type { AgentEnv } from "../env.js";
import type { EventQueueTransport } from "../queue/transport.js";
import { EventStreamHub } from "../stream/hub.js";
import type { EventStore } from "../event-store/store.js";
import { ConnectionMailbox } from "../stream/mailbox/index.js";

export function attachWebSocketTransport(server: Server, env: AgentEnv, queue: EventQueueTransport, hub: EventStreamHub, eventStore: EventStore): WebSocketServer {
  const websocket = new WebSocketServer({ server, path: "/ws" });
  websocket.on("connection", (socket) => {
    const mailbox = new ConnectionMailbox(env.websocketMailboxMax, (event, done) => {
      if (socket.readyState !== socket.OPEN) { done(); return; }
      socket.send(JSON.stringify({ type: "event", event } satisfies ChannelServerFrame), (error) => { if (error) socket.close(1011, "websocket send failed"); done(); });
    }, () => socket.close(1013, "slow consumer"));
    let unsubscribe = hub.subscribe(["agent.requests", "agent.results"], (event) => {
      mailbox.enqueue(event);
    });
    socket.send(JSON.stringify({ type: "ready", channels: ["agent.requests", "agent.results"] } satisfies ChannelServerFrame));
    console.log(JSON.stringify({ event: "websocket.connected" }));
    socket.on("message", async (raw) => {
      try {
      let frame;
      try { frame = parseChannelClientFrame(JSON.parse(String(raw))); } catch { return; }
      if (!frame) return;
      if (frame.type === "subscribe") {
        unsubscribe();
        const channels = frame.channels.filter((channel) => channel.length > 0).slice(0, 32);
        const positions = parseChannelCursor(frame.cursor, channels);
        if (!positions) { socket.close(1008, "invalid channel cursor"); return; }
        const live: import("agent_domain/common").EventEnvelope[] = [];
        let replaying = true;
        const highWater = frame.cursor ? await eventStore.channelHighWater(channels) : {};
        const send = (event: import("agent_domain/common").EventEnvelope) => mailbox.enqueue(event);
        unsubscribe = hub.subscribe(channels, (event) => { if (replaying) live.push(event); else send(event); });
        const replay = await eventStore.replayChannels(channels, positions, highWater);
        replay.forEach(send);
        live.filter((event) => BigInt(event.sequence) > BigInt(highWater[event.streamId] ?? "0")).sort((left, right) => left.streamId.localeCompare(right.streamId) || Number(BigInt(left.sequence) - BigInt(right.sequence))).forEach(send);
        const cursor = encodeChannelCursor(channels, { ...positions, ...highWater });
        replaying = false;
        socket.send(JSON.stringify({ type: "subscribed", channels, cursor } satisfies ChannelServerFrame));
        return;
      }
      if (frame.type !== "event") return;
      const event = createRequestEvent({ action: frame.action, payload: frame.payload, transactionKey: frame.transactionKey, channel: frame.channel, source: "websocket", replyChannel: frame.replyChannel });
      void queue.send(env.queue, event).then(async (messageId) => {
        console.log(JSON.stringify({ event: "event.enqueued", transport: "websocket", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, messageId }));
      }).catch((error) => console.error(JSON.stringify({ event: "websocket.enqueue.failed", action: event.action, transactionKey: event.transactionKey, error: error instanceof Error ? error.message : String(error) })));
      } catch (error) { console.error(JSON.stringify({ event: "websocket.message.failed", error: error instanceof Error ? error.message : String(error) })); socket.close(1008, "invalid subscription"); }
    });
    socket.on("close", () => { unsubscribe(); console.log(JSON.stringify({ event: "websocket.disconnected" })); });
    socket.on("error", (error) => console.error(JSON.stringify({ event: "websocket.error", error: error.message })));
  });
  return websocket;
}
