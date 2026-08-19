# Constraints

Queue delivery is at-least-once beyond its visibility timeout. `EventQueueTransport` is the only consumer-facing delivery contract; PGMQ-specific SQL stays in `src/server/pgmq`. The durable-state Postgres pool is injected separately and owns execution claims, results, and event history. The transaction key makes retries safe only when the action's external side effects also use the same idempotency boundary. Unknown actions fail into a result event and are not executed dynamically.

The contract targets visibility-aware queue systems such as PGMQ, SQS, Redis Streams, and NATS JetStream. Kafka is outside the drop-in contract because offset commits do not provide message-level delete and visibility semantics.
