# Usage

Deploy the `agent` Gateway, `agent-worker`, and `agent-router` Compose services together. Only `agent` publishes `AGENT_HOST_PORT`.

`AGENT_ROUTER_CONCURRENCY` bounds independent result fan-out operations (default `12`). The Gateway, Worker, and Router pool ceilings are budgeted together below PostgreSQL's 100-client default; increase it only after raising or re-budgeting that shared capacity. It improves result-drain throughput without changing per-result delivery acknowledgement.

Set `AGENT_MAX_THREADS` for CPU-bound Worker Thread capacity. Scale `agent-worker` for command throughput and `agent` for socket connections independently. A Router must route one shared result queue consistently; use partitioning before running multiple Router consumers.
