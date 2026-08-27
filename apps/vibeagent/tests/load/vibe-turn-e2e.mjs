/**
 * Drives one real turn the same way the browser does: authenticate against
 * admin, open one WebSocket, submit the turn as an event, and read the whole
 * transcript back off that socket. Nothing here uses an HTTP agent route,
 * because none exists — the socket is the event path.
 *
 * Usage: node apps/vibeagent/tests/load/vibe-turn-e2e.mjs "<prompt>"
 */
import assert from "node:assert/strict";
import WebSocket from "ws";

const adminUrl = process.env.VIBE_ADMIN_URL ?? "http://localhost:18080";
const gatewayUrl = process.env.VIBE_GATEWAY_URL ?? "http://localhost:18081";
const email = process.env.VIBE_EMAIL ?? "vibe@example.com";
const password = process.env.VIBE_PASSWORD ?? "vibe-password-1";
const prompt = process.argv[2] ?? "Create a simple calculator web page in index.html.";
const timeoutMs = Number(process.env.VIBE_E2E_TIMEOUT_MS ?? 900_000);

const post = async (url, body) => {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
};

const login = await post(`${gatewayUrl}/api/auth/login`, { email, password });
assert.ok(login.ok, `login failed: ${JSON.stringify(login.body)}`);
const token = login.body.sessionToken;
const userId = login.body.user.id;

const sessionKey = `${userId}-${crypto.randomUUID()}`;
const replyChannel = `vibe.${sessionKey}`;
const turnKey = crypto.randomUUID();
// A session cannot exist without a folder, so the folder is made first and the
// session is opened in it. Submitting a turn against an unopened session is
// refused, which is the rule this script has to follow like any other client.
const workspace = process.env.VIBE_WORKSPACE ?? `e2e-${Date.now().toString(36)}`;
const folder = await fetch(`${gatewayUrl}/api/vibe/workspaces`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({ workspace }),
});
assert.ok(folder.ok, `could not create ${workspace}: ${await folder.text()}`);

const socket = new WebSocket(`${gatewayUrl.replace(/^http/, "ws")}/ws?session=${encodeURIComponent(token)}`);
const started = Date.now();
const tools = new Map();
let iterations = 0;
let answer = "";
let terminal;

const done = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`turn did not finish within ${timeoutMs}ms`)), timeoutMs);
  socket.on("error", (error) => { clearTimeout(timer); reject(error); });
  socket.on("open", () => {
    socket.send(JSON.stringify({ type: "subscribe", channels: [replyChannel] }));
  });
  let opened = false;
  socket.on("message", (raw) => {
    const frame = JSON.parse(String(raw));
    if (frame.type === "subscribed") {
      // Open only after the subscription exists, so no progress is missed.
      socket.send(JSON.stringify({ type: "event", action: "vibe.session.open", transactionKey: `open:${sessionKey}`, sessionId: sessionKey, payload: { sessionKey, workspace } }));
      return;
    }
    if (frame.type !== "event") return;
    const { action, payload, kind } = frame.event;
    if (action.endsWith(".session.opened") && !opened) {
      opened = true;
      console.log(`${String(Date.now() - started).padStart(6)}ms opened     ${workspace}`);
      socket.send(JSON.stringify({ type: "event", action: "vibe.turn.run", transactionKey: turnKey, sessionId: sessionKey, payload: { sessionKey, turnKey, prompt } }));
      return;
    }
    const at = `${String(Date.now() - started).padStart(6)}ms`;
    if (action.endsWith(".reasoning")) console.log(`${at} reasoning  ${String(payload.reasoning).replace(/\s+/g, " ").slice(0, 140)}`);
    else if (action.endsWith(".iteration.started")) { iterations += 1; console.log(`${at} iteration  #${payload.iterationIndex}`); }
    else if (action.endsWith(".tool.started")) { tools.set(payload.toolCallKey, payload.command); console.log(`${at} bash       ${String(payload.command).replace(/\n/g, " ⏎ ").slice(0, 160)}`); }
    else if (action.endsWith(".tool.completed")) console.log(`${at} exit ${payload.exitCode}   (${payload.durationMs}ms)`);
    else if (action.endsWith(".turn.final")) { answer = String(payload.answer ?? ""); console.log(`${at} final      ${answer.replace(/\s+/g, " ").slice(0, 200)}`); }
    // The turn ends at turn.final. A `result` is one reaction's terminal, not
    // the turn's — a turn is a chain of them now, and the first to arrive is
    // the session opening, which is why waiting on any result ended instantly.
    if (action.endsWith(".turn.final")) {
      clearTimeout(timer);
      terminal = { ok: true, value: { turnKey, stoppedBy: payload.stoppedBy ?? "final" } };
      resolve();
      return;
    }
    // A reaction that threw leaves the chain with nothing to continue it, so a
    // failed result still has to end the wait rather than time out.
    if (kind === "failure" || (kind === "result" && payload?.ok === false)) {
      clearTimeout(timer);
      terminal = payload;
      resolve();
    }
  });
});

try {
  await done;
} finally {
  socket.close();
}

assert.ok(terminal, "no terminal event arrived");
assert.equal(terminal.ok, true, `turn failed: ${JSON.stringify(terminal.error)}`);

console.log(JSON.stringify({
  test: "vibe-turn-e2e",
  sessionKey, turnKey,
  elapsedMs: Date.now() - started,
  iterations,
  toolCalls: tools.size,
  stoppedBy: terminal.value?.stoppedBy,
  answer: (answer || terminal.value?.answer || "").slice(0, 400),
  workspace,
  workspaceUrl: `${gatewayUrl}/workspace/${workspace.split("/").map(encodeURIComponent).join("/")}/`,
}, null, 2));
