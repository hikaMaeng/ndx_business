# agent_domain 사용법

Gateway는 `common`에서 ingress event를 만들고 PGMQ에 쓴다.

```ts
import { createIngressEvent } from "agent_domain/common";

const ingress = createIngressEvent({
  action: "hash.sha256",
  payload: { input: "hello" },
  transactionKey: "order-42",
  channel: "agent.requests",
  replyChannel: "orders.results",
});
```

Worker는 저장된 `EventEnvelope`에서 result draft를 파생하고, result ID는 server export에서 만든다.

```ts
import { createDerivedDraft } from "agent_domain/common";
import { deterministicEventId } from "agent_domain/server";

const result = createDerivedDraft(command, {
  eventId: deterministicEventId(`result:${command.transactionKey}:${command.replyChannel ?? command.channel}`),
  kind: "result",
  action: `${command.action}.result`,
  payload: { ok: true },
  source: "worker",
});
```

handler registry는 unknown action도 `acknowledge` fallback으로 처리한다. handler를 추가할 때는 기존 fallback 의미를 바꿀지, action별 reject 정책을 별도로 도입할지 함께 결정해야 한다.
