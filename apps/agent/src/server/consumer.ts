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

type ResultPayload = { ok: boolean; value?: unknown; error?: { code: string; message: string } };
type ExecutionStatus = "completed" | "failed" | "timed_out" | "cancelled";

/** One terminal result exists per transaction key, so its identity is derived rather than random. */
function resultEventId(event: AgentEvent): string { return deterministicEventId(`result:${event.transactionKey}`); }

function failureStatus(message: string): ExecutionStatus {
  if (message.includes("timed out") || message.includes("timeout")) return "timed_out";
  if (message.includes("aborted")) return "cancelled";
  return "failed";
}

/**
 * Runs the worker and converts either outcome into a terminal result.
 * This never rejects: only the worker's own outcome is classified here, so a later durable-state or
 * egress failure cannot reach the client labelled as a worker failure.
 */
async function runToOutcome(pool: WorkerPool, event: AgentEvent): Promise<{ resultEvent: AgentEvent<ResultPayload>; status: ExecutionStatus }> {
  try {
    const result = await runWorker(pool, event);
    return { resultEvent: createResultEvent(event, { ok: true, value: result.value }, resultEventId(event)), status: "completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Worker failed";
    return { resultEvent: createResultEvent(event, { ok: false, error: { code: "worker_failed", message } }, resultEventId(event)), status: failureStatus(message) };
  }
}

export function startConsumer(input: { queueTransport: EventQueueTransport; database: import("pg").Pool; pool: WorkerPool; hub: EventStreamHub; eventStore: EventStore; deliveryStore: DeliveryStore; metrics: MetricsRegistry; queue: string; resultQueue: string; visibilityTimeoutSeconds: number; pollSeconds: number; batchSize: number }): { stop: () => void } {
  let stopped = false;
  const publishResult = async (request: EventEnvelope, result: AgentEvent<ResultPayload>): Promise<void> => {
    const envelope = await input.eventStore.append(toResultDraft(request, result));
    const claim = await input.deliveryStore.claim(envelope.eventId);
    if (claim === "delivered") return;
    if (claim === "leased") throw new Error(`result ${envelope.eventId} is leased by an unfinished delivery attempt`);
    await input.queueTransport.send(input.resultQueue, result);
    input.hub.publish(result);
    await input.deliveryStore.complete(envelope.eventId);
  };
  const acknowledge = async (event: AgentEvent, messageId: string): Promise<void> => {
    await input.queueTransport.delete(input.queue, messageId);
    input.metrics.increment("queueDeletes");
    console.log(JSON.stringify({ event: "event.deleted", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, messageId }));
  };
  const handle = async (message: { id: string; event: unknown }): Promise<void> => {
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
      return;
    }
    if (claim.kind === "duplicate") {
      if (claim.completed && claim.result) {
        const resultEvent = createResultEvent(event, claim.result as ResultPayload, resultEventId(event));
        console.log(JSON.stringify({ event: "event.replayed", action: resultEvent.action, eventId: resultEvent.eventId, transactionKey: resultEvent.transactionKey }));
        await publishResult(persisted, resultEvent);
      }
      if (claim.completed) await acknowledge(event, message.id);
      return;
    }
    // The timer and the in-flight counter are released by this `finally` on every exit path,
    // durable-state and egress failures included. A leaked timer would keep extending the message
    // visibility and strand the event: never acknowledged, never redelivered.
    const visibilityTimer = setInterval(() => {
      void input.queueTransport.extendVisibility(input.queue, message.id, input.visibilityTimeoutSeconds).catch((error) => {
        console.error(JSON.stringify({ event: "visibility.extend.failed", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, messageId: message.id, error: error instanceof Error ? error.message : String(error) }));
      });
    }, Math.max(1000, Math.floor(input.visibilityTimeoutSeconds * 1000 / 2)));
    input.metrics.increment("workerStarted");
    input.metrics.increment("inFlight");
    try {
      console.log(JSON.stringify({ event: "worker.started", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey }));
      const outcome = await runToOutcome(input.pool, event);
      console.log(JSON.stringify({ event: outcome.status === "completed" ? "worker.completed" : "worker.failed", action: event.action, resultAction: outcome.resultEvent.action, eventId: event.eventId, resultEventId: outcome.resultEvent.eventId, transactionKey: event.transactionKey, status: outcome.status }));
      input.metrics.increment(outcome.status === "completed" ? "workerCompleted" : "workerFailed");
      await completeExecution(input.database, event.transactionKey, outcome.resultEvent.payload, outcome.status);
      console.log(JSON.stringify({ event: "execution.completed", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, status: outcome.status }));
      await publishResult(persisted, outcome.resultEvent);
      await acknowledge(event, message.id);
    } finally {
      clearInterval(visibilityTimer);
      input.metrics.increment("inFlight", -1);
    }
  };
  const loop = async (): Promise<void> => {
    while (!stopped) {
      try {
        const messages = await input.queueTransport.read(input.queue, { visibilityTimeoutSeconds: input.visibilityTimeoutSeconds, quantity: input.batchSize, pollSeconds: input.pollSeconds });
        input.metrics.increment("queueReads");
        input.metrics.increment("queueMessages", messages.length);
        for (const message of messages) {
          try {
            await handle(message);
          } catch (error) {
            // The message stays unacknowledged and becomes visible again after its timeout. One
            // failing message must not abandon the rest of the batch.
            input.metrics.increment("processingFailures");
            console.error(JSON.stringify({ event: "event.processing.failed", messageId: message.id, error: error instanceof Error ? error.message : String(error) }));
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
