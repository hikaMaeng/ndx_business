# Usage

## Deploy

```sh
npm run deploy admin
```

From the repository root. This builds locally, refreshes the stack through
Docker Compose, and verifies the published port and health before reporting.
It is the standard entrypoint; do not substitute a manual build plus
`docker compose up`.

## Configuration

| Variable | Required | Contract |
| --- | --- | --- |
| `PORT` | yes | Integer in `10000-59999`. Validated at startup by `readEnv`. |
| `NODE_ENV` | no | `development`, `test`, or `production`. Defaults to `development`. |

Defaults live in `docker/env.defaults`, which is committed. The deploy copies it
to `docker/.env` when that file is absent; `docker/.env` is git-ignored and is
where local overrides go.

## Importing the domain package

```ts
import { /* ... */ } from "admin_domain";
```

Always by workspace package name — never a relative path across the package
boundary. The app may depend on the package; the package must not depend on the
app.
