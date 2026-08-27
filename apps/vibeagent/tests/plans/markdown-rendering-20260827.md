# 마크다운 렌더링 — 검증 계획

## 목표

에이전트의 답변을 마크다운으로 그린다. mermaid까지 포함해서. 그러면서
스트리밍 중에도 대화가 옆으로 스크롤되지 않아야 한다.

## 환경

- 클라이언트 `http://localhost:18081`, 계정 `vibe@example.com` (저장소 로컬 픽스처)
- 검증은 크롬 확장으로 실제 브라우저에서
- 프로젝트 `calc-events`

## 사전 조건

1. `npm run lint`, `npm test` 통과
2. `npm run deploy vibeagent` 성공, `/ready` 200
3. mermaid 청크가 실제로 서빙될 것 (`/assets/flowDiagram-*.js` → 200)

## 단계

1. **문법 전반** — 한 턴에서 제목·굵게·기울임·인라인 코드·목록·표·코드펜스를 한꺼번에
   요구하고, 각각이 해당 요소로 그려졌는지 DOM에서 센다
2. **mermaid** — ```mermaid 펜스 하나만 출력하게 하고 SVG가 그려졌는지 본다.
   노드 라벨이 실제로 보이는지까지 확인한다. 빈 SVG는 그려진 게 아니다
3. **다이어그램 뷰박스** — `getBBox()` 로 실제로 그린 범위를 재고, 그것이 `viewBox`
   안에 들어오는지 본다. 벗어나면 노드가 잘린다
4. **하이라이트** — 언어를 붙인 펜스에서 `.hljs-*` 요소가 나오는지 본다
5. **XSS** — 답변에 `<img src=x onerror=alert(1)>` 와 `<script>alert(2)</script>` 를
   그대로 쓰게 시킨다. 스크립트 태그 0개, `onerror` 속성 0개, 그리고 그 문자열이
   **글자로는 보여야** 한다. 안 보이면 소독이 아니라 유실이다
6. **가로 스크롤** — 대화 영역의 `scrollWidth > clientWidth` 를 본다.
   `documentElement` 가 아니라 대화 영역이어야 한다. 넘치는 건 그 안이다
7. **최악 형태** — 4000px짜리 코드 한 줄, 8열 표, 1600px SVG를 DOM에 직접 넣고
   대화 영역이 여전히 안 넘치는지 본다. 스트리밍 중 잘린 펜스가 만드는 모양이다
8. **재생 경로** — 세션을 다시 열어 저장된 기록에서도 같은 것이 그려지는지 본다.
   스트리밍과 다른 경로다

## 기대 결과

- 각 마크다운 요소가 해당 태그로 존재
- mermaid SVG가 라벨을 갖고 그려지고, 그린 범위가 `viewBox` 안에 들어옴
- `.hljs-*` 가 존재
- `script` 0, `onerror` 0, 페이로드는 글자로 보임
- 대화 영역이 스트리밍 중에도 완료 후에도 옆으로 스크롤되지 않음
- 넓은 것은 각자 자기 상자 안에서 스크롤

## 로케이터 계약

| 대상 | 로케이터 |
| --- | --- |
| 마크다운 본문 | `[data-testid=markdown]` |
| 대화 영역 | `[data-testid=transcript]` |
| 코드펜스 / 언어 | `.markdown .md-code`, `.md-code-lang` |
| 하이라이트 | `.markdown .hljs-keyword`, `.hljs-string`, `.hljs-title` |
| 다이어그램 | `.md-diagram`, `.md-diagram svg`, 실패 시 `.md-diagram-failed` |
| 입력/전송 | `[data-testid=prompt-input]`, `[data-testid=run-turn]` |

## 남길 로그

- 요소별 개수
- SVG의 `viewBox` 와 `getBBox()` 값 쌍
- 대화 영역의 `scrollWidth`/`clientWidth`
- 최악 형태 주입 전후 값
