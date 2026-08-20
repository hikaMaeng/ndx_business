import type { AgentEvent, EventEnvelope } from "agent_domain/common";
import { createResultEvent, deterministicEventId } from "agent_domain/common";
import type { EventQueueTransport } from "./queue/transport.js";
import { claimExecution, completeExecution, renewExecution } from "./execution/store.js";
import { runWorker } from "./worker/pool.js";
import type { WorkerPool } from "./worker/pool.js";
import type { EventStreamHub } from "./stream/hub.js";
import type { EventStore } from "./event-store/store.js";
import type { DeliveryStore } from "./delivery/store.js";
import type { ProcessingStore } from "./processing/store.js";
import type { MetricsRegistry } from "./metrics/registry.js";
import { toEventDraft, toProcessingFailureDraft, toResultDraft } from "./ingress/event-draft.js";

type ResultPayload = { ok: boolean; value?: unknown; error?: { code: string; message: string } };
type ExecutionStatus = "completed" | "failed" | "timed_out" | "cancelled";
type Loop = { stop: () => void };
class ExecutionInProgressError extends Error {}
const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));
const resultEventId = (event: Pick<EventEnvelope, "transactionKey">): string => deterministicEventId(`result:${event.transactionKey}`);
function failureStatus(message: string): ExecutionStatus { return message.includes("timed out") || message.includes("timeout") ? "timed_out" : message.includes("aborted") ? "cancelled" : "failed"; }

async function workerOutcome(pool: WorkerPool, event: EventEnvelope, signal?: AbortSignal): Promise<{ result: AgentEvent<ResultPayload>; status: ExecutionStatus }> {
  try { return { result: createResultEvent(event, { ok: true, value: (await runWorker(pool, event, signal)).value }, resultEventId(event)), status: "completed" }; }
  catch (error) { const message = error instanceof Error ? error.message : "Worker failed"; return { result: createResultEvent(event, { ok: false, error: { code: "worker_failed", message } }, resultEventId(event)), status: failureStatus(message) }; }
}

/** Thread 1: PGMQ handoff only. It never awaits a worker or result delivery. */
export function startIngressConsumer(input: { queueTransport: EventQueueTransport; eventStore: EventStore; processingStore: ProcessingStore; metrics: MetricsRegistry; notifyScheduler: () => void; queue: string; visibilityTimeoutSeconds: number; pollSeconds: number; batchSize: number; maxConcurrentHandoffs: number }): Loop {
  let stopped = false;
  const handoffLane = async (): Promise<void> => { while (!stopped) {
    try {
      const messages = await input.queueTransport.read(input.queue, { visibilityTimeoutSeconds: input.visibilityTimeoutSeconds, quantity: input.batchSize, pollSeconds: input.pollSeconds });
      input.metrics.increment("queueReads"); input.metrics.increment("queueMessages", messages.length);
      for (const message of messages) try {
        input.metrics.increment("ingressHandoffActive");
        const persisted = await input.eventStore.append(toEventDraft(message.event));
        await input.processingStore.enqueue(persisted);
        await input.queueTransport.delete(input.queue, message.id);
        input.notifyScheduler();
        input.metrics.increment("queueDeletes");
        console.log(JSON.stringify({ event: "ingress.handed-off", eventId: persisted.eventId, streamId: persisted.streamId, sequence: persisted.sequence, messageId: message.id }));
      } catch (error) { input.metrics.increment("processingFailures"); console.error(JSON.stringify({ event: "ingress.handoff.failed", messageId: message.id, error: error instanceof Error ? error.message : String(error) })); }
      finally { input.metrics.increment("ingressHandoffActive", -1); }
    } catch (error) { console.error(JSON.stringify({ event: "ingress.retry", error: error instanceof Error ? error.message : String(error) })); await delay(input.pollSeconds * 1000); }
  } };
  for (let lane = 0; lane < input.maxConcurrentHandoffs; lane += 1) void handoffLane();
  return { stop: () => { stopped = true; } };
}

