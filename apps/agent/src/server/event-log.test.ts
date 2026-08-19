import assert from "node:assert/strict";
import test from "node:test";
import { EventLog } from "./event-log.js";

test("append resolves only after the durable insert query resolves", async () => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const log = new EventLog({ query: async () => { await pending; return { rows: [], rowCount: 1 }; } } as never);
  let completed = false;
  const append = log.append({ eventId: "event-1", transactionKey: "transaction-1", kind: "request", channel: "agent.requests", action: "hash.sha256", source: "test", createdAt: new Date().toISOString(), payload: {} }).then(() => { completed = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(completed, false);
  release?.();
  await append;
  assert.equal(completed, true);
});
