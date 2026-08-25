# Test Plan: broker-library-extraction

## Created

2026-08-25

## Goal

`apps/agent/src/server`의 전송 계층을 `packages/agent_domain/src/broker`로 옮긴 뒤에도 전달 보장이 이동 전과 동일한지 확인한다. 이 리팩터는 동작 변경을 의도하지 않았으므로 **모든 관측값이 이전 실측과 같아야** 하며, 하나라도 다르면 이동 중 의미가 바뀐 것이다.

검증 대상은 코드가 어디에 있는지가 아니라 다음 네 가지다.

1. 옮긴 단위 테스트가 하나도 유실되지 않았는가
2. 세 프로세스 role이 여전히 같은 이미지에서 기동하는가
3. claim·lease·두 outbox·큐 배수가 부하에서 이동 전과 같은 수치를 내는가
4. WebSocket 투영이 브라우저까지 도달하는가

## Environment

- 저장소: `F:\dev\ndx_business-pgmq`, 브랜치 `master`
- 컨테이너: `admin`(PostgreSQL 18 + PGMQ 1.10), `agent`(gateway, host 18081), `ndx-business-agent-worker-1`, `ndx-business-agent-router-1`
- Worker Thread 96, `QUEUE_VISIBILITY_TIMEOUT_SECONDS=60`, `AGENT_EXECUTION_LEASE_SECONDS=120`
- 빌드·테스트는 WSL Ubuntu-24.04에서 실행한다. Windows에서 `npm install`을 돌리면 esbuild 네이티브 바이너리가 win32로 교체돼 tsx 로더가 죽는다.
- 부하 하네스는 반대로 Windows에서 실행한다. `docker exec`를 쓰는데 이 WSL 배포판에는 Docker 통합이 없다.

## Preconditions

- `npm install`을 WSL에서 실행해 linux esbuild 바이너리가 설치돼 있을 것
- 세 큐(`agent_requests`, `agent_results`, `agent_gateway_agent`) backlog가 0일 것
- 두 ledger(`agent_result_delivery`, `agent_gateway_delivery`)에 `ready`/`dead` 행이 없을 것

## Steps

1. `npm run build` — 패키지 `tsc` 빌드와 app `esbuild` 번들이 모두 성공하는지
2. `npm run lint` — 6개 task 전부 통과하는지
3. `npm test --workspace agent_domain` — 옮긴 51개 + 기존 11개
4. arch / compose / docs 검사를 **저장소 루트를 인자로 넘겨** 실행 (인자를 빼면 스킬 baseline 템플릿을 검사해 무의미해진다)
5. `npm run deploy -- agent agent-worker agent-router`
6. 단건 왕복: `POST /api/events`로 `hash.sha256` 하나를 보내고 `event_store`에 command·result 2행, `agent_execution`이 `completed`·attempts=1·redeliveries=0인지
7. 복합 부하: `pgmq-composite-workload.mjs` (2,048 delay + 128 join + 32 conflict + 65s lease probe + 8 channel × 2 subscriber)
8. 브라우저: `http://localhost:18081` 로드 → WS 연결 확인 → 서버에서 이벤트를 밀어 넣고 타임라인 도달 확인

## Expected Results

| 항목 | 기대값 | 근거 |
| --- | --- | --- |
| agent_domain 테스트 | 62/62 (51 이동 + 11 기존) | 이동 전 agent 51 + agent_domain 11 |
| lint | 6 task 성공 | |
| arch/compose/docs | 셋 다 `violations=0` | |
| worker 번들 크기 | 10KB 미만 | worker thread는 `pg`·`express`·`ws`를 담으면 안 된다 |
| 배포 `/ready` | 200 | |
| 단건 왕복 | command+result 2행, `completed`/1/0 | |
| 부하 `expectedTerminalCount` | 2,242 | 이동 전 실측과 동일해야 함 |
| 부하 `eventRows` | 4,484 | |
| 부하 `completedExecutions` | 2,082 | |
| 부하 `gatewayDeliveryRows` / `Undelivered` | 2,242 / 0 | |
| 부하 `leaseAttempts` / `leaseRedeliveries` | 1 / 0 | |
| 부하 큐 backlog | 세 큐 모두 0 | |
| 부하 실패 계열 메트릭 증가분 | 전부 0 | `brokerReadFailures`, `routerUnmatchedResults`, `processingDlqTotal`, `queueVisibilityRenewFailures`, `gatewayDeliveryRetries`, `gatewayDeliveryDeadLetters` |
| 부하 `elapsedMs` | 110,000 이상 130,000 이하 | worker-only 하한 + 허용 오버헤드 20,000 |
| 브라우저 | WS `online`, 결과 이벤트가 타임라인에 DELIVERED로 표시 | |

`elapsedMs`는 절대값 비교 대상이 아니다. 같은 머신에서도 빌드·컨테이너 작업 직후에는 수천 ms 흔들린다. 하한과 상한 사이에 있으면 통과이며, 이동 전 값과의 차이를 성능 변화로 해석하면 안 된다.

## Logs To Capture

- `deploy-report-begin` ~ `deploy-report-end` 블록 전체
- 하네스 최종 JSON 한 줄 (`gatewayMetrics` 포함)
- 단건 왕복의 `event_store`·`agent_execution` 질의 결과
- 브라우저 콘솔 오류 유무

## Locator Contract

`apps/agent/src/front`는 이번 리팩터에서 수정하지 않았다. 검증은 기존 마크업의 접근성 트리에 의존한다.

| 대상 | 우선 로케이터 | 대체 |
| --- | --- | --- |
| 연결 상태 | 텍스트 `stream · online` | `.live-dot.online` 클래스 |
| 이벤트 발행 폼 | `form[data-form="event"]` | role `form` |
| 서버 전송 버튼 | 접근 가능한 이름 `Send to agent` | `button[name="mode"][value="server"]` |
| 타임라인 항목 | 텍스트 `DELIVERED` + action 이름 | `.event-row.inbound` |

이 화면은 `role`/`aria-label`이 부족하고 상태를 클래스와 본문 텍스트로 표현한다. 텍스트 기반 로케이터는 i18n 키(`agent.event.state.delivered.status`)가 바뀌면 깨진다. 구조 의존 셀렉터를 쓰지 않으려면 후속 작업에서 `data-testid`를 도입해야 한다.
