# MicroTrace — Gemini AI 규칙

## 원칙

이 저장소의 AI 워크플로우 원본은 `.claude/CLAUDE.md`다. Gemini는 먼저 원본을 읽고 그 안의 필수 참조 규칙을 따른다.

## 필수 참조 (아래 순서로 반드시 읽고 작업)

1. `.claude/CLAUDE.md` — 마스터 인덱스 (모든 규칙의 진입점)
2. `.claude/CLAUDE.md`의 "필수 참조 문서" 표에 적힌 모든 문서 (ai-behavior / coding-rules / commit-convention)

## 프로젝트 문서 (역할별 분리)

- 전체 지도: `docs/README.md`
- 설명(자연어): `docs/projects/microtrace/guide/*.md`
- 코드 수정/탐색: `docs/projects/microtrace/code/microtrace.code.md`
- **코드 수정 전 연관·소유권 ★필수★**: `docs/projects/microtrace/code/microtrace.edges.md`
- 외부 규격·PRD 전문: `docs/projects/microtrace/reference/*.md`

## Gemini 어댑터 규칙

- `.claude/` 폴더는 Gemini가 자동으로 읽지 않는다. 위 경로를 명시적으로 읽어야 한다.
- `/update-docs` 등 슬래시 명령은 Gemini에서 자동 발동하지 않는다. 같은 요청을 받으면 `.claude/skills/update-docs/SKILL.md`를 직접 읽고 절차를 수행한다.
- Stop hook은 Gemini에서 자동 실행된다고 가정하지 않는다. 작업 종료 전 수동 체크:
  - 코드 수정이 있으면 `git status --porcelain`으로 변경 파일 확인.
  - 동작·구조·규약이 바뀌었으면 `.claude/skills/update-docs/SKILL.md` 절차로 문서 갱신.
  - 작업이 일단락되고 추적 파일 변경이 있으면 `.claude/rules/commit-convention.md`에 따라 커밋 메시지 제시 → **사용자 승인 후에만** 커밋.
- 에러 리포트는 `docs/reports/yyyy-mm-dd.md` 형식.
