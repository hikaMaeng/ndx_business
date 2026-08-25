# vibeagent 내부 동작

## 신원은 연결에서 온다

`createVibeSocketPolicy`가 두 지점을 지킨다.

- `verifyUpgrade` — 핸드셰이크 전에 토큰을 admin으로 검증하고, 통과하면 `{ userId, email }`을 그 연결의 context로 붙인다
- `guardIngress` — 클라이언트가 보낸 프레임을 그대로 쓰지 않고 다시 쓴다. `userId`는 연결 context로 **덮어쓰고**, `sessionKey`가 그 사용자 접두사로 시작하지 않으면 거절하며, `vibe.turn.run` 외의 action도 거절한다

클라이언트가 보낸 값 중 서버가 믿는 것은 `prompt`와 `sessionKey`의 형태뿐이다.

## 세션 키를 클라이언트가 만드는 이유

`sessionKey = <userId>-<uuid>`다. 소유자가 키 안에 있으므로 서버가 접두사만 보면 소유권을 판정할 수 있고, 세션을 열기 위한 왕복이 필요 없다. 스트림은 첫 이벤트가 append될 때 생긴다.

## 진행 상황이 내구적인 이유

worker thread의 `emit`은 `postMessage`로 나가고 broker의 worker consumer가 이를 event store에 append하며 outbox에 넣는다. 따라서 reasoning과 stdout도 결과와 같은 내구성을 갖는다. 중간에 재접속한 브라우저는 cursor replay로 transcript 전체를 복원한다.

## 도구가 별도 프로세스인 이유

worker thread는 heartbeat(20초마다 PGMQ visibility와 DB execution lease 갱신)에 응답해야 한다. 셸 작업을 스레드 안에서 하면 그 응답이 막히고 실행 소유권을 잃는다. `runBash`는 `spawn`으로 자식 프로세스를 띄우고 스레드는 I/O만 기다린다.
