import type { EventEnvelope } from "agent_domain/common";
import { deterministicEventId } from "agent_domain/server";
import type { EventQueueTransport } from "./queue/transport.js";
import { abandonExecution, claimExecution, completeExecution, executionRecipients, renewExecution } from "./execution/store.js";
import { runWorker, WorkerLostError } from "./worker/pool.js";
import type { WorkerPool } from "./worker/pool.js";
import type { EventStreamHub } from "./stream/hub.js";
import type { EventStore } from "./event-store/store.js";
import type { ProcessingStore } from "./processing/store.js";
import type { MetricsRegistry } from "./metrics/registry.js";
import type { OutboxStore } from "./outbox/store.js";
import { toEventDraft, toProcessingFailureDraft, toResultDraft } from "./ingress/event-draft.js";

type ResultPayload = { ok: boolean; value?: unknown; error?: { code: string; message: string } };
type ExecutionStatus = "completed" | "failed" | "timed_out" | "cancelled";
export type Loop = { stop: () => void; done: Promise<void> };
class ExecutionInProgressError extends Error {}
const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));
const resultEventId = (event: Pick<EventEnvelope, "transactionKey" | "replyChannel">): string => deterministicEventId(`result:${event.transactionKey}:${event.replyChannel ?? "agent.results"}`);
function failureStatus(message: string): ExecutionStatus { return message.includes("timed out") || message.includes("timeout") ? "timed_out" : message.includes("aborted") ? "cancelled" : "failed"; }
function isProcessingFailure(payload: ResultPayload): payload is ResultPayload & { error: { code: "processing_permanent_failure"; message: string } } { return payload.error?.code === "processing_permanent_failure"; }

async function workerOutcome(pool: WorkerPool, event: EventEnvelope, signal: AbortSignal | undefined, onAssigned: (workerId: string) => Promise<void>): Promise<{ payload: ResultPayload; status: ExecutionStatus }> {
  try { return { payload: { ok: true, value: (await runWorker(pool, event, signal, onAssigned)).value }, status: "completed" }; }
  catch (error) {
    if (error instanceof WorkerLostError) throw error;
    const message = error instanceof Error ? error.message : "Worker failed";
    return { payload: { ok: false, error: { code: "worker_failed", message } }, status: failureStatus(message) };
  }
}

/** Thread 1: PGMQ handoff only. It never awaits a worker or result delivery. */
export function startIngressConsumer(input: { queueTransport: EventQueueTransport; eventStore: EventStore; processingStore: ProcessingStore; metrics: MetricsRegistry; notifyScheduler: () => void; notifyProjection?: () => void; publishLive: (event: EventEnvelope) => void; queue: string; visibilityTimeoutSeconds: number; pollSeconds: number; batchSize: number; maxConcurrentHandoffs: number }): Loop {
  let stopped = false;
  const handoffLane = async (): Promise<void> => { while (!stopped) {
    try {
      const messages = await input.queueTransport.read(input.queue, { visibilityTimeoutSeconds: input.visibilityTimeoutSeconds, quantity: input.batchSize, pollSeconds: input.pollSeconds });
      input.metrics.increment("queueReads"); input.metrics.increment("queueMessages", messages.length);
      await Promise.all(messages.map(async (message) => { try {
        input.metrics.increment("ingressHandoffActive");
        const persisted = await input.eventStore.append(toEventDraft(message.event));
        await input.processingStore.enqueue(persisted);
        input.publishLive(persisted);
        input.notifyProjection?.();
        await input.queueTransport.delete(input.queue, message.id);
        input.notifyScheduler();
        input.metrics.increment("queueDeletes");
        console.log(JSON.stringify({ event: "ingress.handed-off", eventId: persisted.eventId, streamId: persisted.streamId, sequence: persisted.sequence, messageId: message.id }));
      } catch (error) { input.metrics.increment("processingFailures"); console.error(JSON.stringify({ event: "ingress.handoff.failed", messageId: message.id, error: error instanceof Error ? error.message : String(error) })); }
      finally { input.metrics.increment("ingressHandoffActive", -1); }
      }));
    } catch (error) { console.error(JSON.stringify({ event: "ingress.retry", error: error instanceof Error ? error.message : String(error) })); await delay(input.pollSeconds * 1000); }
  } };
  const lanes = Array.from({ length: input.maxConcurrentHandoffs }, handoffLane);
  return { stop: () => { stopped = true; }, done: Promise.all(lanes).then(() => undefined) };
}

