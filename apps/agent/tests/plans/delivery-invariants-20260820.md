# Test Plan: delivery-invariants

## Created
2026-08-20

## Goal
Prove that a failure between worker completion and result delivery cannot strand, drop, or
mislabel an event:
1. a durable-state failure releases the visibility timer, so the message is redelivered rather than
   held invisible forever;
2. a result whose lease is held by an unfinished attempt is neither sent nor acknowledged;
3. an already delivered result acknowledges its source without sending again;
4. a durable-state or egress error never reaches the client as `worker_failed`;
5. `AGENT_DELIVERY_LEASE_SECONDS` shorter than `QUEUE_VISIBILITY_TIMEOUT_SECONDS` is enforced at
   startup;
6. source redelivery still converges on one command row, one result row, and one result-queue send.

## Environment
- Compose stack refreshed with `npm run deploy agent`.
- `agent` on host port 18081; PostgreSQL/PGMQ owned by the `admin` service, database `ndx_business`.
- `apps/agent/docker/.env` carries `AGENT_METRICS_TOKEN` and `AGENT_DELIVERY_LEASE_SECONDS=30`
  against the default `QUEUE_VISIBILITY_TIMEOUT_SECONDS=60`.

## Preconditions
- `event_store`, `event_stream_sequence`, `event_delivery`, and `agent_execution` exist.
- `GET /health` returns 200.

## Steps
1. Run `npm run test --workspace agent`; goals 1–4 are covered by stubbed transports and a stubbed
   pool, because neither a durable-state outage nor a live lease can be induced against the
   deployed database without corrupting it.
2. Call `readEnv` with `QUEUE_VISIBILITY_TIMEOUT_SECONDS=20` and `AGENT_DELIVERY_LEASE_SECONDS=30`,
   then with 60/30.
3. `pgmq.send` the same source event ID to `agent_requests` twice, six seconds apart.
4. Count `pgmq.q_agent_results` before and after.
5. Query `event_store` for the session stream, `event_delivery` for the result, and every stream
   counter against its stored maximum.
6. `GET /metrics` with the bearer token.
7. Run the browser scenario against `/`.

## Expected Results
1. 16 unit tests pass, including the four delivery-invariant tests.
2. 20/30 is refused by name; 60/30 is accepted.
3. Result-queue delta is 1.
4. One `command` row and one `result` row in the session stream; `event_delivery.attempts=1` with
   `delivered_at` set and `lease_until` cleared.
5. Counter mismatch count is 0.
6. `processingFailures` is 0 and `appendDuplicates` equals the number of redelivered appends.
7. Browser scenario passes with zero console and page errors.

## Logs To Capture
- `docker logs agent`: `event.persisted`, `event.deleted`, `event.processing.failed`.
- `psql` output for every query in steps 4–5.
- `readEnv` rejection message, `/metrics` body, browser `report.json`.

## Locator Contract
Browser steps use `getByRole("main")`, `getByLabel("Event type")`, `getByLabel("Payload JSON")`,
and `getByRole("button", { name: "Send to agent" })`. The result marker has no sanctioned test id
and is matched by text; record that as a known exception.
