# 에이전트 아키텍처

## 1. 참가자 넷

이 시스템에는 참가자가 넷 있다. 각자 **하나의 책임만** 갖고, 서로를 함수로 호출하지 않는다.

```text
 ┌────────────┐   WebSocket    ┌───────────────┐    read/delete    ┌────────┐
 │ 클라이언트 │◄──────────────►│ 이벤트 브로커 │◄─────────────────►│  PGMQ  │
 └────────────┘   이벤트 교환   └───────────────┘    write           └────────┘
        │                                                                ▲
        │ HTTP (인증·PG 테이블)                             read/delete  │ write
        ▼                                                                ▼
 ┌────────────┐                                                  ┌──────────────┐
 │ 계정 서비스│                                                  │  워커 서버   │
 └────────────┘                                                  └──────────────┘
```

| 참가자 | 하는 일 | 하지 않는 일 |
| --- | --- | --- |
| **PGMQ** | 일감 보관. `write` `read` `delete` `set_vt` `archive` 다섯 연산 | 라우팅, 필터링, 처리 |
| **이벤트 브로커** | 클라이언트가 붙는 서버. 구독한 채널의 이벤트만 골라 보내고, 클라이언트가 올린 이벤트를 PGMQ에 넣는다 | **아무 처리도 하지 않는다.** action의 의미를 모른다 |
| **클라이언트** | 소켓으로 브로커에 붙어 필요한 채널만 구독하고, 요청을 이벤트로 만들어 보낸다 | PGMQ에 직접 접근 |
| **워커 서버** | PGMQ에서 자기 담당 이벤트를 가져가 처리하고, 결과를 다시 이벤트로 등록 | 클라이언트와 직접 통신 |

브로커를 여러 대, 워커를 종류별로 여러 대 띄울 수 있다. 한계는 PGMQ가 감당하는 지점까지다.

## 2. 왜 PGMQ인가

큐는 `read`와 `delete`가 **분리**돼 있다. 꺼내도 지워지지 않고 visibility timeout 동안만 남에게 안 보인다. 그 사이에 소비자가 죽으면 메시지가 되살아난다. 이것이 이 아키텍처가 신뢰성을 얻는 유일한 원천이다.

PGMQ는 PostgreSQL 테이블이므로, 큐 조작과 도메인 테이블 쓰기를 **하나의 트랜잭션**에 넣을 수 있다. 별도 브로커(Kafka·RabbitMQ)로는 불가능한 성질이며, 아래 outbox가 이 위에 선다.

## 3. 이벤트 엔벨롭 — 고정 계약

엔벨롭 스펙은 **페이로드와 독립**이다. 새 action을 추가해도 브로커는 한 줄도 바뀌지 않는다.

```ts
interface IngressCommand {
  action: string;          // 무엇을 시키는가 (브로커는 뜻을 모른다)
  transactionKey: string;  // 멱등 단위
  channel: string;         // 어디로 보내는가
  replyChannel?: string;   // 답이 갈 곳
  sessionId?: string; runId?: string; turnId?: string;  // 식별 계층
  correlationId?: string;
  payload: Record<string, unknown>;  // 브로커에게는 불투명
}
```

`EventEnvelope`는 여기에 서버가 발급하는 `eventId`·`streamId`·`sequence`·`kind`·`source`가 더해진 것이다. **`payload`는 브로커에게 끝까지 불투명하다.** 브로커가 판단에 쓰는 것은 엔벨롭 필드뿐이다.

`streamId`는 `sessionId`가 있으면 `session:<id>`, 없으면 `channel:<channel>`이다. `sequence`는 그 stream 안에서만 의미를 갖는다 — 전역 순번을 두지 않기에 쓰기가 한 줄로 직렬화되지 않는다.

## 4. 신뢰성 — "적고 나서 지운다"

이 시스템의 유일한 불변식이다. 각 구간은 다음 사람에게 확실히 넘긴 **뒤에야** 자기 원본을 지운다.

```text
① 클라이언트 ─event─► 브로커 ─write─► agent_requests
② 워커 read ─► claim ─► 실행 ─► [terminal event + outbox 행] 한 트랜잭션
③ publisher: outbox → agent_results 전송 성공 ─► 그때 비로소 ①의 원본 delete
④ 라우터 read ─► 구독 조회 ─► [handoff 원장 기록] ─► gateway 큐 write ─► ②의 결과 delete
⑤ 브로커 read ─► 소켓 전송 ─► delete
```

