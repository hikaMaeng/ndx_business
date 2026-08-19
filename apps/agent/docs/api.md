# API

`GET /health` reports process health. `GET /ready` checks PostgreSQL connectivity. `POST /api/events` accepts `{ action, payload, transactionKey?, replyChannel? }` and returns `202` with the event and transaction identifiers. Browser clients subscribe and publish through the WebSocket endpoint at `/ws`.

`GET /metrics` is not implemented in the current baseline. Renewal Phase 2 adds it as a token-protected operator endpoint that returns aggregate ingress, append, retry, and mailbox-lag values only; it must not return payloads, channels, or session identifiers even when the Agent host port is published.
