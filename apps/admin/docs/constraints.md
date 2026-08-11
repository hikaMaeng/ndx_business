# Constraints

## Blast radius

| Surface                          | Consumers                                                         | Invariants (do not break)                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /health`, `GET /api/health` | deploy verification, container `HEALTHCHECK`, browser smoke tests | Stays unauthenticated, side-effect free, and answers before the front assets load. Changing the path breaks the deploy report and the image health probe together. |
| `readEnv` (`src/server/env.ts`)  | process start                                                     | Rejects a `PORT` outside `10000-59999` and an unknown `NODE_ENV` by throwing at startup, never by falling back to a default.                                       |
| static asset serving             | every browser route                                               | The SPA fallback must not shadow `/health`; route order in `createApp` is load-bearing.                                                                            |
| organization capability projection | organization tree and node modal | Buttons and editable controls render only from server-projected capabilities; the server independently rechecks every mutation. |
| `/api/admin/*` | master admin shell | Every route requires `isMasterAdmin`; hiding Account/System navigation is not an authorization boundary. |
| `/api/models*` | model endpoint React feature | Every route requires `isMasterAdmin`; a configured header is sent only to the selected provider during its explicit refresh. |
| `/api/organizations/:id/inference-services*` | organization node model tab | The selected node's manager may attach or remove a service and change only its local model active flags; provider credentials never enter this surface. |
| `apiPermissionMiddleware` (`src/server/permission/index.ts`) | every API handler | `GET /api/health`, signup, and login are the only public API routes. Every other `/api` route authenticates once before its handler; `/api/admin/*` and `/api/models*` additionally require `isMasterAdmin`. |

## Runtime

- Authentication transport names are persisted in `auth_settings` and are
  editable through `PUT /api/admin/settings`; changing them does not rotate the
  shared token. The accepted names must remain valid HTTP header/cookie names.
- A shared account token is represented by one active session row. Device
  identity, last request time, request count, and request history are tracked in
  `session_devices` and `session_request_logs`.

- Port comes from env only, validated before use. No source file embeds one.
- The process must exit on `SIGTERM`; the container stops by signal.
- Production serving is Express only. The Vite dev server is a development tool
  and is never the deployed surface.

## Front end

UI uses shadcn/ui components, Tailwind CSS, and Radix primitives. Markup is
written for headless-browser verification; see the `headless-browser-test`
skill for the contract shape.

Approved locators, which tests may rely on:

| Locator                                                               | Element                                                                    |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `role=banner` / `nav[aria-label="Primary"]`                           | header navigation                                                          |
| `role=main`                                                           | main content landmark                                                      |
| `role=heading` level 1, id `page-title`                               | page title                                                                 |
| `role=status`, `data-testid="service-state"`                          | runtime status line                                                        |
| `role=link` name `Health`                                             | health endpoint link                                                       |
| `data-testid="organization-node-modal"`, `role=dialog`                | Existing-node information and membership editor.                           |
| `role=tab` names from `organization.node.*.tab.button`                | Information and member modal surfaces; member tab includes its live count. |
| `role=tab` name from `organization.node.models.tab.button`             | Attached inference service selector and per-model active toggles. |
| `role=listbox` name from `organization.node.member.suggestions.label` | Account autocomplete shown while typing.                                   |
| `role=dialog` name from `models.add.endpoint.button` | New endpoint form surface. |
| `role=dialog` name from `models.model.add.text` or `models.model.edit.text` | Manual model creation and list-item editing form surfaces. |
| `role=status` from `models.*.status` | Model endpoint save and refresh result. |

Removing or renaming any of these is a breaking change for the smoke tests.
Prefer adding a new hook over repurposing one.

The node modal never creates nodes. Root, sibling, and child creation stay in
the organization tree surface. `admin` and `admin all` are mutually exclusive
toggles backed by `node` and `subtree`; pressing the active toggle clears it.
Non-master navigation contains only Dashboard and Organizations. A delegated
`node` admin can edit that node and manage its members or node admins, but sees
no root, sibling, child, delete, or `admin all` grant controls. A delegated
`subtree` admin additionally sees child creation and `admin all` grant controls;
root, sibling, and delete controls remain master-only.

The node model tab receives credential-free service options in the organization
snapshot. Selecting one attaches the service; every current endpoint model
projects as active until that node overrides it. Each model activation flag and
service removal applies only to the selected node.

The Model menu is master-only. Its card list exposes only endpoint metadata plus
model identifier/context size; provider credentials remain editable only in the
detail form and are never rendered in a card.
