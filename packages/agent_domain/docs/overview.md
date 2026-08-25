# agent_domain 개요

`agent_domain`은 두 층을 함께 담는 패키지다. `common`·`server`·`front`는 Gateway, Worker, Router가 같은 message shape를 쓰게 하는 계약이고, `broker`는 그 계약을 실제로 실어 나르는 도메인 중립 런타임(PGMQ 전송, event store, claim/lease, outbox, WebSocket 투영)이다.

`common`·`server`·`front`는 PGMQ·PostgreSQL·WebSocket 호출을 포함하지 않는다. 그 호출은 전부 `broker`에 있다.

`broker`가 이 패키지에 있는 이유는 어느 app에도 속하지 않기 때문이다. `apps/agent`는 이제 role 분기와 wiring만 하는 조립 루트이며, 다른 app이 자기 action registry만 바꿔 같은 broker 위에서 돌 수 있다.

`IngressEvent`는 Gateway가 PGMQ에 기록하는 저장 전 command이고, `EventEnvelope`는 Worker가 event store append 뒤 받은 stream position까지 포함한 canonical event다. 이 둘을 나누므로 client는 server-only sequence를 지정할 수 없다.

타입과 wire frame은 [API](api.md), ID와 draft 생성 원리는 [내부 동작](internals.md)을 참조한다.
