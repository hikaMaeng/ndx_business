# Internals

## Decisions

* PGMQ is the only inter-participant path — Gateway, Worker, and Router can scale or restart without direct addresses to one another.
* `agent-worker` has no published port — it reads `AGENT_QUEUE`, executes the handler, writes `AGENT_RESULT_QUEUE`, then acknowledges the command message.
* A Router is required for multi-Gateway delivery — a shared PGMQ queue load-balances; it does not fan out by channel on its own.
* Each Gateway receives an event only through `AGENT_GATEWAY_QUEUE_PREFIX + gatewayId` — its in-memory hub then filters to locally subscribed WebSocket connections.
* PostgreSQL owns immutable history, cursor replay, idempotency, and subscription registry — it never schedules Worker execution.

## Broker topology

`src/server/broker/worker-consumer.ts#startWorkerConsumer` consumes `AGENT_QUEUE` and publishes a derived terminal event to `AGENT_RESULT_QUEUE`. `src/server/broker/result-router.ts#startResultRouter` reads that shared result queue, queries `agent_gateway_subscription`, and writes one copy to each live Gateway queue. `src/server/broker/gateway-delivery.ts#startGatewayDelivery` reads only one Gateway queue and calls the local `EventStreamHub`.

The Worker consumer bounds local durable work at `AGENT_MAX_THREADS + AGENT_MAX_QUEUE`, but it does not wait for an entire PGMQ read batch to finish. When one Worker Thread completes, the next already-read command can enter the pool immediately; this preserves pool saturation for long-running actions. The result router applies the same pattern with `AGENT_ROUTER_CONCURRENCY`: independent results fan out concurrently, while each individual result is deleted from the shared result queue only after every subscribed Gateway copy was durably written. Gateway queue creation is memoized, so a sustained result stream does not repeatedly issue the same PGMQ create call.
