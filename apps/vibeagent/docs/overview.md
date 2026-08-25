# vibeagent 개요

vibeagent는 사용자가 자연어로 요청하면 bash 명령으로 그것을 만들어내는 코딩 에이전트다. 화면·인증·조립은 이 app이, 전달 보장은 [`agent`](../../../packages/agent/docs/overview.md) broker가, 에이전트 루프는 [`vibeagent_domain`](../../../packages/vibeagent_domain/docs/overview.md)이 맡는다.

```text
브라우저 ─(WebSocket)─ Gateway → agent_requests → Worker ─(bash 자식 프로세스)─ workspace
                          │                            │
                          └──── tail ── event_store ◄── append
```

일감은 큐로 흐르고(정확히 한 Worker가 가져간다) 사실은 로그로 흐른다(관심 있는 Gateway가 전부 읽는다). Gateway는 로그를 소비하지 않고 자기 위치부터 따라 읽으므로 몇 대를 띄워도 서로를 막지 않는다.

## 전송이 둘로 나뉘는 이유

HTTP는 **인증과 바이트 전달**만 한다. 로그인 프록시, `/api/vibe/me`, 클라이언트 번들, 생성된 파일이 전부다.

에이전트와의 대화는 **전부 WebSocket 이벤트**다. 턴 제출도 이벤트고 진행 상황도 이벤트다. 제출만 HTTP로 두면 하나의 대화가 두 전송으로 쪼개지고, 소켓은 단순 알림 채널로 격하된다.

## 도구는 bash 하나

파일 쓰기 도구도 읽기 도구도 없다. 모델은 heredoc으로 파일을 쓰고 `cat`으로 되읽는다. 모든 도구 실행은 worker thread가 아니라 **별도 OS 프로세스**다.
