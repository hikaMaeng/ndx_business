import type { EventEnvelope } from "agent_domain/common";
import type { EventQueueTransport } from "../queue/transport.js";
import type { GatewaySubscriptionStore } from "../subscription/store.js";
import type { MetricsRegistry } from "../metrics/registry.js";
import type { BrokerLoop } from "./gateway-delivery.js";

function gatewayQueue(prefix: string, gatewayId: string): string { return `${prefix}${gatewayId.replace(/[^a-zA-Z0-9_]/g, "_")}`; }

/** Fans one result event to every Gateway that currently owns a matching channel subscription. */
export function startResultRouter(input: { queue: EventQueueTransport; resultQueue: string; gatewayQueuePrefix: string; subscriptions: GatewaySubscriptionStore; metrics: MetricsRegistry; visibilitySeconds: number; pollSeconds: number }): BrokerLoop {
  let stopped = false;
  const run = async (): Promise<void> => { while (!stopped) {
    try {
      const messages = await input.queue.read(input.resultQueue, { visibilityTimeoutSeconds: input.visibilitySeconds, quantity: 32, pollSeconds: input.pollSeconds });
      for (const message of messages) {
        try {
          const event = message.event as EventEnvelope;
          const gateways = await input.subscriptions.gatewaysFor(event.channel);
          for (const gatewayId of gateways) {
            const target = gatewayQueue(input.gatewayQueuePrefix, gatewayId);
            await input.queue.ensure(target);
            await input.queue.send(target, event);
          }
          await input.queue.delete(input.resultQueue, message.id);
          input.metrics.increment("queueDeletes");
        } catch (error) { input.metrics.increment("processingFailures"); console.error(JSON.stringify({ event: "router.result.failed", messageId: message.id, error: error instanceof Error ? error.message : String(error) })); }
      }
    } catch (error) { console.error(JSON.stringify({ event: "router.result.retry", error: error instanceof Error ? error.message : String(error) })); }
  } };
  const done = run();
  return { stop: () => { stopped = true; }, done };
}