②③과 ④가 **내구 인계 지점**이다. 어느 프로세스가 언제 죽어도 아직 delete되지 않은 원본이 남아 있으므로 다음 delivery가 이어받는다.

⑤에서 보장이 끊긴다. WebSocket 전달에는 영수증이 없다. 그래서 클라이언트에게 두 가지 의무가 생긴다 — `eventId` 중복 제거와 cursor 재개.

## 5. 중복을 흡수하는 지점

`exactly-once`는 달성 불가능하다. 대신 구간마다 중복을 흡수할 지점을 명시한다.

| 구간 | 보장 | 흡수 장치 |
| --- | --- | --- |
| 클라이언트 → 브로커 → 명령 큐 | at-least-once | `transactionKey` |
| 명령 큐 → 워커 실행 | at-least-once | `agent_execution` claim |
| 결과 큐 → 라우터 → 브로커 큐 | at-least-once | `eventId` (event_store 기본키) |
| 브로커 → 소켓 | at-least-once, 영수증 없음 | 클라이언트의 `eventId` dedupe |

결과 이벤트의 `eventId`는 난수가 아니라 입력에서 계산한 값이다. 같은 실행이 두 번 결과를 써도 저장은 한 행이다.

## 6. 이중 lease — 죽음과 느림의 구별

워커는 실행 중 두 시계를 함께 갱신한다.

| lease | 소유자 | 실패 시 |
| --- | --- | --- |
| PGMQ visibility (60초) | 큐 | 메시지가 다시 보인다 |
| DB execution lease (120초) | `agent_execution` | 소유권을 잃는다 |

`visibility < execution lease`인 것이 핵심이다. 큐 재전달이 일어나도 DB 소유권은 아직 원 소유자에게 있으므로, 재전달된 소비자는 `joined`로 판정하고 물러난다. **DB만이 소유권을 판정하고, 큐는 재시도 기회만 제공한다.**

그래서 heartbeat는 비대칭이다. DB lease 갱신 실패는 곧 소유권 상실이므로 handler를 abort하지만, PGMQ `set_vt` 일시 실패는 무시한다 — 재노출된 원본은 안전하게 회수되기 때문이다.

## 7. 라우터가 존재하는 이유

구상대로라면 브로커가 PGMQ에서 "자기 클라이언트가 원하는 채널의 이벤트만" 골라 읽으면 된다. **PGMQ에서는 불가능하다.** read는 큐 단위 FIFO이고, 브로커 A가 B의 클라이언트용 이벤트를 읽으면 visibility 동안 B에게 보이지 않는다 — 경쟁 소비가 곧 사고다.

두 해법이 있다.

1. **채널당 큐 1개** — 구상에 정확히 맞지만 채널 수만큼 PGMQ 테이블이 생긴다. 채널이 세션 단위면 현실적으로 불가
2. **라우터** — 결과 큐를 읽어 구독 테이블을 보고 브로커별 전용 큐로 복제

이 아키텍처는 2를 택했다. 라우터는 처리를 하지 않으므로 **브로커의 일부**이지 다섯 번째 참가자가 아니다.

| 큐 | 쓰는 쪽 | 읽는 쪽 | 경쟁 소비 |
| --- | --- | --- | --- |
| `agent_requests` | 브로커 | 워커 전부 | 목적 (부하 분산) |
| `agent_results` | 워커 publisher | 라우터 전부 | 목적 |
| `agent_gateway_<id>` | 라우터 | 해당 브로커 1개 | **사고** — instance lease로 단일 소유 강제 |

## 8. 저장소 소유권

테이블마다 주인이 하나다. 주인만 스키마를 만들고 주인만 지운다.

| 테이블 | 주인 | 용도 |
| --- | --- | --- |
| `event_store`, `event_stream_sequence` | **워커** | 불변 이벤트 기록과 stream watermark |
| `agent_execution`, `agent_execution_recipient` | **워커** | 실행 claim·lease·수신자 |
| `agent_result_delivery` | **워커** | 워커→결과 큐 outbox |
| `event_subscription_cursor` | **브로커** | 클라이언트별 재생 위치 |
| `agent_gateway_instance`, `agent_gateway_subscription` | **브로커** | 브로커 identity와 채널 구독 |
| `agent_gateway_delivery` | **브로커(라우터)** | 라우터→브로커 handoff 원장 |

