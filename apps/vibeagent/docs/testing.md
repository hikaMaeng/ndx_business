# vibeagent 테스트

```powershell
npm run lint --workspace vibeagent
```

이 app에는 단위 테스트가 없다. broker 런타임은 [`agent`](../../../packages/agent/docs/testing.md)가, 반응기와 bash 도구는 [`vibeagent_domain`](../../../packages/vibeagent_domain/docs/testing.md)이 각각 덮는다. 남은 것은 조립 루트와 소켓 정책이며 배포 검증으로 확인한다.

## 종단 검증

[`vibe-turn-e2e.mjs`](../tests/load/vibe-turn-e2e.mjs)는 브라우저와 같은 경로로 한 턴을 돌린다. admin에 로그인하고, 소켓 하나를 열고, 턴을 이벤트로 제출한 뒤 transcript 전체를 그 소켓에서 읽는다. HTTP agent 라우트를 쓰지 않는데 그런 것이 존재하지 않기 때문이다.

```powershell
$env:AGENT_METRICS_TOKEN='local-agent-metrics'
node apps/vibeagent/tests/load/vibe-turn-e2e.mjs "Create a simple calculator web page as index.html."
```

## 연쇄 검증

반응기 구조에서는 한 턴이 도는 것만으로는 부족하다. 어느 반응기도 다음 반응기를 부르지 않으므로, **사실과 그 사실의 반응 사본이 짝을 이루는지**를 로그에서 봐야 한다.

```sql
SELECT action, kind, audience, count(*)
FROM event_store
WHERE session_id IN (SELECT session_key FROM vibe_session WHERE workspace = 'calc-events')
GROUP BY 1, 2, 3 ORDER BY 1, 2;
```

`progress` 는 반응기가 남긴 사실이고, 같은 action의 `command` 는 디스패처가 반응표를 보고 큐에 넣은 사본이다. 두 줄이 짝을 이루면 연쇄가 돈 것이다.

- `audience = 'worker'` 인 행이 클라이언트 채널 읽기에 섞이면 안 된다
- `iteration.started` 가 실제 도구 호출 횟수와 맞아야 한다. 크게 벌어지면 반응기가 자기 dispatch에 반응하고 있다는 뜻이고, 그대로 두면 무한히 돈다

## 통과 기준

에이전트의 자기 보고는 증거가 아니다. 다음이 전부 참이어야 한다.

- terminal 이벤트가 `ok: true`이고 `stoppedBy`가 `final`일 것
- 생성된 파일이 `/workspace/<프로젝트 폴더>/`에서 실제로 서빙될 것. 세션이 아니라 프로젝트가 폴더를 정한다
- 그 페이지를 브라우저에서 열어 **실제로 조작했을 때 올바른 값이 나올 것**
- 위 연쇄 집계가 짝이 맞고 폭주가 없을 것
- 최근 실측과 재현 절차는 [브라우저 검증 리포트](../tests/reports/)에 남긴다. 반응기 분해 검증은 [`reactor-decomposition/`](../tests/reports/reactor-decomposition/)
