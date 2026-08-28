import assert from "node:assert/strict";
import test from "node:test";
import type { OrganizationSnapshot } from "../../../../common/protocol/organization/index.js";
import type { UserSummary } from "../../../../common/protocol/auth/index.js";
import { addableAccounts, heldResponsibility, membersOf, unattachedInferenceServices } from "./index.js";

const account = (id: string, email: string, status: UserSummary["status"] = "active"): UserSummary =>
  ({ id, email, status });

const snapshot = (over: Partial<OrganizationSnapshot> = {}): OrganizationSnapshot => ({
  organizations: [],
  members: [],
  responsibilities: [],
  inferenceServiceOptions: [],
  inferenceServices: [],
  access: { isMasterAdmin: false, canCreateRoot: false, nodes: [] },
  ...over,
} as OrganizationSnapshot);

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

test("only the services this node has not attached are offered", () => {
  const state = snapshot({
    inferenceServiceOptions: [{ endpointId: "e1", name: "one" }, { endpointId: "e2", name: "two" }],
    inferenceServices: [{ organizationId: "org", endpointId: "e1", name: "one", models: [] }],
  });
  assert.deepEqual(unattachedInferenceServices(state, "org").map((one) => one.endpointId), ["e2"]);

  // Another node's attachment is not this node's.
  assert.deepEqual(unattachedInferenceServices(state, "other").map((one) => one.endpointId), ["e1", "e2"]);
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
