# Testing

Run `npm test --workspace agent` for Gateway/Worker/Router unit tests and `npm run lint --workspace agent` for protocol/type checks.

Integration proof must run three containers: public Gateway, internal Worker, and internal Router. Submit through Gateway, assert the Worker consumes the command queue, then assert the Router writes only matching Gateway queues.

Load proof must use multiple Gateway instances and Worker instances. It passes only when command/result/Gateway queues drain and every submitted transaction has one terminal event on every expected subscribed channel.
