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
    // Required since organization inference services landed; the parser rejects
    // a snapshot without them.
    inferenceServiceOptions: [],
    inferenceServices: [],
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
