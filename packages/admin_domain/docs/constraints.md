# Constraints

## Blast radius

| Subpath               | Consumers                                          | Invariants (do not break)                                                                                                                            |
| --------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin_domain/common` | Admin HTTP handlers and organization React feature | Organization snapshots keep explicit many-to-many memberships, one exclusive responsibility scope per node/account, validated appearance, and actor-specific capabilities. |
| `admin_domain/server` | `apps/admin/src/server/app.ts`                     | `node` permits node edits/member management only; `subtree` additionally permits child creation and `subtree` delegation; only master permits roots and deletion. |
| `admin_domain/front`  | `apps/admin/src/front/organization`                | Models are token-keyed and live outside React; snapshot, account, and selection slices emit independently.                                           |
| `admin_domain/common` | `apps/admin/src/front/models`, `apps/admin/src/server/app.ts` | Model endpoint and definition payloads are parsed at the browser boundary and have one runtime-neutral route/type source. |
| `admin_domain/server` | `apps/admin/src/server/app.ts` | Provider refresh never persists identifiers containing `embedding` and keeps each configured header scoped to that provider request. |
| `admin_domain/front` | `apps/admin/src/front/models` | Catalog and endpoint selection are independent token-keyed slices outside React. |

- This is the only domain package for `apps/admin`.
- Do not create another domain-related package for the same app.
- Do not import from `apps/`.
- Keep domain invariants here instead of in app lifecycle wiring.
- Keep non-domain shared packages cohesive and standalone.
- A non-master can never create a root, delete a node, or grant `subtree`
  without inherited `subtree` authority, even when a crafted request bypasses
  the browser.
- Organization creation carries an explicit `root` / `sibling` / `child` mode.
  Non-masters may submit only `child`, and only under inherited `subtree`
  authority; do not infer sibling intent from `parentId` alone.
