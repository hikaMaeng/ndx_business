# vibeagent 테스트

```powershell
npm run lint --workspace vibeagent
```

이 app에는 단위 테스트가 없다. broker 런타임은 [`agent`](../../../packages/agent/docs/testing.md)가, 에이전트 루프와 bash 도구는 [`vibeagent_domain`](../../../packages/vibeagent_domain/docs/testing.md)이 각각 덮는다. 남은 것은 조립 루트와 소켓 정책이며 배포 검증으로 확인한다.

## 종단 검증

[`vibe-turn-e2e.mjs`](../tests/load/vibe-turn-e2e.mjs)는 브라우저와 같은 경로로 한 턴을 돌린다. admin에 로그인하고, 소켓 하나를 열고, 턴을 이벤트로 제출한 뒤 transcript 전체를 그 소켓에서 읽는다. HTTP agent 라우트를 쓰지 않는데 그런 것이 존재하지 않기 때문이다.

```powershell
$env:AGENT_METRICS_TOKEN='local-agent-metrics'
node apps/vibeagent/tests/load/vibe-turn-e2e.mjs "Create a simple calculator web page as index.html."
```

## 통과 기준

에이전트의 자기 보고는 증거가 아니다. 다음이 전부 참이어야 한다.

- terminal 이벤트가 `ok: true`이고 `stoppedBy`가 `final`일 것
- 생성된 파일이 `/workspace/<sessionKey>/`에서 실제로 서빙될 것
- 그 페이지를 브라우저에서 열어 **실제로 조작했을 때 올바른 값이 나올 것**
- 최근 실측과 재현 절차는 [브라우저 검증 리포트](../tests/reports/vibe-coding-e2e/)에 남긴다
