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

function resultId(event: EventEnvelope): string { return deterministicEventId(`result:${event.transactionKey}:${event.streamId}:${event.replyChannel ?? event.channel}`); }
function conflictId(event: EventEnvelope): string { return deterministicEventId(`conflict:${event.eventId}`); }

/** A Worker server is only a PGMQ command consumer and PGMQ result producer. */
export function startWorkerConsumer(input: { queue: EventQueueTransport; commandQueue: string; resultQueue: string; eventStore: EventStore; executions: ExecutionStore; pool: WorkerPool; metrics: MetricsRegistry; visibilitySeconds: number; pollSeconds: number; batchSize: number; maxInFlight: number; maxAttempts: number }): BrokerLoop {
  let stopped = false;
  const process = async (message: { id: string; event: IngressEvent }): Promise<void> => {
    const command = await input.eventStore.append(toEventDraft(message.event));
    const claim = await input.executions.claim(command, randomUUID());
    if (claim.kind === "conflict") {
      const conflict = await input.eventStore.append(toResultDraft(command, { eventId: conflictId(command), action: `${command.action}.conflict`, channel: command.replyChannel ?? command.channel, createdAt: new Date().toISOString(), source: "worker", payload: { ok: false, error: { code: "idempotency_conflict", message: claim.reason } } }));
      await input.queue.send(input.resultQueue, conflict);
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
      if (error instanceof WorkerLostError) throw error;
      payload = { ok: false, error: { code: "worker_failed", message: error instanceof Error ? error.message : String(error) } };
      input.metrics.increment("workerFailed");
      if (claim.kind === "claimed" && !await input.executions.complete(command.transactionKey, claim.attemptId, payload)) throw new WorkerLostError("worker lost the execution lease");
    }
    const recipients = await input.executions.recipients(command.transactionKey);
    for (const recipient of recipients) {
      const result = await input.eventStore.append(toResultDraft(recipient, { eventId: resultId(recipient), action: `${recipient.action}.result`, channel: recipient.replyChannel ?? recipient.channel, createdAt: new Date().toISOString(), source: "worker", payload }));
      await input.queue.send(input.resultQueue, result);
    }
    await input.queue.delete(input.commandQueue, message.id);
    input.metrics.increment("queueDeletes");
  };
  const inFlight = new Set<Promise<void>>();
  const schedule = (message: { id: string; event: IngressEvent; readCount: number }): void => {
    let task: Promise<void>;
    task = process(message).catch((error) => {
      input.metrics.increment("processingFailures");
      console.error(JSON.stringify({ event: "worker.command.retry", messageId: message.id, error: error instanceof Error ? error.message : String(error) }));
      if (message.readCount < input.maxAttempts) return;
      return (async () => {
        // A pre-terminal infrastructure error needs a finite terminal state too. Archive first so
        // it cannot spin forever; a canonical command can additionally emit a visible failure.
        await input.queue.archive(input.commandQueue, message.id);
        input.metrics.increment("processingDlqTotal");
        const command = await input.eventStore.append(toEventDraft(message.event));
        const failure = await input.eventStore.append(toProcessingFailureDraft(command, deterministicEventId(`processing-failed:${command.eventId}:${command.streamId}:${command.replyChannel ?? command.channel}`), error instanceof Error ? error.message : String(error)));
        await input.queue.send(input.resultQueue, failure);
      })();
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
