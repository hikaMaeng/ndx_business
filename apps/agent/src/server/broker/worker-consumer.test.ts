import assert from "node:assert/strict";
import test from "node:test";
import type { EventDraft, EventEnvelope, IngressEvent } from "agent_domain/common";
import { startWorkerConsumer } from "./worker-consumer.js";
import { WorkerLostError } from "../worker/pool.js";

const command: IngressEvent = { eventId: "command-1", action: "hash.sha256", transactionKey: "tx-1", channel: "agent.requests", replyChannel: "orders", createdAt: "2026-08-22T00:00:00.000Z", payload: { input: "abc" } };

test("worker consumes a PGMQ command, emits a result event, then acknowledges the command", async () => {
  let read = false; const sent: EventEnvelope[] = []; const deleted: string[] = [];
  let sequence = 0;
  const store = { append: async (draft: EventDraft): Promise<EventEnvelope> => ({ ...draft, sequence: String(++sequence) }) };
  const loop = startWorkerConsumer({
    queue: { read: async () => read ? await new Promise<never>(() => undefined) : (read = true, [{ id: "19", event: command, headers: null }]), send: async (_queue: string, event: EventEnvelope) => { sent.push(event); return "21"; }, delete: async (_queue: string, id: string) => { deleted.push(id); } } as never,
    commandQueue: "agent_commands", resultQueue: "agent_results", eventStore: store as never, deliveries: { enqueue: async () => undefined } as never,
    executions: { claim: async () => ({ kind: "claimed", attemptId: "attempt-a", attempts: 1 }), complete: async () => true, recipients: async () => [{ ...command, kind: "command", eventVersion: 1, streamId: "session:unknown:agent.requests", sequence: "1", correlationId: "tx-1", source: "client" }], renew: async () => true } as never,
    pool: { run: async () => ({ value: "digest", workerId: "worker-a" }) } as never,
    metrics: { increment: () => undefined } as never, visibilitySeconds: 60, pollSeconds: 1, batchSize: 1, maxInFlight: 2, maxExecutionAttempts: 5,
  });
  await new Promise((resolve) => setTimeout(resolve, 15)); loop.stop();
  // Worker persists terminal output to the transactional outbox; the separate publisher owns queue.send.
  assert.equal(sent.length, 0);
  assert.deepEqual(deleted, ["19"]);
});

test("a joined transaction preserves its command for lease-expiry recovery without repeating work", async () => {
  let read = false; let runs = 0; const deleted: string[] = [];
  const loop = startWorkerConsumer({
    queue: { read: async () => read ? await new Promise<never>(() => undefined) : (read = true, [{ id: "20", event: command, headers: null }]), delete: async (_queue: string, id: string) => { deleted.push(id); } } as never,
    commandQueue: "agent_commands", resultQueue: "agent_results", eventStore: { append: async (): Promise<EventEnvelope> => ({ ...command, kind: "command", eventVersion: 1, streamId: "session:unknown:agent.requests", sequence: "1", correlationId: "tx-1", source: "client" }) } as never, deliveries: { enqueue: async () => undefined } as never,
    executions: { claim: async () => ({ kind: "joined", requestEventId: command.eventId, completed: false }), complete: async () => true, recipients: async () => [], renew: async () => true, recordRedelivery: async () => undefined } as never,
    pool: { run: async () => { runs += 1; return { value: "unexpected", workerId: "worker-a" }; } } as never,
    metrics: { increment: () => undefined } as never, visibilitySeconds: 60, pollSeconds: 1, batchSize: 1, maxInFlight: 2, maxExecutionAttempts: 5,
  });
  await new Promise((resolve) => setTimeout(resolve, 15)); loop.stop();
  assert.equal(runs, 0);
  assert.deepEqual(deleted, []);
});

