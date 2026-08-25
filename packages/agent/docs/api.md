# agent API

## common export

[`agent/common`](../src/common/index.ts)은 `IngressEvent`, `EventDraft`, `EventEnvelope`, `createIngressEvent`, `createDerivedDraft`, `streamIdOf`, channel frame parser를 export한다.

```ts
interface EventEnvelope {
  eventId: string;
  eventVersion: 1;
  kind: "command" | "fact" | "result" | "progress" | "failure" | "control";
  streamId: string;
  sequence: string; // PostgreSQL bigint의 10진 표현
  action: string;
  transactionKey: string;
  channel: string;
  replyChannel?: string;
  causationEventId?: string;
  correlationId: string;
  source: "client" | "server" | "worker" | "scheduler";
  createdAt: string;
  payload: Record<string, unknown>;
}
```

`ChannelClientFrame`은 `{ type: "subscribe", channels, cursor? }` 또는 `{ type: "event", ...IngressCommand }`다. `ChannelServerFrame`은 `ready`, `subscribed`, `event`, `replay` 네 종류다.

## server export

[`agent/server`](../src/server/index.ts)은 handler registry와 `deterministicEventId`를 export한다. `deterministicEventId`는 `common` export가 아니며 server에서 파생 result/failure ID를 만들 때만 사용한다.

## front export

[`agent/front`](../src/front/index.ts)은 화면의 stream event model을 export한다. frontend는 raw socket object 대신 `ChannelServerFrame`을 parse한 뒤 이 모델에 반영한다.
