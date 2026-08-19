# Architecture

The replacement plan and its event-store, attempt, replay, and migration contracts live in [Agent Renewal plan](../../../agentRenewal.md). Update this router with the implementing source path and a code-to-document anchor in the same phase that changes a contract.

The `admin` Compose service owns the PostgreSQL/PGMQ runtime. The agent separates the durable-state Postgres pool from the `EventQueueTransport`; PGMQ is the current adapter, not the consumer contract. The current async consumer loop reads batches with `read_with_poll(... quantity: AGENT_POLL_BATCH_SIZE)`, then processes each message serially before reading again. It claims the transaction key, dispatches bounded CPU work to a lazy Worker Thread pool, publishes a result event, and deletes the source message only after result publication and execution persistence succeed. An empty queue keeps the pool at zero workers; `AGENT_MAX_THREADS` is an explicit upper bound.

The preserved baseline branch had a duplicate/conflict early-return defect that could stop consumption. The current Renewal branch continues to the next message after acknowledging a conflict; the old branch remains reference/recovery material, not an operational fallback. See the [Agent Renewal plan](../../../agentRenewal.md).

| Source path | Responsibility |
| --- | --- |
| `src/server/app.ts` | HTTP ingress, health/readiness, token-guarded metrics |
| `src/server/database.ts` | explicit durable-state Postgres pool construction |
| `src/server/queue` | queue transport contract independent of a broker |
| `src/server/pgmq` | PostgreSQL/PGMQ adapter |
| `src/server/consumer.ts` | legacy poll, canonical append, claim, execute, publish, delete |
| `src/server/ingress` | legacy queue event to canonical draft conversion and result derivation |
| `src/server/event-store` | immutable canonical event persistence, per-stream positions, identity backfill |
| `src/server/delivery` | lease-backed result-delivery claim and completion ledger |
| `src/server/execution` | transaction-key idempotency state |
| `src/server/metrics` | aggregate operator counters behind `GET /metrics` |
| `src/server/worker` | lazy bounded Worker Thread pool and allow-listed actions |
| `src/server/stream` | channel-filtered WebSocket event projection |
| `src/server/transport/websocket.ts` | `/ws` subscribe and event frames |
| `src/front` | minimal service shell |

```mermaid
flowchart LR
  WS["WebSocket /ws"] --> T["EventQueueTransport"]
  T --> Q["PGMQ adapter"]
  Q --> C["Agent consumer"]
  C --> P["lazy bounded worker_threads"]
  P --> R["agent_results event"]
  C --> D["delete source message"]
  C --> DB["Postgres durable state"]
```
