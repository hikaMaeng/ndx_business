import type { AgentEvent } from "agent_domain/common";
import { createResultEvent } from "agent_domain/common";
import type { EventQueueTransport } from "./queue/transport.js";
import { claimExecution, completeExecution } from "./execution/store.js";
import { runWorker } from "./worker/pool.js";
import type { WorkerPool } from "./worker/pool.js";
import type { EventStreamHub } from "./stream/hub.js";
import type { EventLog } from "./event-log.js";
import type { EventStore } from "./event-store/store.js";
import { toEventDraft } from "./ingress/event-draft.js";

export function startConsumer(input: { queueTransport: EventQueueTransport; database: import("pg").Pool; pool: WorkerPool; hub: EventStreamHub; eventLog: EventLog; eventStore: EventStore; queue: string; resultQueue: string; visibilityTimeoutSeconds: number; pollSeconds: number; batchSize: number }): { stop: () => void } {
  let stopped = false;
  const loop = async (): Promise<void> => {
    while (!stopped) {
      try {
        const messages = await input.queueTransport.read(input.queue, { visibilityTimeoutSeconds: input.visibilityTimeoutSeconds, quantity: input.batchSize, pollSeconds: input.pollSeconds });
        for (const message of messages) {
        const event = message.event as AgentEvent;
        console.log(JSON.stringify({ event: "event.received", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, messageId: message.id }));
        const persisted = await input.eventStore.append(toEventDraft(event));
        console.log(JSON.stringify({ event: "event.persisted", eventId: persisted.eventId, streamId: persisted.streamId, sequence: persisted.sequence, messageId: message.id }));
        await input.eventLog.append(event);
        const claim = await claimExecution(input.database, event);
        console.log(JSON.stringify({ event: "execution.claim", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, kind: claim.kind, completed: claim.kind === "duplicate" ? claim.completed : false }));
        if (claim.kind === "conflict") {
          console.log(JSON.stringify({ event: "idempotency.conflict", action: event.action, transactionKey: event.transactionKey, reason: claim.reason }));
          const conflictEvent = createResultEvent(event, { ok: false, error: { code: "idempotency_conflict", message: claim.reason } });
          await input.eventStore.append(toEventDraft(conflictEvent));
          await input.eventLog.append(conflictEvent);
          await input.queueTransport.send(input.resultQueue, conflictEvent);
          input.hub.publish(conflictEvent);
          await input.queueTransport.delete(input.queue, message.id);
          continue;
        }
        if (claim.kind === "duplicate") {
          if (claim.completed && claim.result) {
            const resultEvent = createResultEvent(event, claim.result as { ok: boolean; value?: unknown; error?: { code: string; message: string } });
            console.log(JSON.stringify({ event: "event.replayed", action: resultEvent.action, eventId: resultEvent.eventId, transactionKey: resultEvent.transactionKey }));
            input.hub.publish(resultEvent);
            await input.eventStore.append(toEventDraft(resultEvent));
            await input.eventLog.append(resultEvent);
            await input.queueTransport.send(input.resultQueue, resultEvent);
          }
          if (claim.completed) { await input.queueTransport.delete(input.queue, message.id); console.log(JSON.stringify({ event: "event.deleted", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, messageId: message.id })); }
          continue;
        }
        const visibilityTimer = setInterval(() => {
          void input.queueTransport.extendVisibility(input.queue, message.id, input.visibilityTimeoutSeconds).catch((error) => {
            console.error(JSON.stringify({ event: "visibility.extend.failed", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, messageId: message.id, error: error instanceof Error ? error.message : String(error) }));
          });
        }, Math.max(1000, Math.floor(input.visibilityTimeoutSeconds * 1000 / 2)));
        try {
          console.log(JSON.stringify({ event: "worker.started", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey }));
          const result = await runWorker(input.pool, event);
          const resultEvent = createResultEvent(event, { ok: true, value: result.value });
          console.log(JSON.stringify({ event: "worker.completed", action: event.action, resultAction: resultEvent.action, eventId: event.eventId, resultEventId: resultEvent.eventId, transactionKey: event.transactionKey }));
          await input.eventStore.append(toEventDraft(resultEvent));
          await input.eventLog.append(resultEvent);
          await input.queueTransport.send(input.resultQueue, resultEvent);
          await completeExecution(input.database, event.transactionKey, resultEvent.payload, "completed");
          input.hub.publish(resultEvent);
          console.log(JSON.stringify({ event: "execution.completed", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey }));
          clearInterval(visibilityTimer);
          await input.queueTransport.delete(input.queue, message.id);
          console.log(JSON.stringify({ event: "event.deleted", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, messageId: message.id }));
        } catch (error) {
          const resultEvent = createResultEvent(event, { ok: false, error: { code: "worker_failed", message: error instanceof Error ? error.message : "Worker failed" } });
          console.log(JSON.stringify({ event: "worker.failed", action: event.action, resultAction: resultEvent.action, eventId: event.eventId, resultEventId: resultEvent.eventId, transactionKey: event.transactionKey, error: resultEvent.payload }));
          await input.eventStore.append(toEventDraft(resultEvent));
          await input.eventLog.append(resultEvent);
          await input.queueTransport.send(input.resultQueue, resultEvent);
          const status = resultEvent.payload.error?.message.includes("timed out") || resultEvent.payload.error?.message.includes("timeout") ? "timed_out" : resultEvent.payload.error?.message.includes("aborted") ? "cancelled" : "failed";
          await completeExecution(input.database, event.transactionKey, resultEvent.payload, status);
          input.hub.publish(resultEvent);
          console.log(JSON.stringify({ event: "execution.completed", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, outcome: "failed" }));
          clearInterval(visibilityTimer);
          await input.queueTransport.delete(input.queue, message.id);
          console.log(JSON.stringify({ event: "event.deleted", action: event.action, eventId: event.eventId, transactionKey: event.transactionKey, messageId: message.id }));
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
