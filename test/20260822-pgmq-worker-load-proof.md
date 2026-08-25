# PGMQ worker topology: final 2,048 request proof

## Workload

- 2,048 independent `test.delay` commands.
- 5,000 ms delay, 96 resident worker threads, 512 streams, and four reply channels.
- Load generator used 128 concurrent keep-alive HTTP sockets and four WebSocket subscriptions.
- The worker lower bound is `ceil(2048 / 96) x 5,000 = 110,000 ms`; acceptance is 125,000 ms.

## Result

| Check | Result |
| --- | ---: |
| End-to-end WebSocket terminal result time | **112,769 ms** |
| Terminal success events observed | **2,048 / 2,048** |
| Terminal failures | **0** |
| Dedicated command queue after settlement | **0** |
| Dedicated result queue after settlement | **0** |
| Dedicated Gateway queue after settlement | **0** |
| Acceptance (125,000 ms) | **pass, 12,231 ms margin** |

The prior fixed-worker baseline was 118,522 ms. The PGMQ participant topology
finished 5,753 ms faster under the same request, worker, delay, stream, and
channel counts.

## Changes required for the result

1. bounded parallel result fan-out and one-time Gateway queue creation;
2. PostgreSQL pool budget across Gateway, Worker, and Router roles;
3. bounded PGMQ `send_batch` coalescing plus a multi-connection load client;
4. removal of the benchmark's accidental second 5-second delay.

## Runtime evidence

The deployed worker logged `minWorkerThreads=96` and `maxWorkerThreads=96`.
The load harness emitted:

```json
{"test":"pgmq-worker-concurrency","total":2048,"workers":96,"delayMs":5000,"criticalPathMs":110000,"overheadMs":15000,"elapsedMs":112769,"terminalResults":2048}
```
