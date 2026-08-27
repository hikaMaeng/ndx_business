/**
 * Stability when the parts restart underneath a live turn.
 *
 * The contention harness proves sessions do not interfere when everything is
 * healthy. This one breaks things on purpose, because the failures that matter
 * here are the quiet ones: a turn that stops without an error, or a command
 * that runs twice because two workers each believed they owned it.
 *
 * Three scenarios, each with a specific claim to disprove:
 *
 *   dispatcher-gap  A dispatcher that restarts normally loses nothing: its
 *                   cursor is a row in the database, so it resumes where it
 *                   stopped. The gap is narrower than that, and this scenario
 *                   creates exactly it — a dispatcher with no saved cursor,
 *                   which seeds at the end of the log and therefore steps over
 *                   every fact recorded before it started. That happens on a
 *                   first run, after a rename, or if the cursor row is lost.
 *                   The turn should stop, and then be recovered by the sweep,
 *                   which finds it by age rather than by position.
 *
 *   worker-restart  Killing the worker mid-turn abandons a claimed execution.
 *                   Another worker should reclaim it after the lease expires
 *                   and finish the turn, without the command running twice.
 *
 *   both            Everything restarts while several sessions are in flight.
 *                   Nothing should be lost, duplicated, or crossed over.
 *
 * Usage: node apps/vibeagent/tests/load/vibe-chaos.mjs [scenario] [sessions]
 *   scenario: dispatcher-gap | worker-restart | both   (default: dispatcher-gap)
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import WebSocket from "ws";

const run = promisify(execFile);
const gatewayUrl = process.env.VIBE_GATEWAY_URL ?? "http://localhost:18081";
const email = process.env.VIBE_EMAIL ?? "vibe@example.com";
const password = process.env.VIBE_PASSWORD ?? "vibe-password-1";
const scenario = process.argv[2] ?? "dispatcher-gap";
const sessionCount = Number(process.argv[3] ?? 2);
const timeoutMs = Number(process.env.VIBE_TIMEOUT_MS ?? 900_000);
const dispatcherName = process.env.VIBE_DISPATCHER ?? "ndx-business-vibeagent-dispatcher-1";
const workerName = process.env.VIBE_WORKER ?? "ndx-business-vibeagent-worker-1";

const started = Date.now();
const at = () => String(Date.now() - started).padStart(7);
const log = (...parts) => console.log(`${at()}ms`, ...parts);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const docker = async (...args) => { await run("docker", args); };

const post = async (path, body, token) => {
  const response = await fetch(`${gatewayUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
};

const login = await post("/api/auth/login", { email, password });
assert.ok(login.ok, `login failed: ${JSON.stringify(login.body)}`);
const token = login.body.sessionToken;
const userId = login.body.user.id;
const stamp = Date.now().toString(36);

/**
 * A session that reports what it saw rather than asserting as it goes.
 *
 * Under chaos a turn may legitimately take a long time — that is the point —
 * so nothing here treats slowness as failure. It records, and the scenario
 * decides what the record means.
 */
function openSession(index) {
  const sessionKey = `${userId}-${crypto.randomUUID()}`;
  const workspace = `chaos-${stamp}/s${index}`;
  const marker = `s${index}`;
  const channel = `vibe.${sessionKey}`;
  const state = {
    marker, sessionKey, workspace, opened: false, finals: 0, toolStarts: [], iterations: 0,
    answer: "", foreign: 0, finishedAt: 0,
  };

  const socket = new WebSocket(`${gatewayUrl.replace(/^http/, "ws")}/ws?session=${encodeURIComponent(token)}`);
  let resolveOpen;
  let resolveFinal;
  state.untilOpen = new Promise((resolve) => { resolveOpen = resolve; });
  state.untilFinal = new Promise((resolve) => { resolveFinal = resolve; });

  socket.on("error", (error) => log(`${marker} socket error: ${error.message}`));
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
    const { channel: on, action, payload } = frame.event;
    if (on !== channel) { state.foreign += 1; return; }
    if (action === "vibe.session.opened") { state.opened = true; resolveOpen(); return; }
    if (action === "vibe.iteration.started") { state.iterations += 1; return; }
    // Every start is recorded, not counted: running the same command twice is
    // the failure this scenario exists to detect, and a count would hide which.
    if (action === "vibe.tool.started") { state.toolStarts.push(payload.toolCallKey); return; }
    if (action === "vibe.turn.final") {
      state.finals += 1;
      state.answer = String(payload.answer ?? "");
      state.finishedAt = Date.now() - started;
      resolveFinal();
    }
  });

  state.submit = (turnKey, prompt) => socket.send(JSON.stringify({
    type: "event", action: "vibe.turn.run", transactionKey: turnKey, sessionId: sessionKey,
    payload: { sessionKey, turnKey, prompt },
  }));
  state.close = () => socket.close();
  return state;
}

const oneCommand = (marker) =>
  `Run exactly one bash command: printf '%s' ${marker} >> ${marker}.log. `
  + "Then reply with one short sentence and make no further tool call.";

async function prepare(count) {
  const sessions = [];
  for (let index = 0; index < count; index += 1) {
    const workspace = `chaos-${stamp}/s${index}`;
    const created = await post("/api/vibe/workspaces", { workspace }, token);
    assert.ok(created.ok, `could not create ${workspace}`);
    sessions.push(openSession(index));
  }
  await Promise.all(sessions.map((s) => s.untilOpen));
  log(`${count} session(s) open in chaos-${stamp}/`);
  return sessions;
}

