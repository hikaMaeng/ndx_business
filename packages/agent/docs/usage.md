# 에이전트 라이브러리로 앱 만들기

이 문서는 `agent` 라이브러리 위에 애플리케이션을 올리는 지침이다. 왜 이런 모양인지는 [개요](overview.md)와 [아키텍처](architecture.md)를 먼저 본다.

## 0. 앱이 만드는 것과 만들지 않는 것

한 앱은 보통 하나의 이미지로 여러 서비스를 돌린다. 역할은 `AGENT_ROLE`로 갈린다.

| 이 앱이 작성하는 것 | 라이브러리에서 받는 것 |
| --- | --- |
| 도메인 이벤트 계약 (`<domain>_domain/common/protocol`) | 엔벨롭·채널 프레임 |
| 워커 모듈 (한 건의 일이 하는 것) | 워커 서버의 나머지 전부 |
| 클라이언트 화면과 이벤트 해석 | 소켓 송수신과 커서 복구 |
| 어떤 action을 허용할지 (설정값) | 이벤트 브로커 전체 |

## 1. 도메인 이벤트 계약을 먼저 쓴다

코드보다 먼저 합의를 만든다. 워커와 클라이언트가 **같은 파일**을 import해야 한다.

```ts
// packages/<domain>_domain/src/common/protocol/<name>/index.ts
export const MY_ACTION = "my.thing.run" as const;

export const MY_ACTIONS = { started: "my.thing.started", progress: "my.thing.progress" } as const;
export type MyAction = (typeof MY_ACTIONS)[keyof typeof MY_ACTIONS];

export interface MyStarted { turnKey: string; at: string }
export interface MyProgress { turnKey: string; chunk: string }

/** action → payload. 한 곳에 모아야 양쪽이 어긋날 수 없다. */
export interface MyProgressMap {
  [MY_ACTIONS.started]: MyStarted;
  [MY_ACTIONS.progress]: MyProgress;
}
export type MyProgressEvent = { [K in MyAction]: { action: K } & MyProgressMap[K] }[MyAction];
```

규칙 셋.

- 모든 진행 이벤트에 **어느 단위에 속하는지**를 나타내는 키를 넣는다(`turnKey` 등). 없으면 클라이언트가 어디에 붙일지 알 수 없다
- payload에 신원(`userId`)을 담더라도 **클라이언트가 보낸 값은 신뢰하지 않는다.** 브로커가 덮어쓴다
- action 이름은 브로커의 허용 목록에 들어갈 문자열이다. 계약과 설정이 같은 상수를 쓰게 한다

## 2. 워커 모듈을 끼운다

라이브러리는 "한 건의 일" 자리 하나만 비워 둔다.

```ts
// apps/<app>/src/server/worker-entry.ts  — worker thread에서 로드된다
import { startWorkerEntry } from "agent/broker/worker";
import { executeHandler } from "<domain>_domain/server";

startWorkerEntry(executeHandler);
```

```ts
// packages/<domain>_domain/src/server/handlers/index.ts
export async function executeHandler(event: EventEnvelope, signal: AbortSignal, emit: WorkerEmit): Promise<unknown> {
  if (event.action !== MY_ACTION) throw new Error(`No worker handler for ${event.action}`);
  emit({ action: MY_ACTIONS.started, turnKey: event.transactionKey, at: new Date().toISOString() });
  // ... 실제 일
  return outcome;   // 반환값이 terminal result의 payload.value가 된다
}
```

핸들러가 지켜야 할 것.

- **`signal`을 존중한다.** abort는 소유권을 잃었다는 뜻이다. 무시하면 두 프로세스가 같은 일을 한다
- **`emit`은 내구적이다.** 진행 상황도 event store에 append되고 outbox를 탄다. 중간에 재접속한 클라이언트가 replay로 복원한다
- **긴 CPU 작업을 스레드에서 직접 하지 않는다.** 그 스레드는 20초마다 lease heartbeat에 응답해야 한다. 외부 작업은 별도 프로세스로 내보낸다
- **재실행을 전제한다.** 워커가 소실되면 handler는 처음부터 다시 돈다. 되돌릴 수 없는 부작용은 `event_store`를 조회해 건너뛴다

## 3. 서비스를 런칭한다

앱의 조립 루트는 역할을 고르는 일만 한다.

