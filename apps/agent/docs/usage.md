# Usage

Deploy the `agent` Gateway, `agent-worker`, and `agent-router` Compose services together. Only `agent` publishes `AGENT_HOST_PORT`.

Set `AGENT_MAX_THREADS` for CPU-bound Worker Thread capacity. Scale `agent-worker` for command throughput and `agent` for socket connections independently. A Router must route one shared result queue consistently; use partitioning before running multiple Router consumers.
