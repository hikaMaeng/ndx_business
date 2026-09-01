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
| `OrganizationInferenceModel` and route bindings       | Every registered model as a choice, plus the one model each node picked. Never provider URLs or headers. | `src/common/protocol/organization/index.ts#OrganizationInferenceModel` |
| `setOrganizationInferenceModel`                       | Points one organization at one model, replacing whatever it had.        | `src/server/organizations/index.ts#setOrganizationInferenceModel` |
| `clearOrganizationInferenceModel`                     | Removes it, so the node inherits from its nearest configured ancestor again. | `src/server/organizations/index.ts#clearOrganizationInferenceModel` |
| `chosenInferenceModel`, `inheritedInferenceModel`     | What this node chose, and which ancestor answers when it chose nothing. | `src/front/organization/model/membership/index.ts#inheritedInferenceModel` |

## Model endpoint surface

| Export | Purpose | Defined in |
| --- | --- | --- |
| `ModelCatalogSnapshot` and parser | Shared endpoint/model wire contract with route bindings. | `src/common/protocol/models/index.ts#ModelCatalogSnapshot` |
| `createModelEndpoint`, `updateModelEndpoint` | Validate and persist endpoint name, URL, optional header, and type. | `src/server/models/index.ts#createModelEndpoint` |
| `refreshModelEndpoint` | Calls the type-specific models endpoint and persists non-embedding identifiers. | `src/server/models/index.ts#refreshModelEndpoint` |
| `createModelDefinition` | Validates and persists one manually supplied model definition. | `src/server/models/index.ts#createModelDefinition` |
| `updateModelDefinition` | Persists sampling, reasoning, and modality options. | `src/server/models/index.ts#updateModelDefinition` |
| `ensureModelsFeatureModel` | Token-keyed catalog and selected-endpoint front slices. | `src/front/models/model/store.ts#ensureModelsFeatureModel` |

## Skill bundle surface

A skill is a folder, not a row. The `policy` row of kind `skill` names one and
says what it is for; the folder holds `SKILL.md` and whatever the skill needs
beside it. Bundles live under a root the admin container mounts read-write and
the tool container mounts read-only.

| Export | Purpose | Defined in |
| --- | --- | --- |
| `BUNDLE_LIMITS` | Size, count, and depth ceilings applied before anything is written. | `src/server/skills/index.ts#BUNDLE_LIMITS` |
| `resolveInBundle` | The single path rule: resolves a requested path and refuses any that leaves the folder. | `src/server/skills/index.ts#resolveInBundle` |
| `bundleRoot` | Where one skill's files sit, keyed by the layer that owns them. | `src/server/skills/index.ts#bundleRoot` |
| `extractBundle` | Unpacks an uploaded zip, replacing the previous version. | `src/server/skills/index.ts#extractBundle` |
| `listBundle` | Every file, `SKILL.md` first, each marked editable or not. | `src/server/skills/index.ts#listBundle` |
| `readBundleFile`, `writeBundleFile` | Read and write one text file inside a bundle. | `src/server/skills/index.ts#readBundleFile` |
| `looksText`, `certainlyBinary`, `isTextFile` | Whether a file may be opened, decided by its bytes rather than its name. | `src/server/skills/index.ts#looksText` |
| `deleteBundle` | Removes a skill's files. | `src/server/skills/index.ts#deleteBundle` |

Two decisions carry the rest:

**Editability is decided by content.** There is no list of blessed extensions.
A skill may be made of `.rs`, `.lua`, `.tf`, a `Makefile`, a `Dockerfile`, or
something nobody has thought of; a whitelist would list every one of those and
open only the ones that were guessed — and the file a person needs to fix is
always the one missing from the guess. Only bytes that cannot be text (a NUL, a
sequence UTF-8 cannot decode) mark a file as not editable.

**Path safety is one function.** A zip entry names its own path, and so does an
editor request, so both arrive from outside. `resolveInBundle` checks the
resolved answer rather than the requested string, which is why the list of
tricks — `..`, a leading slash, a backslash, a drive letter — does not have to
be complete.

Add APIs only when a requested product behavior needs a durable domain contract.
