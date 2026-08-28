# Constraints

## Blast radius

| Subpath               | Consumers                                          | Invariants (do not break)                                                                                                                            |
| --------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin_domain/common` | Admin HTTP handlers and organization React feature | Organization snapshots keep explicit many-to-many memberships, one exclusive responsibility scope per node/account, validated appearance, actor-specific capabilities, and credential-free inference service/model projections. |
| `admin_domain/server` | `apps/admin/src/server/app.ts`                     | `node` permits node edits/member management and attached-model changes only; `subtree` additionally permits child creation and `subtree` delegation; only master permits roots and deletion. |
| `admin_domain/front`  | `apps/admin/src/front/organization`                | Models are token-keyed and live outside React; snapshot, account, and selection slices emit independently.                                           |
| `admin_domain/common` | `apps/admin/src/front/models`, `apps/admin/src/server/app.ts` | Model endpoint and definition payloads are parsed at the browser boundary and have one runtime-neutral route/type source. |
| `admin_domain/server` | `apps/admin/src/server/app.ts` | Provider refresh never persists identifiers containing `embedding` and keeps each configured header scoped to that provider request; manual model identifiers remain unique within an endpoint. |
| `admin_domain/front` | `apps/admin/src/front/models` | Catalog and endpoint selection are independent token-keyed slices outside React. |

- `src/front/theme/theme.css` is the only place a colour or a font size is
  chosen. Downstream files map names onto it and never re-pick a value; a
  literal `font-size` in either app is a defect.
- Keep that file to tokens. An element rule there would apply to both apps at
  once, which is the one thing importing it must never be able to do.
- Adding a step to the type scale is additive and safe. Changing an existing
  step moves both apps, so treat it as a change to both.
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
- Attaching an inference service projects every current definition under that
  endpoint as active for the selected organization unless that node overrides
  it. The organization relation never exposes provider URLs or headers, and
  model activation remains local to that organization.
