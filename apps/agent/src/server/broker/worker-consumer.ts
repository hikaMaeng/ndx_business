import { randomUUID } from "node:crypto";
import { deterministicEventId } from "agent_domain/server";
import type { EventEnvelope, IngressEvent } from "agent_domain/common";
import type { EventQueueTransport } from "../queue/transport.js";
import { EventStore } from "../event-store/store.js";
import { toEventDraft, toResultDraft } from "../ingress/event-draft.js";
import { toProcessingFailureDraft } from "../ingress/event-draft.js";
import { runWorker, type WorkerPool, WorkerLostError } from "../worker/pool.js";
import type { MetricsRegistry } from "../metrics/registry.js";
import type { BrokerLoop } from "./gateway-delivery.js";
import { ExecutionStore, type ResultPayload } from "../idempotency/store.js";
import { nextReadBackoff, wait } from "./backoff.js";
import { DeliveryStore } from "../delivery/store.js";

function resultId(event: EventEnvelope): string { return deterministicEventId(`result:${event.transactionKey}:${event.streamId}:${event.replyChannel ?? event.channel}`); }
function conflictId(event: EventEnvelope): string { return deterministicEventId(`conflict:${event.eventId}`); }
class TerminalPersistenceError extends Error {}

/** A Worker server is only a PGMQ command consumer and PGMQ result producer. */
export function startWorkerConsumer(input: { queue: EventQueueTransport; commandQueue: string; resultQueue: string; eventStore: EventStore; deliveries: DeliveryStore; executions: ExecutionStore; pool: WorkerPool; metrics: MetricsRegistry; visibilitySeconds: number; pollSeconds: number; batchSize: number; maxInFlight: number; maxExecutionAttempts: number; terminalPersistenceAlertAttempts?: number; onTerminalPersisted?: () => void }): BrokerLoop {
  let stopped = false;
  const persistResult = async (draft: Parameters<EventStore["append"]>[0]): Promise<EventEnvelope> => {
    const persisted = await input.eventStore.append(draft, (client, event) => input.deliveries.enqueue(client, input.resultQueue, event));
    input.onTerminalPersisted?.();
    return persisted;
  };
  const process = async (message: { id: string; event: IngressEvent; readCount: number }): Promise<void> => {
    const command = await input.eventStore.append(toEventDraft(message.event));
    const claim = await input.executions.claim(command, randomUUID());
    if (claim.kind === "conflict") {
      await persistResult(toResultDraft(command, { eventId: conflictId(command), action: `${command.action}.conflict`, channel: command.replyChannel ?? command.channel, createdAt: new Date().toISOString(), source: "worker", payload: { ok: false, error: { code: "idempotency_conflict", message: claim.reason } } }));
      await input.queue.delete(input.commandQueue, message.id);
      input.metrics.increment("queueDeletes");
      return;
    }
    if (claim.kind === "joined" && !claim.completed) {
      input.metrics.increment("processingJoined");
      // See docs/constraints.md#내구성-경계: this can be a visibility redelivery of
      // the still-running source command. Keeping it lets a later lease expiry
      // reclaim the execution instead of orphaning the transaction.
      if (claim.requestEventId !== command.eventId) {
        await input.queue.delete(input.commandQueue, message.id);
        input.metrics.increment("queueDeletes");
      } else await input.executions.recordRedelivery(command.transactionKey);
      return;
    }
    let payload: ResultPayload;
    try {
      if (claim.kind === "claimed") {
        input.metrics.increment("workerStarted");
        const controller = new AbortController();
        let leaseLost = false;
        const heartbeat = setInterval(() => {
          // DB ownership fences execution. A transient PGMQ set_vt failure may duplicate delivery,
          // but must not abort the owner: the retained source command is safe to reclaim later.
          void input.executions.renew(command.transactionKey, claim.attemptId).then((owned) => {
            if (!owned) { leaseLost = true; controller.abort(); }
          }).catch(() => { leaseLost = true; controller.abort(); });
          void input.queue.extendVisibility(input.commandQueue, message.id, input.visibilitySeconds).catch((error) => {
            input.metrics.increment("queueVisibilityRenewFailures");
            console.error(JSON.stringify({ event: "worker.visibility.renew.failed", messageId: message.id, error: error instanceof Error ? error.message : String(error) }));
          });
        }, Math.max(1_000, Math.floor(input.visibilitySeconds * 1_000 / 3)));
        try {
          const worker = await runWorker(input.pool, command, controller.signal);
          if (leaseLost) throw new WorkerLostError("worker lost the execution lease");
          payload = { ok: true, value: worker.value };
        }
        finally { clearInterval(heartbeat); }
        input.metrics.increment("workerCompleted");
        if (!await input.executions.complete(command.transactionKey, claim.attemptId, payload)) throw new WorkerLostError("worker lost the execution lease");
      } else {
        payload = claim.result ?? { ok: false, error: { code: "missing_terminal_result", message: "completed execution had no result" } };
      }
    } catch (error) {
      if (error instanceof WorkerLostError) {
        if (claim.kind !== "claimed") throw error;
        if (claim.attempts < input.maxExecutionAttempts) {
          if (!await input.executions.release(command.transactionKey, claim.attemptId)) throw error;
          throw error;
        }
        payload = { ok: false, error: { code: "processing_permanent_failure", message: error.message } };
        if (!await input.executions.complete(command.transactionKey, claim.attemptId, payload)) throw error;
      } else {
      payload = { ok: false, error: { code: "worker_failed", message: error instanceof Error ? error.message : String(error) } };
      input.metrics.increment("workerFailed");
      if (claim.kind === "claimed" && !await input.executions.complete(command.transactionKey, claim.attemptId, payload)) throw new WorkerLostError("worker lost the execution lease");
      }
    }
    try {
      const recipients = await input.executions.recipients(command.transactionKey);
      const permanentFailure = payload.error?.code === "processing_permanent_failure";
      for (const recipient of recipients) {
        if (permanentFailure) {
          await persistResult(toProcessingFailureDraft(recipient, deterministicEventId(`processing-failed:${recipient.transactionKey}:${recipient.streamId}:${recipient.replyChannel ?? recipient.channel}`), payload.error?.message ?? "processing failed"));
        } else {
          await persistResult(toResultDraft(recipient, { eventId: resultId(recipient), action: `${recipient.action}.result`, channel: recipient.replyChannel ?? recipient.channel, createdAt: new Date().toISOString(), source: "worker", payload }));
        }
      }
      if (permanentFailure) {
        await input.queue.archive(input.commandQueue, message.id);
        input.metrics.increment("processingDlqTotal");
      } else {
        await input.queue.delete(input.commandQueue, message.id);
        input.metrics.increment("queueDeletes");
      }
    } catch (error) { throw new TerminalPersistenceError(error instanceof Error ? error.message : String(error)); }
  };
  const inFlight = new Set<Promise<void>>();
  const schedule = (message: { id: string; event: IngressEvent; readCount: number }): void => {
    let task: Promise<void>;
    task = process(message).catch(async (error) => {
      if (error instanceof TerminalPersistenceError) {
        input.metrics.increment("terminalPersistenceRetries");
        console.error(JSON.stringify({ event: "worker.terminal.retry", messageId: message.id, error: error.message }));
        if (message.readCount >= (input.terminalPersistenceAlertAttempts ?? 10)) {
          input.metrics.increment("terminalPersistenceAlerts");
          console.error(JSON.stringify({ event: "worker.terminal.persistence.alert", messageId: message.id, readCount: message.readCount, threshold: input.terminalPersistenceAlertAttempts ?? 10, error: error.message }));
        }
      } else {
        input.metrics.increment("processingFailures");
        console.error(JSON.stringify({ event: "worker.command.retry", messageId: message.id, error: error instanceof Error ? error.message : String(error) }));
      }
    }).finally(() => inFlight.delete(task));
    inFlight.add(task);
  };
  const lane = async (): Promise<void> => { let backoffMs = 100; while (!stopped) {
    try {
      const messages = await input.queue.read(input.commandQueue, { visibilityTimeoutSeconds: input.visibilitySeconds, quantity: input.batchSize, pollSeconds: input.pollSeconds });
      input.metrics.increment("queueReads"); input.metrics.increment("queueMessages", messages.length);
      backoffMs = 100;
      for (const message of messages) {
        while (!stopped && inFlight.size >= input.maxInFlight) await Promise.race(inFlight);
        if (stopped) break;
        schedule({ id: message.id, event: message.event as IngressEvent, readCount: message.readCount });
      }
    } catch (error) { input.metrics.increment("brokerReadFailures"); console.error(JSON.stringify({ event: "worker.consumer.retry", backoffMs, error: error instanceof Error ? error.message : String(error) })); await wait(backoffMs); backoffMs = nextReadBackoff(backoffMs); }
  } await Promise.allSettled(inFlight); };
  const done = lane();
  return { stop: () => { stopped = true; }, done };
}
