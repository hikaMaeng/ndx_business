# agent 내부 동작

## ID와 draft

`eventId`는 저장 event의 정체성이고 `transactionKey`는 여러 제출을 같은 논리 실행으로 묶는 키다. 같은 transaction의 result라도 recipient channel이 다르면 Worker가 별도 result ID namespace를 사용한다. 이는 각 channel의 result가 event store에서 서로 덮이지 않게 한다.

[`createIngressEvent`](../src/common/protocol/event/index.ts)는 Gateway가 PGMQ에 쓸 event ID·생성 시각·기본 transactionKey를 만든다. [`createDerivedDraft`](../src/common/protocol/event/index.ts)는 저장된 command에서 stream·session·run·turn·correlation을 계승하고 `causationEventId`를 command ID로 둔다.

[`deterministicEventId`](../src/server/id/index.ts)는 server-derived outcome용 안정 ID다. PGMQ 재전달로 같은 outcome을 다시 만들더라도 event store append가 같은 저장 행으로 수렴하게 한다. 현재 permanent processing failure는 생성하지 않으므로 이를 정상 result와 구분하는 구현은 아직 없다.

## channel frame

channel parser는 client가 `eventId`, `streamId`, `sequence`, `eventVersion`을 ingress frame에 넣는 것을 거부한다. subscribe는 최대 32개 channel과 optional cursor를 받는다. server frame parser는 `event`에 canonical envelope의 필수 필드가 있는지 확인한다.

## 결정 사항

- `IngressEvent`와 `EventEnvelope`를 분리한다. 이유: PGMQ에 쓴 요청과 append 뒤 순서를 확정한 event를 혼동하지 않는다.
- `deterministicEventId`는 server export다. 이유: client-facing 공통 wire type에 Node crypto 구현을 섞지 않는다.
- acknowledge fallback을 둔다. 이유: 현재 action 확장 단계에서 알 수 없는 action도 관측 가능한 결과를 반환한다.
