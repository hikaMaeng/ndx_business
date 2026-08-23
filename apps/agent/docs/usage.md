# Agent 사용법

Compose에서는 `AGENT_ROLE=gateway|worker|router`로 같은 이미지를 세 역할로 실행한다. Gateway만 외부에 공개되고 Worker·Router는 `ndx-business_internal` 네트워크 안에서 PGMQ와 PostgreSQL에 연결한다.

| 환경값 | 의미 |
| --- | --- |
| `AGENT_QUEUE`, `AGENT_RESULT_QUEUE` | command와 result의 공유 PGMQ queue |
| `AGENT_GATEWAY_QUEUE_PREFIX` | Gateway별 결과 queue 접두사 |
| `AGENT_GATEWAY_ID` | Gateway별 구독·결과 queue 식별자. 미설정 시 `HOSTNAME`, 그다음 UUID. 같은 ID의 두 live Gateway는 DB lease 때문에 두 번째가 기동 실패한다. |
| `AGENT_TERMINAL_PERSISTENCE_ALERT_ATTEMPTS` | terminal event 저장 실패가 PGMQ read count 몇 회에 도달하면 운영 경보를 남길지 정하는 임계값 |
| `QUEUE_VISIBILITY_TIMEOUT_SECONDS` | PGMQ read visibility lease 기간 |
| `AGENT_EXECUTION_LEASE_SECONDS` | PostgreSQL execution ownership lease 기간. 미설정 시 visibility의 2배 |
| `AGENT_MAX_DELIVERY_READS` | Router가 구독 Gateway 없는 result를 archive하기 전 허용하는 PGMQ delivery read 수 |
| `AGENT_MAX_EXECUTION_ATTEMPTS` | Worker 소실 뒤 reclaim 가능한 execution ownership 횟수 |
| `AGENT_MAX_OUTBOX_ATTEMPTS` | result queue 전송 실패 뒤 `dead` outbox row로 전환하기 전 횟수 |
| `AGENT_RETENTION_DAYS` | event·완료 execution·recipient·cursor 보존 일수(기본 30일) |
| `AGENT_MAX_THREADS`, `AGENT_MAX_QUEUE` | Worker Thread 실행·대기 상한 |
| `AGENT_ROUTER_CONCURRENCY` | 동시에 fan-out하는 result 수 |

`npm run deploy`는 이미 존재하는 `apps/agent/docker/.env`를 덮어쓰지 않는다. 대신 `env.defaults`에 새로 추가된 non-secret key만 append한다. 따라서 기존의 로컬 override와 credential은 유지되고, 배포 컨테이너가 필요한 reliability key를 명시적으로 받는다.

client 순서는 다음과 같다.

1. `/ws`로 연결해 결과 `replyChannel`을 `subscribe`한다.
2. HTTP 또는 WebSocket event frame으로 command를 보낸다.
3. 재시도라면 반드시 같은 `transactionKey`를 사용한다.
4. `eventId`로 중복 terminal event를 제거하고 cursor를 저장해 재접속 시 subscribe frame에 넣는다.

현재 Compose 파일은 `container_name: agent`와 단일 port publish를 사용하므로 `docker compose --scale agent=N`을 지원하지 않는다. 다중 Gateway가 필요하면 먼저 Compose/ingress를 replica 가능하도록 바꾸고 각 replica에 고유 Gateway ID를 공급해야 한다.
