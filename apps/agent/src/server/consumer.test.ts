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
    metrics, notifyScheduler: () => undefined, publishLive: () => undefined, queue: "agent_requests", visibilityTimeoutSeconds: 1, pollSeconds: 1, batchSize: 1, maxConcurrentHandoffs: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 20)); ingress.stop();
  assert.deepEqual(jobs, ["event-1"]); assert.deepEqual(deleted, ["message-1"]);
});

test("scheduler alone dispatches a durable job and completes it", async () => {
  let claims = 0; const completed: string[] = [];
  const scheduler = startScheduler({
    database: { query: async (sql: string) => sql.startsWith("INSERT") ? { rowCount: 1, rows: [] } : { rowCount: 1, rows: [] } } as never,
    pool: { run: async () => ({ value: "ok" }), destroy: async () => undefined },
    eventStore: { append: async (draft: Record<string, unknown>) => ({ ...draft, sequence: "1" }) } as never,
    outboxStore: { enqueue: async () => undefined } as never,
    processingStore: { claimNext: async () => ++claims === 1 ? { eventId: event.eventId, attemptId: "attempt-1", event } : undefined, complete: async (id: string) => { completed.push(id); return true; }, renew: async () => true, retryLater: async () => true } as never,
    metrics, schedulerIdleMs: 1, executionLeaseSeconds: 60, processingMaxAttempts: 3, processingRetryBaseMs: 1, waitForWork: async () => await new Promise<never>(() => undefined), maxConcurrentDispatches: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 30)); scheduler.stop();
  assert.deepEqual(completed, ["event-1"]);
});

test("a terminal result fans out once to every durable reply-channel recipient", async () => {
  let claims = 0; const outboxed: Array<{ channel: string; eventId: string }> = [];
  const first = { ...event, kind: "command", eventVersion: 1, streamId: "channel:agent.requests", sequence: "1", correlationId: event.transactionKey, replyChannel: "agent.results" };
  const second = { ...first, eventId: "event-2", sequence: "2", replyChannel: "orders" };
  const scheduler = startScheduler({
    database: { query: async (sql: string) => sql.startsWith("SELECT request_event") ? { rowCount: 2, rows: [{ request_event: first }, { request_event: second }] } : { rowCount: 1, rows: [] } } as never,
    pool: { run: async () => ({ value: "ok" }), destroy: async () => undefined },
    eventStore: { append: async (draft: Record<string, unknown>, afterAppend?: (client: never, persisted: never) => Promise<void>) => { const persisted = { ...draft, sequence: "3" }; await afterAppend?.({} as never, persisted as never); return persisted; } } as never,
    outboxStore: { enqueue: async (_client: never, persisted: { channel: string; eventId: string }) => { outboxed.push(persisted); } } as never,
    processingStore: { claimNext: async () => ++claims === 1 ? { eventId: first.eventId, attemptId: "attempt-1", event: first } : undefined, complete: async () => true, renew: async () => true, retryLater: async () => "retry" } as never,
    metrics, schedulerIdleMs: 1, executionLeaseSeconds: 60, processingMaxAttempts: 3, processingRetryBaseMs: 1, waitForWork: async () => await new Promise<never>(() => undefined), maxConcurrentDispatches: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 30)); scheduler.stop();
  assert.deepEqual(outboxed.map((value) => value.channel).sort(), ["agent.results", "orders"]);
  assert.notEqual(outboxed[0]?.eventId, outboxed[1]?.eventId, "each target has a separate deterministic outbox identity");
});

