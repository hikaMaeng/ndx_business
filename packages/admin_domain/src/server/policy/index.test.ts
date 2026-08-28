import assert from "node:assert/strict";
import test from "node:test";
import { adminDatabaseReachable, useAdminDatabase } from "../testing/index.js";
import type { AdminDatabase } from "../database/index.js";
import { createProject } from "../projects/index.js";
import { clearPolicy, policyChain, resolvePolicy, setPolicy } from "./index.js";

const reachable = await adminDatabaseReachable();
const needs = { skip: reachable ? false : "no PostgreSQL at TEST_DATABASE_URL" };

/**
 * A root, a team beneath it, an account in the team, and a project.
 *
 * Every test here is about which of those decided something, so they all need
 * the same shape and it is built once.
 */
async function world(t: { after: (fn: () => void | Promise<void>) => void }) {
  const database: AdminDatabase = await useAdminDatabase(t);
  const q = (text: string, params: unknown[] = []) => database.query(text, params);
  await q("INSERT INTO users (id, email, password_hash, status, created_at) VALUES ('u1', 'dev@example.com', '', 'active', 'now')");
  await q("INSERT INTO organizations (id, name, parent_id, created_at) VALUES ('root', 'root', NULL, 'now')");
  await q("INSERT INTO organizations (id, name, parent_id, created_at) VALUES ('team', 'team', 'root', 'now')");
  await q("INSERT INTO organization_members (organization_id, user_id) VALUES ('team', 'u1')");
  const project = await createProject(database, { ownerId: "u1", organizationId: "team", name: "work" });
  const resolve = () => resolvePolicy(database, { ownerId: "u1", organizationId: "team", projectId: project.id, kind: "skill" });
  return { database, project, resolve };
}

test("the chain is the organisations whose policy reaches a project, nearest first", needs, async (t) => {
  const { database } = await world(t);
  assert.deepEqual(await policyChain(database, "team"), ["team", "root"]);
  assert.deepEqual(await policyChain(database, "root"), ["root"]);
  assert.deepEqual(await policyChain(database, null), [], "a personal project answers to no organisation");
});

test("a default is refined by the nearer layer", needs, async (t) => {
  const { database, project, resolve } = await world(t);

  await setPolicy(database, { kind: "skill", name: "deploy", organizationId: "root", value: { from: "root" } });
  assert.equal((await resolve())[0]!.value.from, "root");

  await setPolicy(database, { kind: "skill", name: "deploy", organizationId: "team", value: { from: "team" } });
  assert.equal((await resolve())[0]!.value.from, "team", "the nearer organisation refines its parent");

  await setPolicy(database, { kind: "skill", name: "deploy", ownerId: "u1", value: { from: "account" } });
  assert.equal((await resolve())[0]!.value.from, "account", "an account refines the organisation's suggestion");

  await setPolicy(database, { kind: "skill", name: "deploy", ownerId: "u1", projectId: project.id, value: { from: "project" } });
  const winner = (await resolve())[0]!;
  assert.equal(winner.value.from, "project", "and this project refines the account");
  assert.equal(winner.origin.source, "account-project");
  assert.equal(winner.shadowed.length, 3, "the three it beat are still reported");
});

test("an enforced entry beats every account layer", needs, async (t) => {
  const { database, project, resolve } = await world(t);

  await setPolicy(database, { kind: "skill", name: "audit", ownerId: "u1", projectId: project.id, value: { from: "project" } });
  await setPolicy(database, { kind: "skill", name: "audit", ownerId: "u1", value: { from: "account" } });
  assert.equal((await resolve())[0]!.value.from, "project");

  // The organisation binds it. Nothing below can take it back.
  await setPolicy(database, { kind: "skill", name: "audit", organizationId: "team", mode: "enforced", value: { from: "team" } });
  const bound = (await resolve())[0]!;
  assert.equal(bound.value.from, "team");
  assert.equal(bound.origin.mode, "enforced");
  assert.equal(bound.origin.source, "organization");
});

test("between organisations, the outermost enforcement wins", needs, async (t) => {
  const { database, resolve } = await world(t);

  await setPolicy(database, { kind: "skill", name: "secrets", organizationId: "team", mode: "enforced", value: { from: "team" } });
  assert.equal((await resolve())[0]!.value.from, "team");

  // The parent's enforcement reaches down and the child cannot loosen it. This
  // is the opposite direction from defaults, on purpose.
  await setPolicy(database, { kind: "skill", name: "secrets", organizationId: "root", mode: "enforced", value: { from: "root" } });
  const bound = (await resolve())[0]!;
  assert.equal(bound.value.from, "root", "the root binds the whole tree");
  assert.equal(bound.origin.distance, 1, "and the distance says how far up it came from");
});

