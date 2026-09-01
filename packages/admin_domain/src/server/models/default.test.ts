import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openAdminDatabase, ensureAdminSchema, queries, type AdminDatabase } from "../database/index.js";
import { createModelDefinition, listModelCatalog, setModelDefault } from "./index.js";

/**
 * Against a real PostgreSQL, because what is being tested is a partial unique
 * index and a transaction that has to step around it. A stub would have to
 * reimplement `idx_model_definitions_default` to be worth anything, and then it
 * would be the stub that was under test.
 */
const url = process.env.ADMIN_TEST_DATABASE_URL ?? process.env.ADMIN_DATABASE_URL ?? "";
const describe = url ? test : test.skip;

async function fixture(t: { after: (fn: () => Promise<void> | void) => void }): Promise<{ database: AdminDatabase; endpoint: string }> {
  const schema = `model_default_test_${randomUUID().replace(/-/g, "")}`;
  const database = openAdminDatabase(url, 4, schema);
  // Registered before anything that can throw, so a fixture that fails halfway
  // still drops the schema it created rather than leaving one behind per
  // failing run.
  t.after(async () => {
    await database.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await database.end().catch(() => {});
  });
  await ensureAdminSchema(database, schema);
  const endpoint = randomUUID();
  await queries(database).run(
    "INSERT INTO model_endpoints (id, name, url, header_name, header_value, api_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    endpoint, "test", "http://127.0.0.1:1/v1", "", "", "openai-chat-completion", "now", "now",
  );
  return { database, endpoint };
}

async function addModel(database: AdminDatabase, endpoint: string, identifier: string): Promise<string> {
  const catalog = await createModelDefinition(database, endpoint, {
    identifier, contextSize: 131072, temperature: 0.3, minP: 0, topP: 0.9, topK: 20, repeatPenalty: 1.05,
    reasoning: false, supportsText: true, supportsImage: false, supportsSound: false, supportsVideo: false,
  });
  return catalog.models.find((item) => item.identifier === identifier)!.id;
}

const holders = (models: Array<{ id: string; isDefault: boolean }>): string[] =>
  models.filter((item) => item.isDefault).map((item) => item.id);

describe("a registered model does not become the default on its own", async (t) => {
  const { database, endpoint } = await fixture(t);

  await addModel(database, endpoint, "first-model");
  const catalog = await addModel(database, endpoint, "second-model").then(() => listModelCatalog(database));

  // Registering the first model of a fresh install is not the same act as
  // choosing what the deployment falls back to, and conflating them would make
  // the choice depend on insertion order.
  assert.deepEqual(holders(catalog.models), []);
});

describe("setting a default moves it off the previous holder", async (t) => {
  const { database, endpoint } = await fixture(t);

  const first = await addModel(database, endpoint, "first-model");
  const second = await addModel(database, endpoint, "second-model");

  assert.deepEqual(holders((await setModelDefault(database, endpoint, first, { isDefault: true })).models), [first]);

  // The point of the transaction: the second set has to clear the first row and
  // write the second, and `idx_model_definitions_default` would reject the write
  // outright if both were ever 1 at the end of a statement.
  const moved = await setModelDefault(database, endpoint, second, { isDefault: true });
  assert.deepEqual(holders(moved.models), [second]);
});

describe("setting the default on the model that already holds it changes nothing", async (t) => {
  const { database, endpoint } = await fixture(t);

  const only = await addModel(database, endpoint, "only-model");
  await setModelDefault(database, endpoint, only, { isDefault: true });

  // The clear excludes the target, so the row it is about to set is never taken
  // away from itself first — a repeated press must not be able to leave the
  // deployment briefly without a default.
  assert.deepEqual(holders((await setModelDefault(database, endpoint, only, { isDefault: true })).models), [only]);
});

describe("clearing leaves no default at all", async (t) => {
  const { database, endpoint } = await fixture(t);

  const only = await addModel(database, endpoint, "only-model");
  await setModelDefault(database, endpoint, only, { isDefault: true });

  // Nothing takes its place. A deployment can be left with no default — the
  // screen says what that costs — and the index has to tolerate zero holders
  // just as it tolerates one.
  assert.deepEqual(holders((await setModelDefault(database, endpoint, only, { isDefault: false })).models), []);
});

describe("a model id from another endpoint is refused without touching the default", async (t) => {
  const { database, endpoint } = await fixture(t);

  const holder = await addModel(database, endpoint, "holder-model");
  await setModelDefault(database, endpoint, holder, { isDefault: true });

  // A request naming a model that does not belong to the endpoint it claims
  // must roll back rather than clear the current holder on its way to failing.
  await assert.rejects(
    setModelDefault(database, randomUUID(), holder, { isDefault: true }),
    /Unknown endpoint model/,
  );
  assert.deepEqual(holders((await listModelCatalog(database)).models), [holder]);
});
