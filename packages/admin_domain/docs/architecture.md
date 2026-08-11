# Architecture

Source is partitioned by runtime:

| Path         | Contract                                                                    | Drill-down                                                       |
| ------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/common` | Runtime-neutral domain code shared by server and front.                     | `src/common/protocol/models/index.ts#ModelCatalogSnapshot` |
| `src/server` | Server-only domain rules and persistence. Must not import from `src/front`. | `src/server/models/index.ts#refreshModelEndpoint` |
| `src/front`  | Front-only pure model state. Must not own app UI composition.               | `src/front/models/model/store.ts#ensureModelsFeatureModel` |

Packages must never import from `apps/`. App code may import this package by
workspace package name only.
