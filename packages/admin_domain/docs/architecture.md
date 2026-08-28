# Architecture

Source is partitioned by runtime:

| Path         | Contract                                                                    | Drill-down                                                       |
| ------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/common` | Runtime-neutral domain code shared by server and front.                     | `src/common/protocol/organization/index.ts#OrganizationInferenceService` |
| `src/server` | Server-only domain rules and persistence. Must not import from `src/front`. | `src/server/organizations/index.ts#assignOrganizationInferenceService` |
| `src/front`  | Front-only pure model state. Must not own app UI composition.               | `src/front/models/model/store.ts#ensureModelsFeatureModel` |
| `src/front/theme` | The design scale both apps read: surfaces, type family, type steps. Tokens only — no element rules, no layout. | `src/front/theme/theme.css` |

Packages must never import from `apps/`. App code may import this package by
workspace package name only.

## The shared scale

`admin_domain/front/theme.css` is the single definition of the palette and the
type scale, imported by `apps/admin` and `apps/vibeagent` alike. It ships as a
package export (`admin_domain/front/theme.css`), copied into `dist` by
`copy-assets.mjs` because `tsc` emits no stylesheets.

It holds custom properties and nothing else, so importing it can only add
names — it cannot move anything on a page that has not asked for a name. Each
app maps its own vocabulary onto it downstream
(`apps/admin/src/front/theme/linker.css`) rather than re-picking values.

Why the dependency runs this way round: the coding agent verifies every
session against the Admin account service, so Admin is upstream of it in fact.
Declaring that in `package.json` describes the system as it already is.
`admin_domain` imports no workspace package itself, so no cycle is possible.
