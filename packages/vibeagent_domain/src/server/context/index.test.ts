import assert from "node:assert/strict";
import test from "node:test";
import { composePrefix, composeSuffix, describeContext, digest, type ContextParts, type SkillEntry } from "./index.js";

const parts = (over: Partial<ContextParts> = {}): ContextParts => ({
  basePrompt: "You are a coding agent.",
  tools: ["bash"],
  projectPath: "/workspace/u1/work",
  projectName: "work",
  agents: "",
  ...over,
});

test("the prefix puts what every session shares before what only this project does", () => {
  const text = composePrefix(parts({ agents: "Run the tests." }));
  const at = (needle: string) => text.indexOf(needle);

  assert.ok(at("You are a coding agent.") === 0, "the base prompt leads");
  assert.ok(at("# Tools") < at("# Project"), "tools are identical everywhere; the project is not");
  assert.ok(at("# Project") < at("# Project instructions"), "and paths come before the project's own instructions");
});

test("two sessions in one project get a byte-identical prefix", () => {
  // This is the whole point of freezing it: the cache is shared across sessions
  // that share leading tokens, so equal inputs must give equal bytes.
  assert.equal(composePrefix(parts()), composePrefix(parts()));
});

test("two projects share everything up to where they differ", () => {
  const a = composePrefix(parts({ projectName: "alpha", projectPath: "/workspace/u1/alpha" }));
  const b = composePrefix(parts({ projectName: "beta", projectPath: "/workspace/u1/beta" }));

  let shared = 0;
  while (shared < a.length && a[shared] === b[shared]) shared += 1;
  assert.ok(shared > a.indexOf("# Project"), "they diverge no earlier than the project section");
  assert.ok(a.slice(0, shared).includes("# Tools"), "so the base prompt and tool list are shared cache");
});

test("an absent AGENTS.md leaves no heading", () => {
  // An empty heading reads as "there are no instructions" when it means
  // "nobody wrote any", and an agent should not be told the first.
  assert.ok(!composePrefix(parts({ agents: "   " })).includes("# Project instructions"));
  assert.ok(composePrefix(parts({ agents: "x" })).includes("# Project instructions"));
});

test("skills are a one-line index, not their contents", () => {
  const skills: SkillEntry[] = [
    { name: "deploy", description: "how this repository ships" },
    { name: "test-plan", description: "what a verification record has to contain" },
  ];
  const suffix = composeSuffix(skills);

  assert.match(suffix, /- \*\*deploy\*\* — how this repository ships/);
  assert.equal(suffix.split("\n").filter((line) => line.startsWith("- ")).length, 2);
  assert.equal(composeSuffix([]), "", "no skills is no section, not an empty one");
});

test("the suffix is what changes, so the prefix does not have to", () => {
  // Loading a skill mid-session must not touch a byte of the prefix, or the
  // whole transcript is re-encoded for the sake of one line.
  const before = composePrefix(parts());
  const after = composePrefix(parts());
  assert.equal(before, after);
  assert.notEqual(composeSuffix([{ name: "a", description: "x" }]), composeSuffix([]));
});

test("the recipe records what was used, not what was said", () => {
  const skills: SkillEntry[] = [{ name: "deploy", description: "ships" }];
  const recipe = describeContext(parts({ agents: "Run the tests." }), skills, "v1");

  assert.deepEqual(recipe.skills, ["deploy"]);
  assert.equal(recipe.baseVersion, "v1");
  assert.equal(recipe.toolCount, 1);
  assert.match(recipe.agentsDigest, /^[0-9a-f]{8}$/);
  assert.ok(
    !JSON.stringify(recipe).includes("Run the tests."),
    "the instructions are fingerprinted, not copied into the log",
  );
});

test("the digest changes when the instructions do, and only then", () => {
  assert.equal(digest("same"), digest("same"));
  assert.notEqual(digest("one"), digest("two"));
  assert.notEqual(digest(""), digest(" "), "whitespace is a change; the caller decides to trim");
});
