import assert from "node:assert/strict";
import test from "node:test";
import { startIngressConsumer, startScheduler } from "./consumer.js";

const event = { eventId: "event-1", transactionKey: "transaction-1", kind: "request" as const, channel: "agent.requests", action: "hash.sha256", source: "test", createdAt: new Date().toISOString(), payload: { input: "value" } };
const metrics = { increment: () => undefined } as never;

test("ingress persists and hands off without awaiting worker completion", async () => {
  const deleted: string[] = []; const jobs: string[] = []; let reads = 0;
  const ingress = startIngressConsumer({
    queueTransport: { read: async () => ++reads === 1 ? [{ id: "message-1", event, headers: null }] : await new Promise<never>(() => undefined), delete: async (_q: string, id: string) => { deleted.push(id); }, send: async () => "", extendVisibility: async () => undefined, check: async () => undefined },
    eventStore: { append: async (draft: Record<string, unknown>) => ({ ...draft, sequence: "1" }) } as never,
    processingStore: { enqueue: async (value: typeof event) => { jobs.push(value.eventId); } } as never,
    metrics, notifyScheduler: () => undefined, queue: "agent_requests", visibilityTimeoutSeconds: 1, pollSeconds: 1, batchSize: 1, maxConcurrentHandoffs: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 20)); ingress.stop();
  assert.deepEqual(jobs, ["event-1"]); assert.deepEqual(deleted, ["message-1"]);
});

test("scheduler alone dispatches a durable job and completes it", async () => {
  let claims = 0; const completed: string[] = [];
  const scheduler = startScheduler({
    queueTransport: { send: async () => "result", read: async () => [], delete: async () => undefined, extendVisibility: async () => undefined, check: async () => undefined },
    database: { query: async (sql: string) => sql.startsWith("INSERT") ? { rowCount: 1, rows: [] } : { rowCount: 1, rows: [] } } as never,
    pool: { run: async () => ({ value: "ok" }), destroy: async () => undefined }, hub: { publish: () => undefined } as never,
    eventStore: { append: async (draft: Record<string, unknown>) => ({ ...draft, sequence: "1" }) } as never,
    deliveryStore: { claim: async () => "claimed", complete: async () => undefined } as never,
    processingStore: { claimNext: async () => ++claims === 1 ? { eventId: event.eventId, attemptId: "attempt-1", event } : undefined, complete: async (id: string) => { completed.push(id); return true; }, renew: async () => true, retryLater: async () => true } as never,
    metrics, resultQueue: "agent_results", schedulerIdleMs: 1, executionLeaseSeconds: 60, processingMaxAttempts: 3, processingRetryBaseMs: 1, waitForWork: async () => await new Promise<never>(() => undefined), maxConcurrentDispatches: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 30)); scheduler.stop();
  assert.deepEqual(completed, ["event-1"]);
});

test("scheduler claims up to its dispatch concurrency without waiting for an earlier worker", async () => {
  const completed: string[] = []; let claimIndex = 0; let started = 0; let releaseWorkers: (() => void) | undefined;
  const workerGate = new Promise<void>((resolve) => { releaseWorkers = resolve; });
  const jobs = [event, { ...event, eventId: "event-2", transactionKey: "transaction-2" }];
  const scheduler = startScheduler({
    queueTransport: { send: async () => "result", read: async () => [], delete: async () => undefined, extendVisibility: async () => undefined, check: async () => undefined },
    database: { query: async () => ({ rowCount: 1, rows: [] }) } as never,
    pool: { run: async () => { started += 1; await workerGate; return { value: "ok" }; }, destroy: async () => undefined }, hub: { publish: () => undefined } as never,
    eventStore: { append: async (draft: Record<string, unknown>) => ({ ...draft, sequence: "1" }) } as never,
    deliveryStore: { claim: async () => "claimed", complete: async () => undefined } as never,
    processingStore: { claimNext: async () => jobs[claimIndex] ? { eventId: jobs[claimIndex]!.eventId, attemptId: `attempt-${claimIndex}`, event: jobs[claimIndex++]! } : undefined, complete: async (id: string) => { completed.push(id); return true; }, renew: async () => true, retryLater: async () => true } as never,
    metrics, resultQueue: "agent_results", schedulerIdleMs: 1, executionLeaseSeconds: 60, processingMaxAttempts: 3, processingRetryBaseMs: 1, waitForWork: async () => await new Promise<never>(() => undefined), maxConcurrentDispatches: 2,
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(started, 2);
  releaseWorkers?.();
  await new Promise((resolve) => setTimeout(resolve, 20)); scheduler.stop();
  assert.deepEqual(completed.sort(), ["event-1", "event-2"]);
});

test("infrastructure delivery failures become a bounded retry rather than completing the job", async () => {
  let retry: { eventId: string; attemptId: string; maxAttempts: number; baseRetryMs: number } | undefined;
  const scheduler = startScheduler({
    queueTransport: { send: async () => { throw new Error("temporary result queue outage"); }, read: async () => [], delete: async () => undefined, extendVisibility: async () => undefined, check: async () => undefined },
    database: { query: async () => ({ rowCount: 1, rows: [] }) } as never,
    pool: { run: async () => ({ value: "ok" }), destroy: async () => undefined }, hub: { publish: () => undefined } as never,
    eventStore: { append: async (draft: Record<string, unknown>) => ({ ...draft, sequence: "1" }) } as never,
    deliveryStore: { claim: async () => "claimed", complete: async () => undefined } as never,
    processingStore: {
      claimNext: async () => retry ? undefined : { eventId: event.eventId, attemptId: "attempt-1", event }, complete: async () => true, renew: async () => true,
      retryLater: async (eventId: string, attemptId: string, maxAttempts: number, baseRetryMs: number) => { retry = { eventId, attemptId, maxAttempts, baseRetryMs }; return "retry"; },
    } as never,
    metrics, resultQueue: "agent_results", schedulerIdleMs: 1, executionLeaseSeconds: 60, processingMaxAttempts: 4, processingRetryBaseMs: 250, waitForWork: async () => await new Promise<never>(() => undefined), maxConcurrentDispatches: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 30)); scheduler.stop();
  assert.deepEqual(retry, { eventId: "event-1", attemptId: "attempt-1", maxAttempts: 4, baseRetryMs: 250 });
});
