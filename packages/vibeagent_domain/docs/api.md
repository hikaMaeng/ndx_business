# vibeagent_domain API

## command

action은 `vibe.turn.run` 하나다. `transactionKey`가 turnKey이고, `replyChannel`은 `vibe.<sessionKey>`다.

```json
{ "action": "vibe.turn.run",
  "payload": { "sessionKey": "...", "turnKey": "...", "userId": "...", "prompt": "..." } }
```

## progress 이벤트

전부 `kind: "progress"`이며 reply channel로 나간다. 각 이벤트는 `turnKey`를 갖는다.

| action | 의미 | 주요 payload |
| --- | --- | --- |
| `vibe.turn.started` | Turn 시작 | `workspace`, `prompt` |
| `vibe.iteration.started` | iteration 시작 | `iterationIndex` |
| `vibe.iteration.reasoning` | 모델의 reasoning_content | `reasoning` |
| `vibe.iteration.message` | 모델의 일반 텍스트 | `message` |
| `vibe.tool.started` | bash 실행 시작 | `toolCallKey`, `command` |
| `vibe.tool.stdout` / `vibe.tool.stderr` | 스트리밍 출력 | `chunk` |
| `vibe.tool.completed` | bash 종료 | `exitCode`, `timedOut`, `durationMs` |
| `vibe.turn.final` | 최종 답변 | `answer` |

## terminal result

broker가 `vibe.turn.run.result`로 append한다. `payload.value`는 `VibeTurnOutcome`이다.
