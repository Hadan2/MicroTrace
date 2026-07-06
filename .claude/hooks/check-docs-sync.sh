#!/usr/bin/env bash
# Stop hook: 코드가 변경됐는데 docs/가 안 바뀌었으면 문서 갱신을 리마인드한다.
# - 판단(정말 갱신이 필요한가)은 AI/update-docs 스킬에 맡기고, 여기서는 "신호"만 준다.
# - exit 2 + stderr 로 차단하면 그 메시지가 AI에게 주입되어 대화가 계속된다.
#
# 루프 방지: "변경 코드 집합의 해시"를 스탬프 파일에 기록하고, 같은 집합엔 다시 리마인드하지 않는다.
#   → AI가 리마인드를 보고 "문서 불필요" 판단을 내리면 다음 Stop에선 통과 → 멈출 수 있다.
#
# {{설정}}: 아래 CODE_EXT 정규식을 프로젝트 언어에 맞게 바꾼다(기본: 흔한 코드 확장자).

set -uo pipefail

# ── 프로젝트별 설정 ───────────────────────────────────────────────────────────
# MicroTrace 언어: C/eBPF(.c/.h), Go(.go), Frontend(.ts/.tsx/.js/.jsx)
CODE_EXT='\.(c|h|go|ts|tsx|js|jsx)$'
# ──────────────────────────────────────────────────────────────────────────────

input="$(cat 2>/dev/null || true)"

# git 저장소가 아니면(또는 git 미설치) 아무것도 하지 않고 통과("잠자는 hook").
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

toplevel="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$toplevel" ] && cd "$toplevel"

changed="$(git status --porcelain 2>/dev/null | sed 's/^...//')"
[ -z "$changed" ] && exit 0

code_changed="$(printf '%s\n' "$changed" | grep -E "$CODE_EXT" || true)"
docs_changed="$(printf '%s\n' "$changed" | grep -E '(^|/)docs/' || true)"

[ -z "$code_changed" ] && exit 0
[ -n "$docs_changed" ] && exit 0

# ── 루프 방지(스탬프) ─────────────────────────────────────────────────────────
sig_input="$(printf '%s\n' "$code_changed" | while IFS= read -r f; do
  [ -z "$f" ] && continue
  h="$(git hash-object -- "$f" 2>/dev/null || echo missing)"
  printf '%s:%s\n' "$f" "$h"
done)"
sig="$(printf '%s' "$sig_input" | git hash-object --stdin 2>/dev/null || printf '%s' "$sig_input" | cksum | tr -d ' ')"

stamp_dir="$toplevel/.claude/.cache"
stamp_file="$stamp_dir/docs-sync.stamp"
mkdir -p "$stamp_dir" 2>/dev/null || true

if [ -f "$stamp_file" ] && [ "$(cat "$stamp_file" 2>/dev/null)" = "$sig" ]; then
  exit 0
fi
printf '%s' "$sig" > "$stamp_file" 2>/dev/null || true

{
  echo "[docs-sync] 코드가 변경됐으나 docs/ 변경이 없습니다. 문서 갱신이 필요한지 검토하세요."
  echo "변경된 코드 파일:"
  printf '%s\n' "$code_changed" | sed 's/^/  - /'
  echo ""
  echo "동작/구조/규약이 바뀌었다면 /update-docs 절차로 갱신하고(역방향 매핑 표 참조),"
  echo "오타·리네임·포맷팅뿐이면 '문서 갱신 불필요(사유)'를 한 줄 남기고 마치세요."
  echo "(같은 변경 집합에는 이 리마인더가 1회만 뜹니다.)"
} >&2
exit 2
