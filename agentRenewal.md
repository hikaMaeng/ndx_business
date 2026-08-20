# Agent Renewal 개발 계획

## 1. 문서 목적

이 문서는 현재 `apps/agent`를 부분 수정하는 계획이 아니다. 현재 Agent를
`old` 기준 구현으로 보존하고, 기존 코드는 동작·프로토콜·실패 사례를
참고하는 자료로 사용하면서 이벤트소싱/CQRS/CPS 기반 Agent 런타임을
재구축하기 위한 실행 계획이다.

새 구현의 권위 있는 사실은 불변 이벤트 원본이다. PGMQ는 이벤트 원본이나
상태 저장소가 아니라, 외부에서 들어온 이벤트를 Agent의 영속 이벤트 저장소로
옮기는 짧은 수명의 ingress buffer로만 사용한다.

이 문서의 완료는 코드 작성 완료가 아니다. 다음이 모두 증명되어야 한다.

- 이벤트가 PGMQ에서 삭제되기 전에 불변 event store에 기록된다.
- Thread 1 장애와 worker 장애에서 이벤트가 유실되지 않는다.
- 원본 이벤트는 변경되지 않고, 처리 결과는 새로운 이벤트로 생성된다.
- worker는 클라이언트에 직접 응답하지 않고 이벤트를 다시 등록한다.
- 서버는 채널 구독을 기준으로 각 WebSocket 연결에 이벤트를 전달한다.
- 재접속 클라이언트가 cursor 이후 이벤트를 replay할 수 있다.
- CQRS projection과 outbox가 원본 이벤트와 독립적으로 재생성된다.

## 2. 현재 기준선

현재 구현의 실제 흐름은 다음과 같다.

```text
HTTP/WebSocket
  → PGMQ send
  → consumer read_with_poll
  → transactionKey claim
  → Worker Thread 실행
  → result event 생성
  → result queue 전송
  → execution state 저장
  → EventStreamHub publish
  → 원본 PGMQ 메시지 delete
```

현재 구현은 다음 파일에 분산되어 있다.

| 영역 | 현재 경로 | 현재 역할 | Renewal에서의 처리 |
| --- | --- | --- | --- |
| HTTP ingress | `apps/agent/src/server/app.ts` | HTTP 이벤트 수신 | 새 ingress adapter로 교체 |
| WebSocket ingress | `apps/agent/src/server/transport/websocket.ts` | subscribe와 이벤트 수신 | control plane과 event ingress 분리 |
| PGMQ | `apps/agent/src/server/pgmq/client.ts` | send/read/delete/visibility | ingress buffer adapter로 축소 |
| consumer | `apps/agent/src/server/consumer.ts` | poll/claim/worker/result/delete | Thread 1 handoff coordinator로 재작성 |
| worker pool | `apps/agent/src/server/worker/pool.ts` | Worker Thread 관리 | fixed pool과 attempt 보고로 재작성 |
| worker entry | `apps/agent/src/server/worker/entry.ts` | action 분기와 실행 | domain handler dispatcher 호출만 담당 |
| event log | `apps/agent/src/server/event-log.ts` | 비동기 이벤트 INSERT | immutable event store로 승격 |
| execution | `apps/agent/src/server/execution/store.ts` | transactionKey 상태 | attempt/idempotency/checkpoint로 분리 |
| WebSocket hub | `apps/agent/src/server/stream/hub.ts` | 메모리 subscriber 순회 | channel registry/mailbox/replay로 교체 |
| domain protocol | `packages/agent_domain/src/common/protocol` | 이벤트 타입 일부 정의 | canonical envelope와 handler 계약의 기준 |

현재 코드의 주요 한계는 다음과 같다.

- PGMQ의 visibility lease와 worker 처리 상태가 분리되어 있지 않다.
- `EventLog`는 이벤트소싱 원본 저장소가 아니라 비동기 로그 기록기다.
- worker 결과를 호출자에게 반환하는 구조가 남아 있다.
- 이벤트 타입별 독립 handler registry가 없다.
- worker 처리에 consumer의 `AbortSignal`이 연결되어 있지 않다.
- 처리 실패 후 재생성할 원본/attempt/checkpoint 모델이 없다.
- `EventStreamHub`는 채널의 개념만 있고 실제 egress routing 정책이 없다.
- 연결별 outbound queue, backpressure, replay cursor가 없다.
- 실제 wire type은 `protocol/agent`의 `AgentEvent` 하나다. `protocol/envelope`를
  포함한 미사용 protocol stub은 export·import되지 않으므로 Renewal의 계약 근거로
  사용하지 않고 Phase 1에서 제거한다.
- 현재 consumer는 batch를 읽은 뒤 메시지를 순차적으로 처리한다.
- duplicate 또는 conflict 처리에서 consumer의 `return`이 loop 자체를 끝내므로,
  한 메시지로 소비가 영구 중단될 수 있다. old 기준선은 참조·복구용이지 안전한
  운영 fallback이 아니다.

## 3. 백업과 전환 원칙

### 3.1 기존 구현 보존

새 구현을 시작하기 전에 기존 Agent를 참조용 기준선으로 보존한다.

```text
old branch
  현재 HEAD 보존

scoped snapshot commit
  apps/agent
  packages/agent_domain
  Agent 관련 docs/test/docker 설정
```

