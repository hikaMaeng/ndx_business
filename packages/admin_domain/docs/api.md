# API

Public exports:

| Export                | Purpose                            |
| --------------------- | ---------------------------------- |
| `admin_domain`        | Common domain entrypoint.          |
| `admin_domain/common` | Runtime-neutral domain entrypoint. |
| `admin_domain/server` | Server-only domain entrypoint.     |
| `admin_domain/front`  | Front-only domain entrypoint.      |

## Organization surface

| Export                                               | Purpose                                                                 | Defined in                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `OrganizationSnapshot` and parsers                   | Shared node data plus actor-specific node capability wire contract.     | `src/common/protocol/organization/index.ts#OrganizationSnapshot` |
| `updateOrganization`, `assignMember`, `removeMember` | Enforce node management and membership mutations.                       | `src/server/organizations/index.ts#updateOrganization`           |
| `assignResponsible`, `removeResponsible`             | Set or clear exclusive `node` / `subtree` admin scope.                  | `src/server/organizations/index.ts#assignResponsible`            |
| `listOrganizationAccounts`                           | Lists account candidates only for actors with organization authority.  | `src/server/organizations/index.ts#listOrganizationAccounts`     |
| `buildOrganizationAccess`                            | Projects the server policy into per-node UI capabilities.               | `src/server/organizations/authorization/index.ts#buildOrganizationAccess` |
| `ensureOrganizationModel`                            | Token-keyed live front model registry.                                  | `src/front/organization/model/store.ts#ensureOrganizationModel`  |

## Model endpoint surface

| Export | Purpose | Defined in |
| --- | --- | --- |
| `ModelCatalogSnapshot` and parser | Shared endpoint/model wire contract with route bindings. | `src/common/protocol/models/index.ts#ModelCatalogSnapshot` |
| `createModelEndpoint`, `updateModelEndpoint` | Validate and persist endpoint name, URL, optional header, and type. | `src/server/models/index.ts#createModelEndpoint` |
| `refreshModelEndpoint` | Calls the type-specific models endpoint and persists non-embedding identifiers. | `src/server/models/index.ts#refreshModelEndpoint` |
| `updateModelDefinition` | Persists sampling, reasoning, and modality options. | `src/server/models/index.ts#updateModelDefinition` |
| `ensureModelsFeatureModel` | Token-keyed catalog and selected-endpoint front slices. | `src/front/models/model/store.ts#ensureModelsFeatureModel` |

Add APIs only when a requested product behavior needs a durable domain contract.
