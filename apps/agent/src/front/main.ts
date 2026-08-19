import { EventStreamModel, type StreamEventRecord } from "agent_domain/front";
import resources from "../../assets/i18n/en.json";
import { RSC } from "./resource";
import "./styles.css";

const model = new EventStreamModel();
const t = (key: RSC): string => resources[key];
const app = document.querySelector<HTMLElement>("#app");
const id = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();
const safe = (value: unknown): string => JSON.stringify(value, null, 2).replaceAll("<", "&lt;");
const sessionKey = id();
const runKey = id();
const turnKey = id();
const actionOptions = [
  "session.create.request", "session.delete.request", "session.get.request", "session.snapshot.response", "session.deleted.response", "session.cancel.request", "session.cancelled.response", "session.resume.request", "session.resumed.response",
  "turn.start.request", "turn.input.append.request", "turn.stop.request", "turn.final.response", "turn.cancelled.response", "turn.failed.response",
  "iteration.start.request", "iteration.progress", "iteration.merge.request", "iteration.merged.response", "iteration.failed.response",
  "tool.call.request", "tool.started", "tool.progress", "tool.stdout", "tool.stderr", "tool.completed", "tool.failed", "tool.cancel.request", "tool.cancelled",
  "hook.invoke.request", "hook.started", "hook.completed", "hook.failed", "hook.skipped",
  "model.select.request", "model.change.request", "model.defaults.update.request", "model.selected.response", "model.defaults.updated.response",
  "kv.put.request", "kv.get.request", "kv.delete.request", "kv.persist.request", "kv.persisted.response", "compaction.start.request", "compaction.progress", "compaction.completed.response", "checkpoint.create.request", "checkpoint.created.response",
  "process.start.request", "process.started", "process.stdout", "process.stderr", "process.exit", "process.timeout", "process.cancel.request", "process.cancelled",
  "approval.request", "approval.granted", "approval.rejected", "approval.expired",
  "artifact.register.request", "artifact.progress", "artifact.registered.response", "artifact.failed.response",
];

function eventRecord(input: Partial<StreamEventRecord> & Pick<StreamEventRecord, "channel" | "eventType" | "direction" | "state" | "payload">): StreamEventRecord {
  return { id: id(), transactionKey: input.transactionKey ?? id(), timestamp: now(), ...input };
}

function renderEvent(event: StreamEventRecord): string {
  const inbound = event.direction === "inbound";
  return `<article class="event-row ${event.direction}"><div class="event-marker ${event.state}" aria-hidden="true">${inbound ? "↓" : "↑"}</div><div class="event-card"><div class="event-topline"><span class="direction-label">${inbound ? t(RSC.AGENT_EVENT_INBOUND_LABEL) : t(RSC.AGENT_EVENT_OUTBOUND_LABEL)}</span><span class="event-channel"># ${event.channel}</span><time>${new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div><div class="event-title"><strong>${event.eventType}</strong><span class="state-pill ${event.state}">${t(RSC[`AGENT_EVENT_STATE_${event.state.toUpperCase()}_STATUS` as keyof typeof RSC])}</span></div><pre>${safe(event.payload)}</pre><div class="event-foot"><span>tx ${event.transactionKey.slice(0, 12)}…</span><span>${event.id.slice(0, 8)}</span></div></div></article>`;
}

