import assert from "node:assert/strict";
import test from "node:test";
import type { EventDraft, EventEnvelope, IngressEvent } from "agent_domain/common";
import { startWorkerConsumer } from "./worker-consumer.js";

const command: IngressEvent = { eventId: "command-1", action: "hash.sha256", transactionKey: "tx-1", channel: "agent.requests", replyChannel: "orders", createdAt: "2026-08-22T00:00:00.000Z", payload: { input: "abc" } };

test("worker consumes a PGMQ command, emits a result event, then acknowledges the command", async () => {
  let read = false; const sent: EventEnvelope[] = []; const deleted: string[] = [];
  let sequence = 0;
  const store = { append: async (draft: EventDraft): Promise<EventEnvelope> => ({ ...draft, sequence: String(++sequence) }) };
  const loop = startWorkerConsumer({
    queue: { read: async () => read ? await new Promise<never>(() => undefined) : (read = true, [{ id: "19", event: command, headers: null }]), send: async (_queue: string, event: EventEnvelope) => { sent.push(event); return "21"; }, delete: async (_queue: string, id: string) => { deleted.push(id); } } as never,
    commandQueue: "agent_commands", resultQueue: "agent_results", eventStore: store as never,
    executions: { claim: async () => ({ kind: "claimed", attemptId: "attempt-a" }), complete: async () => true, recipients: async () => [{ ...command, kind: "command", eventVersion: 1, streamId: "session:unknown:agent.requests", sequence: "1", correlationId: "tx-1", source: "client" }], renew: async () => true } as never,
    pool: { run: async () => ({ value: "digest", workerId: "worker-a" }) } as never,
    metrics: { increment: () => undefined } as never, visibilitySeconds: 60, pollSeconds: 1, batchSize: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 15)); loop.stop();
  assert.equal(sent.length, 1); assert.equal(sent[0]?.channel, "orders"); assert.equal(sent[0]?.payload.ok, true);
  assert.deepEqual(deleted, ["19"]);
});

test("a joined transaction acknowledges its duplicate command without repeating work", async () => {
  let read = false; let runs = 0; const deleted: string[] = [];
  const loop = startWorkerConsumer({
    queue: { read: async () => read ? await new Promise<never>(() => undefined) : (read = true, [{ id: "20", event: command, headers: null }]), delete: async (_queue: string, id: string) => { deleted.push(id); } } as never,
    commandQueue: "agent_commands", resultQueue: "agent_results", eventStore: { append: async (): Promise<EventEnvelope> => ({ ...command, kind: "command", eventVersion: 1, streamId: "session:unknown:agent.requests", sequence: "1", correlationId: "tx-1", source: "client" }) } as never,
    executions: { claim: async () => ({ kind: "joined", completed: false }), complete: async () => true, recipients: async () => [], renew: async () => true } as never,
    pool: { run: async () => { runs += 1; return { value: "unexpected", workerId: "worker-a" }; } } as never,
    metrics: { increment: () => undefined } as never, visibilitySeconds: 60, pollSeconds: 1, batchSize: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 15)); loop.stop();
  assert.equal(runs, 0);
  assert.deepEqual(deleted, ["20"]);
});
