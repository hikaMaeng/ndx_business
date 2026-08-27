/**
 * Two contention cases the account/session grid does not reach.
 *
 * The contention harness gives every session its own folder, so it never tests
 * the thing the design actually asks for: sessions in one project deliberately
 * share a directory. And it runs one turn at a time per session, so it never
 * tests two turns arriving in the same session at once — which is what a
 * double-click or an impatient client produces.
 *
 * Both are places where the isolation argument stops applying, so both need
 * their own answer:
 *
 *   shared-folder  Several sessions, one directory, all writing at once. The
 *                  session boundary is not a file boundary here and is not
 *                  meant to be — the project is the boundary. What must hold is
 *                  that each session's own writes survive intact and no session
 *                  is refused or corrupted by a neighbour working beside it.
 *
 *   same-session   Two turns submitted into one session simultaneously. They
 *                  share one history, one sequence counter and one row lock, so
 *                  this is the narrowest contention in the system. Each turn
 *                  must end exactly once and the history must contain both
 *                  prompts, in some order, without either being lost or merged.
 *
 * Usage: node apps/vibeagent/tests/load/vibe-shared-folder.mjs [scenario] [n]
 *   scenario: shared-folder | same-session   (default: shared-folder)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import WebSocket from "ws";

const gatewayUrl = process.env.VIBE_GATEWAY_URL ?? "http://localhost:18081";
const email = process.env.VIBE_EMAIL ?? "vibe@example.com";
const password = process.env.VIBE_PASSWORD ?? "vibe-password-1";
const scenario = process.argv[2] ?? "shared-folder";
const count = Number(process.argv[3] ?? 4);
const timeoutMs = Number(process.env.VIBE_TIMEOUT_MS ?? 900_000);

const started = Date.now();
/**
 * Written synchronously, on purpose.
 *
 * Node buffers stdout when it is a file rather than a terminal, and an
 * uncaught assertion exits before that buffer is flushed — so the run that
 * fails is exactly the run whose diagnostics disappear. These lines are read
 * after the fact from a redirected log, so they have to survive the exit that
 * reports the failure.
 */
const emit = (line) => { try { fs.writeSync(1, line + "\n"); } catch { console.log(line); } };
const log = (...parts) => console.log(`${String(Date.now() - started).padStart(7)}ms`, ...parts);

const post = async (path, body, token) => {
  const response = await fetch(`${gatewayUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
};
const get = async (path, token) => {
  const response = await fetch(`${gatewayUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
};

const login = await post("/api/auth/login", { email, password });
assert.ok(login.ok, `login failed: ${JSON.stringify(login.body)}`);
const token = login.body.sessionToken;
const userId = login.body.user.id;
const stamp = Date.now().toString(36);

/** A live socket for one session, reporting what it saw rather than asserting. */
function connect(sessionKey, workspace, marker) {
  const channel = `vibe.${sessionKey}`;
  const state = { marker, sessionKey, workspace, opened: false, finals: [], toolStarts: [], foreign: 0, errors: [] };
  const socket = new WebSocket(`${gatewayUrl.replace(/^http/, "ws")}/ws?session=${encodeURIComponent(token)}`);
  let resolveOpen;
  state.untilOpen = new Promise((resolve) => { resolveOpen = resolve; });

  socket.on("error", (error) => state.errors.push(error.message));
  socket.on("open", () => socket.send(JSON.stringify({ type: "subscribe", channels: [channel] })));
  socket.on("message", (raw) => {
    let frame;
    try { frame = JSON.parse(String(raw)); } catch { return; }
    if (frame.type === "subscribed") {
      socket.send(JSON.stringify({
        type: "event", action: "vibe.session.open", transactionKey: `open:${sessionKey}`, sessionId: sessionKey,
        payload: { sessionKey, workspace },
      }));
      return;
    }
    if (frame.type !== "event") return;
    const { channel: on, action, payload, kind } = frame.event;
    if (on !== channel) { state.foreign += 1; return; }
    if (action === "vibe.session.opened") { state.opened = true; resolveOpen(); return; }
    if (action === "vibe.tool.started") { state.toolStarts.push(payload.toolCallKey); return; }
    // Recorded per turn, because with two turns in flight "how many finals"
    // is not the question — "which turn ended, and how often" is.
    if (action === "vibe.turn.final") { state.finals.push(String(payload.turnKey)); return; }
    if (kind === "failure" || (kind === "result" && payload?.ok === false)) {
      state.errors.push(`${action}: ${JSON.stringify(payload?.error ?? payload)}`);
    }
  });

  state.submit = (turnKey, prompt) => socket.send(JSON.stringify({
    type: "event", action: "vibe.turn.run", transactionKey: turnKey, sessionId: sessionKey,
    payload: { sessionKey, turnKey, prompt },
  }));
  state.close = () => socket.close();
  return state;
}

const waitUntil = async (predicate, label) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`timed out waiting for ${label}`);
};

// ------------------------------------------------------------- scenarios ----

/**
 * One folder, several sessions, all writing at once.
 *
 * Each session writes its own file and then lists the directory, so the
 * transcript also shows whether a session can see its neighbours' work — which
 * it should, because sharing the folder is the point of a project.
 */
