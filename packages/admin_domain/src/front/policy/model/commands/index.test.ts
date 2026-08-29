import assert from "node:assert/strict";
import test from "node:test";
import type { PolicyEntry, PolicyKind } from "../../../../common/protocol/policy/index.js";
import { groupByKind, manageableOrganizations } from "./index.js";

test("only organisations this actor may manage become layers", () => {
  const layers = manageableOrganizations({
    organizations: [
      { id: "acme", name: "Acme" },
      { id: "sub", name: "Acme Research" },
      { id: "other", name: "Somebody Else" },
    ],
    access: {
      nodes: [
        { organizationId: "acme", canUpdate: true },
        { organizationId: "sub", canUpdate: true },
        // Visible in the tree, not editable. A chip here would save and then be
        // refused by the route — the worst of the three possible answers,
        // because it looks like it worked until somebody checks.
        { organizationId: "other", canUpdate: false },
      ],
    },
  });

  assert.deepEqual(layers, [{ id: "acme", name: "Acme" }, { id: "sub", name: "Acme Research" }]);
});

test("an organisation missing from access is not a layer", () => {
  // Absent is not the same as permitted. The snapshot lists every organisation;
  // access lists what this actor may do, and a node it says nothing about is a
  // node this actor cannot manage.
  assert.deepEqual(
    manageableOrganizations({ organizations: [{ id: "acme", name: "Acme" }], access: { nodes: [] } }),
    [],
  );
  assert.deepEqual(manageableOrganizations({ organizations: [{ id: "acme", name: "Acme" }] }), []);
  assert.deepEqual(manageableOrganizations({}), []);
});

test("a permission for an organisation that is not listed is ignored", () => {
  // A chip needs a name, and a permission alone does not carry one.
  assert.deepEqual(
    manageableOrganizations({ organizations: [], access: { nodes: [{ organizationId: "ghost", canUpdate: true }] } }),
    [],
  );
});

test("entries are grouped by kind, in a stable order", () => {
  const entry = (kind: PolicyKind, name: string): PolicyEntry => ({
    id: `${kind}-${name}`, kind, name, enabled: true, mode: "default", value: {},
    organizationId: null, ownerId: "u1", projectId: null, updatedAt: "2026-08-29T00:00:00.000Z",
  });
  const grouped = groupByKind([
    entry("prompt", "review"),
    entry("skill", "deploy"),
    entry("skill", "release"),
  ]);

  assert.deepEqual(grouped.map(([kind, entries]) => [kind, entries.map((one) => one.name)]), [
    ["prompt", ["review"]],
    ["skill", ["deploy", "release"]],
  ]);
});
