# Agent broker architecture

## Decision

PGMQ is the sole transport between independently scalable participants. Gateway, Worker, and Router never call one another and never share an in-memory scheduler.

```text
client ↔ Gateway → PGMQ agent_commands → Worker pool → PGMQ agent_results → Router → PGMQ gateway_<id> → Gateway ↔ client
```

PostgreSQL keeps immutable `event_store` history, WebSocket replay cursors, idempotency records, and the `{gateway, connection, channel}` subscription registry. It is not a worker dispatch queue.

## Participants

| Participant | Reads | Writes | External port |
| --- | --- | --- | --- |
| Gateway | its own `agent_gateway_<id>` queue | `agent_commands` | Yes |
| Worker | `agent_commands` | `agent_results` | No |
| Router | `agent_results` | one `agent_gateway_<id>` queue per live matching subscription | No |

The Gateway is the only service a client knows. A client command carries `replyChannel`, `transactionKey`, and correlation identity. A Worker receives only the event and emits the next event; it does not know a socket, Gateway address, or client identity.

## Delivery rules

1. Gateway writes a client command to PGMQ. It does not wait for a Worker.
2. Worker records the canonical command/result in `event_store`, writes the result event to PGMQ, then deletes the consumed command.
3. Router resolves the result `channel` to live Gateway subscriptions and copies the event to each Gateway-specific queue before deleting the shared result message.
4. Gateway publishes its queue event only to locally subscribed sockets. Offline clients replay immutable history with their cursor.
5. Every PGMQ boundary is at-least-once. Stable event IDs make redelivery converge; no participant treats one queue receive as exactly once.

## Scale and failure model

* More Gateways increase concurrent client connections without changing Worker capacity.
* More Worker containers increase command throughput without exposing any Worker port.
* More Routers increase result-routing capacity; a production deployment must partition routing consistently if more than one Router consumes the same result channel.
* If Workers are unavailable, commands remain in PGMQ. Gateway acceptance remains independent until broker capacity is reached.
* If a Gateway disappears, its subscription leases expire. Connected clients reconnect to another Gateway and replay missed events from `event_store`.

## Verification

* A command reaches one Worker and produces a result event before its command message is deleted.
* A result for one channel reaches every Gateway with a live subscription for that channel, and no unrelated Gateway queue.
* Multiple Worker containers share one command queue without direct coordination.
* Gateway, Worker, and Router can restart independently without client-to-worker connections.
