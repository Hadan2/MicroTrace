#!/usr/bin/env bash
# verify-resolver.sh — StaticResolver가 "실제로" IP를 서비스명으로 바꾸는지
# EC2 없이 로컬 Docker로 검증한다.
#
# 왜 EC2 없이 되나:
#   StaticResolver는 "IP를 테이블에서 찾아 이름을 돌려주는" 순수 로직이다.
#   EC2든 로컬이든 로직은 같고, 다른 건 IP 값(10.0.x.x vs 172.19.x.x)뿐이다.
#   그래서 로컬 컨테이너의 진짜 IP를 읽어 hosts.yaml을 즉석 생성하고,
#   collector를 static 모드로 강제해 EC2와 똑같은 코드 경로를 태운다.
#   그 뒤 WebSocket으로 오는 메시지에 IP가 아니라 이름이 있는지 관측한다.
#
# 검증 단계:
#   1. 테스트 컨테이너(service-a, service-b) 기동 → IP 확보 목적
#   2. 컨테이너 실제 IP를 읽어 hosts.yaml 생성
#   3. collector를 MICROTRACE_RESOLVER=static 으로 기동 (sock_ops attach)
#   4. service-a 재시작 → "최초 연결"을 collector가 붙은 뒤에 다시 발생시킨다
#      (eBPF sock_ops는 attach 이후의 새 연결만 잡는다. service-a는 Keep-Alive라
#       최초 1회만 연결을 맺으므로, collector보다 먼저 떠 있으면 그 연결을 영영 놓친다.
#       컨테이너를 죽이지 않고 재시작하면 같은 네트워크에서 같은 IP를 유지한 채
#       새 연결을 다시 만든다 — dev.sh가 컨테이너보다 collector를 먼저 띄우는 것과 같은 이유.)
#   5. verify-resolver.go 로 WebSocket 관측 → 이름 붙었나 판정
#   6. 정리(컨테이너·collector 종료)
#
# 사용:  ./scripts/verify-resolver.sh
# 종료:  0 통과 / 1 실패

set -Euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/testenv/docker-compose.yml"
HOSTS_FILE="$ROOT_DIR/collector/hosts.verify.yaml" # 임시 생성물(.gitignore 대상)
WS_URL="ws://localhost:9090/ws"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-20s}"

COMPOSE_CMD=()
COLLECTOR_PID=""

log() { printf '[verify] %s\n' "$*" >&2; }
fail() { log "❌ $*"; exit 1; }

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  log "정리 중..."

  # root(sudo) 소유 프로세스라도 일반 kill(같은 세션)로 시그널 전달이 되고,
  # collector 자신이 SIGTERM을 받아 graceful shutdown(agent/resource_agent
  # 자식까지 정리)하므로 pkill/sudo 없이 $COLLECTOR_PID 하나로 충분하다.
  if [[ -n "$COLLECTOR_PID" ]] && kill -0 "$COLLECTOR_PID" 2>/dev/null; then
    kill -TERM "$COLLECTOR_PID" 2>/dev/null || true
    sleep 1
    kill -KILL "$COLLECTOR_PID" 2>/dev/null || true
  fi

  if [[ "${#COMPOSE_CMD[@]}" -gt 0 && "${KEEP_CONTAINERS:-0}" != "1" ]]; then
    "${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -f "$HOSTS_FILE" 2>/dev/null || true

  exit "$code"
}
trap cleanup EXIT INT TERM

detect_compose() {
  if docker compose version >/dev/null 2>&1; then COMPOSE_CMD=(docker compose); return; fi
  if command -v docker-compose >/dev/null 2>&1; then COMPOSE_CMD=(docker-compose); return; fi
  fail "Docker Compose를 찾지 못함"
}

# ── 0. 사전 점검: 9090이 이미 점유 중이면 즉시 실패 ───────────────
# 이전 실행의 좀비(예: go run의 자식 바이너리)가 남아 있으면, 이번에 새로
# 띄운 collector가 바인딩 실패로 죽어도 헬스체크가 좀비의 응답을 성공으로
# 착각할 수 있다. 애초에 그 상황을 만들지 않도록 시작 전에 걸러낸다.
if curl -sf -o /dev/null --max-time 1 "http://localhost:9090/" 2>/dev/null; then
  fail "9090 포트가 이미 사용 중 — 이전 실행의 좀비 프로세스일 수 있음. 'ss -ltnp | grep 9090'과 'ps aux | grep collector'로 확인 후 종료하고 재실행하세요."
fi

# ── 1. 컨테이너 기동 ──────────────────────────────────────────────
detect_compose
log "1/6 테스트 컨테이너 기동..."
"${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" up --build -d >&2 || fail "컨테이너 기동 실패"

