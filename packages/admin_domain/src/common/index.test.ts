import assert from "node:assert/strict";
import test from "node:test";
import { parseOrganizationSnapshot, serviceDomain } from "./index.js";

test("service domain metadata is stable", () => {
  assert.equal(serviceDomain.service, "admin");
  assert.equal(serviceDomain.packageName, "admin_domain");
});

test("organization snapshot parser validates appearance tokens", () => {
  const valid = parseOrganizationSnapshot({
    organizations: [
      {
        id: "root",
        name: "Root",
        parentId: null,
        color: "blue",
        icon: "building",
        createdAt: "now",
      },
    ],
    members: [],
    responsibilities: [],
    // Required since the organisation's model landed; the parser rejects a
    // snapshot without them.
    inferenceModelOptions: [],
    inferenceModels: [],
    access: {
      isMasterAdmin: true,
      canCreateRoot: true,
      nodes: [
        {
          organizationId: "root",
          canUpdate: true,
          canManageMembers: true,
          canCreateChild: true,
          canCreateSibling: true,
          canDelete: true,
          canAssignAdminAll: true,
        },
      ],
    },
  });
  assert.ok(valid);
  assert.equal(valid.organizations[0]?.color, "blue");
  assert.equal(
    parseOrganizationSnapshot({
      ...valid,
      organizations: [{ ...valid.organizations[0], color: "javascript" }],
    }),
    null,
  );
});

test("one organisation cannot arrive with two models", () => {
  const model = (organizationId: string, identifier: string) =>
    ({ organizationId, modelId: identifier, endpointId: "e1", endpointName: "one", identifier });
  const base = {
    organizations: [],
    members: [],
    responsibilities: [],
    inferenceModelOptions: [],
    access: { isMasterAdmin: true, canCreateRoot: true, nodes: [] },
  };
  assert.ok(parseOrganizationSnapshot({
    ...base,
    inferenceModels: [model("a", "one"), model("b", "two")],
  }), "different organisations each choosing is the normal case");

  // A server that lost the constraint would have the screen render a `<select>`
  // silently showing one of the two. A load failure says so; a quiet pick does
  // not.
  assert.equal(
    parseOrganizationSnapshot({ ...base, inferenceModels: [model("a", "one"), model("a", "two")] }),
    null,
  );
});
