# MicroTrace 문서 지도

> 인수인계·탐색용 진입점. 문서는 **역할별로 분리**돼 있다 — 자연어 설명과 코드 정보를 섞지 않는다.
> (사람: 필요한 역할만 읽으면 됨 / AI: 필요한 한 덩이만 로드해 토큰 절약 + 안 썩음)

## 문서 역할 (5종)

| 역할 | 내용 | 코드 포함 | 어디 |
|------|------|:--:|------|
| **① 설명(Guide)** | **AI용 축약 자연어**: 목적·동작원리. 토큰 절약용. | ❌ | `projects/<p>/guide/` |
| **② 코드맵(CodeMap)** | 기능→파일/심볼, 빌드·데이터 흐름, 패키지 구조 | ✅ | `projects/<p>/code/` |
| **③ 레퍼런스(Reference)** | **사람용 전문**: PRD/기획서 원본, 면접 Q&A, 외부 규격 | △ | `projects/<p>/reference/` |
| **④ 분석/리포트(Analysis/Report)** | 진행 기록, 날짜별 디버깅 결과 | △ | `projects/<p>/analysis/`, `reports/` |
| **⑤ AI 규칙** | AI 작업 규칙, 작업 기록(todo) | — | `ai/` |

## 폴더 구조

```
docs/
  README.md                  ← 이 파일 (문서 지도)
  ai/                        ⑤ AI 규칙
    CLAUDE.md     AI 마스터 규칙 (루트 CLAUDE.md가 @import)
    GEMINI.md     Gemini CLI용 진입 규칙
    todo.md       "지금 하고 있는 작업 하나" 기록
  projects/
    microtrace/
      guide/      ① overview.md     (★AI용 축약 자연어: 목적·포지션·동작원리)
      code/       ② microtrace.code.md (★AI용 코드맵: 기능→파일/심볼+교차영향, 부록A 빌드·로드 순서)
      reference/  ③ microtrace.md(사람용 PRD 전문) · interview-qa.md(면접 Q&A)
      analysis/   ④ progress.md     (Phase별 진행 기록)
    netsim/
      guide/      ① overview.md     (AI용 축약)
      reference/  ③ netsim.md(기획 전문) · integration.md(통합 시나리오 전문)
  learning/                  학습 노트 (개념 정리)
    kernel/   ebpf, go, c_language
    network/  tcp, websocket, microservices, percentile
    infra/    linux, docker, sqlite, cause_detection
  reports/                   ④ 날짜별 트러블슈팅 (yyyy-mm-dd.md)
```

루트 `CLAUDE.md`(얇은 포인터)와 `AGENTS.md`(→ `docs/ai/CLAUDE.md` 심볼릭링크)는 ⑤ AI 규칙으로 연결된다.

## 빠른 진입

- **이 프로젝트가 뭔지 / 왜 만드는지 (AI용 축약)** → [`projects/microtrace/guide/overview.md`](projects/microtrace/guide/overview.md)
- **전체 기획서 (사람용 PRD 전문)** → [`projects/microtrace/reference/microtrace.md`](projects/microtrace/reference/microtrace.md)
- **코드 수정·탐색 시 필수 (기능→파일/심볼, 함정·교차영향, 빌드·로드 순서)** → [`projects/microtrace/code/microtrace.code.md`](projects/microtrace/code/microtrace.code.md)
- **지금 무슨 작업 중인지** → [`ai/todo.md`](ai/todo.md)
- **진행 상황 (Phase별 완료 현황)** → [`projects/microtrace/analysis/progress.md`](projects/microtrace/analysis/progress.md)
- **면접/발표 예상 질문** → [`projects/microtrace/reference/interview-qa.md`](projects/microtrace/reference/interview-qa.md)
- **NetSim Lab (AI용 축약)** → [`projects/netsim/guide/overview.md`](projects/netsim/guide/overview.md) · 전문은 `projects/netsim/reference/`
- **개념이 헷갈릴 때 (eBPF/TCP/cgroup 등)** → `learning/<분야>/`
- **에러를 만났을 때 (과거 트러블슈팅)** → `reports/`

## 원칙

- **가이드(①)는 AI가 읽는 축약 자연어다.** 파일경로·심볼·줄번호를 넣지 않고(그건 코드맵 ②), 길게 풀어 쓰지 않는다(그건 레퍼런스 ③). 토큰 절약이 목적.
- **긴 사람용 문서(PRD·기획서)는 레퍼런스(③)에 둔다.** AI는 평소 가이드만 읽고, 배경·근거가 필요할 때만 레퍼런스를 연다.
- 코드맵(②)은 줄번호 대신 **파일+심볼**로. 줄번호는 빨리 썩는다.
- 새 개념이 등장하면 `learning/<분야>/`에, 에러 트러블슈팅은 `reports/yyyy-mm-dd.md`에 기록한다.
