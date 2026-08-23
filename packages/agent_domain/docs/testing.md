# agent_domain 테스트

```powershell
npm test --workspace agent_domain
npm run lint --workspace agent_domain
```

계약 테스트는 다음을 확인한다.

- `createIngressEvent`가 event ID와 transactionKey를 생성하는지
- `streamIdOf`가 session 우선·channel fallback을 지키는지
- `createDerivedDraft`가 원 command의 stream·transaction·causation을 계승하는지
- `deterministicEventId`가 같은 입력에는 같은 UUID-shaped ID를 반환하는지
- `parseChannelClientFrame`이 server-issued field를 가진 ingress를 거부하는지
- known handler와 unknown action 모두 현재 acknowledge fallback 계약대로 실행되는지

PGMQ visibility, transaction claim, recipient fan-out은 Agent 통합 범위다. domain 테스트 통과만으로 전달 보장을 주장하면 안 된다.
