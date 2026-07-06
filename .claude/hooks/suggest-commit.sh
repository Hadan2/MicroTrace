#!/usr/bin/env bash
# Stop hook: 커밋되지 않은 변경이 쌓여 있으면 커밋을 권유한다.
# - docs-sync hook과 독립. 트리거 조건이 다르다(이쪽은 "미커밋 변경 존재" 전반).
# - 실제 커밋은 사용자 승인 사항이므로, 여기서는 "권유 신호"만 준다(직접 커밋하지 않는다).
# - exit 2 + stderr 로 메시지를 Claude에 주입 → Claude가 사용자에게 커밋을 권유.
#
# 루프 방지: "현재 미커밋 변경 집합의 해시"를 스탬프에 기록하고, 같은 집합엔 다시 권유하지 않는다.
#   → 권유 후 사용자가 커밋하지 않기로 해도, 변경이 그대로면 다음 Stop에선 통과 → 멈출 수 있다.
#   변경이 더 생기면(집합이 달라지면) 다시 1회 권유한다.
#
# 입력: stdin 으로 hook JSON(session_id 등). 출력: 권유 시 exit 2 + stderr.

set -uo pipefail

input="$(cat 2>/dev/null || true)"

# git 저장소가 아니면 조용히 통과(잠자는 hook).
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

toplevel="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$toplevel" ] && cd "$toplevel"

# working tree + staged 변경(추적 파일의 수정/삭제 + staged 신규). untracked는 제외:
# 임시 산출물·로그가 매번 권유를 띄우는 노이즈를 막기 위함. (커밋 대상은 보통 추적 파일)
changed="$(git status --porcelain --untracked-files=no 2>/dev/null)"
[ -z "$changed" ] && exit 0

# ── 루프 방지(스탬프) ─────────────────────────────────────────────────────────
# 변경 집합 시그니처(상태코드+파일명+내용 해시). 집합이 그대로면 재차 권유하지 않는다.
sig_input="$(printf '%s\n' "$changed" | while IFS= read -r line; do
  [ -z "$line" ] && continue
  f="${line:3}"
  h="$(git hash-object -- "$f" 2>/dev/null || echo missing)"
  printf '%s:%s\n' "$line" "$h"
done)"
sig="$(printf '%s' "$sig_input" | git hash-object --stdin 2>/dev/null || printf '%s' "$sig_input" | cksum | tr -d ' ')"

stamp_dir="$toplevel/.claude/.cache"
stamp_file="$stamp_dir/suggest-commit.stamp"
mkdir -p "$stamp_dir" 2>/dev/null || true

if [ -f "$stamp_file" ] && [ "$(cat "$stamp_file" 2>/dev/null)" = "$sig" ]; then
  exit 0
fi

printf '%s' "$sig" > "$stamp_file" 2>/dev/null || true

count="$(printf '%s\n' "$changed" | grep -c . || true)"
{
  echo "[suggest-commit] 커밋되지 않은 변경이 ${count}개 있습니다. 작업이 일단락됐으면 커밋을 제안하세요."
  echo "변경된 파일:"
  printf '%s\n' "$changed" | sed 's/^/  /'
  echo ""
  echo "절차(★ .claude/rules/commit-convention.md 규약을 따른다):"
  echo "  1) 직접 git commit 하지 말 것. AI는 커밋 메시지만 작성해 제시한다."
  echo "  2) 외부에서 요청받은 이력 작업으로 보이면 먼저 사용자에게 이력명(이력 번호/제목)을 묻는다."
  echo "  3) 규약 형식([분류] 제목 + 빈 줄 + 파일 수정/추가/제거 목록)대로 완성된 메시지를 코드블록으로 제시한다."
  echo "  4) 'Co-Authored-By: Claude' 트레일러·작성자 표기를 넣지 않는다."
  echo "  5) 관심사가 섞였으면 의미 단위로 나눠 커밋할지 제안한다. (같은 변경 집합엔 이 알림이 1회만 뜸)"
} >&2
exit 2
