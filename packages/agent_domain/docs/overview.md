# agent_domain 개요

`agent_domain`은 Gateway, Worker, Router가 같은 message shape를 사용하게 하는 프레임워크 독립 계약 패키지다. PGMQ·PostgreSQL·WebSocket 호출을 포함하지 않는다.

`IngressEvent`는 Gateway가 PGMQ에 기록하는 저장 전 command이고, `EventEnvelope`는 Worker가 event store append 뒤 받은 stream position까지 포함한 canonical event다. 이 둘을 나누므로 client는 server-only sequence를 지정할 수 없다.

타입과 wire frame은 [API](api.md), ID와 draft 생성 원리는 [내부 동작](internals.md)을 참조한다.