function render(): void {
  if (!app) return;
  const snapshot = model.getSnapshot();
  const subscribed = new Set(snapshot.subscribedChannels);
  const inbound = snapshot.events.filter((event) => event.direction === "inbound").length;
  const outbound = snapshot.events.filter((event) => event.direction === "outbound").length;
  app.innerHTML = `<div class="app-shell"><header class="topbar"><div class="brand-lockup"><span class="brand-mark" aria-hidden="true">◈</span><div><p class="eyebrow">${t(RSC.AGENT_SHELL_KICKER_TEXT)}</p><h1>Vibe coding control room</h1></div></div><div class="topbar-meta"><span class="live-dot ${snapshot.connection}"></span><span>${t(RSC.AGENT_SHELL_CONNECTION_LABEL)} · ${t(RSC[`AGENT_CONNECTION_${snapshot.connection.toUpperCase()}_STATUS` as keyof typeof RSC])}</span><span class="system-chip">${t(RSC.AGENT_SHELL_NODE_LABEL)}</span></div></header><section class="session-strip panel"><div><p class="section-kicker">Session / Run / Turn</p><strong>${sessionKey.slice(0, 18)}…</strong></div><div><span>run</span><strong>${runKey.slice(0, 12)}…</strong></div><div><span>turn</span><strong>${turnKey.slice(0, 12)}…</strong></div><div class="session-state"><span class="live-dot online"></span><strong>event-driven · resumable</strong></div></section><main class="workspace"><aside class="rail panel"><div class="panel-heading"><div><p class="section-kicker">${t(RSC.AGENT_CHANNELS_KICKER_TEXT)}</p><h2>${t(RSC.AGENT_CHANNELS_TITLE_TEXT)}</h2></div><span class="count-badge">${subscribed.size}</span></div><p class="panel-copy">${t(RSC.AGENT_CHANNELS_DESCRIPTION_TEXT)}</p><div class="channel-list">${snapshot.channels.map((channel) => `<label class="channel-row"><input type="checkbox" data-channel="${channel}" ${subscribed.has(channel) ? "checked" : ""}/><span class="channel-pulse"></span><span class="channel-name">${channel}</span><span class="channel-count">${snapshot.events.filter((event) => event.channel === channel).length}</span></label>`).join("")}</div><form class="add-channel" data-form="channel"><input name="channel" autocomplete="off" placeholder="${t(RSC.AGENT_CHANNELS_INPUT_PLACEHOLDER)}" aria-label="${t(RSC.AGENT_CHANNELS_INPUT_LABEL)}"/><button class="icon-button" type="submit" aria-label="${t(RSC.AGENT_CHANNELS_ADD_BUTTON)}">+</button></form><div class="rail-footer"><span class="signal-line"></span><span>${t(RSC.AGENT_CHANNELS_LISTENING_STATUS)}</span></div></aside><section class="stream-column"><div class="stream-header"><div><p class="section-kicker">${t(RSC.AGENT_STREAM_KICKER_TEXT)}</p><h2>${t(RSC.AGENT_STREAM_TITLE_TEXT)}</h2></div><div class="stream-stats"><span><strong>${inbound}</strong>${t(RSC.AGENT_STREAM_INBOUND_LABEL)}</span><span><strong>${outbound}</strong>${t(RSC.AGENT_STREAM_OUTBOUND_LABEL)}</span></div></div><div class="timeline panel"><div class="timeline-line" aria-hidden="true"></div>${snapshot.events.length ? snapshot.events.map(renderEvent).join("") : `<div class="empty-state"><span class="empty-orbit">◎</span><h3>${t(RSC.AGENT_STREAM_EMPTY_TITLE)}</h3><p>${t(RSC.AGENT_STREAM_EMPTY_DESCRIPTION)}</p></div>`}</div><div class="timeline-actions"><button class="text-button" data-action="sample">${t(RSC.AGENT_STREAM_SAMPLE_BUTTON)}</button><button class="text-button muted" data-action="clear">${t(RSC.AGENT_STREAM_CLEAR_BUTTON)}</button></div></section><aside class="composer panel"><div class="panel-heading"><div><p class="section-kicker">${t(RSC.AGENT_COMPOSER_KICKER_TEXT)}</p><h2>${t(RSC.AGENT_COMPOSER_TITLE_TEXT)}</h2></div><span class="compose-icon">↗</span></div><p class="panel-copy">${t(RSC.AGENT_COMPOSER_DESCRIPTION_TEXT)}</p><form data-form="event" class="event-form"><label>${t(RSC.AGENT_COMPOSER_TYPE_LABEL)}<select name="eventType">${actionOptions.map((action) => `<option value="${action}">${action}</option>`).join("")}</select></label><label>${t(RSC.AGENT_COMPOSER_CHANNEL_LABEL)}<select name="channel"><option value="agent.requests">agent.requests</option><option value="agent.results">agent.results</option><option value="orders">orders</option><option value="telemetry">telemetry</option></select></label><label>${t(RSC.AGENT_COMPOSER_PAYLOAD_LABEL)}<textarea name="payload" rows="8" aria-label="${t(RSC.AGENT_COMPOSER_PAYLOAD_LABEL)}">${`{\n  "prompt": "Inspect the repository and propose the next safe step",\n  "modelKey": "coding-default",\n  "context": "session checkpoint"\n}`}</textarea></label><div class="form-footer"><span class="key-hint">${t(RSC.AGENT_COMPOSER_KEY_HINT)}</span><button class="primary-button" name="mode" value="local" type="submit">${t(RSC.AGENT_COMPOSER_LOCAL_BUTTON)}</button><button class="secondary-button" name="mode" value="server" type="submit">${t(RSC.AGENT_COMPOSER_SERVER_BUTTON)}</button></div></form></aside></main><footer class="footer-bar"><span>${t(RSC.AGENT_FOOTER_PROTOCOL_LABEL)} <strong>CPS / PGMQ</strong></span><span>${t(RSC.AGENT_FOOTER_POOL_LABEL)} <strong>worker_threads × 8</strong></span><span class="footer-right">${t(RSC.AGENT_FOOTER_RETRY_LABEL)} <strong>transactionKey</strong></span></footer></div>`;
}

