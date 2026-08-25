# vibeagent_domain 제약

## 도구는 bash 하나

파일 쓰기·읽기 도구를 따로 두지 않는다. 도구가 늘면 모델이 도구 선택을 틀릴 여지가 생기고, 실행 격리를 지켜야 할 지점도 늘어난다.

## 도구는 반드시 별도 프로세스

`runBash`는 `spawn`으로 **독립 OS 프로세스**를 띄운다. worker thread 안에서 셸을 흉내 내면 그 스레드가 heartbeat와 abort 신호에 응답하지 못한다. `detached: false`는 의도적이다 — worker가 죽으면 자식도 죽어야 하며, 추적되지 않는 프로세스를 남기지 않는다.

## 상한이 없는 실행은 없다

`VIBE_TOOL_TIMEOUT_MS`로 한 명령을, `VIBE_MAX_ITERATIONS`로 한 Turn을, `VIBE_TOOL_MAX_OUTPUT_BYTES`로 버퍼를 각각 막는다. 셋 중 하나라도 없으면 한 Turn이 worker를 영구 점유할 수 있다.

## 세션 격리

workspace는 `<root>/<sessionKey>`다. 세션은 다른 세션의 파일에 닿을 수 없다. 단 같은 세션의 연속 Turn은 같은 디렉터리를 공유하며 이는 의도된 동작이다.

## 이 패키지가 하지 않는 것

인증을 모른다. 세션 토큰 검증은 app 계층(`apps/vibeagent/src/server/auth`)이 하고, broker와 이 패키지는 이미 검증된 요청만 본다.
