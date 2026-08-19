# Architecture

The package owns framework-independent event shapes. PostgreSQL access, polling, worker-thread orchestration, and external process adapters remain in `apps/agent`.

The planned replacement contract and its migration boundaries are in the [Agent Renewal plan](../../../agentRenewal.md). Until Phase 1 implements that contract, the only exported runtime wire shape is `src/common/protocol/agent`; the other protocol folders are not public subpaths.

| Edge | Status | Owner |
| --- | --- | --- |
| `src/common/protocol/agent` → HTTP/WebSocket/worker boundary | current exported contract | `AgentEvent`, request/result factories |
| `src/common/protocol/vibe` → typed Vibe callers | current root re-export | alias over the current `AgentEvent` contract |
| `src/common/protocol/{envelope,session,turn,iteration,tool,process,hook,model,state,approval,artifact}` | unexported legacy stubs; Phase 1 removal | no runtime consumer or public subpath |
| `src/front/model` → browser stream console | current exported front contract | in-memory view model and subscription signal |
