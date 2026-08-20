# Architecture

The package owns framework-independent event shapes. PostgreSQL access, polling, worker-thread orchestration, and external process adapters remain in `apps/agent`.

The planned replacement contract and its migration boundaries are in the [Agent Renewal plan](../../../agentRenewal.md). `protocol/agent` is the server-issued ingress-queue record, while `protocol/event` is the canonical stored and egress contract. Removed legacy protocol folders have no public subpath or runtime consumer.

| Edge | Status | Owner |
| --- | --- | --- |
| `src/common/protocol/agent` → HTTP/WebSocket ingress queue | current exported ingress record | `AgentEvent`, request/result factories |
| `src/common/protocol/event` → server event store and ingress | current exported contract | `IngressCommand`, `EventDraft`, `EventEnvelope`, stream and identity rules |
| `src/common/protocol/stream` → browser stream model | current exported contract | stream event and snapshot wire shapes |
| Removed `protocol/{envelope,session,turn,iteration,tool,process,hook,model,state,approval,artifact,vibe}` | no public contract | deleted after consumer search confirmed no imports |
| `src/front/model` → browser stream console | current exported front contract | in-memory view model and subscription signal |
