import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { createIngressEvent, parseChannelClientFrame, parseChannelCursor, type ChannelServerFrame, type IngressCommand } from "../../common/index.js";
import type { AgentEnv } from "../env.js";
import type { EventQueueTransport } from "../queue/transport.js";
import { EventStreamHub } from "../stream/hub.js";
import type { EventStore } from "../event-store/store.js";
import { ConnectionMailbox } from "../stream/mailbox/index.js";
import { ReplayBuffer } from "../stream/replay-buffer/index.js";
import type { MetricsRegistry } from "../metrics/registry.js";

/**
 * Lets the deploying app decide who may open a socket and what an ingress frame
 * is allowed to become. The broker stays unaware of accounts: it only knows a
 * connection may carry an opaque context, and that a guard may rewrite or
 * reject what the client asked for.
 */
export interface GatewaySocketPolicy {
  /** Return a per-connection context, or null to refuse the upgrade. */
  verifyUpgrade?(request: IncomingMessage): Promise<Record<string, unknown> | null>;
  /**
   * Rewrite or reject a client-submitted ingress command. Returning null drops
   * the connection. The guard sees the envelope, never a decoded payload: the
   * envelope contract is fixed and independent of what an action carries.
   */
  guardIngress?(frame: IngressCommand, context: Record<string, unknown> | undefined): IngressCommand | null;
}

export interface GatewayWebSocketTransport {
  closeClientsAndRemoveSubscriptions(): Promise<void>;
}

