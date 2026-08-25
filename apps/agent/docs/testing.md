# Agent 테스트

## 코드 검증

```powershell
npm test --workspace agent
npm test --workspace agent_domain
npm run lint --workspace agent
```

문서 그래프 검사 스크립트는 현재 PGMQ worktree에 포함돼 있지 않다. 이 worktree를 검사할 때는 스크립트를 제공하는 원 worktree에서 대상 경로를 명시해야 하며, 없는 상대 `.codex/...` 경로를 실행 명령으로 문서화하지 않는다.

## 통합 검증

| 시나리오 | 반드시 확인할 사실 |
| --- | --- |
| 단일 command | command append, result enqueue, source message delete 순서 |
| 긴 handler | execution lease보다 짧은 PGMQ visibility를 넘겨도 `queue_redeliveries=0`과 `attempts=1` |
| visibility 재전달 | join된 미완료 message가 delete되지 않고, 만료 execution이 reclaim됨 |
| 같은 transaction·다른 channel | 실행은 한 번이고 recipient마다 result가 생성됨 |
| 다른 payload | 기존 lease를 바꾸지 않고 conflict result만 생성됨 |
| Worker 실패 | `worker_failed` result와 source message 재전달을 관측 |
| Worker 소실 | source message는 남고 execution attempt만 release된 뒤 다음 delivery가 reclaim함 |
| 실행 시도 소진 | recipient별 `*.processing.failure` outbox 행이 먼저 생기고 source message가 archive됨 |
| result queue 전송 실패 | terminal event와 outbox row가 남고 publisher retry 뒤 queue 전송·fence 완료됨 |
| outbox retry 소진 | 동일 row가 `dead`·`last_error`로 남고 `outboxDeadLetters`가 증가하며 자동 삭제되지 않음 |
| retention 뒤 유휴 stream 재사용 | event 행을 prune해도 `event_stream_sequence` watermark가 남고 새 event의 sequence가 이전 cursor position보다 큼 |
| 만료 execution lease | Gateway retention이 row를 terminalise하지 않고, source PGMQ 재전달이 fenced reclaim함 |
| Gateway identity 충돌 | 같은 `AGENT_GATEWAY_ID`의 두 번째 process는 queue consume 전에 passive standby가 되고 `/health=200`, `/ready=503`, ingress·WebSocket upgrade=`503`을 반환하며 Docker HEALTHCHECK가 `/ready` 실패로 unhealthy를 표시함 |
| Gateway graceful handoff | reader 종료 → WebSocket close/subscription row 삭제 → HTTP keep-alive 강제 종료 → ownership release 순서를 확인하고, takeover 직후 이전 channel subscription이 0행 |
| terminal persistence 장기 실패 | source는 남고 execution attempt는 증가하지 않으며 read-count 임계에서 `terminalPersistenceAlerts`가 증가함 |
| terminal persistence backoff | source를 delete/archive하지 않고 read count에 따라 visibility가 증가하며 configured cap을 넘지 않음 |
| Gateway handoff ledger | Router가 Gateway별 row를 기록하고 queue handoff 완료 뒤에만 result source를 delete함 |
| Gateway handoff retry 소진 | queue 전송 오류가 `AGENT_MAX_GATEWAY_DELIVERY_ATTEMPTS` 뒤 `dead`·`last_error` row로 종결되고 source가 무한 재전달되지 않음 |
| watermark 수명 | retained event 또는 cursor가 있으면 보존하고, 둘 다 없는 오래된 stream만 정리함 |
| WebSocket replay | `ready`·`subscribed`·`event`·`replay` 및 cursor advance 확인 |

## 부하 검증

[`pgmq-composite-workload.mjs`](../tests/load/pgmq-composite-workload.mjs)는 기존의 순수 delay benchmark를 대체하는 배포 E2E harness다. 기본 workload는 2,048개의 5초 delay 실행, 128개의 다채널 transaction join, 실행 중인 32개의 payload conflict, visibility timeout보다 긴 lease probe, sessionKey 없는 channel stream probe, 8개 논리 channel과 channel당 2개 WebSocket subscriber를 함께 사용한다. 성공 run은 session·channel watermark를 포함한 자기 prefix 행을 transaction으로 정리하고 0행을 강제 확인한다. 최근 실측값과 재현 절차는 [복합 부하 증적](../tests/load/pgmq-composite-workload.md)에 남긴다.

`gateway-outbox-budget.mts`는 별도의 실 DB 경계 검증이다. 이 test는 `GatewayOutboxStore.failed()`를 실제 PostgreSQL에 연결해 1~9회는 `ready/retry`, 10회째는 `dead/last_error`, 그 뒤 `pending()`은 빈 배열임을 확인하고 자기 행을 삭제한다. Compose network에서 실행한다.

```powershell
docker run --rm --network ndx-business_ndx-business_internal -e AGENT_INTEGRATION_DATABASE_URL=postgres://postgres:postgres@admin:5432/ndx_business -v "${PWD}:/workspace" -w /workspace ndx-business-agent:latest node --import tsx apps/agent/tests/integration/gateway-outbox-budget.mts
```

완료 기준은 단순 queue drain이 아니다. 모든 subscriber가 정확한 action·성공/실패 값을 받고 예상 밖 transactionKey를 하나도 받지 않아야 한다. event store의 command/result 행 수·완료 execution 수·긴 실행의 attempt와 `queue_redeliveries`·세 PGMQ queue의 prefix별 잔여가 모두 예상값과 일치해야 한다. 또한 terminal result마다 `agent_gateway_delivery.delivered` row가 정확히 하나 있어야 하며 ready/dead row가 없어야 한다. lease probe는 `QUEUE_VISIBILITY_TIMEOUT_SECONDS`보다 긴 handler와 그보다 긴 `AGENT_EXECUTION_LEASE_SECONDS`를 반드시 사용한다. 결과에는 Worker 수, handler 지연, stream 수, channel·subscriber 수, ingress/terminal p50·p95·p99, lower bound, elapsed, queue 잔여와 인증된 `/metrics` 응답을 기록한다. harness는 컨테이너 env에 reliability key가 명시돼 있는지와 `/metrics.configuration`이 그 값과 같은지도 확인한다.

archive 행과 `processingDlqTotal`도 실패 시나리오의 수용 기준이다.

## 단위 테스트의 위치

이 app에는 서버 단위 테스트가 없다. broker 런타임이 [`agent_domain`](../../../packages/agent_domain/docs/testing.md)으로 옮겨가면서 51개가 함께 이동했고, 남은 것은 role 분기 조립 루트와 3줄짜리 worker 진입 모듈이다. 이 app은 lint·배포 검증·부하 하네스로 덮인다.

## 리팩터 검증 기록

전송 계층을 라이브러리로 옮긴 작업의 계획과 실행 기록은 [broker-library-extraction 계획](../tests/plans/broker-library-extraction-20260825.md)과 [실행 리포트](../tests/reports/broker-library-extraction/20260825_150500.md)에 있다. 동작 변경을 의도하지 않은 이동이므로 부하 실측이 이전 값과 같은지가 통과 기준이었다.
