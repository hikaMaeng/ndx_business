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
| WebSocket replay | `ready`·`subscribed`·`event`·`replay` 및 cursor advance 확인 |

## 부하 검증

[`pgmq-composite-workload.mjs`](../tests/load/pgmq-composite-workload.mjs)는 기존의 순수 delay benchmark를 대체하는 배포 E2E harness다. 기본 workload는 2,048개의 5초 delay 실행, 128개의 다채널 transaction join, 실행 중인 32개의 payload conflict, visibility timeout보다 긴 lease probe, 7개 논리 channel과 channel당 2개 WebSocket subscriber를 함께 사용한다. 최근 실측값과 재현 절차는 [복합 부하 증적](../tests/load/pgmq-composite-workload.md)에 남긴다.

완료 기준은 단순 queue drain이 아니다. 모든 subscriber가 정확한 action·성공/실패 값을 받고 예상 밖 transactionKey를 하나도 받지 않아야 한다. event store의 command/result 행 수·완료 execution 수·긴 실행의 attempt와 `queue_redeliveries`·세 PGMQ queue의 prefix별 잔여가 모두 예상값과 일치해야 한다. lease probe는 `QUEUE_VISIBILITY_TIMEOUT_SECONDS`보다 긴 handler와 그보다 긴 `AGENT_EXECUTION_LEASE_SECONDS`를 반드시 사용한다. 결과에는 Worker 수, handler 지연, stream 수, channel·subscriber 수, ingress/terminal p50·p95·p99, lower bound, elapsed, queue 잔여와 인증된 `/metrics` 응답을 기록한다.

archive 행과 `processingDlqTotal`도 실패 시나리오의 수용 기준이다.
