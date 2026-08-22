# Constraints

## Blast radius

| Subpath | Consumers | Invariants (do not break) |
| --- | --- | --- |
| `agent_domain/common` | browser, Gateway, Worker, Router | Every participant exchanges the canonical event contract; Gateway never sends a worker task directly. |
| `src/server/queue` | Gateway, Worker, Router | PGMQ is the only participant-to-participant transport. A source message is deleted only after its successor state/event is durable. |
| `src/server/broker/worker-consumer.ts` | `agent-worker` | Worker reads commands from PGMQ and writes terminal events to PGMQ. It has no client socket or published port. |
| `src/server/broker/result-router.ts` | `agent-router` | One shared result queue is a competing-consumer queue, not pub/sub. Router fans each result into every subscribed Gateway-specific queue. |
| `src/server/subscription` | Gateway, Router | Subscription rows expire unless the owning Gateway renews them; a stale Gateway cannot receive future routing. |
| `src/server/idempotency` | Worker | A transaction runs at most once; joining requests add a logical reply channel but never become a DB dispatch job. |
| `src/server/event-store` | Gateway replay, Worker event history | Event store is history/replay authority only; it must not become a second worker dispatch queue. |

Gateway WebSocket traffic is bounded per connection. A slow client may be closed, but it must not delay another channel or Worker service.
