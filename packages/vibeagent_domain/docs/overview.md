# vibeagent_domain 개요

이 패키지는 코딩 에이전트가 "무엇을 하는가"만 소유한다. 큐·claim·lease·outbox 같은 전달 기계는 전부 [`agent`](../../agent/docs/overview.md) broker에 있고, 여기에는 없다.

세 조각이다.

- `common` — Turn 요청과 진행 이벤트의 wire 계약. worker와 웹클라이언트가 같은 파일을 import한다
- `server` — 추론 클라이언트, bash 도구, 에이전트 루프, broker에 bind할 action registry
- `front` — 이벤트 스트림을 화면 상태로 접는 모델

도구는 bash 하나뿐이다. 파일 쓰기 도구도, 읽기 도구도 없다. 모델은 heredoc으로 파일을 쓰고 `cat`으로 되읽는다. 도구를 하나로 묶으면 모델이 "어떤 도구를 쓸까"를 고민하지 않고 셸 한 줄만 생각하면 되며, 실행 격리도 한 곳만 지키면 된다.
