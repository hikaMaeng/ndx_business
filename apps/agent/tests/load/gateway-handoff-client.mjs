import WebSocket from "ws";

const channel = process.argv[2];
const baseUrl = process.env.AGENT_URL ?? "ws://127.0.0.1:18081/ws";
if (!channel) throw new Error("usage: node gateway-handoff-client.mjs <channel>");

const websocket = new WebSocket(baseUrl);
websocket.on("message", (raw) => {
  const frame = JSON.parse(String(raw));
  if (frame.type === "ready") websocket.send(JSON.stringify({ type: "subscribe", channels: [channel] }));
  if (frame.type === "subscribed") console.log("SUBSCRIBED");
});
websocket.on("close", () => { console.log("CLOSED"); process.exit(0); });
setTimeout(() => process.exit(2), 45_000);
