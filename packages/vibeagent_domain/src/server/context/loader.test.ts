import assert from "node:assert/strict";
import test from "node:test";
import { bundlePath, renderSkillIndex, skillIndex, SKILLS_MOUNT, type ResolvedSkill } from "./loader.js";

const skill = (over: Partial<ResolvedSkill> = {}): ResolvedSkill => ({
  name: "deploy",
  enabled: true,
  value: { description: "how this repository ships" },
  origin: { source: "organization", sourceId: "acme" },
  ...over,
});

test("the path follows the layer that won, not the layer that asked", () => {
  // The admin writes these folders and the tool container reads them. The two
  // sides agreeing is the whole contract; a disagreement is a skill listed as
  // available whose files are not where the agent is sent to look.
  assert.equal(bundlePath("/skills", { source: "organization", sourceId: "acme" }, "deploy"), "/skills/org/acme/deploy");
  assert.equal(bundlePath("/skills", { source: "account", sourceId: "u1" }, "deploy"), "/skills/account/u1/deploy");
  assert.equal(
    bundlePath("/skills", { source: "account-project", sourceId: "u1", projectId: "p1" }, "deploy"),
    "/skills/project/p1/deploy",
    "a project entry is stored by project, and its sourceId is the account",
  );
});

test("a skill whose files cannot be located is left out of the index", () => {
  // Worse than an absent skill: it reads as a capability and behaves as a dead
  // end, and the agent spends a turn discovering that.
  assert.deepEqual(skillIndex([skill({ origin: { source: "account-project", sourceId: "u1" } })]), []);
  assert.deepEqual(skillIndex([skill({ name: "../escape" })]), []);
});

test("disabled and undescribed skills are dropped", () => {
  assert.deepEqual(skillIndex([skill({ enabled: false })]), []);
  assert.deepEqual(skillIndex([skill({ value: {} })]), []);
  assert.deepEqual(skillIndex([skill({ value: { description: "   " } })]), []);
});

test("the index names the file to read and no way to run anything", () => {
  const rendered = renderSkillIndex([
    skill(),
    skill({ name: "release", origin: { source: "account", sourceId: "u1" } }),
  ]);

  assert.ok(rendered.includes("/skills/org/acme/deploy"));
  assert.ok(rendered.includes("/skills/account/u1/release"));
  assert.match(rendered, /SKILL\.md/);

  // What a skill is made of is the skill's business — it may be a shell script,
  // a Rust binary, a Makefile target, or nothing at all. A convention stated
  // here would be a second answer competing with SKILL.md's, and the prompt
  // would be the one that is out of date.
  assert.doesNotMatch(rendered, /\bbash \S+\.sh\b|\bnode \S+\.mjs\b|chmod|executable bit/);
});

test("the mount is the one the compose file gives the tool container", () => {
  assert.equal(SKILLS_MOUNT, "/skills");
});
