# Agent 아키텍처

## 프로세스와 저장 경계

Gateway만 host port `18081`을 공개한다. Worker는 command queue를 읽는 내부 consumer이고, Router는 result queue를 읽어 Gateway별 queue로 fan-out하는 내부 consumer다. PGMQ가 프로세스 사이의 일감을 보관하고, PostgreSQL은 event 순서·cursor·transaction 상태·구독 대상을 보관한다.

| PostgreSQL 데이터 | 책임 | 코드 |
| --- | --- | --- |
| `event_store`, `event_stream_sequence` | canonical event·retention index와 stream별 sequence watermark | [`EventStore`](../../packages/agent_domain/src/broker/event-store/store.ts) |
| `event_subscription_cursor` | channel별 cursor position | [`EventStore`](../../packages/agent_domain/src/broker/event-store/store.ts) |
| `agent_execution`, `agent_execution_recipient` | transaction claim, 실행 결과, reply channel 집합 | [`ExecutionStore`](../../packages/agent_domain/src/broker/idempotency/store.ts) |
| `agent_gateway_instance`, `agent_gateway_subscription` | Gateway queue identity의 단일 owner와 channel 구독 lease | [`GatewaySubscriptionStore`](../../packages/agent_domain/src/broker/subscription/store.ts) |
| `agent_gateway_delivery` | Router→Gateway queue handoff ledger | [`GatewayOutboxStore`](../../packages/agent_domain/src/broker/gateway-outbox/store.ts) |

Gateway handoff는 ledger 기록 뒤에만 result source를 삭제한다. WebSocket receipt는 ephemeral이므로 최종 consumer는 `eventId` dedupe와 cursor replay를 사용한다.

## 소스 경계

| 경로 | 책임 | 대표 코드 |
| --- | --- | --- |
| `src/server/index.ts` | 조립 루트. `AGENT_ROLE`로 gateway/worker/router를 분기하고 broker 부품을 wiring한다 | [`src/server/index.ts`](../src/server/index.ts) |
| `src/server/worker-entry.ts` | Worker Thread 진입 모듈. broker 루프에 이 app의 action registry를 bind한다 | [`src/server/worker-entry.ts`](../src/server/worker-entry.ts) |
| `src/front/` | Agent 화면 | [`src/front/main.ts`](../src/front/main.ts) |

전송 계층은 이 app에 없다. PGMQ 전송, event store, claim/lease, 두 outbox, WebSocket 투영은 [`agent_domain/broker`](../../../packages/agent_domain/docs/architecture.md#srcbroker--broker-런타임)가 소유한다. 이 app은 그 라이브러리를 조립하고 자기 것 두 가지만 주입한다.

| 주입 지점 | 이 app이 공급하는 것 | 이유 |
| --- | --- | --- |
| `createApp(..., frontDir)` | `dist/front` 경로 | 정적 번들은 이 app의 build 산출물이다 |
| `createWorkerPool({ ..., workerUrl })` | `dist/server/worker.js` 경로 | worker 진입 모듈은 이 app의 esbuild 산출물이다 |

`worker-entry.ts`가 `agent_domain/broker`가 아니라 `agent_domain/broker/worker`를 쓰는 것은 의도적이다. barrel을 거치면 worker 번들이 `pg`·`express`·`ws`까지 끌어와 4KB에서 1.4MB가 된다.
