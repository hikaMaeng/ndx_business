# API

## HTTP

| Route                                                          | Response                                              | Defined in                    |
| -------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------- |
| `GET /health`                                                  | `{ "status": "ok", "service": "admin" }`              | `src/server/app.ts#createApp` |
| `GET /api/health`                                              | same payload as `/health`                             | `src/server/app.ts#createApp` |
| `GET /*`                                                       | built front `index.html` (SPA fallback)               | `src/server/app.ts#createApp` |
| `GET /api/organizations`                                      | Organization data plus actor-specific node capability projection. | `src/server/app.ts#createApp` |
| `GET /api/organizations/users`                                | Account candidates for a master or delegated organization admin. | `src/server/app.ts#createApp` |
| `POST /api/organizations`                                     | Creates `root`, `sibling`, or `child`; the explicit mode is authorization input. | `src/server/app.ts#createApp` |
| `PUT /api/organizations/:id`                                   | Updates a node name, color, and icon.                 | `src/server/app.ts#createApp` |
| `POST/DELETE /api/organizations/:id/members[/userId]`          | Adds or removes one node member.                      | `src/server/app.ts#createApp` |
| `POST/DELETE /api/organizations/:id/responsibilities[/userId]` | Sets or clears the member's node/subtree admin scope. | `src/server/app.ts#createApp` |
| `POST/DELETE /api/organizations/:id/inference-services[/endpointId]` | Attaches an endpoint to a node or removes that node's service relation; all of its current models project as active unless locally overridden. | `src/server/app.ts#createApp` |
| `PUT /api/organizations/:id/inference-services/:endpointId/models/:modelId` | Enables or disables one model only for that node. | `src/server/app.ts#createApp` |
| `GET/POST /api/models` | Lists persisted provider endpoints or creates one. | `src/server/app.ts#createApp` |
| `PUT /api/models/:endpointId` | Updates an endpoint's name, URL, optional header, and provider type. | `src/server/app.ts#createApp` |
| `POST /api/models/:endpointId/refresh` | Retrieves provider models and excludes identifiers containing `embedding`. | `src/server/app.ts#createApp` |
| `POST /api/models/:endpointId/models` | Manually registers one model definition for an endpoint. | `src/server/app.ts#createApp` |
| `PUT /api/models/:endpointId/models/:modelId` | Persists model sampling, reasoning, and modality capabilities. | `src/server/app.ts#createApp` |

Authenticated routes accept `Authorization: Bearer <token>`, the configured
session header, or the configured session cookie. Conflicting credentials are
rejected. One account has one shared active token; `SettingsResponse.sessions`
contains the device records and request activity beneath that token.

All `/api/admin/*` routes require a master administrator. Delegated organization
admins use `/api/organizations/users` for node membership work; direct calls to
the global account, session, and policy routes return `403`.

Static assets from the front build are served before the fallback.

## Module surface

| Export             | Contract                                                                                         | Defined in                    |
| ------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------- |
| `createApp()`      | Builds the Express app with routes and static serving attached. Does not listen.                 | `src/server/app.ts#createApp` |
| `readEnv(source?)` | Validates and returns `{ port, nodeEnv }`. Throws on an out-of-range port or unknown `NODE_ENV`. | `src/server/env.ts#readEnv`   |

`createApp` is separated from listening so tests can exercise routes without
binding a port; see `src/server/app.test.ts`.