현재 작업트리에서 `apps/agent/`와 `packages/agent_domain/`이 untracked인
경우가 있으므로, 단순히 현재 HEAD에 branch만 만드는 것은 충분한 백업이
아니다. 백업 시 다음을 별도로 확인한다.

- `git status --short`
- Agent 관련 tracked 파일 목록
- Agent 관련 untracked 파일 목록
- 생성물과 테스트 산출물의 보존 여부
- Admin의 무관한 dirty 변경이 백업 범위에 섞이지 않았는지

백업 단계에서는 `git add -A`를 사용하지 않는다. Agent Renewal 범위에 속한
파일만 명시적으로 stage한다.

old branch에는 현재 확인된 결함 목록(consumer 조기 종료, 비동기 EventLog 유실
가능성, worker task 무기한 pending 가능성)을 snapshot commit과 함께 남긴다.
rollback은 소스 복구 수단일 뿐, 이 결함이 해소되기 전 production fallback으로
간주하지 않는다.

### 3.2 교체 원칙

기존 `apps/agent`와 새 런타임을 장기간 혼합하지 않는다.

개발 중에는 별도 임시 경로 또는 분리된 작업 공간에서 새 계약을 검증할 수
있지만, 최종적으로는 하나의 `apps/agent` 서비스와 하나의
`packages/agent_domain`만 남긴다. 기존 코드는 old branch에서 복구할 수 있는
참고 구현으로 남긴다.

## 4. 목표 아키텍처

```text
┌─────────────────────────────────────────────────────────────┐
│ Participants                                                 │
│  Client A / Client B / Agent Server / Internal Scheduler      │
└───────────────┬─────────────────────────────────────────────┘
                │ WebSocket ingress or internal event append
                ▼
┌─────────────────────────────────────────────────────────────┐
│ PGMQ ingress buffer                                           │
│  short-lived delivery only; no domain authority               │
└──────────────────────┬──────────────────────────────────────┘
                       │ Thread 1: read → append → delete
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Immutable event store                                         │
│  event_id, stream, sequence, causation, correlation, payload  │
└───────────────┬──────────────────────┬────────────────────────┘
                │                      │
                │ processing consumer │ projection/egress consumers
                ▼                      ▼
      ┌──────────────────┐   ┌──────────────────────────────┐
      │ bounded dispatch │   │ scheduler/checkpoint          │
      │ in memory        │   │ CQRS views + outbox + replay   │
      └────────┬─────────┘   └──────────────┬───────────────┘
               ▼                            ▼
      ┌──────────────────┐        ┌──────────────────────────┐
      │ fixed worker pool│        │ channel egress router     │
      │ domain handlers  │        │ subscription registry     │
      └────────┬─────────┘        │ per-connection mailbox    │
               │                  └──────────────┬───────────┘
               │ new events                     ▼
               └──────────────► event store   WebSocket clients
```

## 5. 핵심 불변식

### 5.1 이벤트 불변성

원본 이벤트는 INSERT 이후 변경하지 않는다.

```text
원본 이벤트 변경 금지
처리 상태 UPDATE 금지
처리 결과는 새로운 이벤트
실패 결과도 새로운 이벤트
재처리는 새로운 attempt
```

예시:

```text
tool.call.request       E1
tool.call.started       E2, causation=E1
tool.call.failed        E3, causation=E1, attempt=A1
tool.call.started       E4, causation=E1, attempt=A2
tool.call.completed     E5, causation=E1, attempt=A2
```

### 5.2 PGMQ 삭제 순서

PGMQ에서 메시지를 삭제하는 것은 이벤트를 폐기하는 행위가 아니다. 불변
event store로 인계가 완료되었다는 의미다.

```text
PGMQ read
  → event_store append
  → append transaction commit
  → PGMQ delete/archive
  → memory dispatch
```

Thread 1이 append 후 delete 전에 죽으면 같은 PGMQ 메시지가 다시 보일 수
있다. `event_id` unique constraint와 idempotent append가 이를 중복으로
처리한다. 반대로 PGMQ를 먼저 삭제하면 event store append 실패 시 유실된다.

### 5.3 Ingress와 처리의 분리

Thread 1의 완료 범위는 durable append와 PGMQ delete/archive까지다. append가
commit된 뒤에는 scheduler를 깨울 수 있지만, handler 완료나 worker 결과를
await하지 않고 즉시 다음 ingress batch를 처리한다. worker capacity는 scheduler의
dispatch만 제한하며 event store append 용량을 제한하지 않는다.

```text
PGMQ read → durable append → commit → delete/archive → scheduler wakeup
                                                   └→ handler 완료를 기다리지 않음
```

### 5.4 Worker 장애

worker의 in-memory task는 유실되어도 원본 event store 이벤트는 유실되지
않아야 한다.

```text
worker failure
  → processing.failed 또는 worker.lost 이벤트
  → attempt 실패 기록
  → retry policy 판단
  → scheduler가 원본 event_id 재투입
```

worker가 `try/catch`에 들어가지 못하고 비정상 종료하는 경우도 있으므로
worker 내부 catch와 Worker Pool의 `error`/`exit` 감지를 모두 구현한다.

### 5.5 서버와 클라이언트의 관계

서버와 클라이언트는 identity-bound RPC 관계가 아니라 channel participant다.