# ── 2. 컨테이너 실제 IP → hosts.yaml 생성 ─────────────────────────
# compose가 붙인 컨테이너의 첫 네트워크 IP를 읽는다.
log "2/6 컨테이너 IP 읽어 hosts.yaml 생성..."
: > "$HOSTS_FILE"
echo "hosts:" >> "$HOSTS_FILE"
mapped=0
for svc in service-a service-b; do
  cid="$("${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" ps -q "$svc" 2>/dev/null || true)"
  [[ -z "$cid" ]] && { log "  $svc 컨테이너 없음 — 건너뜀"; continue; }
  ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$cid" 2>/dev/null || true)"
  [[ -z "$ip" ]] && { log "  $svc IP 못 읽음 — 건너뜀"; continue; }
  printf '  %s: %s\n' "$ip" "$svc" >> "$HOSTS_FILE"
  log "  $svc → $ip"
  mapped=$((mapped+1))
done
[[ "$mapped" -eq 0 ]] && fail "컨테이너 IP를 하나도 못 읽음"
log "생성된 매핑:"; sed 's/^/    /' "$HOSTS_FILE" >&2

# ── 3. collector를 static 모드로 기동 ─────────────────────────────
# eBPF attach에 root가 필요하다. /etc/sudoers.d/microtrace 에 이 프로젝트의
# collector-bin/tcp_trace 두 바이너리만 NOPASSWD + SETENV로 등록해뒀으므로
# 비밀번호 프롬프트 없이(비대화형으로) 실행 가능하다. 그 외 모든 sudo 명령은
# 여전히 비밀번호가 필요하다 — 이 스크립트가 다른 시스템 권한을 얻는 건 아니다.
#
# go run 대신 미리 빌드한 고정 경로(collector-bin)를 쓰는 이유:
#   go run은 매번 새 임시 바이너리를 만들어서 (a) sudoers가 특정 경로로
#   화이트리스트할 수 없고 (b) pkill 패턴 매칭이 불안정해 좀비를 남긴 적이 있다.
log "3/6 collector 빌드 + static 모드로 기동 (NOPASSWD sudo — eBPF attach)..."
(cd "$ROOT_DIR/collector" && go build -o collector-bin .) || fail "collector 빌드 실패"

# collector는 ../agent/tcp_trace 같은 상대경로로 agent 바이너리를 찾으므로
# cwd가 반드시 collector/ 여야 한다. bash -c 'cd ... && exec sudo ...'로
# exec 치환하면(서브셸을 남기지 않고 sudo가 이 bash -c의 PID를 그대로 이어받음)
# $!가 서브셸이 아니라 실제 sudo 프로세스를 가리켜 cleanup의 kill이 확실히 먹힌다.
bash -c "cd '$ROOT_DIR/collector' && exec sudo -n MICROTRACE_RESOLVER=static MICROTRACE_HOSTS_FILE='$HOSTS_FILE' ./collector-bin" >&2 2>&1 &
COLLECTOR_PID=$!

# collector가 실제로 포트 바인딩까지 성공했는지 확인한다.
# (예: 이전 실행의 좀비 프로세스가 9090을 이미 점유 중이면 collector가
#  "address already in use"로 죽는데, 그래도 agent/resource_agent는 이미
#  떠서 리소스 로그를 계속 찍으므로 언뜻 정상처럼 보인다 — 반드시 여기서 걸러낸다.)
boot_ok=0
for _ in $(seq 1 10); do
  if curl -sf -o /dev/null --max-time 1 "http://localhost:9090/" 2>/dev/null; then
    boot_ok=1
    break
  fi
  if ! kill -0 "$COLLECTOR_PID" 2>/dev/null; then
    break # collector 프로세스가 이미 죽음 — 재시도해도 의미 없음
  fi
  sleep 1
done
[[ "$boot_ok" -eq 1 ]] || fail "collector가 9090에서 응답하지 않음 (포트 충돌·기동 실패 가능성 — 위 collector 로그 확인)"
log "  collector 기동 확인됨 (http://localhost:9090 응답)"

# ── 4. service-a 재시작 — collector attach 이후 새 연결을 발생시킨다 ──
# collector가 sock_ops를 붙이는 데 시간이 걸리므로 재시작 전에 잠깐 기다린다.
log "4/6 collector attach 대기 후 service-a 재시작 (Keep-Alive 최초 연결 재발생)..."
sleep "${COLLECTOR_BOOT_DELAY:-2}"
"${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" restart service-a >&2 || fail "service-a 재시작 실패"

# ── 5. WebSocket 관측으로 판정 ────────────────────────────────────
log "5/6 WebSocket 관측 — 이름이 붙는지 확인 (최대 $BOOT_TIMEOUT)..."
if (cd "$ROOT_DIR/collector" && go run "$ROOT_DIR/scripts/verify-resolver.go" \
      -url "$WS_URL" -timeout "$BOOT_TIMEOUT" -expect "service-a,service-b"); then
  log "✅ 통과 — StaticResolver가 실제 트래픽에서 IP를 서비스명으로 변환함"
  exit 0
else
  fail "StaticResolver가 이름을 붙이지 못함 (위 진단 참고)"
fi
