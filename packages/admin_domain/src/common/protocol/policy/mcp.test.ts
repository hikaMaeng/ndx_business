import assert from "node:assert/strict";
import test from "node:test";
import { POLICY_VARIANTS, parseMcpServer, parsePairs, splitList } from "./index.js";

test("a stdio server needs a command", () => {
  assert.deepEqual(
    parseMcpServer({ transport: "stdio", command: "npx", args: "-y @scope/server --port 3000" }),
    { transport: "stdio", command: "npx", args: ["-y", "@scope/server", "--port", "3000"], env: {} },
  );

  // Refused rather than filled in. An entry with no command is not a server
  // waiting on something else; it is one somebody stopped halfway through, and
  // a plausible default would move the failure to the connection, where the
  // reason is gone.
  assert.equal(parseMcpServer({ transport: "stdio", command: "   " }), null);
  assert.equal(parseMcpServer({ transport: "stdio" }), null);
});

test("an sse server needs a url, and a safe one", () => {
  assert.deepEqual(
    parseMcpServer({ transport: "sse", url: "https://mcp.example.com/sse", headers: "Authorization=Bearer x" }),
    { transport: "sse", url: "https://mcp.example.com/sse", headers: { Authorization: "Bearer x" } },
  );

  // An MCP server is handed whatever the session can reach. Sending that over
  // plain http is not a decision to make by leaving a field as typed.
  assert.equal(parseMcpServer({ transport: "sse", url: "http://mcp.example.com/sse" }), null);
  assert.equal(parseMcpServer({ transport: "sse", url: "not a url" }), null);
  assert.equal(parseMcpServer({ transport: "sse" }), null);

  // Localhost is the exception, because there is no network to listen on.
  assert.ok(parseMcpServer({ transport: "sse", url: "http://localhost:3000/sse" }));
  assert.ok(parseMcpServer({ transport: "sse", url: "http://127.0.0.1:3000/sse" }));
});

test("a transport that is not one of the two is refused", () => {
  assert.equal(parseMcpServer({ transport: "websocket", url: "https://x.example.com" }), null);
  assert.equal(parseMcpServer({ command: "npx" }), null, "no transport is not stdio by default");
  assert.equal(parseMcpServer(null), null);
});

test("a stdio entry's url and an sse entry's command are simply not read", () => {
  // The form only sends the chosen variant's fields, but a stored entry may
  // still carry leftovers from an older shape. What is read is decided by the
  // transport, so a leftover cannot quietly change what the entry means.
  const stdio = parseMcpServer({ transport: "stdio", command: "npx", url: "https://elsewhere.example.com" });
  assert.deepEqual(stdio, { transport: "stdio", command: "npx", args: [], env: {} });
});

test("lists and pairs read the way a person types them", () => {
  assert.deepEqual(splitList("a  b,c\nd"), ["a", "b", "c", "d"]);
  assert.deepEqual(splitList(""), []);
  assert.deepEqual(splitList(undefined), []);

  assert.deepEqual(parsePairs("A=1\nB = two words \n\nnot a pair\n=novalue"), { A: "1", B: "two words" });
  assert.deepEqual(parsePairs("URL=https://x/?a=b"), { URL: "https://x/?a=b" }, "only the first = splits");
});

test("the transports are declared, so a form needs no code to render them", () => {
  const variant = POLICY_VARIANTS.mcp;
  assert.ok(variant);
  assert.equal(variant.field, "transport");
  assert.deepEqual(Object.keys(variant.options), ["stdio", "sse"]);
  // Nothing shared between them but what the kind itself carries: a command
  // means nothing to an SSE server, and a URL means nothing to a process.
  const overlap = variant.options.stdio.filter((field) => variant.options.sse.includes(field));
  assert.deepEqual(overlap, []);
});
