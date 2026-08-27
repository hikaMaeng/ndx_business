# Test Plan: event-store-identity

## Created
2026-08-19

## Goal
Prove, against the deployed database rather than a stubbed pool, that:
1. a `bigint` sequence reaches the runtime as an exact decimal string, not a lossy number;
2. a result event stays in its request's stream and records `causation_event_id`;
3. a redelivered request converges on one stored request row and one stored result row;
4. rows written before the identity columns existed are backfilled;
5. `GET /metrics` is token-guarded and is not shadowed by the SPA fallback.

## Environment
- Compose stack refreshed with `npm run deploy agent`.
- `agent` container on `ndx-business_internal`, host port 18081.
- PostgreSQL/PGMQ owned by the `admin` service, database `ndx_business`.
- `AGENT_METRICS_TOKEN` set from `apps/agent/docker/env.defaults`.

## Preconditions
- `agent` container healthy, `GET /health` returns 200.
- `event_store`, `event_stream_sequence`, and `agent_execution` exist.
- At least one pre-migration row exists in `event_store` with `session_id IS NULL`
  and a `session:` stream prefix (rows appended before commit `1162179`).

## Steps
1. `POST /api/events` with `{action:"hash.sha256", transactionKey:"<tx>", payload:{input, sessionKey, runKey, turnKey}}`.
2. Read the container log line `event.persisted` and record the JSON type of `sequence`.
3. Query the request and result rows for that transaction key.
4. `POST /api/events` again with the same `transactionKey` and the same payload.
5. Re-query the same transaction key and count rows per kind.
6. Query rows whose `stream_id` starts with `session:` and whose `session_id` is null.
7. `GET /metrics` without a token, then with `Authorization: Bearer <token>`.

## Expected Results
1. `event.persisted` logs `"sequence":"1"` (decimal string), never a JavaScript number coercion.
2. The result row shares `stream_id` and `session_id` with its request row and its
   `causation_event_id` equals the request `event_id`.
3. Step 5 yields exactly one `command` row and one `result` row for the transaction key.
4. Step 6 returns zero rows.
5. `/metrics` answers 401 without a token and JSON counters with one; neither response
   is `index.html`.

## Logs To Capture
- `docker logs agent` lines: `event.persisted`, `event.store.backfilled`, `event.replayed`, `event.deleted`.
- `psql` output for every query in steps 3, 5, and 6.
- HTTP status codes and bodies from steps 1, 4, and 7.

## Locator Contract
Not a browser scenario. Browser verification is covered separately by the smoke
run against `/`, which locates the `main` landmark by role.