/** Scheduler is the sole worker dispatcher. A durable job claim, not PGMQ visibility, owns execution. */
export function startScheduler(input: { database: import("pg").Pool; pool: WorkerPool; eventStore: EventStore; outboxStore: OutboxStore; processingStore: ProcessingStore; metrics: MetricsRegistry; notifyProjection?: () => void; schedulerIdleMs: number; executionLeaseSeconds: number; processingMaxAttempts: number; processingRetryBaseMs: number; waitForWork: () => Promise<void>; maxConcurrentDispatches: number }): Loop {
  let stopped = false;
  const recipientsOf = async (request: EventEnvelope): Promise<EventEnvelope[]> => {
    const recipients = await executionRecipients(input.database, request.transactionKey);
    return recipients.length ? recipients : [request];
  };
  const publish = async (request: EventEnvelope, payload: ResultPayload, complete?: (client: import("pg").PoolClient) => Promise<void>): Promise<void> => {
    const drafts = (await recipientsOf(request)).map((recipient) => toResultDraft(recipient, { eventId: resultEventId(recipient), action: `${recipient.action}.result`, channel: recipient.replyChannel ?? "agent.results", createdAt: new Date().toISOString(), source: "worker", payload }));
    await input.eventStore.appendMany(drafts, async (client, persisted) => {
      for (const event of persisted) await input.outboxStore.enqueue(client, event);
      await complete?.(client);
    });
    input.notifyProjection?.();
  };
  const publishProcessingFailure = async (request: EventEnvelope, jobId: string, message: string): Promise<void> => {
    const drafts = (await recipientsOf(request)).map((recipient) => toProcessingFailureDraft(recipient, deterministicEventId(`processing-failed:${jobId}:${recipient.replyChannel ?? "agent.results"}`), message));
    await input.eventStore.appendMany(drafts, async (client, persisted) => {
      for (const event of persisted) await input.outboxStore.enqueue(client, event);
    });
    input.notifyProjection?.();
  };
  const process = async (request: EventEnvelope, jobId: string, attemptId: string): Promise<void> => {
    const claim = await claimExecution(input.database, request, attemptId, input.executionLeaseSeconds);
    if (claim.kind === "conflict") {
      await input.eventStore.append(toResultDraft(request, { eventId: deterministicEventId(`conflict:${request.eventId}`), action: `${request.action}.result`, channel: request.replyChannel ?? "agent.results", createdAt: new Date().toISOString(), source: "scheduler", payload: { ok: false, error: { code: "idempotency_conflict", message: claim.reason } } }), (client, persisted) => input.outboxStore.enqueue(client, persisted)); input.notifyProjection?.();
      return;
    }
    if (claim.kind === "duplicate") {
      if (claim.completed && claim.result) {
        const payload = claim.result as ResultPayload;
        if (isProcessingFailure(payload)) await publishProcessingFailure(request, claim.requestEventId, payload.error.message);
        else await publish(request, payload);
      }
      if (!claim.completed) throw new ExecutionInProgressError(`transaction ${request.transactionKey} is already running`);
      return;
    }
    input.metrics.increment("workerStarted"); input.metrics.increment("inFlight");
    let leaseLost = false; const controller = new AbortController();
    const heartbeatMs = Math.max(100, Math.floor(input.executionLeaseSeconds * 1000 / 3));
    const heartbeat = setInterval(() => { void Promise.all([input.processingStore.renew(jobId, attemptId), renewExecution(input.database, request.transactionKey, attemptId, input.executionLeaseSeconds)]).then(([jobRenewed, executionRenewed]) => { if (!jobRenewed || !executionRenewed) { leaseLost = true; controller.abort(); } }).catch((error) => { leaseLost = true; controller.abort(); input.metrics.increment("processingFailures"); console.error(JSON.stringify({ event: "scheduler.heartbeat.failed", eventId: jobId, attemptId, error: error instanceof Error ? error.message : String(error) })); }); }, heartbeatMs);
    try {
      const outcome = await workerOutcome(input.pool, request, controller.signal, async (workerId) => {
        if (!await input.processingStore.startAttempt(jobId, attemptId, workerId)) throw new WorkerLostError(`processing attempt ${attemptId} lost before worker assignment`);
      });
      if (leaseLost) throw new WorkerLostError(`attempt ${attemptId} lost its lease`);
      await publish(request, outcome.payload, async (client) => {
        if (!await completeExecution(client, request.transactionKey, attemptId, outcome.payload, outcome.status)) throw new WorkerLostError(`execution attempt ${attemptId} lost its lease`);
      });
      input.metrics.increment(outcome.status === "completed" ? "workerCompleted" : "workerFailed");
    }
    finally { clearInterval(heartbeat); input.metrics.increment("inFlight", -1); }
  };
  const dispatchLane = async (): Promise<void> => { while (!stopped) {
    try {
      const job = await input.processingStore.claimNext(); if (!job) { await input.waitForWork(); continue; }
      input.metrics.increment("schedulerDispatchActive");
      try { await process(job.event, job.eventId, job.attemptId); if (!await input.processingStore.complete(job.eventId, job.attemptId)) throw new Error(`attempt ${job.attemptId} lost its lease`); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof ExecutionInProgressError) { if (await input.processingStore.join(job.eventId, job.attemptId)) input.metrics.increment("processingJoined"); console.log(JSON.stringify({ event: "scheduler.joined", eventId: job.eventId, error: message })); continue; }
        input.metrics.increment("processingFailures");
        const released = await abandonExecution(input.database, job.event.transactionKey, job.attemptId);
        if (!released) console.error(JSON.stringify({ event: "scheduler.retry.execution-not-owned", eventId: job.eventId, attemptId: job.attemptId }));
        const outcome = await input.processingStore.retryLater(job.eventId, job.attemptId, input.processingMaxAttempts, input.processingRetryBaseMs, message);
        if (outcome === "retry") input.metrics.increment("processingRetries");
        if (outcome === "dead") { input.metrics.increment("processingDlqTotal"); try { const payload: ResultPayload = { ok: false, error: { code: "processing_permanent_failure", message } }; const completed = await completeExecution(input.database, job.event.transactionKey, job.attemptId, payload, "failed"); if (!completed) console.error(JSON.stringify({ event: "scheduler.dlq.execution-not-owned", eventId: job.eventId })); await publishProcessingFailure(job.event, job.eventId, message); } catch (deliveryError) { input.metrics.increment("processingFailures"); console.error(JSON.stringify({ event: "scheduler.dlq.delivery.failed", eventId: job.eventId, error: deliveryError instanceof Error ? deliveryError.message : String(deliveryError) })); } }
        console.error(JSON.stringify({ event: outcome === "dead" ? "scheduler.dlq" : "scheduler.retry", eventId: job.eventId, error: message }));
      }
      finally { input.metrics.increment("schedulerDispatchActive", -1); }
    } catch (error) { input.metrics.increment("processingFailures"); console.error(JSON.stringify({ event: "scheduler.poll.failed", error: error instanceof Error ? error.message : String(error) })); await delay(input.schedulerIdleMs); }
  } };
  const lanes = Array.from({ length: input.maxConcurrentDispatches }, dispatchLane);
  return { stop: () => { stopped = true; }, done: Promise.all(lanes).then(() => undefined) };
}