- 클라이언트 송신은 WebSocket을 통해 서버 ingress로 들어간다.
- 이벤트는 특정 client ID를 대상으로 하지 않는다.
- 이벤트에는 channel, session/run/turn context, correlation을 담는다.
- 서버는 channel subscription을 현재 WebSocket 연결에 매핑한다.
- 최종 네트워크 전송에서만 ephemeral connection ID가 사용된다.

## 6. Canonical 이벤트 envelope

현재 export·사용 중인 wire type은 `protocol/agent`의 `AgentEvent` 하나다.
`protocol/envelope` 등 미사용 stub을 통합 대상으로 보지 않고 삭제한다. Phase 1은
`AgentEvent`를 아래 canonical contract로 교체하고 HTTP, WebSocket, front model의
전환을 같은 변경에서 끝낸다.

전환 중에도 서비스 불변식의 `action`과 `transactionKey`를 각각 event type과
logical-operation idempotency key로 유지한다. 이름을 바꾸려면 wire version을
올리고, 한 요청 안에서 두 이름을 혼용하지 않는 명시적 adapter와 제거 시점을
별도 결정한다.

권장 필드:

```ts
type EventEnvelope<TPayload = unknown> = {
  eventId: string;
  action: string;
  eventVersion: number;
  kind: "command" | "fact" | "result" | "progress" | "failure" | "control";
  streamId: string;
  sequence: string; // PostgreSQL bigint decimal; JSON precision is preserved
  channel: string;
  replyChannel?: string;
  sessionId?: string;
  runId?: string;
  turnId?: string;
  causationEventId?: string;
  correlationId: string;
  transactionKey: string;
  source: "client" | "server" | "worker" | "scheduler";
  createdAt: string;
  payload: TPayload;
};
```

외부 입력은 canonical envelope가 아니다. `IngressCommand`는 `action`,
`transactionKey`, `channel`, 선택적 `replyChannel`·session/run/turn context와
payload만 받는다. boundary validation 뒤 서버가 `eventId`, `streamId`,
`sequence`, `eventVersion`, `createdAt`, `source`를 발급하여 canonical envelope로
append한다. 클라이언트는 canonical envelope를 수신하지만 발급 전 필드를 송신하지
않는다.

stream은 순서 보장의 단위다. 일반 command는 필수 `sessionId`에서
`streamId = "session:" + sessionId`를 결정한다. session 밖 control command만
`streamId = "channel:" + channel`을 사용하며, run/turn/correlation은 stream을
만들지 않고 envelope context다. client가 `streamId`를 지정하거나 다른 session의
stream을 선택할 수 없다.

`eventId`가 이미 저장되어 있으면 append는 저장된 row와 그 `sequence`를 반환한다.
새 event만 같은 DB transaction에서 stream sequence를 발급하고 INSERT한다.
sequence는 per-stream 단조 증가하지만 gap은 허용하며, cursor는 연속 번호를
기대하지 않는다.

별도 운영 메타데이터는 envelope에 넣지 않는다.

```text
worker_id
attempt_id
lease_until
retry_count
projection status
delivery status
```

이 값들은 `event_processing_attempt`, checkpoint, outbox, runtime registry의
영역이다.

## 7. PGMQ ingress handoff

### 7.1 Thread 1의 책임

Thread 1은 PGMQ를 소비하는 단일 coordinator다.

```text
while running:
  messages = pgmq.read_with_poll(batch <= ingressAppendCapacity)
  for message in messages:
    append event_store idempotently
    commit
    delete/archive PGMQ message
    notify scheduler(event_id)
```

worker가 PGMQ에서 다시 선점하지 않는다. PGMQ visibility lease와 worker
소유권을 이중으로 만들지 않는다. scheduler만 attempt claim 뒤 memory dispatch를
수행하므로 ingress notification과 checkpoint scan이 같은 event를 이중 실행하지
않는다.

### 7.2 부하 제어

`ingressAppendCapacity`는 DB append latency와 bounded handoff queue로 정하고,
worker pool의 유휴 capacity와 독립적으로 제어한다. worker pool capacity는
scheduler의 attempt claim/dispatch 수만 제한한다.

관찰 지표:

- `read_with_poll` 호출 수
- batch 평균 크기
- event store append 처리량
- PGMQ delete/archive 처리량
- duplicate append 수
- lease 만료 재수신 수
- in-memory dispatch queue depth
- worker pool utilization
- event store append latency

Phase 2는 위 지표를 구조화 로그의 고정 필드와 `GET /metrics`의 JSON snapshot으로
노출한다. `/metrics`는 host port 공개 여부와 무관하게 operator token이 필요한
관리 endpoint이며 payload·channel·session 식별자를 반환하지 않는다. 완료·장애
테스트는 둘 중 하나가 아닌 두 경로의 수치를 검증한다.

빈 큐에서는 long poll을 사용한다. 짧은 주기의 busy polling을 사용하지
않는다.

### 7.3 대량 배치

가능하면 append와 PGMQ delete는 단일 이벤트마다 불필요한 round trip을
만들지 않도록 batch 단위로 처리한다. 단, 하나의 batch 안에서 부분 실패가
발생해도 이미 append된 이벤트가 중복 없이 재처리되도록 `event_id` unique와
idempotent insert를 보장한다.

## 8. Event store

최소 저장 구조:

```text
event_store
  event_id PRIMARY KEY
  stream_id
  sequence
  action
  event_version
  kind
  channel
  reply_channel
  session_id
  run_id
  turn_id
  causation_event_id
  correlation_id
  transaction_key
  source
  payload jsonb
  created_at
  stored_at
```