async function sharedFolder() {
  const workspace = `shared-${stamp}`;
  const created = await post("/api/vibe/workspaces", { workspace }, token);
  assert.ok(created.ok, `could not create ${workspace}: ${JSON.stringify(created.body)}`);

  const sessions = Array.from({ length: count }, (_, index) =>
    connect(`${userId}-${crypto.randomUUID()}`, workspace, `w${index}`));
  await Promise.all(sessions.map((s) => s.untilOpen));
  log(`${count} sessions open in one folder: ${workspace}`);

  const turnKeys = sessions.map(() => crypto.randomUUID());
  sessions.forEach((session, index) => session.submit(turnKeys[index],
    `Run exactly one bash command: printf '%s' ${session.marker} > ${session.marker}.txt. `
    + "Then reply with one short sentence and make no further tool call."));
  log("all turns submitted into the same directory");

  await waitUntil(() => sessions.every((s) => s.finals.length >= 1), "every session to finish");
  sessions.forEach((s) => s.close());

  const problems = [];
  for (const [index, session] of sessions.entries()) {
    if (session.finals.length !== 1) problems.push(`${session.marker}: ended ${session.finals.length} times`);
    if (session.finals[0] !== turnKeys[index]) problems.push(`${session.marker}: ended the wrong turn`);
    if (session.foreign) problems.push(`${session.marker}: saw ${session.foreign} foreign events`);
    if (session.errors.length) problems.push(`${session.marker}: ${session.errors[0]}`);
    if (new Set(session.toolStarts).size !== session.toolStarts.length) {
      problems.push(`${session.marker}: started a command twice`);
    }
  }

  // Every session's file must exist with its own content. Sharing a directory
  // is allowed; overwriting a neighbour's file is not what any of them asked for.
  const listing = await get(`/api/vibe/workspaces`, token);
  assert.ok(listing.ok, "workspace listing failed");
  log(`checking ${count} files in ${workspace}`);
  for (const session of sessions) {
    const file = await fetch(`${gatewayUrl}/workspace/${encodeURIComponent(workspace)}/${session.marker}.txt`);
    if (!file.ok) { problems.push(`${session.marker}.txt missing`); continue; }
    const text = (await file.text()).trim();
    if (text !== session.marker) problems.push(`${session.marker}.txt contains ${JSON.stringify(text)}`);
  }

  assert.deepEqual(problems, [], `${problems.length} problem(s) sharing one folder`);
  return { workspace, sessions: sessions.length };
}

/**
 * Two turns into one session at the same moment.
 *
 * They contend for one history, one sequence counter and one row lock. Both
 * must end, exactly once each, and both prompts must survive — the failure to
 * look for is one turn's messages landing inside the other's history.
 */
async function sameSession() {
  const workspace = `same-${stamp}`;
  const created = await post("/api/vibe/workspaces", { workspace }, token);
  assert.ok(created.ok, `could not create ${workspace}`);

  const sessionKey = `${userId}-${crypto.randomUUID()}`;
  const session = connect(sessionKey, workspace, "one");
  await session.untilOpen;
  log(`one session, ${count} turns submitted simultaneously`);

  const turnKeys = Array.from({ length: count }, () => crypto.randomUUID());
  // No await between them: they leave on the same tick.
  turnKeys.forEach((turnKey, index) => session.submit(turnKey,
    `Run exactly one bash command: printf '%s' turn${index} > t${index}.txt. `
    + "Then reply with one short sentence and make no further tool call."));

  await waitUntil(() => new Set(session.finals).size >= count, `all ${count} turns to finish`);
  session.close();

  const problems = [];
  for (const [index, turnKey] of turnKeys.entries()) {
    const ended = session.finals.filter((key) => key === turnKey).length;
    if (ended !== 1) problems.push(`turn ${index} ended ${ended} times`);
  }
  if (session.foreign) problems.push(`saw ${session.foreign} foreign events`);
  if (new Set(session.toolStarts).size !== session.toolStarts.length) problems.push("a command started twice");

  // The read model is the check that the shared history stayed coherent: every
  // turn present, each with its own prompt, none merged into another.
  const view = await get(`/api/vibe/sessions/${encodeURIComponent(sessionKey)}/turns`, token);
  assert.ok(view.ok, "transcript unavailable");
  const turns = view.body.turns ?? [];
  if (turns.length !== count) problems.push(`read model has ${turns.length} turns, expected ${count}`);
  for (const [index, turnKey] of turnKeys.entries()) {
    const turn = turns.find((t) => t.turnKey === turnKey);
    if (!turn) { problems.push(`turn ${index} missing from the read model`); continue; }
    if (!turn.prompt.includes(`t${index}.txt`)) problems.push(`turn ${index} carries another turn's prompt`);
  }

  for (let index = 0; index < count; index += 1) {
    const file = await fetch(`${gatewayUrl}/workspace/${encodeURIComponent(workspace)}/t${index}.txt`);
    if (!file.ok) { problems.push(`t${index}.txt missing`); continue; }
    const text = (await file.text()).trim();
    if (text !== `turn${index}`) problems.push(`t${index}.txt contains ${JSON.stringify(text)}`);
  }

  assert.deepEqual(problems, [], `${problems.length} problem(s) with concurrent turns in one session`);
  return { sessionKey, turns: count };
}

// ------------------------------------------------------------------ main ----

const scenarios = { "shared-folder": sharedFolder, "same-session": sameSession };
const chosen = scenarios[scenario];
assert.ok(chosen, `unknown scenario ${scenario}; expected ${Object.keys(scenarios).join(" or ")}`);

log(`scenario: ${scenario}`);
const result = await chosen();
emit("");
emit(`scenario  ${scenario}`);
emit(`result    ${JSON.stringify(result)}`);
emit(`elapsed   ${Date.now() - started}ms`);
emit("passed");