test("a fresh duplicate command joins work but can be acknowledged", async () => {
  let read = false; const deleted: string[] = [];
  const loop = startWorkerConsumer({
    queue: { read: async () => read ? await new Promise<never>(() => undefined) : (read = true, [{ id: "20", event: command, headers: null }]), delete: async (_queue: string, id: string) => { deleted.push(id); } } as never,
    commandQueue: "agent_commands", resultQueue: "agent_results", eventStore: { append: async (): Promise<EventEnvelope> => ({ ...command, kind: "command", eventVersion: 1, streamId: "channel:agent.requests", sequence: "1", correlationId: "tx-1", source: "client" }) } as never, deliveries: { enqueue: async () => undefined } as never,
    executions: { claim: async () => ({ kind: "joined", requestEventId: "original-command", completed: false }), complete: async () => true, recipients: async () => [], renew: async () => true } as never,
    pool: { run: async () => ({ value: "unexpected", workerId: "worker-a" }) } as never,
    metrics: { increment: () => undefined } as never, visibilitySeconds: 60, pollSeconds: 1, batchSize: 1, maxInFlight: 2, maxExecutionAttempts: 5,
  });
  await new Promise((resolve) => setTimeout(resolve, 15)); loop.stop();
  assert.deepEqual(deleted, ["20"]);
});

test("a running worker renews both its execution and PGMQ visibility leases", async () => {
  let read = false; const extended: string[] = []; let renewals = 0;
  const loop = startWorkerConsumer({
    queue: {
      read: async () => read ? await new Promise<never>(() => undefined) : (read = true, [{ id: "21", event: command, headers: null }]),
      send: async () => "22", delete: async () => undefined,
      extendVisibility: async (_queue: string, id: string) => { extended.push(id); },
    } as never,
    commandQueue: "agent_commands", resultQueue: "agent_results", eventStore: { append: async (draft: EventDraft): Promise<EventEnvelope> => ({ ...draft, sequence: "1" }) } as never, deliveries: { enqueue: async () => undefined } as never,
    executions: {
      claim: async () => ({ kind: "claimed", attemptId: "attempt-a", attempts: 1 }),
      complete: async () => true, recipients: async () => [{ ...command, kind: "command", eventVersion: 1, streamId: "channel:agent.requests", sequence: "1", correlationId: "tx-1", source: "client" }],
      renew: async () => { renewals += 1; return true; },
    } as never,
    pool: { run: async () => { await new Promise((resolve) => setTimeout(resolve, 1_050)); return { value: "digest", workerId: "worker-a" }; } } as never,
    metrics: { increment: () => undefined } as never, visibilitySeconds: 3, pollSeconds: 1, batchSize: 1, maxInFlight: 2, maxExecutionAttempts: 5,
  });
  await new Promise((resolve) => setTimeout(resolve, 1_150)); loop.stop();
  assert.ok(renewals >= 1);
  assert.deepEqual(extended, ["21"]);
});

test("a lost worker releases its fenced execution attempt and retains the broker message for reclaim", async () => {
  let read = false; let releases = 0; const deleted: string[] = [];
  const loop = startWorkerConsumer({
    queue: { read: async () => read ? await new Promise<never>(() => undefined) : (read = true, [{ id: "lost-1", event: command, headers: null }]), delete: async (_queue: string, id: string) => { deleted.push(id); } } as never,
    commandQueue: "agent_commands", resultQueue: "agent_results", eventStore: { append: async (): Promise<EventEnvelope> => ({ ...command, kind: "command", eventVersion: 1, streamId: "channel:agent.requests", sequence: "1", correlationId: "tx-1", source: "client" }) } as never, deliveries: { enqueue: async () => undefined } as never,
    executions: { claim: async () => ({ kind: "claimed", attemptId: "attempt-a", attempts: 1 }), release: async () => { releases += 1; return true; }, complete: async () => true, recipients: async () => [], renew: async () => true } as never,
    pool: { run: async () => { throw new WorkerLostError("worker stopped"); } } as never,
    metrics: { increment: () => undefined } as never, visibilitySeconds: 60, pollSeconds: 1, batchSize: 1, maxInFlight: 2, maxExecutionAttempts: 2,
  });
  await new Promise((resolve) => setTimeout(resolve, 20)); loop.stop();
  assert.equal(releases, 1);
  assert.deepEqual(deleted, []);
});