| event store column | canonical field | contract |
| --- | --- | --- |
| `event_id` | `eventId` | server-issued immutable event identity |
| `action` | `action` | event type; legacy `event_type` column은 새 store에 두지 않음 |
| `transaction_key` | `transactionKey` | logical-operation idempotency key; 별도 `idempotency_key` column은 두지 않음 |
| `stream_id`, `sequence` | `streamId`, `sequence` | server-issued ordering position |

필수 제약:

- `event_id`는 unique다.
- `(stream_id, sequence)`는 unique다.
- 새 sequence 발급과 새 event INSERT는 같은 transaction에서 수행한다. duplicate
  `event_id`는 기존 row를 반환하며 새 sequence를 예약하지 않는다.
- sequence gap은 허용한다. opaque cursor는 구독 filter와 stream별 마지막으로
  관찰한 sequence map을 가지며, "다음 연속 sequence"를 의미하지 않는다.
- 원본 payload는 append 후 수정하지 않는다.
- event store는 worker 완료 여부를 저장하지 않는다.
- 원본 조회는 sequence와 cursor를 지원한다.
- projection은 event store에서 재생성 가능해야 한다.

cursor는 서버가 발급하는 versioned opaque token이다. 내부 값은 subscription
fingerprint와 `{ streamId: lastSequence }` position vector 및 high-water vector다.
token은 최대 64 stream과 직렬화 16 KiB로 제한하며, 이를 넘는 subscription은
분리해야 한다. fingerprint가 다른 channel 또는 stream 집합의 token은 거부한다.

고빈도 이벤트에서 RDB가 병목이 되면 event store를 별도 append-only log로
교체할 수 있도록 repository 경계를 둔다. 다만 첫 구현에서는 PGMQ와
PostgreSQL 간 책임을 분리하고, event store의 인터페이스를 먼저 확정한다.

Renewal 범위에서는 event store를 자동 삭제하지 않는다. `stored_at` 기준 월 단위
partition이 가능한 schema로 만들고, retention/외부 archive는 별도 운영 결정으로
남긴다. PGMQ archive는 delivery 진단용 단기 buffer일 뿐 event store의 보존을
대체하지 않으며, 그 정리 정책도 event store 삭제 정책과 결합하지 않는다.

## 9. Worker Pool과 handler dispatcher

### 9.1 Pool 정책

worker pool은 lazy spawn이 아니라 CPU 정책에 따른 fixed resident pool을
사용한다.

- 시작 시 합리적인 최소 worker 수를 생성한다.
- 최대 수는 CPU-bound 작업 concurrency 상한으로 둔다.
- worker마다 `workerId`를 부여한다.
- running task를 가진 worker의 모든 `error`, `exit`(code 0 포함), terminate를
  lost로 판정하고 capacity가 회복되도록 교체한다.
- shutdown 시 미완료 attempt를 `worker.lost`로 보고한다.
- controller는 attempt lease와 heartbeat 만료도 lost로 판정한다.

I/O-bound 작업은 worker thread에 보내지 않는다. 외부 네트워크, DB,
WebSocket 전송은 async로 처리한다.

### 9.2 Domain handler 구조

이벤트 타입별 처리 함수는 `packages/agent_domain` 안에서 독립 폴더로
분리한다.

권장 구조:

```text
packages/agent_domain/src/server/
  handlers/
    session/
      create/
        index.ts
        handler.ts
        types.ts
      resume/
    turn/
      start/
      cancel/
    iteration/
      start/
      complete/
    tool/
      call/
      complete/
    state/
      checkpoint-create/
      compaction/
    process/
      start/
      exit/
  dispatcher/
    registry.ts
    dispatch.ts
  accumulator/
    event-accumulator.ts
```

worker entry는 이벤트 타입별 업무를 직접 구현하지 않는다.

`packages/agent_domain`에는 `./server` export subpath와 별도 server build target을
추가한다. worker bundle은 dynamic path lookup을 쓰지 않고 registry가 모든 handler를
정적으로 import하도록 하여 `esbuild ... --bundle` 산출물에 handler tree가 포함됨을
검증한다.

```text
worker entry
  → event type registry 조회
  → handler 실행
  → 작은 단위마다 abort 확인
  → 새 이벤트 accumulator 반환
  → controller에 내부 완료/실패 보고
```

### 9.3 Abort

긴 단일 blocking 함수 대신 작은 async step의 누적으로 처리한다.

```text
step 1
  → abort check
step 2
  → abort check
checkpoint
  → abort check
step 3
```

worker 내부의 큰 `try/catch`는 경계에서 유지하되, abort를 일반 오류와
동일하게 처리하지 않는다.

```text
abort       → cancelled
timeout     → timed_out
retryable   → failed + retry scheduled
permanent   → failed + dead-letter/permanent projection
worker exit → worker.lost
```

### 9.4 실패 보고

worker는 클라이언트에 응답하지 않는다. 내부 controller 메시지만 보낸다.

```text
worker → { type: "completed", eventId, attemptId, events }
worker → { type: "failed", eventId, attemptId, error }
```

controller는 이를 새로운 이벤트로 변환하고 event store에 append한다.
실패 시 즉시 재귀 실행하지 말고 scheduler가 `retryAt`, backoff, 최대 시도
횟수를 관리한다.

