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

`src/broker` 테스트는 계약 테스트가 아니라 broker 런타임 단위 테스트다. `apps/agent`에서 옮겨온 것으로 claim 3분기, lease 갱신, outbox 재시도 예산, mailbox·replay buffer 상한, Worker Thread 소실 처리를 mock pool로 검증한다.

이 둘을 합쳐 62개다. 실제 PGMQ·PostgreSQL을 쓰는 통합 검증은 여전히 `apps/agent`의 부하 하네스 범위이며, 단위 테스트 통과만으로 전달 보장을 주장하면 안 된다.
