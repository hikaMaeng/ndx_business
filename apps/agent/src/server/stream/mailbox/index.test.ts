import assert from "node:assert/strict";
import test from "node:test";
import { ConnectionMailbox } from "./index.js";

const event = (kind: "command" | "result" | "progress", id: string) => ({ eventId: id, eventVersion: 1 as const, streamId: "channel:orders", sequence: id, transactionKey: id, correlationId: id, kind, channel: "orders", action: "test", source: "server" as const, createdAt: new Date().toISOString(), payload: {} });

test("a full mailbox drops progress but closes only its slow connection for terminal events", () => {
  const sent: string[] = []; let done: (() => void) | undefined; let closed = 0;
  const mailbox = new ConnectionMailbox(1, (value, next) => { sent.push(value.eventId); done = next; }, () => { closed += 1; });
  mailbox.enqueue(event("command", "1"));
  mailbox.enqueue(event("progress", "2"));
  mailbox.enqueue(event("result", "3"));
  assert.deepEqual(sent, ["1"]); assert.equal(closed, 1);
  done?.();
});
