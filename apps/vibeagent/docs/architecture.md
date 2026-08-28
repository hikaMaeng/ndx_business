# Agent 아키텍처

## 프로세스와 저장 경계

Gateway만 host port `18081`을 공개한다. Worker는 command queue를 읽는 내부 consumer다. PGMQ는 **일감**만 보관하고, 결과는 큐를 타지 않는다 — Worker가 `event_store`에 append하면 Gateway들이 각자 그 로그를 tail한다. 그래서 Gateway는 서로 교체 가능하고 늘리는 데 조정이 필요 없다.

| PostgreSQL 데이터 | 책임 | 코드 |
| --- | --- | --- |
| `event_store`, `event_stream_sequence` | canonical event·retention index와 stream별 sequence watermark | [`EventStore`](../../packages/agent/src/broker/event-store/store.ts) |
| `event_subscription_cursor` | channel별 cursor position | [`EventStore`](../../packages/agent/src/broker/event-store/store.ts) |
| `agent_execution`, `agent_execution_recipient` | transaction claim, 실행 결과, reply channel 집합 | [`ExecutionStore`](../../packages/agent/src/broker/idempotency/store.ts) |

Gateway의 channel 구독은 테이블이 아니라 프로세스 메모리다. 아무도 특정 Gateway로 라우팅하지 않으므로 밖에서 알 필요가 없다. WebSocket receipt는 ephemeral이므로 최종 consumer는 `eventId` dedupe와 cursor replay를 사용한다.

## 소스 경계

| 경로 | 책임 | 대표 코드 |
| --- | --- | --- |
| `src/server/index.ts` | 조립 루트. `AGENT_ROLE`로 gateway/worker를 분기하고 broker 부품을 wiring한다 | [`src/server/index.ts`](../src/server/index.ts) |
| `src/server/worker-entry.ts` | Worker Thread 진입 모듈. broker 루프에 이 app의 action registry를 bind한다 | [`src/server/worker-entry.ts`](../src/server/worker-entry.ts) |
| `src/front/` | Agent 화면 | [`src/front/main.ts`](../src/front/main.ts) |

전송 계층은 이 app에 없다. PGMQ 전송, event store, claim/lease, 로그 tail, WebSocket 투영은 [`agent/broker`](../../../packages/agent/docs/architecture.md#srcbroker--broker-런타임)가 소유한다. 이 app은 그 라이브러리를 조립하고 자기 것 두 가지만 주입한다.

| 주입 지점 | 이 app이 공급하는 것 | 이유 |
| --- | --- | --- |
| `createApp(..., frontDir)` | `dist/front` 경로 | 정적 번들은 이 app의 build 산출물이다 |
| `createWorkerPool({ ..., workerUrl })` | `dist/server/worker.js` 경로 | worker 진입 모듈은 이 app의 esbuild 산출물이다 |

`worker-entry.ts`가 `agent/broker`가 아니라 `agent/broker/worker`를 쓰는 것은 의도적이다. barrel을 거치면 worker 번들이 `pg`·`express`·`ws`까지 끌어와 4KB에서 1.4MB가 된다.

## 서버는 둘, 컨테이너는 그 배치일 뿐

| 등장인물 | 어디에 있나 |
| --- | --- |
| 바이브에이전트 웹백엔드 (Express) + 이벤트 브로커 | `vibeagent` 컨테이너. 웹클라이언트도 여기서 나간다 |
| 워커서버 | `vibeagent-inference` · `-tool-runner` · `-turn-control` · `-read-model` |
| PG 서버 (pg + vector + pgmq) | `admin` 컨테이너에 내장 |

브로커를 웹백엔드에서 떼어낼 수 없다. 클라이언트는 브로커를 웹소켓 서버로
인식하고, 브라우저에 보이는 포트는 이 서버뿐이다.

워커는 `AGENT_QUEUES`로 자기가 볼 큐를 받는다. 목적별로 컨테이너를 쪼개든 하나에
모으든 `docker-compose.yml`만 바뀐다.

### 없는 것

`dispatcher` 역할은 없다. `router` 프로세스를 지운 지 이틀 만에 같은 모양이 다른
이름으로 돌아온 것이었고, 팩트를 기록하는 일과 그것을 누가 들어야 하는지 정하는
일은 나눌 수 있는 두 가지가 아니다. 지금은 브로커가 반응표를 받아 스스로 한다.

브로커는 여러 대 뜰 수 있다. 로그 읽기는 각자의 커서라 조율이 필요 없지만 —
그게 로그를 쓰는 이유다 — 적재는 다르다. 두 브로커가 같은 팩트에 반응하면 같은
추론을 두 번 산다. 그래서 적재 루프만 advisory lock을 잡고, 잡은 쪽만 넣는다.

### 커넥션 예산

PG 서버 하나가 전부를 받는다. 프로세스마다 풀이 셋(런타임·큐·리액터)이므로
`AGENT_DATABASE_POOL_MAX`와 `AGENT_POOL_MAX`를 서비스별로 적어 둔다. 상한은
`POSTGRES_MAX_CONNECTIONS`(기본 200)다.
