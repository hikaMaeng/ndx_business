# Architecture

The package owns framework-independent event shapes. PostgreSQL access, polling, worker-thread orchestration, and external process adapters remain in `apps/agent`.

The planned replacement contract and its migration boundaries are in the [Agent Renewal plan](../../../agentRenewal.md). `protocol/event` owns the server-issued ingress-queue record and the canonical stored/egress contract. Removed legacy protocol folders have no public subpath or runtime consumer.

| Edge | Status | Owner |
| --- | --- | --- |
| `src/common/protocol/event` → HTTP/WebSocket ingress, event store, egress | current exported contract | `IngressCommand`, `IngressEvent`, `EventDraft`, `EventEnvelope`, stream and identity rules |
| `src/server/handlers` → Agent worker bundle | exported `./server` contract | ordered static domain handler registry |
| `src/common/protocol/stream` → browser stream model | current exported contract | stream event and snapshot wire shapes |
| Removed `protocol/{agent,envelope,session,turn,iteration,tool,process,hook,model,state,approval,artifact,vibe}` | no public contract | deleted after consumer search confirmed no imports |
| `src/front/model` → browser stream console | current exported front contract | in-memory view model and subscription signal |
