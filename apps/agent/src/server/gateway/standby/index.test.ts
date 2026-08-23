import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { activateGatewayStandby, createGatewayStandby } from "./index.js";

test("standby Gateway is live but never ready or able to accept ingress", async () => {
  const server = createGatewayStandby().listen(0, "127.0.0.1");
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
  const server = createGatewayStandby().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${origin}/ready`)).status, 503);
    activateGatewayStandby(server, (_request, response) => { response.writeHead(200); response.end("active"); });
    assert.equal((await fetch(`${origin}/ready`)).status, 200);
    const activeAddress = server.address();
    assert.ok(activeAddress && typeof activeAddress !== "string");
    assert.equal(activeAddress.address, address.address);
    assert.equal(activeAddress.port, address.port);
  } finally {
    server.close();
    await once(server, "close");
  }
});
