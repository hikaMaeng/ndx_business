import type { EventEnvelope } from "agent_domain/common";
import type { EventQueueTransport } from "../queue/transport.js";
import type { GatewaySubscriptionStore } from "../subscription/store.js";
import type { MetricsRegistry } from "../metrics/registry.js";
import type { BrokerLoop } from "./gateway-delivery.js";

function gatewayQueue(prefix: string, gatewayId: string): string { return `${prefix}${gatewayId.replace(/[^a-zA-Z0-9_]/g, "_")}`; }

/** Fans one result event to every Gateway that currently owns a matching channel subscription. */
export function startResultRouter(input: { queue: EventQueueTransport; resultQueue: string; gatewayQueuePrefix: string; subscriptions: GatewaySubscriptionStore; metrics: MetricsRegistry; visibilitySeconds: number; pollSeconds: number; maxInFlight: number }): BrokerLoop {
  let stopped = false;
  const readyQueues = new Set<string>();
  const ensuringQueues = new Map<string, Promise<void>>();
  const ensureGatewayQueue = async (queue: string): Promise<void> => {
    if (readyQueues.has(queue)) return;
    let pending = ensuringQueues.get(queue);
    if (!pending) {
      pending = input.queue.ensure(queue).then(() => { readyQueues.add(queue); });
      ensuringQueues.set(queue, pending);
    }
    try { await pending; }
    finally { ensuringQueues.delete(queue); }
  };
  const route = async (message: { id: string; event: EventEnvelope }): Promise<void> => {
    const gateways = await input.subscriptions.gatewaysFor(message.event.channel);
    await Promise.all(gateways.map(async (gatewayId) => {
      const target = gatewayQueue(input.gatewayQueuePrefix, gatewayId);
      await ensureGatewayQueue(target);
      await input.queue.send(target, message.event);
    }));
    await input.queue.delete(input.resultQueue, message.id);
    input.metrics.increment("queueDeletes");
  };
  const inFlight = new Set<Promise<void>>();
  const schedule = (message: { id: string; event: EventEnvelope }): void => {
    let task: Promise<void>;
    task = route(message).catch((error) => {
      input.metrics.increment("processingFailures");
      console.error(JSON.stringify({ event: "router.result.failed", messageId: message.id, error: error instanceof Error ? error.message : String(error) }));
    }).finally(() => inFlight.delete(task));
    inFlight.add(task);
  };
  const run = async (): Promise<void> => { while (!stopped) {
    try {
      const messages = await input.queue.read(input.resultQueue, { visibilityTimeoutSeconds: input.visibilitySeconds, quantity: 32, pollSeconds: input.pollSeconds });
      for (const message of messages) {
        while (!stopped && inFlight.size >= input.maxInFlight) await Promise.race(inFlight);
        if (stopped) break;
        schedule({ id: message.id, event: message.event as EventEnvelope });
      }
    } catch (error) { console.error(JSON.stringify({ event: "router.result.retry", error: error instanceof Error ? error.message : String(error) })); }
  } await Promise.allSettled(inFlight); };
  const done = run();
  return { stop: () => { stopped = true; }, done };
}