const waitFor = async (promise, ms) => {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve("timeout"), ms); });
  try { return await Promise.race([promise.then(() => "done"), timeout]); }
  finally { clearTimeout(timer); }
};

// ------------------------------------------------------------- scenarios ----

async function dispatcherGap() {
  const [session] = await prepare(1);

  log("stopping the dispatcher");
  await docker("stop", dispatcherName);

  const turnKey = crypto.randomUUID();
  session.submit(turnKey, oneCommand(session.marker));
  log("submitted a turn with no dispatcher running");

  // `turn.run` still reaches intake — the broker writes that queue directly —
  // so `turn.started` is recorded. Nothing carries it onward.
  await sleep(15_000);
  assert.equal(session.finals, 0, "a turn finished with no dispatcher, which means it was never dispatched at all");
  log(`turn is stalled as expected (iterations=${session.iterations})`);

  // Without this the dispatcher would resume from its saved position and pick
  // the fact up through the ordinary path — which is what actually happens on
  // a normal restart, and is why this scenario has to remove the cursor to
  // reach the case the sweep exists for.
  log("discarding the saved cursor, so the dispatcher comes up cold");
  await run("docker", ["exec", "admin", "psql", "-U", "postgres", "-d", "ndx_business", "-c",
    `DELETE FROM event_reader_cursor WHERE name = '${process.env.VIBE_DISPATCHER_NAME ?? "vibe"}'`]);

  log("starting the dispatcher — with no cursor it seeds at the end, stepping over the fact");
  await docker("start", dispatcherName);
  await sleep(20_000);

  const beforeSweep = session.finals;
  log(`after restart, before the sweep: finals=${beforeSweep}`);

  log("waiting for the recovery sweep to find it by age");
  const outcome = await waitFor(session.untilFinal, timeoutMs);
  session.close();

  assert.equal(outcome, "done", "the stalled turn was never recovered");
  assert.equal(session.finals, 1, `the turn ended ${session.finals} times`);
  assert.equal(new Set(session.toolStarts).size, session.toolStarts.length,
    `a command was started more than once: ${JSON.stringify(session.toolStarts)}`);
  log(`recovered and finished at ${session.finishedAt}ms`);
  return { recoveredAfterRestart: beforeSweep === 0 };
}

async function workerRestart() {
  const sessions = await prepare(sessionCount);
  const turnKeys = sessions.map(() => crypto.randomUUID());
  sessions.forEach((session, index) => session.submit(turnKeys[index], oneCommand(session.marker)));
  log(`${sessions.length} turn(s) submitted`);

  // Long enough to be mid-flight — a model call is under way — and short
  // enough that nothing has finished.
  await sleep(8_000);
  log("restarting the worker mid-turn");
  await docker("restart", workerName);

  const outcomes = await Promise.all(sessions.map((s) => waitFor(s.untilFinal, timeoutMs)));
  sessions.forEach((s) => s.close());

  for (const [index, session] of sessions.entries()) {
    assert.equal(outcomes[index], "done", `${session.marker} never finished after the worker restarted`);
    assert.equal(session.finals, 1, `${session.marker} ended ${session.finals} times`);
    assert.equal(new Set(session.toolStarts).size, session.toolStarts.length,
      `${session.marker} started a command twice: ${JSON.stringify(session.toolStarts)}`);
  }
  log(`all ${sessions.length} turn(s) survived the restart`);
  return { sessions: sessions.length };
}

async function both() {
  const sessions = await prepare(sessionCount);
  const turnKeys = sessions.map(() => crypto.randomUUID());
  sessions.forEach((session, index) => session.submit(turnKeys[index], oneCommand(session.marker)));
  log(`${sessions.length} turn(s) submitted`);

  await sleep(6_000);
  log("restarting dispatcher and worker together");
  await Promise.all([docker("restart", dispatcherName), docker("restart", workerName)]);

  const outcomes = await Promise.all(sessions.map((s) => waitFor(s.untilFinal, timeoutMs)));
  sessions.forEach((s) => s.close());

  const unfinished = outcomes.filter((o) => o !== "done").length;
  for (const session of sessions) {
    assert.equal(new Set(session.toolStarts).size, session.toolStarts.length,
      `${session.marker} started a command twice: ${JSON.stringify(session.toolStarts)}`);
    assert.ok(session.finals <= 1, `${session.marker} ended ${session.finals} times`);
    assert.equal(session.foreign, 0, `${session.marker} saw ${session.foreign} events from elsewhere`);
  }
  assert.equal(unfinished, 0, `${unfinished} turn(s) never finished after both services restarted`);
  log(`all ${sessions.length} turn(s) survived both restarts`);
  return { sessions: sessions.length };
}

// ------------------------------------------------------------------ main ----

const scenarios = { "dispatcher-gap": dispatcherGap, "worker-restart": workerRestart, both };
const chosen = scenarios[scenario];
assert.ok(chosen, `unknown scenario ${scenario}; expected one of ${Object.keys(scenarios).join(", ")}`);

log(`scenario: ${scenario}`);
const result = await chosen();
// The services must be left running whatever happened, or the next run starts
// against a stack that is half down.
await docker("start", dispatcherName).catch(() => {});
await docker("start", workerName).catch(() => {});
console.log("");
console.log(`scenario   ${scenario}`);
console.log(`result     ${JSON.stringify(result)}`);
console.log(`elapsed    ${Date.now() - started}ms`);
console.log("chaos checks passed");
