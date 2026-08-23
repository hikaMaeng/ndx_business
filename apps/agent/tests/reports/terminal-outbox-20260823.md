# Worker terminal delivery and composite-load verification

Date: 2026-08-23

## Environment

- Deployed target: `agent`, `agent-worker`, `agent-router` Docker services
- Worker pool: 96 resident worker threads
- PGMQ visibility: 60 seconds; execution lease: 120 seconds
- Workload: 2,048 `test.delay` commands, each 5 seconds
- Additional traffic: 128 joined recipients, 32 payload-conflict pairs, one 65-second visibility probe, seven reply channels, and two WebSocket subscribers per channel

## Fault injection: durable terminal outbox

One row with event ID `verify-outbox-retry-1` was inserted into `agent_result_delivery` with a nonexistent queue. The publisher failed five sends with `relation pgmq.q_verify_outbox_missing does not exist`; the row remained `ready|5` rather than being deleted. After creating that queue, the same row reached `delivered|6` and the queue contained exactly one matching event. The test row, its queue message, and the temporary queue were then removed.

## Composite result

```json
{
  "elapsedMs": 112130,
  "lowerBoundMs": 110000,
  "completedExecutions": 2081,
  "eventRows": 4482,
  "expectedTerminalCount": 2241,
  "leaseAttempts": 1,
  "leaseRedeliveries": 0,
  "queues": { "agent_requests": 0, "agent_results": 0, "gateway": 0 },
  "ingressP50Ms": 71,
  "ingressP95Ms": 103,
  "terminalP50Ms": 54333,
  "terminalP95Ms": 105899,
  "terminalP99Ms": 110169
}
```

All fourteen subscribers received only their expected channel/action/payload and no duplicate terminal event. The deployed metrics delta was zero for broker read failures, unmatched/archived router results, processing DLQ, and visibility-renew failures. After the assertion, every row and PGMQ message matching the test prefix was removed; event store, execution, outbox, command queue, and result queue counts were all zero.

## Interpretation

The 112.13-second elapsed time is 2.13 seconds above the 110-second worker-only lower bound (`ceil(2048 / 96) * 5000`). It includes ingress, event persistence, result outbox publication, Router fan-out, Gateway delivery, and WebSocket observation. The previous one-at-a-time publisher created a terminal-delivery backlog; this run uses 128-row outbox claims, queue-grouped PGMQ batching, and batched fence completion, so terminal delivery stays on the critical execution schedule instead of forming a post-processing tail.
