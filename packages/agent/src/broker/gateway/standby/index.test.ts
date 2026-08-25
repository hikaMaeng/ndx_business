import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import WebSocket from "ws";
import { createGatewayStandby } from "./index.js";

test("standby Gateway is live but never ready or able to accept ingress", async () => {
  const standby = createGatewayStandby();
  const server = standby.server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${origin}/health`)).status, 200);
    assert.equal((await fetch(`${origin}/ready`)).status, 503);
    assert.equal((await fetch(`${origin}/api/events`, { method: "POST" })).status, 503);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("ownership promotion replaces the standby handler without releasing its bound port", async () => {
  const standby = createGatewayStandby();
  const server = standby.server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  let observerCalls = 0;
  server.on("request", () => { observerCalls += 1; });
  try {
    assert.equal((await fetch(`${origin}/ready`)).status, 503);
    observerCalls = 0;
    standby.activate((_request, response) => { response.writeHead(200); response.end("active"); });
    assert.equal((await fetch(`${origin}/ready`)).status, 200);
    const activeAddress = server.address();
    assert.ok(activeAddress && typeof activeAddress !== "string");
    assert.equal(activeAddress.address, address.address);
    assert.equal(activeAddress.port, address.port);
    assert.equal(observerCalls, 1);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("standby rejects a WebSocket upgrade with an explicit unavailable response", async () => {
  const standby = createGatewayStandby();
  const server = standby.server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const status = await new Promise<number>((resolve, reject) => {
      const websocket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
      websocket.once("unexpected-response", (_request, response) => { resolve(response.statusCode ?? 0); websocket.terminate(); });
      websocket.once("error", reject);
    });
    assert.equal(status, 503);
  } finally {
    server.close();
    await once(server, "close");
  }
});
