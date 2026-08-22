# Architecture

| Path | Contract | Drill-down |
| --- | --- | --- |
| `src/server/app.ts` | HTTP Gateway accepts a client command and writes it to the PGMQ command queue. | `src/server/app.ts#createApp` |
| `src/server/transport` | WebSocket Gateway accepts client events and owns local socket replay/live delivery. | `src/server/transport/websocket.ts#attachWebSocketTransport` |
| `src/server/broker` | Worker consumes commands, Router fans results to Gateway queues, Gateway consumes only its own delivery queue. | `src/server/broker/worker-consumer.ts#startWorkerConsumer` |
| `src/server/subscription` | Durable `{gateway, connection, channel}` routing registry for Router fan-out. | `src/server/subscription/store.ts#GatewaySubscriptionStore` |
| `src/server/idempotency` | Worker-side `transactionKey` claim and recipient registry; prevents repeated side effects without scheduling work. | `src/server/idempotency/store.ts#ExecutionStore` |
| `src/server/pgmq` | PGMQ-specific send/read/delete adapter behind the broker-neutral queue contract. | `src/server/pgmq/client.ts#PgmqClient` |
| `src/server/event-store` | Immutable event history and WebSocket cursor replay; never a worker scheduler. | `src/server/event-store/store.ts#EventStore` |
| `src/server/worker` | Fixed local Worker Thread pool used only inside a Worker service. | `src/server/worker/pool.ts#createWorkerPool` |
| `src/server/stream` | Per-Gateway in-memory channel index and bounded socket mailbox. | `src/server/stream/hub.ts#EventStreamHub` |
| `src/front` | Browser Gateway client: sends command frames and subscribes/replays only selected channels. | `src/front/main.ts#connectStream` |
