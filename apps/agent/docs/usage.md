# Agent 사용법

Compose에서는 `AGENT_ROLE=gateway|worker|router`로 같은 이미지를 세 역할로 실행한다. Gateway만 외부에 공개되고 Worker·Router는 `ndx-business_internal` 네트워크 안에서 PGMQ와 PostgreSQL에 연결한다.

기본 compose는 `agent` Gateway 하나를 실행한다. 두 번째 Gateway endpoint가 필요하면 PowerShell에서 `$env:COMPOSE_PROFILES='gateway-ha'; npm run deploy -- agent-gateway-b`를 사용한다. `agent`와 `agent-gateway-b`는 각각 `agent`·`agent-b` identity와 18081·18082 host port를 사용하므로 같은 PGMQ queue를 경쟁 소비하지 않는다. host port는 Compose가 읽는 **저장소 루트** `.env`에서 정한다. [`compose.env.example`](../../../compose.env.example)을 `.env`로 복사해 `AGENT_GATEWAY_B_HOST_PORT=18083`처럼 이 머신의 충돌을 해소한다. `.env`는 gitignored이므로 다른 환경에는 값이 전파되지 않는다. `$env:AGENT_GATEWAY_B_HOST_PORT='18083'`는 한 번의 임시 override일 뿐이다.

| 환경값 | 의미 |
| --- | --- |
| `AGENT_QUEUE`, `AGENT_RESULT_QUEUE` | command와 result의 공유 PGMQ queue |
| `AGENT_GATEWAY_QUEUE_PREFIX` | Gateway별 결과 queue 접두사 |
| `AGENT_GATEWAY_ID` | Gateway별 구독·결과 queue 식별자. 미설정 시 `HOSTNAME`, 그다음 UUID. 같은 ID의 두 번째 Gateway는 queue를 소비하지 않고 live lease가 끝날 때까지 standby로 대기한다. standby는 `/health` 200(프로세스 생존), `/ready` 503(소유권 미획득)을 반환하고 WebSocket upgrade도 HTTP 503으로 거절한다. |
| `AGENT_TERMINAL_PERSISTENCE_ALERT_ATTEMPTS` | terminal event 저장 실패가 PGMQ read count 몇 회에 도달하면 운영 경보를 남길지 정하는 임계값 |
| `AGENT_TERMINAL_PERSISTENCE_BACKOFF_MAX_SECONDS` | terminal 저장 실패 때 source visibility를 지수 backoff하는 상한(기본 300초) |
| `QUEUE_VISIBILITY_TIMEOUT_SECONDS` | PGMQ read visibility lease 기간 |
| `AGENT_EXECUTION_LEASE_SECONDS` | PostgreSQL execution ownership lease 기간. 미설정 시 visibility의 2배 |
| `AGENT_MAX_DELIVERY_READS` | Router가 구독 Gateway 없는 result를 archive하기 전 허용하는 PGMQ delivery read 수 |
| `AGENT_MAX_EXECUTION_ATTEMPTS` | Worker 소실 뒤 reclaim 가능한 execution ownership 횟수 |
| `AGENT_MAX_OUTBOX_ATTEMPTS` | result queue 전송 실패 뒤 `dead` outbox row로 전환하기 전 횟수 |
| `AGENT_MAX_GATEWAY_DELIVERY_ATTEMPTS` | Router가 Gateway queue handoff를 재시도한 뒤 `agent_gateway_delivery.dead`로 종결하기 전 횟수 |
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

standby는 ownership 획득 뒤 같은 HTTP server의 handler만 active Gateway로 교체한다. 따라서 schema·queue·retention 초기화가 길어도 포트를 닫았다 다시 여는 공백은 없다. SIGTERM 배포는 Gateway가 PGMQ reader를 멈춘 뒤 WebSocket 연결과 HTTP keep-alive를 닫고, 그 연결의 durable subscription 삭제까지 확인한 뒤 lease를 명시 해제한다. WebSocket close code `1001`은 best-effort이며, keep-alive 강제 종료와 경합하면 client는 `1006`을 볼 수 있다. 어느 경우에도 구독 행 삭제가 ownership release보다 먼저 끝난다. SIGKILL·host 장애처럼 해제가 불가능한 종료에서는 새 process가 기본 30초 이내에 기존 lease 만료를 기다린 뒤 takeover한다. 기다리는 process는 retention·PGMQ 소비·사용자 요청 endpoint·WebSocket을 열지 않는다.
