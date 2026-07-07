#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/testenv/docker-compose.yml"
export ROOT_DIR COMPOSE_FILE

PIDS=()
COMPOSE_CMD=()
WSL_IP=""

log() {
  printf '[dev] %s\n' "$*"
}

prefix() {
  local name="$1"
  sed -u "s/^/[$name] /"
}

start_bg() {
  local name="$1"
  shift

  log "starting $name"
  (
    cd "$ROOT_DIR"
    "$@"
  ) 2>&1 | prefix "$name" &
  PIDS+=("$!")
}

cleanup() {
  local exit_code=$?

  trap - EXIT INT TERM
  log "shutting down..."

  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  # sudo로 실행된 collector(root 프로세스)는 PIDS에 안 잡힘.
  # 프로세스 이름으로 직접 찾아서 종료한다.
  sudo pkill -TERM -f "collector-bin" 2>/dev/null || true
  sudo pkill -TERM -f "tcp_trace" 2>/dev/null || true
  sudo pkill -TERM -f "resource_agent" 2>/dev/null || true

  if [[ "${KEEP_CONTAINERS:-0}" != "1" ]]; then
    if [[ "${#COMPOSE_CMD[@]}" -gt 0 ]]; then
      "${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
    fi
  fi

  exit "$exit_code"
}

need_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf '[dev] missing command: %s\n' "$cmd" >&2
    exit 1
  fi
}

detect_compose() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
    return
  fi

  printf '[dev] missing Docker Compose. Install either docker compose plugin or docker-compose.\n' >&2
  exit 1
}

detect_wsl_ip() {
  local first_ip=""
  read -r first_ip _ < <(hostname -I 2>/dev/null || true)
  WSL_IP="$first_ip"
}

preflight_collector_permission() {
  if [[ "${SKIP_COLLECTOR:-0}" == "1" ]]; then
    return
  fi

  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    return
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    printf '[dev] collector needs root permission to attach eBPF programs, but sudo was not found.\n' >&2
    exit 1
  fi

  log "collector needs sudo for eBPF attach; asking once before background processes start"
  sudo -v
}

run_collector() {
  cd "$ROOT_DIR/collector"

  # go run은 매번 새 임시 바이너리를 만들어 실행한다 — sudo pkill 패턴으로
  # 부모(go 툴체인)만 죽고 자식(실제 실행 바이너리)이 좀비로 남는 사고가 났었다.
  # 고정 경로(collector-bin)로 미리 빌드해두면 pkill 매칭도 안정적이고,
  # /etc/sudoers.d/microtrace 에 이 경로를 NOPASSWD로 등록해두면
  # (이 프로젝트 collector/agent 바이너리에 한해서만 적용, 그 외 sudo는 여전히 비밀번호 필요)
  # 매번 비밀번호를 묻지 않고도 eBPF attach가 가능하다.
  go build -o collector-bin . || { printf '[collector] 빌드 실패\n' >&2; exit 1; }

  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    exec ./collector-bin
  fi

  if command -v sudo >/dev/null 2>&1; then
    exec sudo -n -E ./collector-bin
  fi

  printf '[collector] root permission is required to attach eBPF programs, but sudo was not found.\n' >&2
  exit 1
}

trap cleanup EXIT INT TERM

need_cmd docker
need_cmd go
need_cmd npm
detect_compose
detect_wsl_ip
preflight_collector_permission

log "MicroTrace dev stack"
log "frontend:  http://localhost:5173 or the next available Vite port"
if [[ -n "$WSL_IP" ]]; then
  log "wsl url:   http://$WSL_IP:5173 or the next available Vite port"
fi
log "collector: http://localhost:9090"
if [[ -n "$WSL_IP" ]]; then
  log "collector: http://$WSL_IP:9090"
fi
log "stop:      Ctrl+C"
log "hint:      KEEP_CONTAINERS=1 make dev keeps test containers after exit"
log "compose:   ${COMPOSE_CMD[*]}"

if [[ "${SKIP_COLLECTOR:-0}" != "1" ]]; then
  # resource_agent 바이너리 빌드 (없거나 소스가 바뀐 경우)
  if [[ "${SKIP_RESOURCE:-0}" != "1" ]]; then
    log "building resource_agent..."
    # GOPATH/pkg/mod 아래 설치된 toolchain을 우선 탐색한다.
    # /usr/bin/go가 go toolchain 다운로드를 시도해서 실패하는 경우를 방지한다.
    GOBIN_PATH="$(find "$HOME/go/pkg/mod/golang.org" -maxdepth 1 -name 'toolchain@*go1.25*' 2>/dev/null | sort -V | tail -1)/bin"
    if [[ -x "$GOBIN_PATH/go" ]]; then
      PATH="$GOBIN_PATH:$PATH"
    fi
    (cd "$ROOT_DIR/resource_agent" && go build -o resource_agent . 2>&1) || \
      log "resource_agent 빌드 실패 — 자원 수집 없이 계속 진행"
  fi

  start_bg collector bash -lc "$(declare -f run_collector); run_collector"

  # The eBPF sock_ops program must be attached before service-a creates its
  # Keep-Alive socket. If testenv starts first, the existing connection is missed.
  sleep "${COLLECTOR_BOOT_DELAY:-2}"

  if ! kill -0 "${PIDS[0]}" 2>/dev/null; then
    log "collector failed to start; testenv/frontend were not started"
    exit 1
  fi
else
  log "collector skipped by SKIP_COLLECTOR=1"
fi

start_bg testenv "${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" up --build

# Give Docker Compose a small head start so service traffic is flowing before UI opens.
sleep "${DEV_BOOT_DELAY:-3}"

testenv_pid_index=0
if [[ "${SKIP_COLLECTOR:-0}" != "1" ]]; then
  testenv_pid_index=1
fi

if ! kill -0 "${PIDS[$testenv_pid_index]}" 2>/dev/null; then
  log "testenv failed to start; frontend was not started"
  exit 1
fi

FRONTEND_ENV=""
if [[ "${VITE_MOCK:-0}" == "1" ]]; then
  FRONTEND_ENV="VITE_MOCK=true "
fi
start_bg frontend bash -lc "${FRONTEND_ENV}cd frontend && npm run dev -- --host 0.0.0.0 --port 5173"

wait -n "${PIDS[@]}"
