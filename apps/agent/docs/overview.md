# Agent 개요

Agent는 요청 실행 경로를 Gateway, Worker, Router로 나눈 PGMQ 기반 서비스다. Gateway는 명령을 PGMQ에 기록하고 바로 접수 응답을 돌려준다. Worker가 명령을 실행해 결과를 공유 결과 큐에 기록하고, Router가 결과를 수신 Gateway별 큐로 보낸다.

```text
client → Gateway → agent_requests → Worker → agent_results → Router → agent_gateway_<id> → Gateway WebSocket
```

이 분리는 접속을 받는 Gateway가 Worker Thread의 처리 시간이나 대기열과 직접 묶이지 않게 한다. Worker와 Router는 외부 포트 없이 내부 컨테이너로 동작한다. 다만 현재 Compose는 Gateway 서비스를 한 대만 정의한다. 여러 Gateway는 가능한 논리 구조이지만, 실제 다중 배포에는 별도 replica/ingress 구성과 고유 `AGENT_GATEWAY_ID`가 필요하다.

PGMQ 메시지는 consumer가 delete하기 전까지 visibility timeout 뒤 재전달될 수 있다. 결과는 결과 큐까지 내구적으로 인계되지만, WebSocket 화면 전달은 at-least-once다. client는 `eventId`로 중복을 수렴해야 한다.

구체적인 프로세스 경계는 [아키텍처](architecture.md), wire 계약은 [API](api.md), 현재 보장과 한계는 [제약](constraints.md)을 참조한다.
