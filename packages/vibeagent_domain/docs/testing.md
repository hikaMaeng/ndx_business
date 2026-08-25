# vibeagent_domain 테스트

```powershell
npm test --workspace vibeagent_domain
npm run lint --workspace vibeagent_domain
```

단위 테스트가 검증하는 것.

- `parseVibeTurnRequest`가 필드 누락을 거부하는지
- `runBash`가 exit code·stdout·stderr를 정확히 돌려주고, 타임아웃 시 `timedOut`을 세우는지
- `runBash`가 출력 상한을 넘겨도 버퍼가 무한히 자라지 않는지
- `VibeSessionModel`이 같은 `eventId`를 두 번 받아도 화면 상태를 중복 반영하지 않는지

실제 모델 호출과 계산기 생성은 단위 범위가 아니다. 배포된 스택에 대한 browser 검증으로만 주장할 수 있다.
