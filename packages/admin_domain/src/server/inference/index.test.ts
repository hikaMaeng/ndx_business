import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openAdminDatabase, ensureAdminSchema, queries, type AdminDatabase } from "../database/index.js";
import {
  clearOrganizationInferenceModel,
  setOrganizationInferenceModel,
} from "../organizations/index.js";
import { defaultInference, resolveInference } from "./index.js";

/**
 * These run against a real PostgreSQL, because the whole answer is a recursive
 * walk up a table and a partial unique index. A stub would be a second
 * implementation of the thing under test.
 */
const url = process.env.ADMIN_TEST_DATABASE_URL ?? process.env.ADMIN_DATABASE_URL ?? "";
const describe = url ? test : test.skip;

async function fixture(t: { after: (fn: () => Promise<void> | void) => void }): Promise<{ database: AdminDatabase; endpoint: string; schema: string }> {
  const schema = `inference_test_${randomUUID().replace(/-/g, "")}`;
  const database = openAdminDatabase(url, 4, schema);
  // Registered before anything that can throw. A fixture that fails halfway
  // still owns a schema, and a test suite that leaks one per failure turns a
  // bad afternoon into a database nobody wants to look at.
  t.after(async () => {
    await database.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await database.end().catch(() => {});
  });
  await ensureAdminSchema(database, schema);
  const ask = queries(database);
  const endpoint = randomUUID();
  await ask.run(
    "INSERT INTO model_endpoints (id, name, url, header_name, header_value, api_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    endpoint, "test", "http://127.0.0.1:1/v1", "", "", "openai-chat-completion", "now", "now",
  );
  return { database, endpoint, schema };
}

const addModel = async (database: AdminDatabase, endpoint: string, identifier: string, isDefault = false) => {
  const id = randomUUID();
  await queries(database).run(
    "INSERT INTO model_definitions (id, endpoint_id, identifier, context_size, temperature, min_p, top_p, top_k, repeat_penalty, reasoning, supports_text, supports_image, supports_sound, supports_video, is_default, created_at, updated_at)"
    + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, endpoint, identifier, 131072, 0.3, 0, 0.9, 20, 1.05, 1, 1, 1, 0, 0, isDefault ? 1 : 0, "now", "now",
  );
  return id;
};

const addOrg = async (database: AdminDatabase, name: string, parent: string | null) => {
  const id = randomUUID();
  await queries(database).run(
    "INSERT INTO organizations (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)",
    id, name, parent, "now",
  );
  return id;
};

/**
 * Writes the row by hand rather than through `setOrganizationInferenceModel`,
 * so what the index refuses is tested and not what the domain function chooses
 * to delete first.
 */
const attach = async (database: AdminDatabase, organization: string, endpoint: string, model: string, active = true) => {
  const ask = queries(database);
  await ask.run("INSERT INTO organization_inference_services (organization_id, endpoint_id) VALUES (?, ?) ON CONFLICT DO NOTHING", organization, endpoint);
  await ask.run("INSERT INTO organization_inference_models (organization_id, endpoint_id, model_id, active) VALUES (?, ?, ?, ?)", organization, endpoint, model, active ? 1 : 0);
};

describe("an account in no organisation gets the deployment default", async (t) => {
  const { database, endpoint } = await fixture(t);

  await addModel(database, endpoint, "fallback-model", true);
  const resolved = await resolveInference(database, null);
  assert.equal(resolved?.model, "fallback-model");
  // Null rather than an invented organisation, because "nobody chose this, it
  // is what the deployment falls back to" is a different fact from "an
  // organisation chose it" and the two are asked apart when something surprises.
  assert.equal(resolved?.organizationId, null);
});

describe("the nearest ancestor with a model wins", async (t) => {
  const { database, endpoint } = await fixture(t);

  await addModel(database, endpoint, "fallback-model", true);
  const b = await addModel(database, endpoint, "model-of-b");
  const a = await addOrg(database, "a", null);
  const bOrg = await addOrg(database, "b", a);
  const c = await addOrg(database, "c", bOrg);
  await attach(database, bOrg, endpoint, b);

  // The project runs under c, c has nothing, b does. b answers — and the walk
  // must not continue past it to a or to the default.
  const resolved = await resolveInference(database, c);
  assert.equal(resolved?.model, "model-of-b");
  assert.equal(resolved?.organizationId, bOrg);
});

describe("a child's own model beats its parent's", async (t) => {
  const { database, endpoint } = await fixture(t);

  await addModel(database, endpoint, "fallback-model", true);
  const parentModel = await addModel(database, endpoint, "model-of-a");
  const childModel = await addModel(database, endpoint, "model-of-c");
  const a = await addOrg(database, "a", null);
  const c = await addOrg(database, "c", a);
  await attach(database, a, endpoint, parentModel);
  await attach(database, c, endpoint, childModel);

  // Otherwise a parent's choice would be a ceiling rather than a default, and
  // no sub-organisation could ever run anything of its own.
  assert.equal((await resolveInference(database, c))?.model, "model-of-c");
  assert.equal((await resolveInference(database, a))?.model, "model-of-a");
});

