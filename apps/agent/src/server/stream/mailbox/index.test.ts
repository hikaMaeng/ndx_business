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

test("idle notification waits for the cursor-owning send to finish", () => {
  let done: (() => void) | undefined; let idle = 0;
  const mailbox = new ConnectionMailbox(2, (_value, next) => { done = next; }, () => undefined);
  mailbox.enqueue(event("command", "1"));
  mailbox.onIdle(() => { idle += 1; });
  assert.equal(idle, 0);
  done?.();
  assert.equal(idle, 1);
  assert.equal(mailbox.isIdle(), true);
});

test("a blocked recipient is isolated from a recipient that can keep sending", () => {
  let releaseSlow: (() => void) | undefined; let slowClosed = 0; const fast: string[] = [];
  const slow = new ConnectionMailbox(1, (_value, next) => { releaseSlow = next; }, () => { slowClosed += 1; });
  const healthy = new ConnectionMailbox(2, (value, next) => { fast.push(value.eventId); next(); }, () => undefined);
  for (const value of [event("result", "1"), event("result", "2")]) { slow.enqueue(value); healthy.enqueue(value); }
  assert.equal(slowClosed, 1);
  assert.deepEqual(fast, ["1", "2"]);
  releaseSlow?.();
});

test("reports queued depth and releases it when the connection closes", () => {
  let done: (() => void) | undefined; const depths: number[] = [];
  const mailbox = new ConnectionMailbox(2, (_value, next) => { done = next; }, () => undefined, (depth) => depths.push(depth));
  mailbox.enqueue(event("result", "1"));
  mailbox.enqueue(event("result", "2"));
  mailbox.dispose();
  assert.deepEqual(depths, [1, 2, 0]);
  done?.();
  assert.deepEqual(depths, [1, 2, 0]);
});