## 10. 처리 재생과 scheduler

원본 이벤트의 재생은 event store를 기준으로 한다.

필요한 운영 저장소:

```text
event_processing_attempt
  event_id
  attempt_id
  worker_id
  status
  started_at
  heartbeat_at
  lease_until
  finished_at
  retry_at
  error_code
  error_payload

consumer_checkpoint
  consumer_name
  stream_id
  last_sequence
  updated_at
```

`event_processing_attempt`는 `status IN ('claimed', 'running')`인 동일 `event_id`가
동시에 하나만 존재하도록 partial unique index를 둔다. scheduler는 conditional
insert/claim 성공 후에만 worker에 dispatch한다. lease 또는 heartbeat가 만료된
attempt는 하나의 transaction에서 `lost`로 전이하고 retry 후보가 된다. 완료·실패
보고는 `attempt_id`와 lease ownership을 확인해야 하며, 늦은 보고는 새 attempt의
상태를 바꾸지 못한다.

scheduler는 다음 작업을 담당한다.

1. event store에서 checkpoint 이후 이벤트와 ingress notification을 읽는다.
2. 처리되지 않았거나 retry 가능한 이벤트를 선별한다.
3. worker pool capacity를 확인한다.
4. 원자적 active-attempt claim 성공 시에만 원본 `event_id`를 memory dispatch
   queue에 넣는다.
5. 결과 이벤트를 event store에 append한다.
6. projection을 batch로 갱신한다.
7. outbox를 전달한다.
8. consumer checkpoint를 commit한다.

checkpoint commit은 처리 결과 저장 이후에 일어나야 한다. checkpoint를
먼저 이동하면 projection 또는 결과 이벤트가 누락될 수 있다.

## 11. CQRS projection

event store는 원본이고, 조회 모델은 관점별 projection이다.

초기 projection 후보:

```text
session_view
run_view
turn_view
iteration_view
tool_view
process_view
channel_event_view
```

각 projection은 독립 checkpoint를 가진다. 하나의 projection이 실패해도
다른 projection의 진행을 막지 않으며, 실패한 projection만 event store에서
재생한다.

snapshot은 이벤트를 수정하는 것이 아니다.

```text
snapshot = 특정 stream sequence까지 계산된 조회 상태
```

snapshot에는 반드시 기준 sequence를 저장한다.

## 12. Outbox

클라이언트 전달이나 외부 시스템 전달이 필요한 이벤트는 outbox를 사용한다.

```text
event handler 결과
  → event_store append
  → outbox append
  → 같은 transaction commit
  → egress dispatcher publish
  → published_at 기록
```

WebSocket `send()` 성공만으로 영속 전달을 증명하지 않는다. 소켓이 끊긴
경우에도 outbox/event store에서 replay할 수 있어야 한다.

## 13. Channel Egress Router

### 13.1 구독 registry

서버 런타임에 다음 두 인덱스를 둔다.

```text
connections:
  connectionId → socket, channels, cursor, outboundMailbox

channelSubscribers:
  channel → Set<connectionId>
```

클라이언트가 WebSocket control frame으로 subscribe/unsubscribe하면 이
registry를 갱신한다.

```json
{
  "type": "subscribe",
  "channels": ["session:abc:events", "agent.results"],
  "cursor": "versioned-opaque-resume-token"
}
```

### 13.2 전달 과정

```text
event_store/outbox event
  → delivery policy 판정
  → channel 추출
  → channelSubscribers 조회
  → 각 connection mailbox에 enqueue
  → async flush
  → socket.send
```

domain event에는 client ID를 넣지 않는다. 연결 ID는 전송 계층의 ephemeral
주소일 뿐이다.

### 13.3 연결 mailbox

각 WebSocket 연결은 bounded outbound queue를 가진다.

- queue가 가득 차면 progress/heartbeat는 drop 또는 coalesce한다.
- terminal/result 이벤트는 우선 보존한다.
- 계속 drain되지 않으면 연결을 종료한다.
- 종료된 연결은 replay 대상이 된다.
- `socket.send()`는 router의 루프를 blocking하지 않는다.

### 13.4 Replay

재접속 클라이언트는 channel 집합과 opaque cursor를 함께 보낸다.

```text
subscribe(channels, cursor)
  → connection을 channel registry에 replaying 상태로 원자 등록
  → subscription stream set의 event-store high-water vector 확보
  → cursor 이후부터 high-water까지 mailbox에 replay enqueue
  → replay 중 live event는 같은 mailbox의 live buffer에 보존
  → replay 완료 후 stream별 high-water 이후 live buffer를 sequence 순서로 flush
```

전달은 at-least-once다. 클라이언트는 `event_id`로 중복을 제거하고, 서버는 같은
stream의 sequence 순서를 mailbox에서 보존한다. progress/heartbeat coalesce는 같은
stream의 더 최신 progress만 대체할 수 있으며 terminal/result 이벤트를 앞지르거나
삭제할 수 없다.

## 14. API와 protocol 경계

Wire shape는 `packages/agent_domain/src/common/protocol/event`에만 둔다. Phase 1은
현재 `protocol/agent`를 이 위치로 이관하고 미사용 stub을 삭제한다.

필요한 protocol 목적별 폴더:

```text
protocol/event
protocol/ingress
protocol/channel
protocol/delivery
protocol/worker
protocol/projection
protocol/session
protocol/turn
protocol/tool
```

