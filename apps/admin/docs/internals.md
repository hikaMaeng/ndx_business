# Internals

The scaffold intentionally contains no product workflow or domain model. What
follows is the small set of decisions that are not obvious from the code.

## Decisions

- **One shared token, many device records.** Login reuses the active account
  token and records each client separately so idle expiry is based on aggregate
  activity while operators can see device-level usage. See
  `packages/admin_domain/src/server/auth/index.ts`.
- **Transport names are data.** The session header and cookie name are stored in
  `auth_settings`, not compiled into the authentication contract, because
  reverse proxies and firewalls can filter fixed names. See
  `packages/admin_domain/src/server/settings/index.ts`.

- **Health is served at two paths.** `/health` is what the deploy and the image
  probe use; `/api/health` exists so a future API surface keeps health under the
  same prefix as everything else. Why: moving it later would break the deploy
  report and the container `HEALTHCHECK` at the same time.
- **`readEnv` throws instead of defaulting.** A service that silently starts on
  the wrong port is harder to diagnose than one that refuses to start. Why: the
  port is also a compose contract, so a mismatch is a deployment defect, not a
  runtime preference.
- **The listener is closed on `SIGTERM`.** Without it the process ignores the
  signal and the container runtime waits out its kill timeout on every stop,
  restart, and deploy. See `src/server/index.ts`.
- **The SPA fallback is registered last.** It matches every path, so any route
  declared after it becomes unreachable.
- **Node editing and node creation are separate surfaces.** The large node
  modal edits information and members only; tree actions own creation. Why:
  future node-related tabs can grow without mixing hierarchy mutation into the
  selected-node workflow.
- **Navigation is a projection, not an authorization boundary.** Non-master
  accounts render only Dashboard and Organizations, while the centralized API
  permission middleware enforces master access for every `/api/admin/*` and
  `/api/models*` request. Why: a hidden button cannot stop a crafted HTTP
  request, and a handler-local guard can be omitted when a route is added.
- **Provider discovery is explicit.** Opening the Model menu reads persisted
  configuration only; only the endpoint's Refresh action calls an external
  provider. Why: loading the console must not send credentials or mutate model
  inventory.
- **Embedding models are excluded at the boundary.** Provider identifiers that
  contain `embedding` are not persisted. Why: the configured items represent
  generative endpoints with sampling and modality controls.
- **`dist` is a single bundled file, not a dependency tree.** That is why the
  runtime image needs no package manager and why its Node major is independent
  of the version the build ran on.