function emitFlow(action: string, channel: string, payload: Record<string, unknown>, mode: string): void {
  const transactionKey = id();
  model.addEvent(eventRecord({ transactionKey, channel, eventType: action, direction: "outbound", state: "queued", payload: { ...payload, sessionKey, runKey, turnKey } }));
  if (mode === "server") {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "event", action, payload: { ...payload, sessionKey, runKey, turnKey }, channel, replyChannel: "agent.results", source: "coding-client", transactionKey }));
    else model.addEvent(eventRecord({ transactionKey, channel, eventType: "agent.failed", direction: "inbound", state: "failed", payload: { reason: "websocket unavailable" } }));
    return;
  }
  const steps: Array<[number, string, string, Record<string, unknown>]> = [[260, "iteration.start.request", "processing", { iterationKey: id(), turnKey }], [520, "tool.call.request", "processing", { toolCallKey: id(), name: "repository.inspect", input: payload }], [860, "tool.completed", "delivered", { ok: true, result: "checkpoint ready", worker: "thread-03" }], [1180, "turn.final.response", "delivered", { ok: true, output: "The repository is ready for the next implementation step.", checkpoint: true }]];
  for (const [delay, eventType, state, result] of steps) window.setTimeout(() => model.addEvent(eventRecord({ transactionKey, channel: eventType === "turn.final.response" ? "agent.results" : "agent.requests", eventType, direction: "inbound", state: state as StreamEventRecord["state"], payload: result })), delay);
}

function publishSamples(): void { const samples = [["orders", "order.created", { orderId: "ORD-2048", total: 128 }], ["telemetry", "telemetry.sample", { cpu: 0.42, worker: 3 }], ["notifications", "notification.sent", { recipient: "web-client", template: "ready" }]] as const; samples.forEach(([channel, eventType, payload], index) => { model.addEvent(eventRecord({ channel, eventType, direction: "outbound", state: "delivered", payload })); window.setTimeout(() => model.addEvent(eventRecord({ channel, eventType: `${eventType}.received`, direction: "inbound", state: "delivered", payload: { ...payload, receivedAt: now() } })), 420 + index * 120); }); }

model.subscribe(render); model.setConnection("online"); render();
let socket: WebSocket | undefined;
function connectStream(): void { socket?.close(); const protocol = location.protocol === "https:" ? "wss:" : "ws:"; socket = new WebSocket(`${protocol}//${location.host}/ws`); socket.onopen = () => { model.setConnection("online"); socket?.send(JSON.stringify({ type: "subscribe", channels: model.getSnapshot().subscribedChannels })); }; socket.onerror = () => model.setConnection("offline"); socket.onclose = () => model.setConnection("offline"); socket.onmessage = (message) => { try { const frame = JSON.parse(message.data) as { type: string; event?: { eventId?: string; action?: string; channel: string; transactionKey: string; payload: Record<string, unknown>; createdAt?: string } }; if (frame.type !== "event" || !frame.event) return; const event = frame.event; model.addEvent(eventRecord({ id: event.eventId, transactionKey: event.transactionKey, channel: event.channel, eventType: event.action ?? "agent.event", direction: "inbound", state: "delivered", payload: event.payload, timestamp: event.createdAt ?? now() })); } catch { /* malformed transport frame */ } }; }
connectStream();
app?.addEventListener("change", (event) => { const target = event.target as HTMLInputElement; if (target.matches("[data-channel]")) { model.toggleSubscription(target.dataset.channel ?? ""); connectStream(); } });
app?.addEventListener("submit", (event) => { event.preventDefault(); const form = event.target as HTMLFormElement; if (form.dataset.form === "channel") { model.addChannel(String(new FormData(form).get("channel"))); form.reset(); } if (form.dataset.form === "event") { const data = new FormData(form); let payload: Record<string, unknown>; try { payload = JSON.parse(String(data.get("payload"))); } catch { payload = { raw: String(data.get("payload")) }; } emitFlow(String(data.get("eventType")), String(data.get("channel")), payload, String((event.submitter as HTMLButtonElement)?.value ?? "local")); } });
app?.addEventListener("click", (event) => { const action = (event.target as HTMLElement).dataset.action; if (action === "sample") publishSamples(); if (action === "clear") model.clear(); });
