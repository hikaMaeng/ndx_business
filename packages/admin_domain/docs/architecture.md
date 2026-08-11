# Architecture

Source is partitioned by runtime:

| Path         | Contract                                                                    | Drill-down                                                       |
| ------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/common` | Runtime-neutral domain code shared by server and front.                     | `src/common/protocol/organization/index.ts#OrganizationInferenceService` |
| `src/server` | Server-only domain rules and persistence. Must not import from `src/front`. | `src/server/organizations/index.ts#assignOrganizationInferenceService` |
| `src/front`  | Front-only pure model state. Must not own app UI composition.               | `src/front/models/model/store.ts#ensureModelsFeatureModel` |

Packages must never import from `apps/`. App code may import this package by
workspace package name only.
