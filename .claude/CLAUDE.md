# MicroTrace — AI 마스터 규칙

> 이 파일은 **세션 시작 시 자동 로드**되는 AI의 영속 메모리다. **200줄 이하로 유지**한다(길면 준수율 하락).
> 상세 규칙은 `.claude/rules/*.md`, 코드 위치는 코드맵으로 분리해 **필요할 때만** 읽는다(토큰 절약).

## 프로젝트 개요

MicroTrace는 latency spike가 왜 났는지 — 네트워크인지, CPU throttle인지, 메모리인지 — 가장 빠르게 좁혀주는
eBPF 기반 root-cause 진단 도구다. 주인공은 **latency**. 서버 리소스(CPU throttle, OOM, memory pressure)는
cause 판별을 위한 **증거로만** 수집한다(Datadog식 전수 수집 아님).
짝 프로젝트 **NetSim**(장애 주입, 원인)과 함께 완전한 실험-분석 루프를 이룬다.

## 필수 참조 문서

| 문서 | 내용 |
|------|------|
| `.claude/rules/ai-behavior.md` | 사용자 배경(설명 톤)·답변 지침·edges 확인·버그 로그우선·검증 |
| `.claude/rules/coding-rules.md` | 아키텍처(인터페이스 격리)·언어별 규칙·안티패턴 |
| `.claude/rules/commit-convention.md` | 커밋 형식·절차 (승인 후 AI가 commit/push 실행) |

## 작업 워크플로우 (★ 매 작업 이 순서)

기능 추가·수정·리팩토링 요청을 받으면 **문서를 따라 필요한 코드만** 읽는다. 전체 통독 금지.

```
1. 진입   guide/overview.md              프로젝트 전체 파악 (라우터)
2. 조준   code/microtrace.code.md        해당 기능 §섹션 → 파일/심볼 확인
3. ★필수  code/microtrace.edges.md       수정 전 연관·소유권·의미론적 충돌 확인
4. 진입   실제 코드                       코드맵이 가리킨 파일/심볼만 (전체 X)
5. 막히면  learning/<분야>/ (개념) · reference/microtrace.md (배경·근거)
```

## 프로젝트 문서 (역할별 분리 — 필요한 역할만 로드)

> 전체 지도: `docs/README.md`. **guide=AI 축약 자연어 / code=코드맵(파일·심볼) / edges=연관·소유권 /
> reference=사람용 전문 / learning=개념 / analysis=진행 / reports=트러블슈팅.**
> **자연어 이해는 guide만, 코드 수정은 code만** 로드해 토큰을 아낀다.

| 상황 | 읽을 문서 |
|------|----------|
| 프로젝트 개요/목적 | `docs/projects/microtrace/guide/overview.md` (NetSim: `docs/projects/netsim/guide/overview.md`) |
| **코드 수정/탐색** | `docs/projects/microtrace/code/microtrace.code.md` |
| **코드 수정 전 연관·소유권 확인 ★필수★** | `docs/projects/microtrace/code/microtrace.edges.md` |
| 코드 변경 후 문서 갱신 | `microtrace.code.md` 역방향 매핑 → `/update-docs` 스킬 |
| 사람용 PRD 전문(배경·근거) | `docs/projects/microtrace/reference/microtrace.md`, `netsim/reference/{netsim,integration}.md` |

## 작업 중/후 문서 갱신 규칙 (안 썩게 하는 핵심)

| 무엇이 바뀌면 | 갱신할 문서 |
|---|---|
| 코드 구조/심볼 | `code/microtrace.code.md` |
| 연관·소유권·식별키 | `code/microtrace.edges.md` |
| 진행 단계(Phase·기능 완료) | `analysis/progress.md` (현황 단일 출처) |
| "지금 하는 작업" 전환 | `docs/ai/todo.md` |
| 새 개념 학습 | `learning/<분야>/` |
| 에러 트러블슈팅 | `reports/yyyy-mm-dd.md` |
| 설계 방향/포지션 변경 | `guide/overview.md` (+ 필요 시 reference) |

## 개발 실행

가장 자주 쓰는 명령은 `make dev`(테스트 컨테이너 + collector + React 개발 서버를 한 번에 기동).
상세 실행 순서·환경변수·접속 주소는 코드맵 `microtrace.code.md` 부록 A 및 `scripts/dev.sh` 참조.

| 대상 | 주소 |
|---|---|
| React 대시보드 | `http://localhost:5173` |
| Collector WebSocket | `ws://localhost:9090/ws` |

## 문서 파일명 규칙

- **소문자 kebab-case**(`foo-bar.md`), camelCase·공백·`_` 금지. 폴더가 곧 역할이라 역할 접두/접미 금지.
- 예외: `code/`는 `microtrace.code.md`·`microtrace.edges.md`, `reports/`는 `yyyy-mm-dd.md`.

## 용어 구분 (헷갈리지 말 것)

| 용어 | 의미 |
|---|---|
| **토폴로지** | Web UI에서 컨테이너들을 노드·엣지로 시각화한 화면 |
| **그래프** | Web UI에서 p99, p95 등 지표를 시간 축으로 나타낸 선 그래프 |

---

> 이 파일이 200줄을 넘기 시작하면 `.claude/rules/`로 더 쪼갠다.
> 루트 `CLAUDE.md`는 `@.claude/CLAUDE.md`로 이 파일을 import하고, 루트 `AGENTS.md`는 Codex/Gemini 진입점이다.
