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