`apps/agent`의 HTTP/WebSocket handler에 inline request/response/event 타입을
두지 않는다. `protocol/ingress`의 `IngressCommand`와 `protocol/event`의
canonical `EventEnvelope`는 의도적으로 다른 타입이다. 서버와 클라이언트는 각
방향에 맞는 같은 protocol 타입을 사용하고, inbound payload는 runtime validation과
server-issued field 발급 뒤 domain event로 변환한다.

## 15. 구현 단계

### Phase 0 — 기준선 백업

- 현재 git branch와 HEAD 기록
- `git status --short` 저장
- Agent 관련 tracked/untracked 파일 목록 저장
- old branch 생성
- Agent 범위만 snapshot commit
- 기존 test/report/dist 보존 정책 결정
- old 기준선의 알려진 결함 목록과 rollback 제한 기록

완료 조건:

- old branch에서 현재 기준선을 복구할 수 있다.
- old branch가 안전한 운영 fallback이 아니라는 사실과 알려진 결함이 기록된다.
- 새 작업이 기존 Admin dirty 변경을 포함하지 않는다.

### Phase 1 — 계약 고정

- canonical envelope 확정
- event ID/stream/sequence/correlation 정의
- channel/subscription/delivery protocol 정의
- worker success/failure/lost protocol 정의
- retryable/permanent/cancelled/timeout 분류 정의
- event store와 PGMQ adapter interface 정의
- `action`/`transactionKey` compatibility, server-issued eventId, versioning 및
  front model 전환 규칙 확정
- session-derived stream key 규칙과 session 밖 control command의 channel stream
  규칙 확정
- ingress command와 canonical envelope의 분리 및 column-to-field mapping 확정
- `apps/agent/docs/architecture.md`와 `packages/agent_domain/docs/architecture.md`에
  이 계획과 code contract의 양방향 링크 추가

완료 조건:

- 미사용 protocol stub이 제거되고 canonical event contract만 export된다.
- 서버/worker/front가 같은 wire type을 사용한다.
- client가 server-issued event/stream/sequence 필드를 송신하지 않으며 inbound
  command가 결정 규칙에 따라 하나의 stream으로 수렴한다.

### Phase 2 — Ingress handoff

- PGMQ adapter 구현
- Thread 1 coordinator 구현
- event store idempotent append 구현
- append 성공 후 PGMQ delete/archive 구현
- batch capacity 조절 구현
- 구조화 metrics와 `/metrics` snapshot 구현
- `agent_events`/`agent_execution`의 폐기·rename·read-only 보존 중 하나와 DDL
  책임(initdb/migration)을 결정
- crash recovery 테스트 구현

완료 조건:

- append 전 PGMQ 삭제가 없다.
- append 후 delete 전 장애에서 유실이 없다.
- 중복 수신이 event_id 중복으로 안전하게 수렴한다.
- Thread 1은 worker/handler 완료를 기다리지 않으며 PGMQ ingress와 worker
  saturation을 독립적으로 backpressure한다.
- 기존 `agent_events`/`agent_execution`의 처리와 DDL ownership이 실제 migration
  artifact에 기록되고 legacy runtime DDL과 병행되지 않는다.

진행 상태:

- 완료: durable append 선행, event_id 수렴, 파생 이벤트의 stream/causation 승계,
  bigint sequence 변환, identity backfill, 결정적 result 식별자, token 보호
  `/metrics`, `agent_events` 동결 결정, 그리고 scheduler wakeup을 포함한 Thread 1의
  no-await/독립 backpressure 불변식. ingress는 canonical append·durable job insert·PGMQ
  delete까지만 수행하고 worker 또는 result delivery를 await하지 않는다.
- 완료: Phase 2. `agent_execution`은 transaction idempotency projection으로 보존하고,
  `agent_events`는 read-only legacy 데이터로 동결한다.

### Phase 3 — Event store와 replay

- immutable event store 구현
- stream sequence 생성
- event cursor 조회
- consumer checkpoint 구현
- processing attempt 저장
- retry scheduler 구현
- active attempt partial unique claim, lease/heartbeat 만료 회수 구현
- DLQ/permanent failure projection 구현

진행 상태:

- 완료: scheduler 단독 dispatch, ingress notification wakeup, attempt token fencing,
  processing/execution lease heartbeat와 만료 회수, 지수 backoff·최대 시도·DLQ,
  claim-path partial index, terminal/delivered operational-ledger retention.
- 완료: durable cursor의 subscription fingerprint·stream position/high-water vector,
  bounded replay page, cursor retention, 그리고 event-store 기반 projection checkpoint
  rebuild를 Phase 5/6 구현과 함께 실증했다.

완료 조건:

- worker 실패 후 원본 event_id가 다시 dispatch된다.
- live notification과 checkpoint scan이 같은 event를 동시에 dispatch하지 않는다.
- sequence/cursor는 gap을 허용하고 duplicate append가 기존 cursor position을
  반환한다.
- cursor가 subscription fingerprint와 stream별 position/high-water vector를
  검증하며 stream·token 크기 상한을 초과한 구독을 거부한다.
- projection을 event store에서 처음부터 재생성할 수 있다.

### Phase 4 — Worker domain

