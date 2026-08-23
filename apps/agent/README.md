Agent는 PGMQ를 경계로 Gateway, Worker, Router를 분리해 다수의 요청과 채널별 결과 전달을 처리하는 서비스다.

| Goal | File |
| --- | --- |
| 서비스의 역할과 전체 흐름 | [개요](docs/overview.md) |
| 프로세스·큐·저장소의 경계 | [아키텍처](docs/architecture.md) |
| HTTP·WebSocket 계약 | [API](docs/api.md) |
| 실행 및 환경 설정 | [사용법](docs/usage.md) |
| 반드시 지켜야 할 전달 규칙 | [제약](docs/constraints.md) |
| 재시도·중복·구독 처리 원리 | [내부 동작](docs/internals.md) |
| 테스트와 운영 검증 기준 | [테스트](docs/testing.md) |
