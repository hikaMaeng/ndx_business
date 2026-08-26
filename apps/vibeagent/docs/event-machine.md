# 이벤트 기계 — 제어구조 없는 워커와 클라이언트

## 무엇이 잘못이었나

`runTurn`은 `for` 루프로 턴 전체를 한 콜스택에 붙들고 있었다.

```ts
for (iteration) {
  const reply = await chat(...)          // 이 안에서 20~30초
  for (call of reply.toolCalls) {
    await runBash(...)                   // 이 안에서 최대 120초
  }
}
```

이벤트는 이 루프의 **부산물**이었다. 제어는 이벤트로 흐르지 않고 콜스택으로 흘렀다.
그래서 다음이 전부 불가능하거나 부정확했다.

| 증상 | 원인 |
| --- | --- |
| 턴 중간에 승인·취소·추가 지시를 넣을 수 없다 | 끼어들 지점이 콜스택 안에 있어 도달 불가 |
| 워커가 죽으면 턴 전체를 처음부터 다시 한다 | 진행 상태가 콜스택에만 있다 |
| 한 턴은 한 워커에 고정된다 | 다음 단계를 다른 워커가 이어받을 방법이 없다 |
| 실행 lease를 턴 내내 붙들고 heartbeat로 연명한다 | 하나의 transaction이 수 분짜리다 |

## 규칙

**어떤 핸들러도 제어구조를 소유하지 않는다.** 핸들러는 이벤트 하나를 받아,
경계가 분명한 일 하나를 하고, 다음 이벤트를 발급하고 끝난다. 프로그램은 그 연쇄다.

```ts
worker(event) {
  router[event.action](global, context[event.sessionId], event, emit, dispatch)
}
```

`for`도 `while`도 없다. 반복은 `think → act → think` 이벤트가 서로를 부르는 것으로 나타난다.

## 순서는 큐가 아니라 인과가 보장한다

이것이 이 설계의 핵심이고, 앞서 라우터를 걷어낸 근거와 같은 뿌리다.

> 이벤트 B는 이벤트 A를 **수령하고 처리한 뒤에야** 발급된다.
> 따라서 B가 A보다 먼저 존재할 수 없다. 순서는 여기서 나온다.

큐가 FIFO인지, 로그의 `sequence`가 발급 순서와 같은지에 **기대지 않는다**. 큐는
"정확히 한 워커에게 준다"만 하면 되고, 로그는 "적힌 것이 사라지지 않는다"만 하면 된다.

한 가지 예외가 있고, 정직하게 적어 둔다. **하나의 핸들러가 연속으로 쏟아내는 관측**
— 스트리밍된 추론 델타, bash stdout 청크 — 은 인과 연쇄가 아니다. A를 처리해서 B가
나오는 것이 아니라 한 번에 쏟아진다. 이 구간만은 발급 순서를 별도로 보존해야 하며,
`worker-consumer`가 progress append를 체인으로 직렬화해서 **발급 순서 = 커밋 순서**를
만든다. emit 자체는 여전히 대기하지 않는다.

## 이벤트 두 종류

| 종류 | 어디로 | 누가 받나 | 목적 |
| --- | --- | --- | --- |
| **command** | `agent_requests` 큐 | 워커 **하나** | 제어를 다음 단계로 넘긴다 |
| **progress / fact** | `event_store` 로그 | 관심 있는 클라이언트 **전부** | 관측 |

command만 큐를 탄다. 큐가 잘하는 일이 "정확히 한 명에게"이기 때문이고,
observation이 로그로 가는 이유는 "관심 있는 전부에게"이기 때문이다.

## 턴의 연쇄

```text
client ──vibe.turn.run──► [worker: startTurn]
                            emit  turn.started
                            issue vibe.turn.think (iteration 0)

          vibe.turn.think ─► [worker: think]
                            context[sessionId] 를 로그에서 fold
                            chat(stream) ── delta ──► emit iteration.reasoning/message
                            tool_calls 있으면  issue vibe.turn.act (call 목록)
                            없으면            emit turn.final  ← 턴 종료

          vibe.turn.act  ──► [worker: act]
                            emit tool.started / tool.stdout / tool.completed
                            issue vibe.turn.think (iteration + 1)
```

