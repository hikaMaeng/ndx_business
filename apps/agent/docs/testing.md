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
| 긴 handler | execution renew와 PGMQ `set_vt`가 함께 호출됨 |
| visibility 재전달 | join된 미완료 message가 delete되지 않고, 만료 execution이 reclaim됨 |
| 같은 transaction·다른 channel | 실행은 한 번이고 recipient마다 result가 생성됨 |
| 다른 payload | 기존 lease를 바꾸지 않고 conflict result만 생성됨 |
| Worker 실패 | `worker_failed` result와 source message 재전달을 관측 |
| WebSocket replay | `ready`·`subscribed`·`event`·`replay` 및 cursor advance 확인 |

## 부하 검증

제출 수만큼 terminal result가 관측됐는지와 command/result/Gateway queue가 모두 비워졌는지를 함께 확인한다. 현재 DLQ·최대시도 정책은 없으므로 “DLQ 0”은 완료 기준이 아니다. 결과에는 Worker 수, handler 지연, stream 수, reply channel 수, queue 이름, p95/p99, duplicate event 수를 기록한다.