test("an exhausted execution attempt records a processing failure before archiving its broker message", async () => {
  let read = false; const archived: string[] = []; const drafts: EventDraft[] = [];
  const recipient = { ...command, kind: "command" as const, eventVersion: 1 as const, streamId: "channel:agent.requests", sequence: "1", correlationId: "tx-1", source: "client" as const };
  const loop = startWorkerConsumer({
    queue: { read: async () => read ? await new Promise<never>(() => undefined) : (read = true, [{ id: "lost-2", event: command, headers: null }]), archive: async (_queue: string, id: string) => { archived.push(id); } } as never,
    commandQueue: "agent_commands", resultQueue: "agent_results", eventStore: { append: async (draft: EventDraft): Promise<EventEnvelope> => { drafts.push(draft); return { ...draft, sequence: String(drafts.length) }; } } as never, deliveries: { enqueue: async () => undefined } as never,
    executions: { claim: async () => ({ kind: "claimed", attemptId: "attempt-b", attempts: 2 }), complete: async () => true, recipients: async () => [recipient], renew: async () => true } as never,
    pool: { run: async () => { throw new WorkerLostError("worker stopped"); } } as never,
    metrics: { increment: () => undefined } as never, visibilitySeconds: 60, pollSeconds: 1, batchSize: 1, maxInFlight: 2, maxExecutionAttempts: 2,
  });
  await new Promise((resolve) => setTimeout(resolve, 20)); loop.stop();
  assert.equal(drafts.at(-1)?.kind, "failure");
  assert.deepEqual(archived, ["lost-2"]);
});

test("a completed execution retains its broker message when terminal persistence fails without consuming another execution attempt", async () => {
  let read = false; const deleted: string[] = []; const metrics: string[] = [];
  const loop = startWorkerConsumer({
    queue: { read: async () => read ? await new Promise<never>(() => undefined) : (read = true, [{ id: "terminal-1", event: command, headers: null, readCount: 2 }]), delete: async (_queue: string, id: string) => { deleted.push(id); } } as never,
    commandQueue: "agent_commands", resultQueue: "agent_results", eventStore: {
      append: async (draft: EventDraft): Promise<EventEnvelope> => {
        if (draft.kind === "result") throw new Error("database unavailable");
        return { ...command, kind: "command", eventVersion: 1, streamId: "channel:agent.requests", sequence: "1", correlationId: "tx-1", source: "client" };
      },
    } as never, deliveries: { enqueue: async () => undefined } as never,
    executions: { claim: async () => ({ kind: "joined", requestEventId: command.eventId, completed: true, result: { ok: true, value: "done" } }), recipients: async () => [{ ...command, kind: "command", eventVersion: 1, streamId: "channel:agent.requests", sequence: "1", correlationId: "tx-1", source: "client" }], renew: async () => true } as never,
    pool: { run: async () => ({ value: "unexpected", workerId: "worker-a" }) } as never,
    metrics: { increment: (name: string) => { metrics.push(name); } } as never, visibilitySeconds: 60, pollSeconds: 1, batchSize: 1, maxInFlight: 2, maxExecutionAttempts: 1, terminalPersistenceAlertAttempts: 2,
  });
  await new Promise((resolve) => setTimeout(resolve, 20)); loop.stop();
  assert.deepEqual(deleted, []);
  assert.deepEqual(metrics, ["queueReads", "queueMessages", "terminalPersistenceRetries", "terminalPersistenceAlerts"]);
});

test("terminal persistence failure alerts when a prior non-terminal redelivery already crossed the threshold", async () => {
  let read = false; const metrics: string[] = [];
  const loop = startWorkerConsumer({
    queue: { read: async () => read ? await new Promise<never>(() => undefined) : (read = true, [{ id: "terminal-late", event: command, headers: null, readCount: 11 }]) } as never,
    commandQueue: "agent_commands", resultQueue: "agent_results", eventStore: {
      append: async (draft: EventDraft): Promise<EventEnvelope> => { if (draft.kind === "result") throw new Error("database unavailable"); return { ...command, kind: "command", eventVersion: 1, streamId: "channel:agent.requests", sequence: "1", correlationId: "tx-1", source: "client" }; },
    } as never, deliveries: { enqueue: async () => undefined } as never,
    executions: { claim: async () => ({ kind: "joined", requestEventId: command.eventId, completed: true, result: { ok: true, value: "done" } }), recipients: async () => [{ ...command, kind: "command", eventVersion: 1, streamId: "channel:agent.requests", sequence: "1", correlationId: "tx-1", source: "client" }], renew: async () => true } as never,
    pool: { run: async () => ({ value: "unexpected", workerId: "worker-a" }) } as never,
    metrics: { increment: (name: string) => { metrics.push(name); } } as never, visibilitySeconds: 60, pollSeconds: 1, batchSize: 1, maxInFlight: 2, maxExecutionAttempts: 1, terminalPersistenceAlertAttempts: 10,
  });
  await new Promise((resolve) => setTimeout(resolve, 20)); loop.stop();
  assert.ok(metrics.includes("terminalPersistenceAlerts"));
});
