# Constraints

Queue delivery is at-least-once beyond its visibility timeout. `EventQueueTransport` is the only consumer-facing delivery contract; PGMQ-specific SQL stays in `src/server/pgmq`. The durable-state Postgres pool is injected separately and owns execution claims, results, and event history. The transaction key makes retries safe only when the action's external side effects also use the same idempotency boundary. Unknown actions fail into a result event and are not executed dynamically.

The contract targets visibility-aware queue systems such as PGMQ, SQS, Redis Streams, and NATS JetStream. Kafka is outside the drop-in contract because offset commits do not provide message-level delete and visibility semantics.

`event_store` is the only append target for canonical events; `agent_events` is frozen legacy data and is no longer written. `sequence` is a `bigint` that `pg` returns as text: only the envelope value produced by `src/server/event-store` is a number, and cursor comparison must never use a raw row field. Result and conflict events derive a deterministic event ID from the transaction key, so at-least-once redelivery converges on one stored row instead of one row per delivery; this holds only while the transaction-key execution claim keeps a single terminal outcome per key, and Phase 3 attempt scoping replaces it. Every derived event stays in its cause's stream, so per-stream ordering and session projections cover results as well as commands.

`GET /metrics` is disabled unless `AGENT_METRICS_TOKEN` is set and must stay aggregate-only, because the Agent host port is published in the default Compose profile.
