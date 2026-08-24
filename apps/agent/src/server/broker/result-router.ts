import type { EventEnvelope } from "agent_domain/common";
import type { EventQueueTransport } from "../queue/transport.js";
import type { GatewaySubscriptionStore } from "../subscription/store.js";
import type { MetricsRegistry } from "../metrics/registry.js";
import type { BrokerLoop } from "./gateway-delivery.js";
import { nextReadBackoff, wait } from "./backoff.js";
import { GatewayOutboxStore } from "../gateway-outbox/store.js";

function gatewayQueue(prefix: string, gatewayId: string): string { return `${prefix}${gatewayId.replace(/[^a-zA-Z0-9_]/g, "_")}`; }

/** Fans one result event to every Gateway that currently owns a matching channel subscription. */
export function startResultRouter(input: { queue: EventQueueTransport; resultQueue: string; gatewayQueuePrefix: string; subscriptions: GatewaySubscriptionStore; outbox: GatewayOutboxStore; metrics: MetricsRegistry; visibilitySeconds: number; pollSeconds: number; maxInFlight: number; maxDeliveryReads: number; maxGatewayDeliveryAttempts: number }): BrokerLoop {
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
  const route = async (message: { id: string; event: EventEnvelope; readCount: number }): Promise<void> => {
    const gateways = await input.subscriptions.gatewaysFor(message.event.channel);
    // Do not turn a short subscription outage or submit-before-subscribe race into data loss.
    // Leaving the PGMQ message leased makes the router retry after its visibility timeout.
    if (gateways.length === 0) {
      input.metrics.increment("routerUnmatchedResults");
      // The immutable event store remains the replay source. Archive only after a bounded
      // delivery-read budget so a permanently absent subscription cannot starve the result queue.
      if (message.readCount >= input.maxDeliveryReads) {
        await input.queue.archive(input.resultQueue, message.id);
        input.metrics.increment("routerArchivedUnmatchedResults");
      }
      return;
    }
    const targets = gateways.map((gatewayId) => ({ gatewayId, queueName: gatewayQueue(input.gatewayQueuePrefix, gatewayId) }));
    await input.outbox.record(message.event, targets);
    const pending = new Set(await input.outbox.pending(message.event.eventId, gateways));
    await Promise.all(targets.filter((target) => pending.has(target.gatewayId)).map(async (target) => {
      const { gatewayId, queueName: targetQueue } = target;
      await ensureGatewayQueue(targetQueue);
      try { await input.queue.send(targetQueue, message.event); await input.outbox.delivered(message.event.eventId, gatewayId); }
      catch (error) {
        const outcome = await input.outbox.failed(message.event.eventId, gatewayId, input.maxGatewayDeliveryAttempts, error instanceof Error ? error.message : String(error));
        if (outcome === "dead") input.metrics.increment("gatewayDeliveryDeadLetters");
        else if (outcome === "retry") input.metrics.increment("gatewayDeliveryRetries");
        // The next PGMQ delivery observes either ready (retry) or dead (terminal), so only
        // retry outcomes retain the source lease. A dead handoff is retained in the ledger.
        if (outcome === "retry") throw error;
      }
    }));
    await input.queue.delete(input.resultQueue, message.id);
    input.metrics.increment("queueDeletes");
  };
  const inFlight = new Set<Promise<void>>();
  const schedule = (message: { id: string; event: EventEnvelope; readCount: number }): void => {
    let task: Promise<void>;
    task = route(message).catch((error) => {
      input.metrics.increment("processingFailures");
      console.error(JSON.stringify({ event: "router.result.failed", messageId: message.id, error: error instanceof Error ? error.message : String(error) }));
    }).finally(() => inFlight.delete(task));
    inFlight.add(task);
  };
  const run = async (): Promise<void> => { let backoffMs = 100; while (!stopped) {
    try {
      const messages = await input.queue.read(input.resultQueue, { visibilityTimeoutSeconds: input.visibilitySeconds, quantity: 32, pollSeconds: input.pollSeconds });
      input.metrics.increment("queueReads"); input.metrics.increment("queueMessages", messages.length); backoffMs = 100;
      for (const message of messages) {
        while (!stopped && inFlight.size >= input.maxInFlight) await Promise.race(inFlight);
        if (stopped) break;
        schedule({ id: message.id, event: message.event as EventEnvelope, readCount: message.readCount });
      }
    } catch (error) { input.metrics.increment("brokerReadFailures"); console.error(JSON.stringify({ event: "router.result.retry", backoffMs, error: error instanceof Error ? error.message : String(error) })); await wait(backoffMs); backoffMs = nextReadBackoff(backoffMs); }
  } await Promise.allSettled(inFlight); };
  const done = run();
  return { stop: () => { stopped = true; }, done };
}
