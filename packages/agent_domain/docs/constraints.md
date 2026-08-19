# Constraints

Action names are data, not executable code. The application must allow-list
worker actions. `transactionKey` is the idempotency boundary; the full context
is `sessionKey → runKey → turnKey → iterationKey → stepKey → toolCallKey`.

Consumers: `apps/agent` coordinator, PGMQ dispatcher, external-process adapter,
and browser event client. Invariants: duplicate keys never repeat side effects;
terminal states are monotonic; PGMQ is delivery only; PostgreSQL owns durable
state and results; event payloads are validated at the boundary.