```ts
// apps/<app>/src/server/index.ts
import { readEnv, createEventBroker, createResultRouter, createWorkerServer, runService } from "agent/broker";
import { MY_ACTION } from "<domain>_domain/common";

const env = readEnv();

if (env.role === "worker") {
  await runService(createWorkerServer({ worker: new URL("./worker.js", import.meta.url) }));
} else if (env.role === "router") {
  await runService(createResultRouter());
} else {
  await runService(createEventBroker({
    allowedActions: [MY_ACTION],                    // 설정이지 구현이 아니다
    accountBaseUrl: process.env.ACCOUNT_BASE_URL,
    replyChannelFor: (sessionId) => `my.${sessionId}`,
    clientDir: process.env.CLIENT_DIR,
    assetDir: process.env.ASSET_DIR,
  }));
}
```

`worker`에 넘기는 URL은 **이 앱의 번들 산출물**이다. 라이브러리는 그 경로를 추측하지 않는다.

## 4. 클라이언트를 만든다

라이브러리에서 얻는 것은 송수신뿐이다.

```ts
import { BrokerClient } from "agent/front";
import { MY_ACTION, parseMyProgressEvent } from "<domain>_domain/common";

const client = new BrokerClient({
  token: () => sessionStorage.getItem("session") ?? "",
  channels: () => [`my.${sessionId}`],
  onState: (state) => model.setConnection(state),
  onEvent: (envelope) => model.apply(envelope),   // 해석은 전부 도메인
});
client.connect();

// 요청도 이벤트다
client.send({ action: MY_ACTION, transactionKey: turnKey, sessionId, payload: { prompt } });
```

클라이언트가 반드시 해야 하는 두 가지.

- **`eventId` 중복 제거.** 전달은 at-least-once다. 안 하면 정상 동작 중에도 같은 조각이 두 번 보인다
- **세션 식별자를 엔벨롭에 넣기.** `payload`가 아니라 `sessionId` 필드다. 브로커는 엔벨롭만 본다

## 5. HTTP는 어디까지인가

PostgreSQL 계정·정책처럼 **어드민이 설정한 테이블에 걸린 것만** HTTP로 처리한다. 그 외 에이전트와의 모든 대화는 소켓 이벤트다.

턴 제출을 HTTP로 두면 하나의 대화가 두 전송으로 쪼개지고 소켓은 알림 채널로 격하된다. 브로커의 웹 백엔드가 기본 제공하는 HTTP는 다음뿐이다.

| 경로 | 용도 |
| --- | --- |
| `POST /api/auth/login` · `/api/auth/signup` | 계정 서비스로 프록시 |
| `GET /api/auth/me` | 세션 검증 후 현재 사용자 |
| `GET /workspace/...` | 워커 산출물 (설정된 경우) |
| `GET /health` · `/ready` · `/metrics` | 운영 |

앱 고유의 PG 라우트가 더 필요하면 `extendHttp`로 얹는다.

## 6. 환경값

| 이름 | 기본값 | 의미 |
| --- | --- | --- |
| `AGENT_ROLE` | `gateway` | `gateway` · `worker` · `router` |
| `DATABASE_URL` | — | PGMQ와 PostgreSQL |
| `AGENT_GATEWAY_ID` | 호스트명 | 브로커 identity. 같은 ID의 두 번째 프로세스는 standby |
| `QUEUE_VISIBILITY_TIMEOUT_SECONDS` | `60` | 큐 재전달 시계 |
| `AGENT_EXECUTION_LEASE_SECONDS` | visibility × 2 | 소유권 시계. visibility보다 길어야 한다 |
| `AGENT_MAX_EXECUTION_ATTEMPTS` | `5` | 워커 소실 재획득 상한 |
| `AGENT_MAX_OUTBOX_ATTEMPTS` | `10` | 결과 전송 재시도 상한 |
| `AGENT_MAX_GATEWAY_DELIVERY_ATTEMPTS` | `10` | handoff 재시도 상한 |
| `AGENT_RETENTION_DAYS` | `30` | 보존 기간 |
| `AGENT_MAX_THREADS` | CPU × 2 | worker thread 상한 |

## 7. 하면 안 되는 것

- **브로커에 도메인 지식을 넣지 않는다.** action 이름을 코드에 적거나, payload를 읽거나, 도메인 테이블을 지우는 순간 브로커는 재사용 불가능해진다
- **클라이언트가 보낸 신원을 믿지 않는다.** 연결이 유일한 권위다
- **워커 스레드에서 무경계 작업을 하지 않는다.** lease heartbeat가 막힌다
- **`payload`에 세션 식별자만 넣고 엔벨롭을 비우지 않는다.** 브로커가 소유권을 판정할 수 없다
