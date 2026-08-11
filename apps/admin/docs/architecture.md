# Architecture

Source is partitioned by runtime. Drill down from here.

| Path         | Contract                                                                                                    | Drill-down                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `src/server` | Express app, API permission middleware, env validation, and process lifecycle. Serves the built front assets in production. | `src/server/permission/index.ts#apiPermissionMiddleware` |
| `src/front`  | Vite-built React shell. Organization node details own the information, member, and attached-model tabs; model-endpoint UI remains isolated under its feature folder. | `src/front/organization/node-modal/index.tsx#OrganizationNodeModal` |

The app owns wiring and lifecycle only. Domain rules belong in
`packages/admin_domain`, imported by workspace package name.

Build output is a self-contained bundle under `dist/`, which the runtime image
copies. Nothing is resolved from a package manager at runtime.