각 command는 **자기 자신이 하나의 transaction**이다. 턴은 더 이상 broker transaction이
아니라 **도메인 saga**다. 그래서:

- 실행 lease는 스텝 하나 길이만 잡는다. `think`는 추론 한 번, `act`는 명령 한 번
- 워커가 죽으면 **그 스텝만** 재실행된다. 앞선 스텝의 결과는 로그에 남아 있다
- 스텝마다 다른 워커가 이어받아도 된다

## 다음 command 발급의 내구성

핸들러가 "스텝 완료를 기록"하고 "다음 command를 큐에 넣는" 사이에서 죽으면 턴이
영원히 멈춘다. 둘은 하나의 transaction이어야 한다.

PGMQ가 같은 PostgreSQL 안에 있으므로 가능하다. `EventStore.append`의 `afterAppend`
훅 — 예전에 outbox 행을 쓰던 자리 — 에서 같은 client로 `pgmq.send`를 호출한다.

```ts
await eventStore.appendMany(drafts, async (client) => {
  for (const next of staged) await sendOnClient(client, commandQueue, next);
});
```

적히거나 둘 다 안 적히거나다.

## 세션 컨텍스트는 로그의 fold다

`context[event.sessionId]`가 **메모리 맵**이면 같은 워커가 그 세션의 모든 스텝을 처리해야
한다. 그것은 우리가 방금 결과 경로에서 걷어낸 sticky routing을 다시 들여오는 것이다.

그래서 컨텍스트는 **로그에서 파생**된다. 대화 `messages[]`는 그 세션 이벤트를 접은 결과이고,
클라이언트 화면이 같은 로그를 다른 방식으로 접은 것과 정확히 대칭이다.

메모리 맵은 그 파생물의 **캐시**로만 존재한다. 캐시에 없거나 위치가 어긋나면 로그에서
다시 접는다. 어느 워커가 어느 스텝을 집어도 결과가 같다.

## 클라이언트도 같은 모양이다

워커와 클라이언트는 같은 규칙을 따른다. 이벤트에 반응하는 함수들의 라우터이고,
비순수한 것은 컨텍스트로 주입된다.

```ts
// 워커
router[event.action](global, context[sessionId], event, emit, dispatch)

// 클라이언트
reducers[event.action](state, payload, context)   // context = 소켓, 저장소, 시계
```

리듀서는 순수하다 — 상태와 이벤트를 받아 새 상태를 낸다. 소켓 전송·로컬 저장·현재 시각은
전부 컨텍스트를 통한다. 그래서 리듀서는 이벤트 하나만 있으면 테스트된다.

## 이 설계가 여는 것

지금까지 "미구현"으로 남겨 두었던 것들이 새 이벤트 타입 하나씩으로 열린다.

| 기능 | 필요한 것 |
| --- | --- |
| 도구 승인 게이트 | `act` 전에 `vibe.tool.approval.requested` 를 emit하고 멈춘다. 클라이언트의 승인 이벤트가 `vibe.turn.act` 를 발급한다 |
| 턴 취소 | `vibe.turn.cancel` command. 다음 `think` 를 발급하지 않는 것으로 끝난다 |
| 재개 | 마지막 command를 다시 넣는 것이 전부다 |
| 다중 워커 협업 | 이미 된다. 스텝마다 다른 워커가 집는다 |

## 대가

- **큐 왕복이 늘어난다.** 이터레이션마다 command 하나. 지연은 수 ms 수준이지만 0은 아니다
- **컨텍스트를 스텝마다 복원한다.** 캐시가 없으면 로그를 접는 비용이 든다
- **턴 종료 판정이 도메인으로 내려온다.** broker terminal은 이제 스텝의 종료이지 턴의 종료가
  아니다. 클라이언트는 `vibe.turn.final` 을 보고 턴을 닫아야 한다
- **스텝마다 멱등 키가 필요하다.** `transactionKey` 가 턴 하나가 아니라 스텝 하나를 가리킨다
