# Architecture

The package owns framework-independent event shapes. PostgreSQL access, polling, worker-thread orchestration, and external process adapters remain in `apps/agent`.

The planned replacement contract and its migration boundaries are in the [Agent Renewal plan](../../../agentRenewal.md). `protocol/agent` is still the deployed wire type; `protocol/event` already carries the canonical ingress and stored shapes that Phase 1 promotes to that role. The stub folders below are unexported and carry no runtime consumer.

| Edge | Status | Owner |
| --- | --- | --- |
| `src/common/protocol/agent` → HTTP/WebSocket/worker boundary | current exported contract | `AgentEvent`, request/result factories |
| `src/common/protocol/event` → server event store and ingress | current exported contract | `IngressCommand`, `EventDraft`, `EventEnvelope`, stream and identity rules |
| `src/common/protocol/stream` → browser stream model | current exported contract | stream event and snapshot wire shapes |
| `src/common/protocol/vibe` → typed Vibe callers | current root re-export | alias over the current `AgentEvent` contract |
| `src/common/protocol/{envelope,session,turn,iteration,tool,process,hook,model,state,approval,artifact}` | unexported legacy stubs; Phase 1 removal | no runtime consumer or public subpath |
| `src/front/model` → browser stream console | current exported front contract | in-memory view model and subscription signal |
