import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { EventEnvelope } from "agent/common";
import { VIBE_ACTIONS, VIBE_SESSION_OPEN_ACTION } from "../../../common/index.js";
import type { LoopConfig } from "../../loop/index.js";
import { handleSessionOpen } from "./session-open.js";
import { SessionContext, type WorkerGlobals } from "../context.js";

function command(payload: Record<string, unknown>): EventEnvelope {
  return {
    eventId: "e1", eventVersion: 1, kind: "command", streamId: "session:s1", sequence: "1",
    action: VIBE_SESSION_OPEN_ACTION, transactionKey: "open:s1", channel: "vibe.s1",
    correlationId: "open:s1", source: "client", createdAt: new Date().toISOString(), payload,
  } as EventEnvelope;
}

async function harness(): Promise<{ globals: WorkerGlobals; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "vibe-ws-"));
  return { root, globals: { pool: {} as never, config: { workspaceRoot: root } as LoopConfig } };
}

test("opening a session fixes its folder, creates the directory and numbers the fact", async () => {
  const { globals, root } = await harness();
  const session = new SessionContext("s1", null, 0);
  const emitted: Record<string, unknown>[] = [];

  const outcome = await handleSessionOpen(globals, session, command({ userId: "u1", workspace: "calculator" }), (payload) => emitted.push(payload));

  assert.deepEqual(outcome, { sessionKey: "s1", workspace: "calculator", created: true });
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]!.action, VIBE_ACTIONS.sessionOpened);
  assert.equal(emitted[0]!.workspace, "calculator");
  // The sequence comes from the session, which is the only counter for it.
  assert.equal(emitted[0]!.seq, 0);
  assert.equal(session.workspace, "calculator");
  assert.ok((await stat(path.join(root, "calculator"))).isDirectory());
});

test("the sequence continues from what the session already issued", async () => {
  const { globals } = await harness();
  const session = new SessionContext("s1", null, 41);
  const emitted: Record<string, unknown>[] = [];
  await handleSessionOpen(globals, session, command({ userId: "u1", workspace: "calculator" }), (payload) => emitted.push(payload));
  assert.equal(emitted[0]!.seq, 41);
  assert.equal(session.nextSeq(), 42);
});

test("re-opening the same folder is idempotent and records nothing new", async () => {
  const { globals } = await harness();
  const session = new SessionContext("s1", "calculator", 0);
  const emitted: Record<string, unknown>[] = [];

  const outcome = await handleSessionOpen(globals, session, command({ userId: "u1", workspace: "calculator" }), (payload) => emitted.push(payload));

  assert.deepEqual(outcome, { sessionKey: "s1", workspace: "calculator", created: false });
  assert.deepEqual(emitted, []);
});

test("a session's folder cannot be changed once it is set", async () => {
  const { globals } = await harness();
  const session = new SessionContext("s1", "calculator", 0);
  await assert.rejects(
    handleSessionOpen(globals, session, command({ userId: "u1", workspace: "something-else" }), () => undefined),
    /already works in calculator/,
  );
  assert.equal(session.workspace, "calculator");
});

test("a session cannot be opened without a usable folder", async () => {
  const { globals } = await harness();
  for (const workspace of [undefined, "", "../escape", "/etc"]) {
    const session = new SessionContext("s1", null, 0);
    await assert.rejects(
      handleSessionOpen(globals, session, command({ userId: "u1", workspace }), () => undefined),
      /requires sessionKey, userId and a workspace path/,
    );
    assert.equal(session.workspace, null);
  }
});
