import assert from "node:assert/strict";
import test from "node:test";
import { adminDatabaseReachable, useAdminDatabase } from "../testing/index.js";
import type { AdminDatabase } from "../database/index.js";
import {
  DEFAULT_GITIGNORE, createProject, deleteProject, listProjects,
  listProjectsByOrganization, readProjectDefault, writeProjectDefault,
} from "./index.js";

const reachable = await adminDatabaseReachable();

/**
 * Fixtures, spoken in the language of the thing under test.
 *
 * Rows go in directly rather than through the auth functions: a project test
 * that broke because signup changed would be reporting the wrong failure.
 */
async function fixtures(database: AdminDatabase) {
  return {
    user: async (id: string, email: string) => {
      await database.query("INSERT INTO users (id, email, password_hash, status, created_at) VALUES ($1, $2, '', 'active', 'now')", [id, email]);
      return id;
    },
    org: async (id: string, parent: string | null) => {
      await database.query("INSERT INTO organizations (id, name, parent_id, created_at) VALUES ($1, $1, $2, 'now')", [id, parent]);
      return id;
    },
    join: async (organizationId: string, userId: string) => {
      await database.query("INSERT INTO organization_members (organization_id, user_id) VALUES ($1, $2)", [organizationId, userId]);
    },
  };
}

test("a project belongs to one account and, optionally, one organization", { skip: reachable ? false : "no PostgreSQL at TEST_DATABASE_URL" }, async (t) => {
  const database = await useAdminDatabase(t);
  const { user, org, join } = await fixtures(database);
  await user("u1", "one@example.com");
  await org("acme", null);
  await join("acme", "u1");

  const personal = await createProject(database, { ownerId: "u1", organizationId: null, name: "sketch" });
  const work = await createProject(database, { ownerId: "u1", organizationId: "acme", name: "billing" });

  assert.equal(personal.organizationId, null, "a personal project runs under nobody's policy");
  assert.equal(work.organizationId, "acme");
  assert.deepEqual((await listProjects(database, "u1")).map((project) => project.name), ["billing", "sketch"]);
});

test("an organization cannot be claimed by an account that is not in it", { skip: reachable ? false : "no PostgreSQL at TEST_DATABASE_URL" }, async (t) => {
  const database = await useAdminDatabase(t);
  const { user, org } = await fixtures(database);
  await user("u1", "one@example.com");
  await org("acme", null);

  // Not a member. Claiming the organization would claim its skills and its
  // permissions, so the check is here and not in the route.
  await assert.rejects(
    () => createProject(database, { ownerId: "u1", organizationId: "acme", name: "billing" }),
    /not a member/,
  );
  assert.deepEqual(await listProjects(database, "u1"), []);
});

test("one account cannot have two projects of the same name, but two accounts can", { skip: reachable ? false : "no PostgreSQL at TEST_DATABASE_URL" }, async (t) => {
  const database = await useAdminDatabase(t);
  const { user } = await fixtures(database);
  await user("u1", "one@example.com");
  await user("u2", "two@example.com");

  await createProject(database, { ownerId: "u1", organizationId: null, name: "shared-name" });
  await assert.rejects(() => createProject(database, { ownerId: "u1", organizationId: null, name: "shared-name" }), /already exists/);

  // Different accounts, different folders — the name only has to be unique
  // within the account that owns it.
  const other = await createProject(database, { ownerId: "u2", organizationId: null, name: "shared-name" });
  assert.equal(other.ownerId, "u2");
});

test("an organization sees the projects of the organizations beneath it", { skip: reachable ? false : "no PostgreSQL at TEST_DATABASE_URL" }, async (t) => {
  const database = await useAdminDatabase(t);
  const { user, org, join } = await fixtures(database);
  await user("boss", "boss@example.com");
  await user("dev", "dev@example.com");
  await org("root", null);
  await org("team", "root");
  await join("root", "boss");
  await join("team", "dev");

  await createProject(database, { ownerId: "boss", organizationId: "root", name: "policy" });
  await createProject(database, { ownerId: "dev", organizationId: "team", name: "feature" });

  // A parent's policy reaches down, so its view has to as well.
  const fromRoot = await listProjectsByOrganization(database, "root");
  assert.deepEqual(fromRoot.map((project) => `${project.ownerEmail}:${project.name}`), ["boss@example.com:policy", "dev@example.com:feature"]);

  // The child sees only its own.
  assert.deepEqual((await listProjectsByOrganization(database, "team")).map((project) => project.name), ["feature"]);
});

test("deleting a project reports whether there was one", { skip: reachable ? false : "no PostgreSQL at TEST_DATABASE_URL" }, async (t) => {
  const database = await useAdminDatabase(t);
  const { user } = await fixtures(database);
  await user("u1", "one@example.com");
  await createProject(database, { ownerId: "u1", organizationId: null, name: "gone" });

  assert.equal(await deleteProject(database, "u1", "gone"), true);
  assert.equal(await deleteProject(database, "u1", "gone"), false, "a second delete is a miss, not a silent success");
});

test("the default gitignore is built in until somebody edits it", { skip: reachable ? false : "no PostgreSQL at TEST_DATABASE_URL" }, async (t) => {
  const database = await useAdminDatabase(t);

  const builtIn = await readProjectDefault(database, "gitignore");
  assert.equal(builtIn.content, DEFAULT_GITIGNORE);
  assert.equal(builtIn.updatedAt, "", "nothing was saved, so there is no save time to report");
  assert.match(builtIn.content, /^!\.env\.example$/m, "the example file is un-ignored, or nobody learns what to set");

  await writeProjectDefault(database, "gitignore", "custom\n");
  assert.equal((await readProjectDefault(database, "gitignore")).content, "custom\n");
});

test("two accounts cannot register the same email in different cases", { skip: reachable ? false : "no PostgreSQL at TEST_DATABASE_URL" }, async (t) => {
  const database = await useAdminDatabase(t);
  const { user } = await fixtures(database);
  await user("u1", "Person@Example.com");

  // `citext` is what makes this one account. Without it these would be two,
  // for one person.
  await assert.rejects(() => user("u2", "person@example.com"), /duplicate key|unique/i);
});
