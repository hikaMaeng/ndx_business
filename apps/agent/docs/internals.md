# Agent 내부 동작

## Worker consume

[`startWorkerConsumer`](../src/server/broker/worker-consumer.ts)는 PGMQ command를 읽고 [`toEventDraft`](../src/server/ingress/event-draft.ts)로 canonical command를 만든다. [`ExecutionStore.claim`](../src/server/idempotency/store.ts)이 세 상태 중 하나를 반환한다.

- `claimed`: Worker Thread handler를 실행하고 result를 만든다.
- `joined`: 같은 transaction이 실행 중이거나 완료됐다. 실행 중인 최초 request의 visibility 재전달만 source message를 남겨 lease reclaim을 보존하고, 다른 event ID의 새 duplicate는 delete한다.
- `conflict`: 같은 transactionKey에 다른 action/payload가 들어왔다. 요청자 channel에 conflict result를 보낸다.

claimed attempt는 `QUEUE_VISIBILITY_TIMEOUT_SECONDS / 3` 주기로 PGMQ visibility와 DB execution lease를 함께 갱신한다. 둘 중 하나라도 실패하면 handler를 abort하고 source message를 delete하지 않는다.

## fan-out

같은 transaction에 다른 `replyChannel`이 합류하면 [`agent_execution_recipient`](../src/server/idempotency/store.ts) row가 추가된다. terminal result를 만들 때 Worker는 recipient마다 `channel`을 바꾼 canonical result를 result queue에 쓴다. Router는 `agent_gateway_subscription`을 조회해 해당 Gateway 전용 queue로 복제한다.

이 과정은 전달을 한 번만 보장하지 않는다. 동일 event가 result queue·Gateway queue·WebSocket에서 다시 보일 수 있다. event store append는 같은 `eventId`를 하나의 저장 행으로 수렴시키지만, 최종 client는 `eventId` dedupe가 필요하다.

## cursor와 느린 소켓

WebSocket은 구독 직후 high-water mark를 잡고 과거 event replay와 이후 live event를 합친다. connection mailbox와 replay buffer는 각각 상한을 넘는 느린 consumer를 닫아 다른 소켓의 진행을 막지 않는다. cursor position은 event를 socket에 성공적으로 보낸 뒤 DB에 갱신된다.

## 결정 사항

- PGMQ는 일감 인계, PostgreSQL은 순서·상태·구독의 사실 원천이다. 이유: Gateway와 Worker를 독립 배치한다.
- Worker는 command를 직접 Gateway로 되돌리지 않고 result queue에 쓴다. 이유: Router가 다수 Gateway의 fan-out 위치를 한 곳으로 만든다.
- 미완료 join의 최초 request만 delete하지 않는다. 이유: visibility 재전달된 원본을 지우면 실행 lease 만료 뒤 재처리할 trigger가 사라진다.
