import assert from "node:assert/strict";
import test from "node:test";
import { composeSuffix } from "./index.js";
import { skillIndex, type ResolvedSkill } from "./loader.js";
import { mcpSessionData, resolveMcpBindings, type ResolvedMcp } from "./mcp.js";

const skill = (name: string, mcp: string, over: Partial<ResolvedSkill> = {}): ResolvedSkill => ({
  name,
  enabled: true,
  value: { description: `${name} does something`, mcp },
  origin: { source: "organization", sourceId: "acme" },
  ...over,
});

const stdio = (name: string, over: Partial<ResolvedMcp> = {}): ResolvedMcp => ({
  name,
  enabled: true,
  value: { transport: "stdio", command: "npx", args: "-y server" },
  ...over,
});

test("a skill binds the servers it declares", () => {
  const resolution = resolveMcpBindings(
    [skill("deploy", "tickets, logs")],
    [stdio("tickets"), stdio("logs"), stdio("unused")],
  );

  assert.deepEqual(resolution.bindings.map((one) => one.name), ["tickets", "logs"]);
  // An entry nothing declares is configured and unreachable, which is a fine
  // thing to be — not an error and not a problem to report.
  assert.deepEqual(resolution.problems, []);
});

test("one server named by two skills is one server", () => {
  const resolution = resolveMcpBindings(
    [skill("deploy", "tickets"), skill("release", "tickets")],
    [stdio("tickets")],
  );

  // Connecting twice would give the process two sessions, and the session two
  // answers to the same question.
  assert.equal(resolution.bindings.length, 1);
  assert.deepEqual(Object.keys(mcpSessionData(resolution)), ["tickets"]);
});

test("what could not be bound is recorded, with the reason", () => {
  const resolution = resolveMcpBindings(
    [skill("deploy", "missing, off, broken, fine")],
    [
      stdio("off", { enabled: false }),
      // A transport with no command: an entry somebody stopped halfway through.
      stdio("broken", { value: { transport: "stdio" } }),
      stdio("fine"),
    ],
  );

  assert.deepEqual(resolution.bindings.map((one) => one.name), ["fine"]);
  // "The skill did nothing" is the same symptom for all three, so the reason
  // has to survive to somewhere a person can read it.
  assert.deepEqual(resolution.problems, [
    { skill: "deploy", name: "missing", reason: "unknown" },
    { skill: "deploy", name: "off", reason: "disabled" },
    { skill: "deploy", name: "broken", reason: "unusable" },
  ]);
});

test("one skill's broken binding does not stop the others", () => {
  const resolution = resolveMcpBindings(
    [skill("deploy", "missing"), skill("release", "fine")],
    [stdio("fine")],
  );

  assert.deepEqual(resolution.bindings.map((one) => one.name), ["fine"]);
  assert.equal(resolution.problems.length, 1);
});

test("a disabled skill binds nothing", () => {
  const resolution = resolveMcpBindings([skill("deploy", "tickets", { enabled: false })], [stdio("tickets")]);
  assert.deepEqual(resolution.bindings, []);
  assert.deepEqual(resolution.problems, [], "a skill nobody gets has no unmet needs");
});

test("a skill declaring nothing binds nothing", () => {
  const bare: ResolvedSkill = { ...skill("deploy", ""), value: { description: "x" } };
  assert.deepEqual(resolveMcpBindings([bare], [stdio("tickets")]).bindings, []);
});

test("MCP servers never reach the prompt", () => {
  const skills = [skill("deploy", "tickets")];
  const resolution = resolveMcpBindings(skills, [
    stdio("tickets", { value: { transport: "sse", url: "https://mcp.example.com/sse", headers: "Authorization=Bearer secret" } }),
  ]);
  const suffix = composeSuffix(skillIndex(skills));

  // The whole point of wrapping MCP in a skill: the session is shown skills. A
  // server listed beside the skill that wraps it would show one capability
  // under two names — and this one carries a credential besides.
  assert.ok(suffix.includes("deploy"));
  assert.ok(!suffix.includes("tickets"));
  assert.ok(!suffix.includes("mcp.example.com"));
  assert.ok(!suffix.includes("secret"));
  assert.ok(!suffix.toLowerCase().includes("transport"));

  // It is session data instead: read by the tool side when a skill asks.
  assert.deepEqual(Object.keys(mcpSessionData(resolution)), ["tickets"]);
});
