import type { AgentEvent, EventEnvelope } from "agent_domain/common";
import { createResultEvent, deterministicEventId } from "agent_domain/common";
import type { EventQueueTransport } from "./queue/transport.js";
import { claimExecution, completeExecution } from "./execution/store.js";
import { runWorker } from "./worker/pool.js";
import type { WorkerPool } from "./worker/pool.js";
import type { EventStreamHub } from "./stream/hub.js";
import type { EventStore } from "./event-store/store.js";
import type { DeliveryStore } from "./delivery/store.js";
import type { ProcessingStore } from "./processing/store.js";
import type { MetricsRegistry } from "./metrics/registry.js";
import { toEventDraft, toResultDraft } from "./ingress/event-draft.js";

type ResultPayload = { ok: boolean; value?: unknown; error?: { code: string; message: string } };
type ExecutionStatus = "completed" | "failed" | "timed_out" | "cancelled";
type Loop = { stop: () => void };
const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));
const resultEventId = (event: AgentEvent): string => deterministicEventId(`result:${event.transactionKey}`);
function failureStatus(message: string): ExecutionStatus { return message.includes("timed out") || message.includes("timeout") ? "timed_out" : message.includes("aborted") ? "cancelled" : "failed"; }

async function workerOutcome(pool: WorkerPool, event: AgentEvent): Promise<{ result: AgentEvent<ResultPayload>; status: ExecutionStatus }> {
  try { return { result: createResultEvent(event, { ok: true, value: (await runWorker(pool, event)).value }, resultEventId(event)), status: "completed" }; }
  catch (error) { const message = error instanceof Error ? error.message : "Worker failed"; return { result: createResultEvent(event, { ok: false, error: { code: "worker_failed", message } }, resultEventId(event)), status: failureStatus(message) }; }
}

/** Thread 1: PGMQ handoff only. It never awaits a worker or result delivery. */
export function startIngressConsumer(input: { queueTransport: EventQueueTransport; eventStore: EventStore; processingStore: ProcessingStore; metrics: MetricsRegistry; queue: string; visibilityTimeoutSeconds: number; pollSeconds: number; batchSize: number }): Loop {
  let stopped = false;
  void (async () => { while (!stopped) {
    try {
      const messages = await input.queueTransport.read(input.queue, { visibilityTimeoutSeconds: input.visibilityTimeoutSeconds, quantity: input.batchSize, pollSeconds: input.pollSeconds });
      input.metrics.increment("queueReads"); input.metrics.increment("queueMessages", messages.length);
      for (const message of messages) try {
        const persisted = await input.eventStore.append(toEventDraft(message.event));
        await input.processingStore.enqueue(message.event);
        await input.queueTransport.delete(input.queue, message.id);
        input.metrics.increment("queueDeletes");
        console.log(JSON.stringify({ event: "ingress.handed-off", eventId: persisted.eventId, streamId: persisted.streamId, sequence: persisted.sequence, messageId: message.id }));
      } catch (error) { input.metrics.increment("processingFailures"); console.error(JSON.stringify({ event: "ingress.handoff.failed", messageId: message.id, error: error instanceof Error ? error.message : String(error) })); }
    } catch (error) { console.error(JSON.stringify({ event: "ingress.retry", error: error instanceof Error ? error.message : String(error) })); await delay(input.pollSeconds * 1000); }
  } })();
  return { stop: () => { stopped = true; } };
}

/** Scheduler is the sole worker dispatcher. A durable job claim, not PGMQ visibility, owns execution. */
export function startScheduler(input: { queueTransport: EventQueueTransport; database: import("pg").Pool; pool: WorkerPool; hub: EventStreamHub; eventStore: EventStore; deliveryStore: DeliveryStore; processingStore: ProcessingStore; metrics: MetricsRegistry; resultQueue: string; pollSeconds: number }): Loop {
  let stopped = false;
  const publish = async (request: EventEnvelope, result: AgentEvent<ResultPayload>): Promise<void> => {
    const envelope = await input.eventStore.append(toResultDraft(request, result)); const delivery = await input.deliveryStore.claim(envelope.eventId);
    if (delivery === "delivered") return;
    if (delivery === "leased") throw new Error(`result ${envelope.eventId} is leased`);
    await input.queueTransport.send(input.resultQueue, result); input.hub.publish(result); await input.deliveryStore.complete(envelope.eventId);
  };
  const process = async (event: AgentEvent, jobId: string): Promise<void> => {
    const request = await input.eventStore.append(toEventDraft(event)); const claim = await claimExecution(input.database, event);
    if (claim.kind === "conflict") { await publish(request, createResultEvent(event, { ok: false, error: { code: "idempotency_conflict", message: claim.reason } }, deterministicEventId(`conflict:${event.eventId}`))); return; }
    if (claim.kind === "duplicate") { if (claim.completed && claim.result) await publish(request, createResultEvent(event, claim.result as ResultPayload, resultEventId(event))); if (!claim.completed) throw new Error(`transaction ${event.transactionKey} is already running`); return; }
    input.metrics.increment("workerStarted"); input.metrics.increment("inFlight");
    const heartbeat = setInterval(() => { void input.processingStore.renew(jobId); }, Math.max(1000, input.pollSeconds * 500));
    try { const outcome = await workerOutcome(input.pool, event); await completeExecution(input.database, event.transactionKey, outcome.result.payload, outcome.status); input.metrics.increment(outcome.status === "completed" ? "workerCompleted" : "workerFailed"); await publish(request, outcome.result); }
    finally { clearInterval(heartbeat); input.metrics.increment("inFlight", -1); }
  };
  void (async () => { while (!stopped) {
    try {
      const job = await input.processingStore.claimNext(); if (!job) { await delay(input.pollSeconds * 1000); continue; }
      try { await process(job.event, job.eventId); await input.processingStore.complete(job.eventId); }
      catch (error) { input.metrics.increment("processingFailures"); await input.processingStore.retryLater(job.eventId); console.error(JSON.stringify({ event: "scheduler.retry", eventId: job.eventId, error: error instanceof Error ? error.message : String(error) })); }
    } catch (error) { input.metrics.increment("processingFailures"); console.error(JSON.stringify({ event: "scheduler.poll.failed", error: error instanceof Error ? error.message : String(error) })); await delay(input.pollSeconds * 1000); }
  } })();
  return { stop: () => { stopped = true; } };
}
