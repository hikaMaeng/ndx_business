# 코딩 에이전트 이벤트 설계

이 문서는 아직 구현되지 않은 설계다. `apps/agent`의 기존 전달 계약(Gateway/Worker/Router, PGMQ 3큐, `event_store` append-only, 이중 outbox, claim/lease)은 이 설계의 **전제이자 보존 대상**이며 이 문서는 그 위에서 도는 도메인 어휘(`action`/`payload`)와 식별자 계층만 정의한다. 기존 스키마·큐·프로세스 경계는 하나도 바뀌지 않는다.

## 출처

이 어휘는 백지에서 새로 만든 것이 아니라 [`apps/agent/src/front/main.ts:16-27`](../src/front/main.ts)의 "Vibe coding control room" 목업에 이미 나열돼 있던 action 목록을 정리한 것이다. 그 목업은 서버 handler가 하나도 연결돼 있지 않다 — [`handlers/index.ts`](../../../packages/agent_domain/src/server/handlers/index.ts)에는 `hash-sha256`/`test-delay`/`acknowledge`뿐이며, 이 action 중 하나를 실제로 보내면 Worker가 `No worker handler for <action>`으로 실패한다. i18n 카피([`assets/i18n/ko.json`](../assets/i18n/ko.json)의 `agent.coding.*` 키)에는 "세션 / 실행 / 턴"이라는 표현이 이미 있어 `runId`(실행)를 세션과 턴 사이에 두려던 의도가 있었음을 보여준다. 이 설계는 그 의도를 **명시적으로 채택하지 않는다** — 아래 §1 참조.

## 1. 식별자 계층 — 4단계, Run 제외

`EventEnvelope`에는 `sessionId`/`runId`/`turnId`가 이미 1급 필드로 있고([`common/protocol/event/index.ts:8-10`](../../../packages/agent_domain/src/common/protocol/event/index.ts)), `createDerivedDraft`가 이 셋을 원인 이벤트에서 자동 전파한다. 이 설계는 User-Session-Turn-Iteration 4단계를 쓰고 `runId`는 채우지 않는다.

| 레벨 | 식별자 | 스트림/트랜잭션 대응 | 비고 |
| --- | --- | --- | --- |
| User | `payload.userId` | 없음 — 스트림이 아니다 | 세션 소유권 메타데이터로만 존재. 유저별 타임라인이 필요하면 `event_store`를 `session_id`로 묶는 파생 뷰로 얻는다. 새 stream 종류를 만들지 않는다 |
| Session | `sessionId` | `streamId = session:<sessionId>` | 기존 그대로 재사용 |
| Turn | `turnId` | `transactionKey = turnId`, `agent_execution` 1행 | 기존 claim/joined/conflict, 이중 lease, terminal outbox 그대로 적용 |
| Iteration | `payload.iterationIndex` | Turn 실행 내부의 순번, 자기 claim 없음 | DB 컬럼 추가 없음 |
| Tool call | `payload.toolCallKey` | **자기 자신의 독립 `transactionKey`이자 독립 `agent_execution` 행** | §3 참조 — Iteration과 달리 자기 claim을 가진다 |

`runId`는 옵션 필드이므로 이 도메인에서 안 채워도 코드 변경이 필요 없다. 세션과 턴 사이에 "실행(프로세스 생존 기간)" 레벨이 실제로 필요해지면 그때 되살린다.

## 2. kind 재사용 매핑

기존 kind enum(`command`/`progress`/`fact`/`result`/`failure`/`control`)은 확장하지 않는다.

| kind | 이 도메인에서의 뜻 |
| --- | --- |
| `command` | 사용자의 Turn 지시, 또는 Iteration이 발행하는 Tool 호출 명령 |
| `progress` | Turn/Iteration/Tool 내부의 중간 산출물 (재실행돼도 안전) |
| `fact` | 되돌릴 수 없는 부작용이 실제로 일어났다는 기록 (재실행하면 안 됨 — §4) |
| `result` | Turn 또는 Tool call의 최종 응답 |
| `failure` | Turn 또는 Tool call 전체의 비정상 종료 |
| `control` | 세션/턴 생명주기, 사용자 개입, 승인 게이트 |

## 3. 이벤트 카탈로그

### Turn

| action | kind | 비고 |
| --- | --- | --- |
| `turn.start.request` | command | 기존 명령 그대로 |
| `turn.input.append.request` / `turn.stop.request` | control | 진행 중 실행에 개입 — §5의 suspend 메커니즘 필요 |
| `turn.final.response` | result | 기존 `ExecutionStore.complete()` 그대로 |
| `turn.cancelled.response` / `turn.failed.response` | failure | |

### Iteration (Turn 내부, 자기 claim 없음)

| action | kind | 멱등 키 |
| --- | --- | --- |
| `iteration.started` | progress | `iter:{turnId}:{iterationIndex}` |
| `iteration.reasoning` | progress | 위 + `:reasoning` |
| `iteration.tool.summary` | fact | `iter-summary:{turnId}:{iterationIndex}` — 여러 tool 호출 결과를 취합한 보고 |
| `iteration.failed` | failure | 해당 iteration만, Turn 전체 아님 |

### Tool call — 독립 실행 (핵심 결정)

도구 호출은 자기 생명주기를 갖는 독립된 실행 단위다: 자기 `transactionKey`(`toolCallKey`)로 `agent_requests`에 재진입해 자기 `agent_execution` 행을 갖는다. 이터레이션 안의 함수 호출이 아니라 재귀적으로 같은 파이프라인을 한 번 더 도는 것이다.

