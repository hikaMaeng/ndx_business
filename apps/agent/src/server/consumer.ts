import type { AgentEvent, EventEnvelope } from "agent_domain/common";
import { createResultEvent, deterministicEventId } from "agent_domain/common";
import type { EventQueueTransport } from "./queue/transport.js";
import { claimExecution, completeExecution } from "./execution/store.js";
import { runWorker } from "./worker/pool.js";
import type { WorkerPool } from "./worker/pool.js";
import type { EventStreamHub } from "./stream/hub.js";
import type { EventStore } from "./event-store/store.js";
import type { MetricsRegistry } from "./metrics/registry.js";
import { toEventDraft, toResultDraft } from "./ingress/event-draft.js";
import type { DeliveryStore } from "./delivery/store.js";

/** One terminal result exists per transaction key, so its identity is derived rather than random. */
function resultEventId(event: AgentEvent): string { return deterministicEventId(`result:${event.transactionKey}`); }

export function startConsumer(input: { queueTransport: EventQueueTransport; database: import("pg").Pool; pool: WorkerPool; hub: EventStreamHub; eventStore: EventStore; deliveryStore: DeliveryStore; metrics: MetricsRegistry; queue: string; resultQueue: string; visibilityTimeoutSeconds: number; pollSeconds: number; batchSize: number }): { stop: () => void } {
  let stopped = false;
  const publishResult = async (request: EventEnvelope, result: AgentEvent<{ ok: boolean; value?: unknown; error?: { code: string; message: string } }>): Promise<void> => {
    const envelope = await input.eventStore.append(toResultDraft(request, result));
    if (!await input.deliveryStore.claim(envelope.eventId)) return;
    await input.queueTransport.send(input.resultQueue, result);
    input.hub.publish(result);
    await input.deliveryStore.complete(envelope.eventId);
  };
  const acknowledge = async (event: AgentEvent, messageId: string): Promise<void> => {
    await input.queueTransport.delete(input.queue, messageId);
    input.metrics.increment("queueDeletes");
    console.log(JSON.stringify({ event: "event.deleted", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, messageId }));
  };
  const loop = async (): Promise<void> => {
    while (!stopped) {
      try {
        const messages = await input.queueTransport.read(input.queue, { visibilityTimeoutSeconds: input.visibilityTimeoutSeconds, quantity: input.batchSize, pollSeconds: input.pollSeconds });
        input.metrics.increment("queueReads");
        input.metrics.increment("queueMessages", messages.length);
        for (const message of messages) {
        const event = message.event as AgentEvent;
        console.log(JSON.stringify({ event: "event.received", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, messageId: message.id }));
        const persisted = await input.eventStore.append(toEventDraft(event));
        console.log(JSON.stringify({ event: "event.persisted", eventId: persisted.eventId, streamId: persisted.streamId, sequence: persisted.sequence, messageId: message.id }));
        const claim = await claimExecution(input.database, event);
        console.log(JSON.stringify({ event: "execution.claim", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, kind: claim.kind, completed: claim.kind === "duplicate" ? claim.completed : false }));
        if (claim.kind === "conflict") {
          console.log(JSON.stringify({ event: "idempotency.conflict", action: event.action, transactionKey: event.transactionKey, reason: claim.reason }));
          const conflictEvent = createResultEvent(event, { ok: false, error: { code: "idempotency_conflict", message: claim.reason } }, deterministicEventId(`conflict:${event.eventId}`));
          await publishResult(persisted, conflictEvent);
          await acknowledge(event, message.id);
          continue;
        }
        if (claim.kind === "duplicate") {
          if (claim.completed && claim.result) {
            const resultEvent = createResultEvent(event, claim.result as { ok: boolean; value?: unknown; error?: { code: string; message: string } }, resultEventId(event));
            console.log(JSON.stringify({ event: "event.replayed", action: resultEvent.action, eventId: resultEvent.eventId, transactionKey: resultEvent.transactionKey }));
            await publishResult(persisted, resultEvent);
          }
          if (claim.completed) await acknowledge(event, message.id);
          continue;
        }
        const visibilityTimer = setInterval(() => {
          void input.queueTransport.extendVisibility(input.queue, message.id, input.visibilityTimeoutSeconds).catch((error) => {
            console.error(JSON.stringify({ event: "visibility.extend.failed", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, messageId: message.id, error: error instanceof Error ? error.message : String(error) }));
          });
        }, Math.max(1000, Math.floor(input.visibilityTimeoutSeconds * 1000 / 2)));
        input.metrics.increment("workerStarted");
        input.metrics.increment("inFlight");
        let resultEvent: AgentEvent<{ ok: boolean; value?: unknown; error?: { code: string; message: string } }>;
        try {
          console.log(JSON.stringify({ event: "worker.started", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey }));
          const result = await runWorker(input.pool, event);
          resultEvent = createResultEvent(event, { ok: true, value: result.value }, resultEventId(event));
          console.log(JSON.stringify({ event: "worker.completed", action: event.action, resultAction: resultEvent.action, eventId: event.eventId, resultEventId: resultEvent.eventId, transactionKey: event.transactionKey }));
          await completeExecution(input.database, event.transactionKey, resultEvent.payload, "completed");
          input.metrics.increment("workerCompleted");
          console.log(JSON.stringify({ event: "execution.completed", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey }));
        } catch (error) {
          resultEvent = createResultEvent(event, { ok: false, error: { code: "worker_failed", message: error instanceof Error ? error.message : "Worker failed" } }, resultEventId(event));
          console.log(JSON.stringify({ event: "worker.failed", action: event.action, resultAction: resultEvent.action, eventId: event.eventId, resultEventId: resultEvent.eventId, transactionKey: event.transactionKey, error: resultEvent.payload }));
          const status = resultEvent.payload.error?.message.includes("timed out") || resultEvent.payload.error?.message.includes("timeout") ? "timed_out" : resultEvent.payload.error?.message.includes("aborted") ? "cancelled" : "failed";
          await completeExecution(input.database, event.transactionKey, resultEvent.payload, status);
          input.metrics.increment("workerFailed");
          console.log(JSON.stringify({ event: "execution.completed", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, outcome: "failed" }));
        }
        try {
          await publishResult(persisted, resultEvent);
          await acknowledge(event, message.id);
        } finally {
          clearInterval(visibilityTimer);
          input.metrics.increment("inFlight", -1);
        }
        }
      } catch (error) {
        console.error(JSON.stringify({ event: "consumer.retry", error: error instanceof Error ? error.message : String(error), delaySeconds: input.pollSeconds }));
        await new Promise((resolve) => setTimeout(resolve, input.pollSeconds * 1000));
      }
    }
  };
  void loop();
  return { stop: () => { stopped = true; } };
}
