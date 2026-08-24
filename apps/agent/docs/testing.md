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
| WebSocket replay | `ready`·`subscribed`·`event`·`replay` 및 cursor advance 확인 |

## 부하 검증

[`pgmq-composite-workload.mjs`](../tests/load/pgmq-composite-workload.mjs)는 기존의 순수 delay benchmark를 대체하는 배포 E2E harness다. 기본 workload는 2,048개의 5초 delay 실행, 128개의 다채널 transaction join, 실행 중인 32개의 payload conflict, visibility timeout보다 긴 lease probe, sessionKey 없는 channel stream probe, 8개 논리 channel과 channel당 2개 WebSocket subscriber를 함께 사용한다. 성공 run은 session·channel watermark를 포함한 자기 prefix 행을 transaction으로 정리하고 0행을 강제 확인한다. 최근 실측값과 재현 절차는 [복합 부하 증적](../tests/load/pgmq-composite-workload.md)에 남긴다.

완료 기준은 단순 queue drain이 아니다. 모든 subscriber가 정확한 action·성공/실패 값을 받고 예상 밖 transactionKey를 하나도 받지 않아야 한다. event store의 command/result 행 수·완료 execution 수·긴 실행의 attempt와 `queue_redeliveries`·세 PGMQ queue의 prefix별 잔여가 모두 예상값과 일치해야 한다. lease probe는 `QUEUE_VISIBILITY_TIMEOUT_SECONDS`보다 긴 handler와 그보다 긴 `AGENT_EXECUTION_LEASE_SECONDS`를 반드시 사용한다. 결과에는 Worker 수, handler 지연, stream 수, channel·subscriber 수, ingress/terminal p50·p95·p99, lower bound, elapsed, queue 잔여와 인증된 `/metrics` 응답을 기록한다. harness는 컨테이너 env에 reliability key가 명시돼 있는지와 `/metrics.configuration`이 그 값과 같은지도 확인한다.

archive 행과 `processingDlqTotal`도 실패 시나리오의 수용 기준이다.
