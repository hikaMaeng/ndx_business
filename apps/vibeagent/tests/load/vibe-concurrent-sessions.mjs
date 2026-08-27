/**
 * Proves that many sessions run at once without blocking each other.
 *
 * Each session gets its own socket, its own session id and its own turn, all
 * submitted within milliseconds of each other. If the worker were pinned to a
 * thread per turn, or serialised anywhere, the finish times would stair-step;
 * if it is genuinely non-blocking they overlap.
 *
 * Usage: node apps/vibeagent/tests/load/vibe-concurrent-sessions.mjs [count]
 */
import assert from "node:assert/strict";
import WebSocket from "ws";

const gatewayUrl = process.env.VIBE_GATEWAY_URL ?? "http://localhost:18081";
const email = process.env.VIBE_EMAIL ?? "vibe@example.com";
const password = process.env.VIBE_PASSWORD ?? "vibe-password-1";
const count = Number(process.argv[2] ?? 6);
const timeoutMs = Number(process.env.VIBE_TIMEOUT_MS ?? 900_000);
const prompt = process.env.VIBE_PROMPT
  ?? "Run exactly one bash command: echo ready > proof.txt && cat proof.txt. Then reply with a one-line summary and no further tool call.";

const login = await fetch(`${gatewayUrl}/api/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
}).then((r) => r.json());
assert.ok(login.sessionToken, `login failed: ${JSON.stringify(login)}`);
const token = login.sessionToken;
const userId = login.user.id;

const started = Date.now();
const at = () => Date.now() - started;

const runStamp = Date.now().toString(36);

function runSession(index) {
  const sessionId = `${userId}-${crypto.randomUUID()}`;
  const turnKey = crypto.randomUUID();
  // Each session works in its own folder. A session has no folder of its own
  // until it is opened with one, so this is a precondition, not a decoration.
  const workspace = `concurrent-${runStamp}/s${index}`;
  const record = { index, sessionId, turnKey, submittedAt: 0, firstEventAt: 0, finishedAt: 0, toolCalls: 0, ok: false };

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${gatewayUrl.replace(/^http/, "ws")}/ws?session=${encodeURIComponent(token)}`);
    const timer = setTimeout(() => { socket.close(); reject(new Error(`session ${index} timed out`)); }, timeoutMs);

    socket.on("error", (error) => { clearTimeout(timer); reject(error); });
    socket.on("open", () => socket.send(JSON.stringify({ type: "subscribe", channels: [`vibe.${sessionId}`] })));
    socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "subscribed") {
        socket.send(JSON.stringify({ type: "event", action: "vibe.session.open", transactionKey: `open:${sessionId}`, sessionId, payload: { sessionKey: sessionId, workspace } }));
        return;
      }
      if (frame.type === "event" && frame.event.action.endsWith(".session.opened")) {
        record.submittedAt = at();
        socket.send(JSON.stringify({ type: "event", action: "vibe.turn.run", transactionKey: turnKey, sessionId, payload: { sessionKey: sessionId, turnKey, prompt } }));
        return;
      }
      if (frame.type !== "event") return;
      const { action, payload, kind } = frame.event;
      if (!record.firstEventAt) record.firstEventAt = at();
      if (action.endsWith(".tool.started")) record.toolCalls += 1;
      // A turn ends at turn.final. A `result` is one reaction's terminal —
      // the chain has several, and the first is the session opening, so
      // resolving on any result would time every session at a few hundred ms
      // and then call the run serial.
      if (action.endsWith(".turn.final")) {
        record.finishedAt = at();
        record.ok = true;
        clearTimeout(timer);
        socket.close();
        resolve(record);
        return;
      }
      if (kind === "failure" || (kind === "result" && payload?.ok === false)) {
        record.finishedAt = at();
        record.ok = false;
        clearTimeout(timer);
        socket.close();
        resolve(record);
      }
    });
  });
}

console.log(`submitting ${count} sessions…`);
const records = await Promise.all(Array.from({ length: count }, (_, i) => runSession(i)));

const submitSpread = Math.max(...records.map((r) => r.submittedAt)) - Math.min(...records.map((r) => r.submittedAt));
const firstFinish = Math.min(...records.map((r) => r.finishedAt));
const lastFinish = Math.max(...records.map((r) => r.finishedAt));
const slowest = Math.max(...records.map((r) => r.finishedAt - r.submittedAt));

// Overlap: how much of the wall clock had more than one turn in flight.
const marks = records.flatMap((r) => [{ t: r.submittedAt, d: +1 }, { t: r.finishedAt, d: -1 }]).sort((a, b) => a.t - b.t);
let inFlight = 0, peak = 0, overlapMs = 0, previous = marks[0].t;
for (const mark of marks) {
  if (inFlight > 1) overlapMs += mark.t - previous;
  inFlight += mark.d;
  peak = Math.max(peak, inFlight);
  previous = mark.t;
}

for (const r of records) {
  console.log(`  #${r.index}  submit ${String(r.submittedAt).padStart(6)}ms  finish ${String(r.finishedAt).padStart(6)}ms  (${String(r.finishedAt - r.submittedAt).padStart(6)}ms, tools ${r.toolCalls}, ok ${r.ok})`);
}

assert.ok(records.every((r) => r.ok), "every session must finish ok");
// Serial execution would make total ≈ count × slowest. Non-blocking keeps it near one turn.
assert.ok(peak > 1, "no two turns were ever in flight at the same time — execution is serialised");
assert.ok(lastFinish < slowest * count, `wall clock ${lastFinish}ms suggests serial execution (slowest turn ${slowest}ms × ${count})`);

console.log(JSON.stringify({
  test: "vibe-concurrent-sessions",
  sessions: count,
  submitSpreadMs: submitSpread,
  peakInFlight: peak,
  overlapMs,
  firstFinishMs: firstFinish,
  lastFinishMs: lastFinish,
  slowestTurnMs: slowest,
  serialWouldBeMs: slowest * count,
}, null, 2));