- fixed worker pool 구현
- handler registry 구현
- 이벤트 타입별 handler 폴더 생성
- accumulator 구현
- AbortSignal step 검사 구현
- worker catch/error/exit 보고 구현
- result/failure 이벤트 생성 구현
- `agent_domain`의 `./server` export 및 build target과 worker bundle의 static
  handler registry 포함을 검증

완료 조건:

- worker가 client response를 직접 보내지 않는다.
- worker 오류와 비정상 종료가 모두 controller에 보고된다.
- retryable 오류가 backoff를 거쳐 재처리된다.

진행 상태:

- 완료: `agent_domain/server`가 ordered static handler registry를 export하고 worker bundle은
  registry만 호출한다. fixed resident pool은 시작 시 `AGENT_MAX_THREADS`를 모두 예약하며,
  handler abort와 worker exit를 controller failure로 전환한다. worker exit/error는 terminal
  result로 오인하지 않고 execution lease를 fenced-release한 뒤 durable job retry/reclaim으로
  수렴하며, terminal event·outbox reservation·execution completion은 하나의 transaction으로
  commit된다.

### Phase 5 — CQRS와 outbox

- session/run/turn/tool projection 구현
- projection checkpoint 구현
- snapshot 기준 sequence 구현
- outbox append와 dispatcher 구현
- projection별 독립 replay 구현

진행 상태:

- 완료: terminal result의 `event_store` append와 `event_outbox` 예약은 같은 transaction으로
  commit되고, fenced dispatcher만 그 이후 PGMQ/WebSocket 발행을 시도한다. session/run/turn/tool
  projection은 독립 stream-position checkpoint를 가진다. outbox는 capped exponential backoff와
  최대 시도 DLQ를 가진다. 실 DB에서 terminal event의 outbox publish 및 특정 projection의
  checkpoint 삭제 뒤 replay/rebuild까지 검증했다.

완료 조건:

- projection 하나가 실패해도 원본 이벤트가 유실되지 않는다.
- 특정 projection만 재생성할 수 있다.
- outbox commit 이후에만 외부 전달이 시도된다.

### Phase 6 — Channel egress

- transaction join 수신자 계약: 같은 `transactionKey`의 서로 다른 `replyChannel`은
  durable recipient로 등록하고, terminal event를 채널별로 정확히 한 번 fan-out
- subscription registry 구현
- channel subscriber reverse index 구현
- per-connection mailbox 구현
- delivery policy 구현
- live event routing 구현
- replay cursor 구현
- slow client/backpressure 정책 구현
- replaying registry, high-water mark, live buffer flush 구현
- WebSocket disconnect/reconnect 테스트 구현

진행 상태:

- 완료: canonical channel frame parser, channel-fingerprint-bound opaque cursor,
  event-store high-water/replay, canonical-envelope-only live routing, replay-live handoff,
  connection별 bounded mailbox와 slow-consumer 격리.
- 완료: rendered browser에서 257-event paged replay, deliberate disconnect 뒤 cursor
  resume, channel 변경 후 reload의 cursor-fingerprint 폐기, capped reconnect를 확인했다.
  4개 채널 × 128 client request fairness run은 channel별 exact terminal receipt와
  p50/p95/p99(4,895/6,614/6,780 ms), server cursor advance, backlog zero를 기록했다.

완료 조건:

- client ID 직접 라우팅 없이 channel 기준으로 전달된다.
- 같은 transactionKey에 합류한 각 replyChannel은 자신이 관측 가능한 경로에서
  실제 실행 결과와 일치하는 terminal event를 정확히 하나 받는다.
- 서로 다른 채널을 구독한 클라이언트가 서로의 이벤트를 받지 않는다.
- 재접속 시 cursor 이후 이벤트를 수신한다.
- replay와 live의 경계에 누락이 없고 per-stream sequence 순서가 보존된다.
- 느린 클라이언트가 다른 클라이언트의 전달을 막지 않는다.

### Phase 7 — 서비스 교체와 제거

- 새 runtime을 `apps/agent` 서비스 경계에 연결
- 기존 consumer/hub/execution 경로 제거
- legacy protocol 사용처 제거
- 문서와 compose/env 갱신
- Docker build/deploy 검증
- old branch와 새 branch의 차이 기록

진행 상태:

- 완료: `event_delivery`/`DeliveryStore`와 delivery lease 환경 계약을 제거했고, 부하
  하네스는 outbox metrics를 사용한다. 배포 후 과거 delivered ledger 7,936행을 제거했으며,
  과거 테스트 리포트는 당시의 `event_delivery` 증적으로 보존한다.

완료 조건:

- 구형 processing path가 실행 경로에 남아 있지 않다.
- 모든 이벤트가 canonical envelope를 사용한다.
- 공식 deploy 경로와 WebSocket browser test가 통과한다.

## 16. 테스트 계획

### 단위 테스트

- envelope validation
- event ID 중복 append
- stream sequence 충돌
- duplicate append가 기존 sequence를 반환하고 cursor gap을 연속 번호로 오인하지 않음
- 동일 event의 active attempt 동시 claim 거부
- lease/heartbeat 만료 attempt 회수와 늦은 worker 보고 무시
- channel matching
- subscription add/remove
- mailbox overflow policy
- retry backoff
- idempotent handler
- abort between accumulator steps
- worker error/exit conversion

### 통합 테스트

