# API

`GET /health` reports process health. `GET /ready` checks PostgreSQL connectivity. `POST /api/events` accepts `{ action, payload, transactionKey?, replyChannel? }` and returns `202` with the event and transaction identifiers. Browser clients subscribe and publish through the WebSocket endpoint at `/ws`.

`GET /metrics` returns aggregate ingress, append, worker, scheduler, and delivery counters as `{ service, metrics }`. `processingReadyOldestMs`, `processingExpiredLeases`, and `schedulerDispatchActive` make queue pressure, lease recovery, and parallel dispatch observable without exposing identifiers. It is registered before the SPA fallback, so a missing route no longer answers `200` with `index.html`. `AGENT_METRICS_TOKEN` is required: an unset token disables the route with `404`, and a request without `Authorization: Bearer <token>` is rejected with `401`. The snapshot carries counts and latency totals only; payloads, channels, and session identifiers are never returned.