export function attachWebSocketTransport(server: Server, env: AgentEnv, queue: EventQueueTransport, hub: EventStreamHub, eventStore: EventStore, metrics: MetricsRegistry, subscriptions?: { replace(connectionId: string, channels: readonly string[]): Promise<void>; remove(connectionId: string): Promise<void> }, policy?: GatewaySocketPolicy): GatewayWebSocketTransport {
  // Authorisation runs before the handshake completes, so an unauthenticated
  // peer never reaches the subscribe path or the ingress path.
  const contexts = new WeakMap<IncomingMessage, Record<string, unknown>>();
  const websocket = new WebSocketServer({
    server, path: "/ws",
    ...(policy?.verifyUpgrade ? { verifyClient: (info: { req: IncomingMessage }, done: (ok: boolean, code?: number, message?: string) => void) => {
      policy.verifyUpgrade!(info.req)
        .then((context) => { if (!context) { done(false, 401, "unauthorized"); return; } contexts.set(info.req, context); done(true); })
        .catch(() => done(false, 401, "unauthorized"));
    } } : {}),
  });
  const removals = new Set<Promise<void>>();
  websocket.on("connection", (socket, request: IncomingMessage) => {
    const connectionContext = contexts.get(request);
    const connectionId = globalThis.crypto.randomUUID();
    let positions: Record<string, string> = {};
    let cursorToken: string | undefined;
    let subscriptionGeneration = 0;
    let closed = false;
    let closing = false;
    let unsubscribe: () => void = () => undefined;
    let mailboxDepth = 0;
    metrics.increment("websocketConnections");
    const closeSlowConsumer = (replay = false) => {
      if (closed || closing) return;
      closing = true;
      metrics.increment("websocketSlowConsumerClosed");
      if (replay) metrics.increment("websocketReplayOverflow");
      socket.close(1013, "slow consumer");
    };
    const mailbox = new ConnectionMailbox(env.websocketMailboxMax, (event, done) => {
      if (socket.readyState !== WebSocket.OPEN) { done(); return; }
      if (socket.bufferedAmount >= env.websocketBufferedBytes) { closeSlowConsumer(); done(); return; }
      if (!cursorToken) { done(); return; }
      const nextPositions = { ...positions, [event.streamId]: event.sequence };
      const token = cursorToken;
      socket.send(JSON.stringify({ type: "event", event, cursor: token } satisfies ChannelServerFrame), (error) => {
        if (error) { metrics.increment("websocketSendFailures"); socket.close(1011, "websocket send failed"); done(); return; }
        void eventStore.advanceChannelCursor(token, nextPositions).then(() => {
          positions = nextPositions;
          metrics.increment("websocketDelivered");
          done();
        }).catch(() => { socket.close(1011, "cursor persistence failed"); done(); });
      });
    }, () => closeSlowConsumer(), (nextDepth) => {
      metrics.increment("websocketMailboxQueued", nextDepth - mailboxDepth);
      mailboxDepth = nextDepth;
    });
    socket.send(JSON.stringify({ type: "ready", channels: ["agent.requests", "agent.results"] } satisfies ChannelServerFrame));
    console.log(JSON.stringify({ event: "websocket.connected" }));
    socket.on("message", async (raw) => {
      try {
        let frame;
        try { frame = parseChannelClientFrame(JSON.parse(String(raw))); } catch { return; }
        if (!frame) return;
        if (frame.type === "subscribe") {
        if (!mailbox.isIdle()) { socket.close(1008, "subscription changed during delivery"); return; }
        const generation = ++subscriptionGeneration;
        unsubscribe();
        unsubscribe = () => undefined;
        const channels = [...new Set(frame.channels.filter((channel) => channel.length > 0))].slice(0, 32);
        if (channels.length === 0 || channels.some((channel) => channel.length > 128)) { socket.close(1008, "invalid channel subscription"); return; }
        if (frame.cursor && !parseChannelCursor(frame.cursor)) { socket.close(1008, "invalid channel cursor"); return; }
        const cursor = await eventStore.openChannelCursor(channels, frame.cursor);
        await subscriptions?.replace(connectionId, channels);
        if (generation !== subscriptionGeneration || closed) return;
        cursorToken = cursor.token;
        positions = cursor.positions;
        const highWater = await eventStore.channelHighWater(channels);
        if (generation !== subscriptionGeneration || closed) return;
        const send = (event: import("../../common/index.js").EventEnvelope) => mailbox.enqueue(event);
        const live = new ReplayBuffer(env.websocketMailboxMax);
        let replaying = true;
        const stopLive = hub.subscribe(channels, (event) => {
          if (!replaying) { send(event); return; }
          const outcome = live.push(event);
          if (outcome === "dropped") metrics.increment("websocketProgressDropped");
          if (outcome === "overflow") closeSlowConsumer(true);
        });
        unsubscribe = stopLive;
        const replay = await eventStore.replayChannels(channels, positions, highWater, env.websocketReplayMax);
        if (generation !== subscriptionGeneration || closed) { stopLive(); return; }
        if (!replay.complete) {
          stopLive();
          unsubscribe = () => undefined;
        }
        socket.send(JSON.stringify({ type: "subscribed", channels, cursor: cursorToken, replayComplete: replay.complete } satisfies ChannelServerFrame), (error) => {
          if (error || generation !== subscriptionGeneration || closed) {
            if (error) { metrics.increment("websocketSendFailures"); socket.close(1011, "websocket send failed"); }
            stopLive();
            return;
          }
          replay.events.forEach(send);
          if (replay.complete) {
            live.drain().filter((event) => BigInt(event.sequence) > BigInt(highWater[event.streamId] ?? "0")).sort((left, right) => left.streamId.localeCompare(right.streamId) || (BigInt(left.sequence) < BigInt(right.sequence) ? -1 : BigInt(left.sequence) > BigInt(right.sequence) ? 1 : 0)).forEach(send);
            replaying = false;
          }
          mailbox.onIdle(() => {
            if (generation !== subscriptionGeneration || closed || !cursorToken) return;
            socket.send(JSON.stringify({ type: "replay", cursor: cursorToken, replayComplete: replay.complete } satisfies ChannelServerFrame), (replayError) => {
              if (replayError) { metrics.increment("websocketSendFailures"); socket.close(1011, "websocket send failed"); }
            });
          });
        });
        return;
        }
        if (frame.type !== "event") return;
        // The client proposes; the app disposes. Anything the server must be able
        // to trust — identity, ownership — is stamped by the guard rather than
        // taken from the wire.
        const { type: _frameType, ...proposed } = frame;
        const allowed = policy?.guardIngress ? policy.guardIngress(proposed, connectionContext) : proposed;
        if (!allowed) { socket.close(1008, "ingress rejected"); return; }
        const event = createIngressEvent(allowed);
        void queue.send(env.queue, event).then(async (messageId) => {
          console.log(JSON.stringify({ event: "event.enqueued", transport: "websocket", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, messageId }));
        }).catch((error) => console.error(JSON.stringify({ event: "websocket.enqueue.failed", action: event.action, transactionKey: event.transactionKey, error: error instanceof Error ? error.message : String(error) })));
      } catch (error) { console.error(JSON.stringify({ event: "websocket.message.failed", error: error instanceof Error ? error.message : String(error) })); socket.close(1008, "invalid subscription"); }
    });
    socket.on("close", () => {
      if (closed) return;
      closed = true;
      closing = true;
      subscriptionGeneration += 1;
      unsubscribe();
      mailbox.dispose();
      const removal = subscriptions ? subscriptions.remove(connectionId) : Promise.resolve();
      removals.add(removal);
      void removal.catch((error) => console.error(JSON.stringify({ event: "gateway.subscription.remove.failed", error: error instanceof Error ? error.message : String(error) }))).finally(() => removals.delete(removal));
      metrics.increment("websocketConnections", -1);
      console.log(JSON.stringify({ event: "websocket.disconnected" }));
    });
    socket.on("error", (error) => console.error(JSON.stringify({ event: "websocket.error", error: error.message })));
  });
  return {
    async closeClientsAndRemoveSubscriptions(): Promise<void> {
      websocket.close();
      const clients = [...websocket.clients];
      const closed = clients.map((client) => new Promise<void>((resolve) => {
        if (client.readyState === WebSocket.CLOSED) { resolve(); return; }
        client.once("close", () => resolve());
        client.close(1001, "gateway shutdown");
      }));
      await Promise.all(closed);
      await Promise.all([...removals]);
    },
  };
}