브로커가 도메인 이벤트 기록을 지우지 않는 것이 중요하다. 그것을 지우는 순간 브로커는 도메인을 아는 존재가 된다.

## 9. 브로커의 판단 범위

브로커도 두 가지는 판단해야 한다. 둘 다 **엔벨롭과 연결 정보만으로** 결정된다.

1. **누가 소켓을 열 수 있는가** — 업그레이드 시점에 세션 토큰을 계정 서비스에 확인. 실패하면 핸드셰이크를 401로 거절
2. **이 프레임을 받아들일 것인가** — action이 허용 목록에 있는가(설정값), `sessionId`가 이 연결의 소유자 것인가

그 뒤 브로커는 `payload.userId`를 **연결의 신원으로 덮어쓴다.** 클라이언트가 보낸 신원은 신뢰하지 않는다. 페이로드의 나머지는 손대지 않고 통과시킨다 — 읽는 것은 워커의 일이다.

## 10. 식별 계층

| 레벨 | 어디에 | 브로커가 아는가 |
| --- | --- | --- |
| User | `payload.userId` (브로커가 각인) | 소유권 판정에만 |
| Session | 엔벨롭 `sessionId` → `streamId` | 예 (구독·소유권) |
| Turn | `transactionKey` = `turnId` | 예 (멱등 단위로만) |
| Iteration | 페이로드 안 | 아니오 |

브로커는 Turn까지만 안다. Iteration부터는 도메인이다.

## 11. 소스 지도

| 경로 | 책임 | 대표 코드 |
| --- | --- | --- |
| `src/common/protocol/event/` | 엔벨롭 계약과 draft 생성. 고정이며 payload와 독립 | [`createIngressEvent`](../src/common/protocol/event/index.ts) |
| `src/common/protocol/channel/` | WebSocket client/server frame과 cursor parser | [`parseChannelClientFrame`](../src/common/protocol/channel/index.ts) |
| `src/common/protocol/stream/` | 화면용 stream snapshot 타입 | [`StreamSnapshot`](../src/common/protocol/stream/index.ts) |
| `src/broker/service/` | 런칭 가능한 서비스 — 브로커·라우터는 완제품, 워커는 틀 | [`createEventBroker`](../src/broker/service/index.ts) |
| `src/broker/loops/` | 워커 소비, 결과 라우팅, 브로커 전달 루프 | [`startWorkerConsumer`](../src/broker/loops/worker-consumer.ts) |
| `src/broker/event-store/` | append, replay, cursor, stream watermark | [`EventStore`](../src/broker/event-store/store.ts) |
| `src/broker/idempotency/` | transaction claim·lease·recipient | [`ExecutionStore`](../src/broker/idempotency/store.ts) |
| `src/broker/delivery/`, `src/broker/gateway-outbox/` | 두 transactional outbox | [`DeliveryStore`](../src/broker/delivery/store.ts) |
| `src/broker/transport/`, `src/broker/stream/` | WebSocket, hub, mailbox, replay buffer | [`attachWebSocketTransport`](../src/broker/transport/websocket.ts) |
| `src/broker/auth/`, `src/broker/policy/`, `src/broker/http/` | 세션 검증, 소켓 정책, 웹 백엔드 | [`createSocketPolicy`](../src/broker/policy/index.ts) |
| `src/broker/pgmq/`, `src/broker/queue/` | PGMQ adapter와 transport 계약 | [`PgmqClient`](../src/broker/pgmq/client.ts) |
| `src/broker/worker/` | Worker Thread pool과 thread 진입 루프 | [`createWorkerPool`](../src/broker/worker/pool.ts) |
| `src/broker/subscription/`, `src/broker/gateway/`, `src/broker/metrics/`, `src/broker/ingress/` | 구독 registry, standby·종료, 계수기, draft 변환 | [`GatewaySubscriptionStore`](../src/broker/subscription/store.ts) |
| `src/front/client/` | 클라이언트 송수신 채널 | [`BrokerClient`](../src/front/client/index.ts) |
| `src/server/id/` | 파생 이벤트의 결정적 ID | [`deterministicEventId`](../src/server/id/index.ts) |
