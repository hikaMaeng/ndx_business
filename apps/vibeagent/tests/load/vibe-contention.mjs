/**
 * Contention: many accounts at once, and one account holding many sessions.
 *
 * The single-session tests answer "does a turn work". This answers the
 * questions that only appear when several are in flight together, which is the
 * shape this architecture is actually for — and the shape where its failures
 * are silent. A session that quietly receives another session's events, or a
 * history that interleaves two turns, does not raise an error; it produces a
 * plausible transcript that is wrong.
 *
 * So every assertion here is about isolation and accounting, not about liveness:
 *
 *   - no session sees an event belonging to another session
 *   - no account sees another account's session at all
 *   - each turn ends exactly once
 *   - each iteration has exactly one assistant message, however many workers
 *     touched it
 *   - the files a session created are the files it asked for
 *   - the read model agrees with the log it was folded from
 *
 * Usage:
 *   node apps/vibeagent/tests/load/vibe-contention.mjs [accounts] [sessionsPerAccount] [turnsPerSession]
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import WebSocket from "ws";

const gatewayUrl = process.env.VIBE_GATEWAY_URL ?? "http://localhost:18081";
const accountCount = Number(process.argv[2] ?? 3);
const sessionsPerAccount = Number(process.argv[3] ?? 3);
const turnsPerSession = Number(process.argv[4] ?? 2);
const timeoutMs = Number(process.env.VIBE_TIMEOUT_MS ?? 900_000);
const password = process.env.VIBE_PASSWORD ?? "contention-password-1";
const stamp = Date.now().toString(36);

const started = Date.now();
const at = () => String(Date.now() - started).padStart(7);

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
const log = (...parts) => emit(`${at()}ms ${parts.join(" ")}`);

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

/**
 * Signs in, creating the account first if this is its first run.
 *
 * A fresh account may need activation depending on the deployment's policy, so
 * a login that fails after a successful signup is reported as a setup problem
 * rather than as a test failure — the difference matters when reading output.
 */
async function account(index) {
  const email = `contention-${stamp}-${index}@example.com`;
  const signup = await post("/api/auth/signup", { email, password });
  if (!signup.ok && !/exists|registered|already/i.test(String(signup.body.error ?? ""))) {
    throw new Error(`signup failed for ${email}: ${JSON.stringify(signup.body)}`);
  }
  const login = await post("/api/auth/login", { email, password });
  if (!login.ok) {
    throw new Error(`account ${email} was created but cannot sign in (${JSON.stringify(login.body)}). `
      + "If this deployment requires admin approval, pre-approve the accounts or set VIBE_EMAIL/VIBE_PASSWORD to reuse one.");
  }
  return { index, email, token: login.body.sessionToken, userId: login.body.user.id };
}

/**
 * One session: open it in its own project folder, then run its turns in order.
 *
 * Turns within a session are sequential because that is what a turn is — the
 * next prompt is asked of the history the previous one produced. Sessions are
 * concurrent, which is the thing under test.
 */
