# vibeagent_domain 내부 동작

## Turn 루프

`runTurn`은 model 호출과 bash 실행을 번갈아 돈다.

1. `chat()` 호출
2. `reasoning_content`가 있으면 `vibe.iteration.reasoning`으로 emit
3. `tool_calls`가 없으면 그것이 최종 답변이고 Turn이 끝난다
4. 있으면 각 호출을 bash 프로세스로 실행하고 결과를 `role: "tool"` 메시지로 대화에 넣는다
5. 2로 돌아간다. `maxIterations`까지

## 이 모델에 맞춘 부분

이 endpoint의 모델은 reasoning 모델이라 tool call 시 `content`가 **빈 문자열**이고 사고 과정은 `reasoning_content`에 온다. `content`가 비었다고 "답이 없다"로 판정하면 모든 Turn이 즉시 끝난다. 그래서 종료 판정은 `content`가 아니라 **`tool_calls`의 부재**로 한다.

## emit이 durable한 이유

`emit`은 worker thread에서 `postMessage`로 나가고, broker의 worker consumer가 이를 event store에 append하며 outbox에 넣는다. 따라서 진행 상황도 결과와 같은 내구성을 갖고, 중간에 재접속한 클라이언트는 cursor replay로 전체 transcript를 복원한다.

progress append 실패는 실행을 죽이지 않는다. 관측을 잃는 것이 실행을 잃는 것보다 낫다.

## toolCallKey

`{turnKey}:{iterationIndex}:{n}`으로 결정적이다. 같은 Turn이 재실행돼도 같은 논리적 호출이 같은 키를 갖는다.