/** Scheduler is the sole worker dispatcher. A durable job claim, not PGMQ visibility, owns execution. */
export function startScheduler(input: { queueTransport: EventQueueTransport; database: import("pg").Pool; pool: WorkerPool; hub: EventStreamHub; eventStore: EventStore; deliveryStore: DeliveryStore; processingStore: ProcessingStore; metrics: MetricsRegistry; resultQueue: string; schedulerIdleMs: number; executionLeaseSeconds: number; processingMaxAttempts: number; processingRetryBaseMs: number; waitForWork: () => Promise<void>; maxConcurrentDispatches: number }): Loop {
  let stopped = false;
  const deliver = async (envelope: EventEnvelope): Promise<void> => {
    const delivery = await input.deliveryStore.claim(envelope.eventId);
    if (delivery.kind === "delivered") return;
    if (delivery.kind === "leased") throw new Error(`result ${envelope.eventId} is leased`);
    await input.queueTransport.send(input.resultQueue, envelope); input.hub.publish(envelope);
    if (!await input.deliveryStore.complete(envelope.eventId, delivery.attemptId)) throw new Error(`delivery attempt ${delivery.attemptId} lost its lease`);
  };
  const publish = async (request: EventEnvelope, result: AgentEvent<ResultPayload>): Promise<void> => deliver(await input.eventStore.append(toResultDraft(request, result)));
  const process = async (request: EventEnvelope, jobId: string, attemptId: string): Promise<void> => {
    const claim = await claimExecution(input.database, request, attemptId, input.executionLeaseSeconds);
    if (claim.kind === "conflict") { await publish(request, createResultEvent(request, { ok: false, error: { code: "idempotency_conflict", message: claim.reason } }, deterministicEventId(`conflict:${request.eventId}`))); return; }
    if (claim.kind === "duplicate") { if (claim.completed && claim.result) await publish(request, createResultEvent(request, claim.result as ResultPayload, resultEventId(request))); if (!claim.completed) throw new ExecutionInProgressError(`transaction ${request.transactionKey} is already running`); return; }
    input.metrics.increment("workerStarted"); input.metrics.increment("inFlight");
    let leaseLost = false; const controller = new AbortController();
    const heartbeatMs = Math.max(100, Math.floor(input.executionLeaseSeconds * 1000 / 3));
    const heartbeat = setInterval(() => { void Promise.all([input.processingStore.renew(jobId, attemptId), renewExecution(input.database, request.transactionKey, attemptId, input.executionLeaseSeconds)]).then(([jobRenewed, executionRenewed]) => { if (!jobRenewed || !executionRenewed) { leaseLost = true; controller.abort(); } }).catch((error) => { leaseLost = true; controller.abort(); input.metrics.increment("processingFailures"); console.error(JSON.stringify({ event: "scheduler.heartbeat.failed", eventId: jobId, attemptId, error: error instanceof Error ? error.message : String(error) })); }); }, heartbeatMs);
    try { const outcome = await workerOutcome(input.pool, request, controller.signal); if (leaseLost) throw new Error(`attempt ${attemptId} lost its lease`); if (!await completeExecution(input.database, request.transactionKey, attemptId, outcome.result.payload, outcome.status)) throw new Error(`execution attempt ${attemptId} lost its lease`); input.metrics.increment(outcome.status === "completed" ? "workerCompleted" : "workerFailed"); await publish(request, outcome.result); }
    finally { clearInterval(heartbeat); input.metrics.increment("inFlight", -1); }
  };
  const dispatchLane = async (): Promise<void> => { while (!stopped) {
    try {
      const job = await input.processingStore.claimNext(); if (!job) { await input.waitForWork(); continue; }
      input.metrics.increment("schedulerDispatchActive");
      try { await process(job.event, job.eventId, job.attemptId); if (!await input.processingStore.complete(job.eventId, job.attemptId)) throw new Error(`attempt ${job.attemptId} lost its lease`); }
      catch (error) { const message = error instanceof Error ? error.message : String(error); if (error instanceof ExecutionInProgressError) { if (await input.processingStore.join(job.eventId, job.attemptId)) input.metrics.increment("processingJoined"); console.log(JSON.stringify({ event: "scheduler.joined", eventId: job.eventId, error: message })); continue; } input.metrics.increment("processingFailures"); const outcome = await input.processingStore.retryLater(job.eventId, job.attemptId, input.processingMaxAttempts, input.processingRetryBaseMs, message); if (outcome === "retry") input.metrics.increment("processingRetries"); if (outcome === "dead") { input.metrics.increment("processingDlqTotal"); try { const failure = await input.eventStore.append(toProcessingFailureDraft(job.event, deterministicEventId(`processing-failed:${job.eventId}`), message)); const completed = await completeExecution(input.database, job.event.transactionKey, job.attemptId, failure.payload, "failed"); if (!completed) console.error(JSON.stringify({ event: "scheduler.dlq.execution-not-owned", eventId: job.eventId })); await deliver(failure); } catch (deliveryError) { input.metrics.increment("processingFailures"); console.error(JSON.stringify({ event: "scheduler.dlq.delivery.failed", eventId: job.eventId, error: deliveryError instanceof Error ? deliveryError.message : String(deliveryError) })); } } console.error(JSON.stringify({ event: outcome === "dead" ? "scheduler.dlq" : "scheduler.retry", eventId: job.eventId, error: message })); }
      finally { input.metrics.increment("schedulerDispatchActive", -1); }
    } catch (error) { input.metrics.increment("processingFailures"); console.error(JSON.stringify({ event: "scheduler.poll.failed", error: error instanceof Error ? error.message : String(error) })); await delay(input.schedulerIdleMs); }
  } };
  for (let lane = 0; lane < input.maxConcurrentDispatches; lane += 1) void dispatchLane();
  return { stop: () => { stopped = true; } };
}
