# Agent 사용법

Compose에서는 `AGENT_ROLE=gateway|worker|router`로 같은 이미지를 세 역할로 실행한다. Gateway만 외부에 공개되고 Worker·Router는 `ndx-business_internal` 네트워크 안에서 PGMQ와 PostgreSQL에 연결한다.

| 환경값 | 의미 |
| --- | --- |
| `AGENT_QUEUE`, `AGENT_RESULT_QUEUE` | command와 result의 공유 PGMQ queue |
| `AGENT_GATEWAY_QUEUE_PREFIX` | Gateway별 결과 queue 접두사 |
| `AGENT_GATEWAY_ID` | Gateway별 구독·결과 queue 식별자. 미설정 시 `HOSTNAME`, 그다음 UUID |
| `QUEUE_VISIBILITY_TIMEOUT_SECONDS` | PGMQ read visibility lease 기간 |
| `AGENT_EXECUTION_LEASE_SECONDS` | PostgreSQL execution ownership lease 기간. 미설정 시 visibility의 2배 |
| `AGENT_MAX_DELIVERY_READS` | 영구 처리 실패를 archive로 전환하기 전 허용하는 PGMQ delivery read 수 |
| `AGENT_RETENTION_DAYS` | event·완료 execution·recipient·cursor 보존 일수(기본 30일) |
| `AGENT_MAX_THREADS`, `AGENT_MAX_QUEUE` | Worker Thread 실행·대기 상한 |
| `AGENT_ROUTER_CONCURRENCY` | 동시에 fan-out하는 result 수 |

client 순서는 다음과 같다.

1. `/ws`로 연결해 결과 `replyChannel`을 `subscribe`한다.
2. HTTP 또는 WebSocket event frame으로 command를 보낸다.
3. 재시도라면 반드시 같은 `transactionKey`를 사용한다.
4. `eventId`로 중복 terminal event를 제거하고 cursor를 저장해 재접속 시 subscribe frame에 넣는다.

현재 Compose 파일은 `container_name: agent`와 단일 port publish를 사용하므로 `docker compose --scale agent=N`을 지원하지 않는다. 다중 Gateway가 필요하면 먼저 Compose/ingress를 replica 가능하도록 바꾸고 각 replica에 고유 Gateway ID를 공급해야 한다.
