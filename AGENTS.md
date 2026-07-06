# MicroTrace — Codex AI 규칙

## 원칙

이 저장소의 AI 워크플로우 원본은 `.claude/CLAUDE.md`다. Claude Code와 Codex가 같은 절차를 타도록,
Codex는 먼저 원본을 읽고 그 안의 필수/선택 참조 규칙을 따른다.

## 필수 참조 (아래 순서로 반드시 읽고 작업)

1. `.claude/CLAUDE.md` — 마스터 인덱스이자 공통 원본
2. `.claude/CLAUDE.md`의 "필수 참조 문서" 표에 적힌 모든 문서 (ai-behavior / coding-rules / commit-convention)

## 프로젝트 문서 (역할별 분리)

- 전체 지도: `docs/README.md`
- 설명(자연어): `docs/projects/microtrace/guide/*.md` (NetSim: `docs/projects/netsim/guide/*.md`)
- 코드 수정/탐색: `docs/projects/microtrace/code/microtrace.code.md`
- **코드 수정 전 연관·소유권 ★필수★**: `docs/projects/microtrace/code/microtrace.edges.md`
- 외부 규격·PRD 전문: `docs/projects/microtrace/reference/*.md`

> 자연어 이해는 guide만, 코드 수정은 code만 로드해 토큰 낭비를 줄인다.

## Codex 어댑터 규칙

- `.claude/` 폴더는 Codex가 자동으로 읽지 않는다. 위 경로를 명시적으로 읽어야 한다.
- Claude Code의 `/update-docs` 등 슬래시 명령은 Codex에서 자동 발동하지 않는다. 같은 요청을 받으면 `.claude/skills/update-docs/SKILL.md`를 직접 읽고 절차를 수행한다.
- Codex용 Stop hook은 `.codex/hooks.json`에 별도로 둔다. **이 hook은 기존 `.claude/hooks/*.sh`(bash)를 그대로 호출**한다(스크립트 중복 없음). **프로젝트-로컬 hook은 프로젝트가 trusted이고 각 hook을 승인해야만 실행된다**(아래 활성화 절차). 미승인/미지원 환경에서는 작업 종료 전 아래 수동 체크를 수행한다.
  - 코드 수정이 있으면 `git status --porcelain`으로 변경 파일을 확인한다.
  - 동작·구조·규약이 바뀌었으면 `.claude/skills/update-docs/SKILL.md` 절차로 문서를 갱신한다.
  - 작업이 일단락되고 추적 파일 변경이 있으면 `.claude/rules/commit-convention.md`에 따라 커밋 메시지를 제시하고, **사용자 승인 후에만** 커밋한다.
- 에러 리포트는 `docs/reports/yyyy-mm-dd.md` 형식으로 작성한다.

## Codex hook 활성화 절차 (한 번만)

`.codex/hooks.json`은 **프로젝트-로컬**이라 보안상 다음 두 조건을 모두 만족해야 실행된다.
안 뜨면 대개 스크립트 버그가 아니라 이 절차를 안 밟은 것이다.

1. **프로젝트를 trusted로 등록** — 사용자 설정 `~/.codex/config.toml`에 절대경로로 추가:
   ```toml
   [projects."/home/seojinlee/projects/MicroTrace"]
   trust_level = "trusted"
   ```
   (이 폴더에서 Codex를 처음 실행할 때 뜨는 신뢰 프롬프트에서 "trust"를 골라도 동일하게 기록된다.)
2. **각 hook을 개별 승인** — Codex는 hook 정의를 **내용 해시 단위로 신뢰**한다. CLI에서 `/hooks`로
   `check-docs-sync` / `suggest-commit` 두 hook을 확인·승인한다. **hook 명령이나 스크립트를 수정하면 해시가
   바뀌어 재승인 전까지 skip**되므로, 고친 뒤에는 `/hooks`로 다시 승인한다.

> 무한루프 방지: 두 스크립트는 같은 변경 집합에 `.claude/.cache/*.stamp`로 1회만 리마인드한다(Claude와 캐시 공유 — 한쪽이 이미 알린 변경은 다른 쪽이 재알림하지 않는다).
> 프로젝트-로컬 hook이 인터랙티브 세션에서 안 뜨는 알려진 이슈(openai/codex#17532)가 있다. 이 경우 위 "수동 체크"로 대체한다.
