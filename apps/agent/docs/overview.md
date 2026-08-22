# Overview

`agent` is a PGMQ-first event system: Gateway, Worker, and Router are independent participants that exchange only events through PGMQ; PostgreSQL retains event history, replay cursors, idempotency, and subscription routing state.

The externally published `agent` service is a Gateway. `agent-worker` and `agent-router` are Docker-internal services with no client port.