test("a root default does not freeze the sub-organisation", needs, async (t) => {
  const { database, resolve } = await world(t);

  // The failure this guards: reading "the parent overrides the child" as one
  // precedence makes every key the root touches unchangeable below it, and the
  // sub-organisation's settings screen stops meaning anything.
  await setPolicy(database, { kind: "skill", name: "format", organizationId: "root", value: { from: "root" } });
  await setPolicy(database, { kind: "skill", name: "format", organizationId: "team", value: { from: "team" } });
  assert.equal((await resolve())[0]!.value.from, "team");
});

test("only an organisation can enforce", needs, async (t) => {
  const { database, project } = await world(t);
  await assert.rejects(
    () => setPolicy(database, { kind: "skill", name: "x", ownerId: "u1", mode: "enforced" }),
    /only an organization can enforce/,
  );
  await assert.rejects(
    () => setPolicy(database, { kind: "skill", name: "x", ownerId: "u1", projectId: project.id, mode: "enforced" }),
    /only an organization can enforce/,
  );
});

test("an entry belongs to one place", needs, async (t) => {
  const { database } = await world(t);
  await assert.rejects(
    () => setPolicy(database, { kind: "skill", name: "x", organizationId: "team", ownerId: "u1" }),
    /not both and not neither/,
  );
  await assert.rejects(() => setPolicy(database, { kind: "skill", name: "x" }), /not both and not neither/);
});

test("a personal project answers only to its account", needs, async (t) => {
  const { database } = await world(t);
  const personal = await createProject(database, { ownerId: "u1", organizationId: null, name: "sketch" });

  await setPolicy(database, { kind: "skill", name: "audit", organizationId: "root", mode: "enforced", value: { from: "root" } });
  await setPolicy(database, { kind: "skill", name: "audit", ownerId: "u1", value: { from: "account" } });

  const resolved = await resolvePolicy(database, { ownerId: "u1", organizationId: null, projectId: personal.id, kind: "skill" });
  assert.equal(resolved[0]!.value.from, "account", "no organisation binds a project that runs under none");
});

test("disabling is a decision, and cascades like any other", needs, async (t) => {
  const { database, project, resolve } = await world(t);

  await setPolicy(database, { kind: "skill", name: "risky", organizationId: "root", mode: "enforced", enabled: false });
  await setPolicy(database, { kind: "skill", name: "risky", ownerId: "u1", projectId: project.id, enabled: true });

  const resolved = (await resolve())[0]!;
  assert.equal(resolved.enabled, false, "an account cannot switch on what the root switched off");
  assert.equal(resolved.shadowed[0]!.source, "account-project");
});

test("clearing an entry removes only that place's", needs, async (t) => {
  const { database, resolve } = await world(t);
  await setPolicy(database, { kind: "skill", name: "deploy", organizationId: "root", value: { from: "root" } });
  await setPolicy(database, { kind: "skill", name: "deploy", organizationId: "team", value: { from: "team" } });

  assert.equal(await clearPolicy(database, { kind: "skill", name: "deploy", organizationId: "team" }), true);
  assert.equal((await resolve())[0]!.value.from, "root", "the parent's is still there");
  assert.equal(await clearPolicy(database, { kind: "skill", name: "deploy", organizationId: "team" }), false, "a second clear is a miss");
});

test("kinds do not collide, and one kind can be asked for alone", needs, async (t) => {
  const { database, project } = await world(t);
  await setPolicy(database, { kind: "skill", name: "same-name", ownerId: "u1", value: { which: "skill" } });
  await setPolicy(database, { kind: "hook", name: "same-name", ownerId: "u1", value: { which: "hook" } });

  const all = await resolvePolicy(database, { ownerId: "u1", organizationId: "team", projectId: project.id });
  assert.deepEqual(all.map((entry) => `${entry.kind}:${entry.name}`), ["hook:same-name", "skill:same-name"]);

  const skills = await resolvePolicy(database, { ownerId: "u1", organizationId: "team", projectId: project.id, kind: "skill" });
  assert.deepEqual(skills.map((entry) => entry.value.which), ["skill"]);
});
