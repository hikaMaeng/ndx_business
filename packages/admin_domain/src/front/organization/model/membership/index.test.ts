import assert from "node:assert/strict";
import test from "node:test";
import type { OrganizationSnapshot } from "../../../../common/protocol/organization/index.js";
import type { UserSummary } from "../../../../common/protocol/auth/index.js";
import { addableAccounts, chosenInferenceModel, heldResponsibility, inheritedInferenceModel, membersOf } from "./index.js";

const account = (id: string, email: string, status: UserSummary["status"] = "active"): UserSummary =>
  ({ id, email, status });

const snapshot = (over: Partial<OrganizationSnapshot> = {}): OrganizationSnapshot => ({
  organizations: [],
  members: [],
  responsibilities: [],
  inferenceModelOptions: [],
  inferenceModels: [],
  access: { isMasterAdmin: false, canCreateRoot: false, nodes: [] },
  ...over,
} as OrganizationSnapshot);

const node = (id: string, parentId: string | null): OrganizationSnapshot["organizations"][number] =>
  ({ id, name: id.toUpperCase(), parentId, color: "blue", icon: "building", createdAt: "now" });

const chose = (organizationId: string, identifier: string): OrganizationSnapshot["inferenceModels"][number] =>
  ({ organizationId, modelId: identifier, endpointId: "e1", endpointName: "one", identifier });

test("nothing is suggested until somebody types", () => {
  const accounts = [account("a", "ann@example.com")];
  assert.deepEqual(addableAccounts(accounts, [], ""), []);
  assert.deepEqual(addableAccounts(accounts, [], "   "), [], "whitespace is not a search");
  assert.equal(addableAccounts(accounts, [], "ann").length, 1);
});

test("an account that cannot be given work is not offered", () => {
  const accounts = [
    account("a", "ann@example.com"),
    account("b", "bob@example.com", "pending"),
    account("c", "cat@example.com", "rejected"),
  ];
  // Offering one leads to a request the server refuses, and a person wondering
  // why the name they were shown does not work.
  assert.deepEqual(addableAccounts(accounts, [], "example").map((one) => one.id), ["a"]);
});

test("somebody already in the node is not offered again", () => {
  const accounts = [account("a", "ann@example.com"), account("b", "bob@example.com")];
  assert.deepEqual(
    addableAccounts(accounts, [{ userId: "a" }], "example").map((one) => one.id),
    ["b"],
  );
});

test("the search is on the address and ignores case", () => {
  const accounts = [account("a", "Ann@Example.com"), account("b", "bob@other.test")];
  assert.deepEqual(addableAccounts(accounts, [], "EXAMPLE").map((one) => one.id), ["a"]);
});

test("the list is capped, because a hundred matches is the same answer scrolled away", () => {
  const accounts = Array.from({ length: 40 }, (_, index) => account(`u${index}`, `user${index}@example.com`));
  assert.equal(addableAccounts(accounts, [], "example").length, 6);
  assert.equal(addableAccounts(accounts, [], "example", 2).length, 2);
});

test("a node's model is its own and nobody else's", () => {
  const state = snapshot({ inferenceModels: [chose("org", "model-of-org")] });
  assert.equal(chosenInferenceModel(state, "org")?.identifier, "model-of-org");
  assert.equal(chosenInferenceModel(state, "other"), undefined);
});

test("a node that chose nothing names the nearest ancestor that did", () => {
  const state = snapshot({
    organizations: [node("a", null), node("b", "a"), node("c", "b")],
    inferenceModels: [chose("a", "model-of-a"), chose("b", "model-of-b")],
  });
  // b is nearer than a, and showing a's model here would tell somebody the
  // wrong thing about the session they are about to start.
  const inherited = inheritedInferenceModel(state, "c");
  assert.equal(inherited?.model.identifier, "model-of-b");
  assert.equal(inherited?.organizationName, "B");

  // A node's own model is not something it inherits, so the walk starts above.
  assert.equal(inheritedInferenceModel(state, "b")?.organizationName, "A");
  assert.equal(inheritedInferenceModel(state, "a"), undefined, "a root inherits from nobody");
});

test("nothing anywhere up the chain is the deployment default, and not this screen's to name", () => {
  const state = snapshot({ organizations: [node("a", null), node("b", "a")] });
  assert.equal(inheritedInferenceModel(state, "b"), undefined);
});

test("a parent link that points back into its own chain stops rather than spins", () => {
  // The data should never contain one; looping forever is a worse way to find
  // that out than rendering nothing.
  const state = snapshot({ organizations: [node("a", "b"), node("b", "a")] });
  assert.equal(inheritedInferenceModel(state, "a"), undefined);
});

test("the held scope is what a toggle has to know before it acts", () => {
  const state = snapshot({
    responsibilities: [
      { organizationId: "org", userId: "a", scope: "subtree", email: "ann@example.com" },
      { organizationId: "other", userId: "b", scope: "node", email: "bob@example.com" },
    ],
  });
  assert.equal(heldResponsibility(state, "org", "a"), "subtree");
  assert.equal(heldResponsibility(state, "org", "b"), undefined, "another node's grant is not this one's");
  assert.equal(heldResponsibility(state, "org", "nobody"), undefined);
});

test("members are read per node", () => {
  const state = snapshot({
    members: [
      { organizationId: "org", userId: "a", email: "ann@example.com" },
      { organizationId: "other", userId: "b", email: "bob@example.com" },
    ],
  });
  assert.deepEqual(membersOf(state, "org").map((one) => one.userId), ["a"]);
});
