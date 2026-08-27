vibeagent는 bash 하나만 도구로 쓰는 코딩 에이전트 서비스다. 전송은 [`agent`](../../packages/agent/README.md) broker, 도메인은 [`vibeagent_domain`](../../packages/vibeagent_domain/README.md)이 맡고, 이 app은 둘을 조립하고 웹클라이언트를 제공한다.

| Goal | File |
| --- | --- |
| 서비스의 역할과 전체 흐름 | [개요](docs/overview.md) |
| 프로세스·큐·저장소의 경계 | [아키텍처](docs/architecture.md) |
| HTTP·WebSocket 계약 | [API](docs/api.md) |
| 실행 및 환경 설정 | [사용법](docs/usage.md) |
| 반드시 지켜야 할 전달 규칙 | [제약](docs/constraints.md) |
| 재시도·중복·구독 처리 원리 | [내부 동작](docs/internals.md) |
| 테스트와 운영 검증 기준 | [테스트](docs/testing.md) |
| 코딩 에이전트 도메인 이벤트 설계 | [코딩 에이전트 이벤트](docs/coding-agent-events.md) |
| 제어 없는 반응기 분해와 반응표 | [이벤트 머신](docs/event-machine.md) |
| 한 턴이 이벤트로 오가는 순서 | [턴 시퀀스](docs/turn-sequence.md) |
| 전사를 접어 두는 읽기 모델과 화면 규칙 | [읽기 모델](docs/read-model.md) |
