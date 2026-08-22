# Testing

Run `npm test --workspace agent` for Gateway/Worker/Router unit tests and `npm run lint --workspace agent` for protocol/type checks.

Integration proof must run three containers: public Gateway, internal Worker, and internal Router. Submit through Gateway, assert the Worker consumes the command queue, then assert the Router writes only matching Gateway queues.

Load proof must use multiple Gateway instances and Worker instances. It passes only when command/result/Gateway queues drain and every submitted transaction has one terminal event on every expected subscribed channel.

`node apps/agent/tests/load/pgmq-worker-concurrency.mjs` is the fixed-capacity comparison: 2,048 independent `test.delay` events, 96 Worker Threads, 512 streams, four reply channels, and a 5,000 ms handler delay. It accepts no more than `ceil(2048 / 96) × 5,000 + 15,000 = 125,000 ms`, then the operator verifies all three dedicated PGMQ queues and the scoped terminal-event rows are zero/non-failing before cleanup.
