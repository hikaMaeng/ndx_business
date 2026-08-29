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
    { name: "deploy", description: "how this repository ships", path: "/skills/org/acme/deploy" },
    { name: "test-plan", description: "what a verification record has to contain", path: "/skills/account/u1/test-plan" },
  ];
  const suffix = composeSuffix(skills);

  assert.match(suffix, /- \*\*deploy\*\* — how this repository ships/);
  // Counted in the index half only: the section below it explains how to use
  // one, in prose that is also bulleted, and counting the whole thing would
  // measure the explanation instead of the list.
  const listed = (suffix.split("## Using one")[0] ?? "").split("\n").filter((line) => line.startsWith("- "));
  assert.equal(listed.length, 2);
  assert.equal(composeSuffix([]), "", "no skills is no section, not an empty one");

  // A name is not something you can open. The index exists to get one file
  // read, and without the path that costs a search of a tree with no map.
  assert.ok(suffix.includes("/skills/org/acme/deploy"));
  assert.ok(suffix.includes("/skills/account/u1/test-plan"));

  // No interpreter is named anywhere: what a skill is made of, and how it is
  // run, is written in the skill. A convention stated here would be one more
  // place to disagree with SKILL.md, and the prompt would lose that argument.
  assert.doesNotMatch(suffix, /\bbash \S+\.sh\b|\bnode \S+\.mjs\b|chmod|\+x\b/);
  assert.match(suffix, /SKILL\.md/);
  assert.match(suffix, /working directory is the project/);
  assert.match(suffix, /read-only/);
});

test("the suffix is what changes, so the prefix does not have to", () => {
  // Loading a skill mid-session must not touch a byte of the prefix, or the
  // whole transcript is re-encoded for the sake of one line.
  const before = composePrefix(parts());
  const after = composePrefix(parts());
  assert.equal(before, after);
  assert.notEqual(composeSuffix([{ name: "a", description: "x", path: "/skills/account/u1/a" }]), composeSuffix([]));
});

test("the recipe records what was used, not what was said", () => {
  const skills: SkillEntry[] = [{ name: "deploy", description: "ships", path: "/skills/account/u1/deploy" }];
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