describe("a chain with nothing configured falls back to the default", async (t) => {
  const { database, endpoint } = await fixture(t);

  await addModel(database, endpoint, "fallback-model", true);
  const a = await addOrg(database, "a", null);
  const b = await addOrg(database, "b", a);
  const c = await addOrg(database, "c", b);

  const resolved = await resolveInference(database, c);
  assert.equal(resolved?.model, "fallback-model");
  assert.equal(resolved?.organizationId, null);
});

describe("a model switched off is not a model, and does not stop the search", async (t) => {
  const { database, endpoint } = await fixture(t);

  await addModel(database, endpoint, "fallback-model", true);
  const aModel = await addModel(database, endpoint, "model-of-a");
  const cModel = await addModel(database, endpoint, "model-of-c");
  const a = await addOrg(database, "a", null);
  const c = await addOrg(database, "c", a);
  await attach(database, a, endpoint, aModel);
  await attach(database, c, endpoint, cModel, false);

  // Switching a model off is how somebody says "not this one". Reading it as
  // "nothing above this either" would let one disabled row cut a whole subtree
  // off from its parent's choice.
  const resolved = await resolveInference(database, c);
  assert.equal(resolved?.model, "model-of-a");
  assert.equal(resolved?.organizationId, a);
});

describe("an organisation cannot hold a second active model", async (t) => {
  const { database, endpoint } = await fixture(t);

  const first = await addModel(database, endpoint, "first");
  const second = await addModel(database, endpoint, "second");
  const a = await addOrg(database, "a", null);
  await attach(database, a, endpoint, first);

  // Refused by the index, not by whoever writes next. Two active rows are an
  // organisation with a preference nothing recorded, and the resolver would go
  // back to breaking the tie on identifier order — a choice nobody made.
  await assert.rejects(() => attach(database, a, endpoint, second));
  // Inactive is not a claim on the one slot, so the record of what an
  // organisation used to have attached survives the constraint.
  await attach(database, a, endpoint, second, false);
  assert.equal((await resolveInference(database, a))?.model, "first");
});

describe("a deployment that already had two keeps the one it was running", async (t) => {
  const { database, endpoint, schema } = await fixture(t);
  const ask = queries(database);

  // Where a running deployment stood before this shipped: no index, so two
  // active rows were possible. Dropping it reproduces that database rather than
  // keeping a second copy of the old DDL around to drift from the real one.
  await ask.run("DROP INDEX idx_organization_inference_models_single");
  const alpha = await addModel(database, endpoint, "alpha");
  const zeta = await addModel(database, endpoint, "zeta");
  const a = await addOrg(database, "a", null);
  await attach(database, a, endpoint, zeta);
  await attach(database, a, endpoint, alpha);

  // Startup migrates. Creating the index over two active rows fails outright,
  // so the surplus has to be deactivated first or a live deployment never
  // finishes starting.
  await ensureAdminSchema(database, schema);

  // `alpha` is what the old `ORDER BY d.identifier` would have resolved to, so
  // nothing changes model underneath a session that was already running.
  assert.equal((await resolveInference(database, a))?.model, "alpha");
  // Deactivated rather than deleted, so somebody can still see what the
  // organisation used to have attached.
  assert.equal(
    (await ask.get("SELECT active FROM organization_inference_models WHERE organization_id = ? AND model_id = ?", a, zeta))?.active,
    0,
  );
});

describe("setting a model replaces the one before it", async (t) => {
  const { database, endpoint } = await fixture(t);

  const first = await addModel(database, endpoint, "first");
  const second = await addModel(database, endpoint, "second");
  const a = await addOrg(database, "a", null);
  await setOrganizationInferenceModel(database, "actor", true, a, { modelId: first });
  await setOrganizationInferenceModel(database, "actor", true, a, { modelId: second });

  // Beside rather than instead would trip the index on the second write, so
  // this also proves the replacement is what makes the screen usable at all.
  assert.equal((await resolveInference(database, a))?.model, "second");

  await clearOrganizationInferenceModel(database, "actor", true, a);
  assert.equal(await resolveInference(database, a), null, "cleared means inheriting again");
  // Clearing what is already clear is the state being asked for, not an error.
  await clearOrganizationInferenceModel(database, "actor", true, a);
});

describe("only one model can be the default", async (t) => {
  const { database, endpoint } = await fixture(t);

  await addModel(database, endpoint, "first", true);
  // Enforced by the index rather than by whoever writes next. Two rows claiming
  // it would make "the default" a question about row order.
  await assert.rejects(() => addModel(database, endpoint, "second", true));
  assert.equal((await defaultInference(database))?.model, "first");
});

describe("no default and no organisation is an answer of none", async (t) => {
  const { database } = await fixture(t);

  // Null rather than a guess. A deployment with nothing configured should say
  // so at the point of asking, not start a session that fails at the first
  // model call with a message about HTTP.
  assert.equal(await resolveInference(database, null), null);
  assert.equal(await defaultInference(database), null);
});