test("scheduler claims up to its dispatch concurrency without waiting for an earlier worker", async () => {
  const completed: string[] = []; let claimIndex = 0; let started = 0; let releaseWorkers: (() => void) | undefined;
  const workerGate = new Promise<void>((resolve) => { releaseWorkers = resolve; });
  const jobs = [event, { ...event, eventId: "event-2", transactionKey: "transaction-2" }];
  const scheduler = startScheduler({
    database: { query: async () => ({ rowCount: 1, rows: [] }) } as never,
    pool: { run: async () => { started += 1; await workerGate; return { value: "ok" }; }, destroy: async () => undefined },
    eventStore: { append: async (draft: Record<string, unknown>) => ({ ...draft, sequence: "1" }) } as never,
    outboxStore: { enqueue: async () => undefined } as never,
    processingStore: { claimNext: async () => jobs[claimIndex] ? { eventId: jobs[claimIndex]!.eventId, attemptId: `attempt-${claimIndex}`, event: jobs[claimIndex++]! } : undefined, complete: async (id: string) => { completed.push(id); return true; }, renew: async () => true, retryLater: async () => true } as never,
    metrics, schedulerIdleMs: 1, executionLeaseSeconds: 60, processingMaxAttempts: 3, processingRetryBaseMs: 1, waitForWork: async () => await new Promise<never>(() => undefined), maxConcurrentDispatches: 2,
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(started, 2);
  releaseWorkers?.();
  await new Promise((resolve) => setTimeout(resolve, 20)); scheduler.stop();
  assert.deepEqual(completed.sort(), ["event-1", "event-2"]);
});

test("scheduler completes after the terminal event is durably reserved for outbox delivery", async () => {
  let retry: { eventId: string; attemptId: string; maxAttempts: number; baseRetryMs: number } | undefined; let claims = 0;
  const scheduler = startScheduler({
    database: { query: async () => ({ rowCount: 1, rows: [] }) } as never,
    pool: { run: async () => ({ value: "ok" }), destroy: async () => undefined },
    eventStore: { append: async (draft: Record<string, unknown>) => ({ ...draft, sequence: "1" }) } as never,
    outboxStore: { enqueue: async () => undefined } as never,
    processingStore: {
      claimNext: async () => ++claims === 1 ? { eventId: event.eventId, attemptId: "attempt-1", event } : undefined, complete: async () => true, renew: async () => true,
      retryLater: async (eventId: string, attemptId: string, maxAttempts: number, baseRetryMs: number) => { retry = { eventId, attemptId, maxAttempts, baseRetryMs }; return "retry"; },
    } as never,
    metrics, schedulerIdleMs: 1, executionLeaseSeconds: 60, processingMaxAttempts: 4, processingRetryBaseMs: 250, waitForWork: async () => await new Promise<never>(() => undefined), maxConcurrentDispatches: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 30)); scheduler.stop();
  assert.equal(retry, undefined);
});

test("terminal result persistence does not depend on immediate external delivery", async () => {
  let appends = 0; let claims = 0;
  const scheduler = startScheduler({
    database: { query: async () => ({ rowCount: 1, rows: [] }) } as never,
    pool: { run: async () => ({ value: "ok" }), destroy: async () => undefined },
    eventStore: { append: async (draft: Record<string, unknown>) => { appends += 1; return { ...draft, sequence: "1" }; } } as never,
    outboxStore: { enqueue: async () => undefined } as never,
    processingStore: { claimNext: async () => ++claims === 1 ? { eventId: event.eventId, attemptId: "attempt-1", event } : undefined, complete: async () => true, renew: async () => true, retryLater: async () => "dead" } as never,
    metrics, schedulerIdleMs: 1, executionLeaseSeconds: 60, processingMaxAttempts: 1, processingRetryBaseMs: 1, waitForWork: async () => await new Promise<never>(() => undefined), maxConcurrentDispatches: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 30)); scheduler.stop();
  assert.equal(appends, 1, "the scheduler reserves its terminal result without invoking the external queue");
});

test("an already-running transaction joins its duplicate job without consuming the retry budget", async () => {
  let joined: { eventId: string; attemptId: string } | undefined; let retried = false; let claims = 0;
  const scheduler = startScheduler({
    database: { query: async (sql: string) => sql.startsWith("INSERT") || sql.startsWith("UPDATE agent_execution SET attempt_id") ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ status: "running", result: null, payload_hash: null }] } } as never,
    pool: { run: async () => ({ value: "unused" }), destroy: async () => undefined },
    eventStore: { append: async (draft: Record<string, unknown>) => ({ ...draft, sequence: "1" }) } as never,
    outboxStore: { enqueue: async () => undefined } as never,
    processingStore: { claimNext: async () => ++claims === 1 ? { eventId: event.eventId, attemptId: "attempt-1", event } : undefined, complete: async () => true, renew: async () => true, retryLater: async () => { retried = true; return "retry"; }, join: async (eventId: string, attemptId: string) => { joined = { eventId, attemptId }; return true; } } as never,
    metrics, schedulerIdleMs: 1, executionLeaseSeconds: 60, processingMaxAttempts: 1, processingRetryBaseMs: 250, waitForWork: async () => await new Promise<never>(() => undefined), maxConcurrentDispatches: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 30)); scheduler.stop();
  assert.deepEqual(joined, { eventId: "event-1", attemptId: "attempt-1" }); assert.equal(retried, false);
});