| action | kind | 대응 |
| --- | --- | --- |
| `tool.call.request` | command | 새 `transactionKey = toolCallKey`, `causationEventId` = 요청한 iteration의 event |
| `tool.started` | progress | 도구 호출 처리기가 claim 성공 직후 emit |
| `tool.progress` / `tool.stdout` / `tool.stderr` | progress | 스트리밍. 멱등 키 `tool:{toolCallKey}:{chunkSeq}` |
| `tool.completed` / `tool.failed` | result / failure | 이 도구 호출의 `agent_execution.complete()` |
| `tool.cancel.request` / `tool.cancelled` | control | 기존 `AbortController` 그대로 재사용 |

`toolCallKey`는 **결정적**이어야 한다: `{turnId}:{iterationIndex}:{toolName}:{callSeq}`. Turn이 재클레임돼 오케스트레이션이 같은 도구 호출을 다시 dispatch해도 `ExecutionStore.claim()`이 같은 transactionKey를 `joined`로 잡아 중복 실행을 막는다 — 새 안전장치가 아니라 기존 claim 규칙의 재귀적 재사용이다.

### Process (Tool의 자식 — 실제 OS 프로세스 하나)

| action | kind |
| --- | --- |
| `process.start.request` / `started` / `stdout` / `stderr` / `exit` / `timeout` | progress / fact |
| `process.cancel.request` / `cancelled` | control |

하나의 tool 호출이 여러 process를 만들 수 있다 (예: `run_tests` tool이 `npm test` 프로세스 하나를 만듦). 부모-자식 관계(`causationEventId` = tool call의 이벤트)를 명시해야 한다.

### Hook, Model, Checkpoint/Context, Approval, Artifact

| 그룹 | action 예시 | kind | 비고 |
| --- | --- | --- | --- |
| Hook | `hook.invoke/started/completed/failed/skipped` | progress/control | tool 호출 전후에 끼는 부가 이벤트 |
| Model | `model.select/change.request` → `selected/updated.response` | control | fact로도 남겨야 "이 턴이 어느 모델로 돌았는지" 재현 가능 |
| Checkpoint | `checkpoint.create.request/created.response` | fact | §4 재개 메커니즘의 명시적 API 버전 |
| Context 유지보수 | `compaction.*`, `kv.*` | fact/control | 세션 레벨, `AGENT_RETENTION_DAYS`(30일)와 별도 정책 필요 |
| Approval | `approval.request/granted/rejected/expired` | control | **몇 분~몇 시간 대기 가능 — §5 suspend가 필수인 근거** |
| Artifact | `artifact.register/progress.request` → `registered/failed.response` | fact | 실제 파일 diff·커밋의 최종 기록 |

## 4. 재개(resume) 안전성 — fact는 다시 하면 안 되는 부작용이다

Worker가 재클레임되면 handler는 처음부터 다시 실행된다(기존 불변식 — "attempts는 fenced owner가 된 횟수"). `progress`/`result`는 재실행돼도 멱등(결정적 eventId, §1)하지만, `file.write.committed` 같은 `fact`는 **실제 부작용 그 자체**라 이벤트 dedupe로 막을 수 없다.

해법 — 재개 시 `event_store`를 `run_id`(또는 turnId)로 조회해 이미 기록된 `fact`를 보고 완료된 iteration을 건너뛴다. 새 테이블이 필요 없다 — `event_store`를 읽기 전용으로 재사용하는 것뿐이다. 다만 handler(코딩 에이전트 루프)가 "재개형"으로 짜여야 한다.

## 5. 실행 확장 지점 — "보존"의 실제 경계

도구 호출을 기다리는 동안 Turn은 끝나지 않고 멈춰 있어야 한다. Approval처럼 몇 시간 걸릴 수 있는 대기는 Worker Thread 하나로 붙잡아 둘 수 없다(AGENTS.md: "Worker Thread는 shell·git·model 같은 무경계 작업을 직접 하면 안 된다"). 다음 세 곳은 **데이터 손실 없이 추가되지만 새 코드가 필요**하다 — Gateway/Worker/Router의 기존 코드, PGMQ 3큐, `event_store`, 이중 outbox는 한 줄도 바뀌지 않는다.

1. **[`idempotency/store.ts`](../../packages/agent_domain/src/broker/idempotency/store.ts)의 `claim()`** — 현재 `joined` 분기가 `completed: row.status !== "running"`으로만 판단한다. `status='suspended'`가 생기면 대기 상태를 최종 결과로 오판한다. `suspended`를 위한 4번째 분기 필요(기존 claimed/joined/conflict는 그대로 둠).
2. **`agent_execution`에 `suspend_state jsonb` 컬럼 추가** — "무엇을 기다리는지, 재개하면 어디부터 할지". 컬럼 추가는 안전하다 — 기존 쿼리 어디도 `SELECT *`를 쓰지 않는다.
3. **재개 트리거 — 새 컴포넌트** — `tool.completed`가 `agent_results`에 들어왔을 때 "이게 어느 suspended turn을 깨우는지" 보고 `agent_requests`에 재개 command를 넣는 소비자. Router를 확장하거나 별도 역할(`AGENT_ROLE=orchestrator`)로 새로 만들 수 있다.

## 6. 미해결 / 향후 과제

- `iteration.tool.summary`의 정확한 취합 규칙(여러 tool 결과를 어떻게 하나의 fact로 합칠지)은 미정
- `hook.*`의 실행 시점(도구 호출 전/후 중 어디에 끼는지)과 실패 시 tool 호출 자체를 막을지는 미정
- `model.select`의 스코프가 Session 전체인지 Turn 단위인지 미정
- `compaction.*`(컨텍스트 압축)과 `AGENT_RETENTION_DAYS`의 관계 미정
