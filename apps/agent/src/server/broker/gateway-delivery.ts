import type { EventEnvelope } from "agent_domain/common";
import type { EventQueueTransport } from "../queue/transport.js";
import type { EventStreamHub } from "../stream/hub.js";
import type { MetricsRegistry } from "../metrics/registry.js";

export type BrokerLoop = { stop(): void; done: Promise<void> };

/** A Gateway consumes only its own PGMQ delivery queue, then projects locally connected sockets. */
export function startGatewayDelivery(input: { queue: EventQueueTransport; queueName: string; hub: EventStreamHub; metrics: MetricsRegistry; visibilitySeconds: number; pollSeconds: number }): BrokerLoop {
  let stopped = false;
  const run = async (): Promise<void> => { while (!stopped) {
    try {
      const messages = await input.queue.read(input.queueName, { visibilityTimeoutSeconds: input.visibilitySeconds, quantity: 32, pollSeconds: input.pollSeconds });
      for (const message of messages) {
        try { input.hub.publish(message.event as EventEnvelope); await input.queue.delete(input.queueName, message.id); input.metrics.increment("queueDeletes"); }
        catch (error) { input.metrics.increment("processingFailures"); console.error(JSON.stringify({ event: "gateway.delivery.failed", messageId: message.id, error: error instanceof Error ? error.message : String(error) })); }
      }
    } catch (error) { console.error(JSON.stringify({ event: "gateway.delivery.retry", error: error instanceof Error ? error.message : String(error) })); }
  } };
  const done = run();
  return { stop: () => { stopped = true; }, done };
}