- WebSocket ingress → PGMQ → event store
- append 후 PGMQ delete
- Thread 1 장애 후 duplicate convergence
- worker failure → failure event → retry
- worker crash → lost attempt → replay
- event store → projection checkpoint
- outbox commit → egress routing
- channel subscription → socket delivery
- replay high-water와 live buffer 합류, per-stream 순서 및 eventId dedupe
- worker pool code 0 exit/terminate 중 lost attempt 회수

### 장애 테스트

- PGMQ read 직후 Thread 1 종료
- event store commit 직후 Thread 1 종료
- PGMQ delete 직전 종료
- worker 실행 중 process exit
- worker 실행 중 abort
- projection scheduler 중단
- socket write 중 disconnect
- slow client mailbox overflow
- duplicate client event
- retry storm 방지
- ingress notification과 scheduler scan의 동시 dispatch claim
- worker pool을 포화시킨 상태에서도 ingress append latency와 처리량이 worker
  capacity와 독립적으로 유지되는지 확인

### 성능 테스트

측정 대상:

- PGMQ read latency
- event store append latency
- batch size별 처리량
- worker utilization
- scheduler lag
- projection lag
- outbox lag
- channel fan-out 비용
- socket별 mailbox depth
- reconnect replay latency

비교해야 할 운영 모델:

```text
single poller + bounded worker dispatch
multiple PGMQ consumers
batch ingress + batch event-store append
live-only egress
replayable egress
```

## 17. 문서와 코드 구조

최종 구조는 다음 책임을 유지한다.

```text
packages/agent_domain/src/common
  protocol과 runtime-neutral event contract

packages/agent_domain/src/server
  handler, dispatcher, accumulator, domain invariant

apps/agent/src/server/ingress
  WebSocket control/event ingress와 PGMQ handoff

apps/agent/src/server/event-store
  immutable event persistence와 cursor 조회

apps/agent/src/server/processing
  attempt, retry, scheduler, checkpoint

apps/agent/src/server/worker
  fixed Worker Thread pool과 worker lifecycle

apps/agent/src/server/egress
  channel registry, router, mailbox, replay

apps/agent/src/server/outbox
  durable external/client delivery

apps/agent/src/server/projection
  CQRS view와 snapshot
```

각 주요 contract는 다음 양방향 문서 연결을 가진다.

- 문서에서 실제 `file.ts#symbol`로 내려간다.
- 코드의 비자명한 invariant에는 해당 문서 anchor를 남긴다.
- `architecture.md`에는 새 top-level source partition을 반영한다.
- `constraints.md`에는 각 exported subpath의 consumer와 invariant를 기록한다.
- `testing.md`에는 channel, replay, worker failure locator와 시나리오를 기록한다.
- 각 Phase는 해당 source contract와 docs link를 같은 변경에서 갱신한다. 문서
  갱신을 Phase 7까지 미루지 않는다.

## 18. 완료 판정

다음 질문에 모두 `예`라고 답할 수 있을 때 Renewal을 완료로 판정한다.

### 보존성

- PGMQ를 먼저 삭제해 이벤트가 유실되는 경로가 없는가?
- event store에서 원본 이벤트를 재생할 수 있는가?
- worker가 죽어도 원본 이벤트가 남는가?

### 불변성

- 처리중/실패/완료를 원본 이벤트 UPDATE로 표현하지 않는가?
- 모든 결과와 실패가 새로운 이벤트인가?
- attempt와 worker metadata가 별도로 저장되는가?

### 처리

- worker는 event type registry를 통해 domain handler를 실행하는가?
- worker는 abort에 단계별로 반응하는가?
- 비정상 worker 종료도 재처리로 연결되는가?
- 동일 원본 이벤트에 active attempt가 둘 생길 수 없는가?
- heartbeat/lease가 만료된 task가 lost 및 재처리로 수렴하는가?

### 전달

- 클라이언트는 WebSocket만 사용하는가?
- 클라이언트 송신은 server ingress로 들어가는가?
- 클라이언트 수신은 client ID가 아니라 channel subscription으로 결정되는가?
- channel router와 connection mailbox가 실제로 존재하는가?
- 재접속 replay가 가능한가?
- replay와 live 합류 시 누락 없이 per-stream 순서가 보존되는가?

### CQRS

- projection별 checkpoint가 있는가?
- projection 하나를 독립적으로 재생할 수 있는가?
- snapshot에 기준 sequence가 있는가?
- outbox가 durable하게 동작하는가?

### 운영

- PGMQ polling, append, delete, replay, retry, mailbox lag를 관찰할 수 있는가?
- retry storm과 slow client가 전체 시스템을 막지 않는가?
- old 기준선을 복구할 수 있는가?
- metrics endpoint와 구조화 로그로 backlog, append, retry, mailbox lag를 확인할 수 있는가?
- 공식 build/deploy/browser 검증이 모두 수행되었는가?

## 19. 범위 밖 사항

이번 Renewal의 기본 범위에는 다음을 포함하지 않는다.

- 새로운 비즈니스 도메인 기능 추가
- Admin의 인증/조직 모델 재설계
- 외부 메시지 브로커의 즉시 도입
- 기존 이벤트 데이터의 무검증 일괄 변환
- 사용자 승인 없는 volume 삭제 또는 데이터 migration
- worker 수를 무제한으로 늘리는 수평 확장

외부 broker, 다중 Agent 인스턴스, 대규모 fan-out이 필요해지는 시점에는
현재 event store/consumer/checkpoint 경계를 유지한 채 transport adapter만
교체한다.