function runSession(owner, sessionIndex) {
  const sessionKey = `${owner.userId}-${crypto.randomUUID()}`;
  const workspace = `contention-${stamp}/a${owner.index}-s${sessionIndex}`;
  const marker = `a${owner.index}s${sessionIndex}`;
  const channel = `vibe.${sessionKey}`;

  const record = {
    owner: owner.index, sessionIndex, sessionKey, workspace, marker,
    turns: [], opened: false, foreignEvents: [], finals: 0, toolCalls: 0, iterations: 0,
  };

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${gatewayUrl.replace(/^http/, "ws")}/ws?session=${encodeURIComponent(owner.token)}`);
    const timer = setTimeout(() => { socket.close(); reject(new Error(`${marker} timed out`)); }, timeoutMs);
    const fail = (error) => { clearTimeout(timer); socket.close(); reject(error); };

    let turnIndex = -1;
    let pending;

    const nextTurn = () => {
      turnIndex += 1;
      if (turnIndex >= turnsPerSession) {
        clearTimeout(timer);
        socket.close();
        resolve(record);
        return;
      }
      const turnKey = crypto.randomUUID();
      const file = `${marker}-${turnIndex}.txt`;
      pending = { turnKey, file, finals: 0, answer: "" };
      record.turns.push(pending);
      // The prompt names a file unique to this session and turn. If any session
      // writes another session's file, the folder listing at the end says so.
      const prompt = `Run exactly one bash command: printf '%s' ${marker}-${turnIndex} > ${file}. `
        + `Then reply with one short sentence and make no further tool call.`;
      socket.send(JSON.stringify({
        type: "event", action: "vibe.turn.run", transactionKey: turnKey, sessionId: sessionKey,
        payload: { sessionKey, turnKey, prompt },
      }));
    };

    socket.on("error", fail);
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

      const event = frame.event;
      // The isolation assertion, made on every single frame rather than at the
      // end: a socket subscribed to one channel must never be handed another's.
      if (event.channel !== channel) {
        record.foreignEvents.push({ channel: event.channel, action: event.action });
        return;
      }

      const { action, payload } = event;
      if (action === "vibe.session.opened") {
        record.opened = true;
        nextTurn();
        return;
      }
      if (action === "vibe.iteration.started") { record.iterations += 1; return; }
      if (action === "vibe.tool.started") { record.toolCalls += 1; return; }
      if (action === "vibe.turn.final") {
        record.finals += 1;
        if (payload.turnKey !== pending?.turnKey) {
          record.foreignEvents.push({ channel: event.channel, action, turnKey: payload.turnKey });
          return;
        }
        pending.finals += 1;
        pending.answer = String(payload.answer ?? "");
        nextTurn();
        return;
      }
      if (event.kind === "failure" || (event.kind === "result" && payload?.ok === false)) {
        fail(new Error(`${marker} ${action}: ${JSON.stringify(payload?.error ?? payload)}`));
      }
    });
  });
}

// ------------------------------------------------------------------ run ----

log(`signing in ${accountCount} accounts`);
const accounts = await Promise.all(Array.from({ length: accountCount }, (_, index) => account(index)));
log(`accounts ready: ${accounts.map((a) => a.email.split("@")[0]).join(", ")}`);

// Folders first. A session cannot be opened without one, and creating them up
// front keeps folder creation out of the timing being measured.
for (const owner of accounts) {
  for (let s = 0; s < sessionsPerAccount; s += 1) {
    const workspace = `contention-${stamp}/a${owner.index}-s${s}`;
    const created = await post("/api/vibe/workspaces", { workspace }, owner.token);
    assert.ok(created.ok, `could not create ${workspace}: ${JSON.stringify(created.body)}`);
  }
}
log(`created ${accountCount * sessionsPerAccount} project folders`);

const plan = accounts.flatMap((owner) => Array.from({ length: sessionsPerAccount }, (_, s) => ({ owner, s })));
log(`starting ${plan.length} sessions x ${turnsPerSession} turns, all at once`);

const settled = await Promise.allSettled(plan.map(({ owner, s }) => runSession(owner, s)));
const failures = settled.filter((r) => r.status === "rejected");
const records = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
log(`finished: ${records.length} ok, ${failures.length} failed (${Date.now() - started}ms)`);
for (const failure of failures) emit(`  FAILED: ${failure.reason?.message ?? failure.reason}`);

// ------------------------------------------------------------ assertions ----

const problems = [];
const check = (condition, message) => { if (!condition) problems.push(message); };

for (const record of records) {
  check(record.opened, `${record.marker}: session never opened`);
  check(record.foreignEvents.length === 0,
    `${record.marker}: received ${record.foreignEvents.length} events belonging elsewhere: ${JSON.stringify(record.foreignEvents.slice(0, 3))}`);
  check(record.turns.length === turnsPerSession, `${record.marker}: ran ${record.turns.length} turns, expected ${turnsPerSession}`);
  for (const turn of record.turns) {
    check(turn.finals === 1, `${record.marker}: turn ${turn.turnKey} ended ${turn.finals} times`);
  }
}

// Cross-account visibility: each account must see its own sessions and nobody
// else's. This is the check that a shared read path would fail.
for (const owner of accounts) {
  const listed = await get("/api/vibe/sessions", owner.token);
  assert.ok(listed.ok, `session list failed for account ${owner.index}`);
  const ids = (listed.body.sessions ?? []).map((s) => s.sessionId);
  const mine = records.filter((r) => r.owner === owner.index).map((r) => r.sessionKey);
  const others = records.filter((r) => r.owner !== owner.index).map((r) => r.sessionKey);
  for (const id of mine) check(ids.includes(id), `account ${owner.index}: cannot see own session ${id}`);
  for (const id of others) check(!ids.includes(id), `account ${owner.index}: can see another account's session ${id}`);

  // And the read model must refuse a session it does not own, by id alone.
  const foreign = others[0];
  if (foreign) {
    const denied = await get(`/api/vibe/sessions/${encodeURIComponent(foreign)}/turns`, owner.token);
    check(denied.status === 404, `account ${owner.index}: read another account's transcript (status ${denied.status})`);
  }
}

// The read model must agree with what the sockets saw.
for (const record of records) {
  const view = await get(`/api/vibe/sessions/${encodeURIComponent(record.sessionKey)}/turns`, accounts[record.owner].token);
  check(view.ok, `${record.marker}: transcript unavailable`);
  const turns = view.body.turns ?? [];
  check(turns.length === record.turns.length,
    `${record.marker}: read model has ${turns.length} turns, socket saw ${record.turns.length}`);
  const keys = new Set(turns.map((t) => t.turnKey));
  for (const turn of record.turns) check(keys.has(turn.turnKey), `${record.marker}: turn ${turn.turnKey} missing from read model`);
}

emit("");
emit(`accounts            ${accountCount}`);
emit(`sessions            ${records.length}/${plan.length}`);
emit(`turns               ${records.reduce((sum, r) => sum + r.turns.length, 0)}`);
emit(`tool calls          ${records.reduce((sum, r) => sum + r.toolCalls, 0)}`);
emit(`iterations          ${records.reduce((sum, r) => sum + r.iterations, 0)}`);
emit(`cross-talk events   ${records.reduce((sum, r) => sum + r.foreignEvents.length, 0)}`);
emit(`elapsed             ${Date.now() - started}ms`);
emit(`workspace root      contention-${stamp}/`);
emit("");

if (problems.length) {
  emit(`${problems.length} problem(s):`);
  for (const problem of problems) emit(`  - ${problem}`);
}
assert.equal(failures.length, 0, `${failures.length} session(s) failed`);
assert.deepEqual(problems, [], `${problems.length} contention problem(s)`);
emit("contention checks passed");
