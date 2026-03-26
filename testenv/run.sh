#!/bin/bash
# run.sh - service_a, service_b 동시 실행
# Ctrl+C 시 둘 다 종료

SCRIPT_DIR=$(dirname "$0")

# service_b 먼저 실행 (백그라운드)
echo "[run.sh] service_b 시작..."
go run "$SCRIPT_DIR/service_b/main.go" &
PID_B=$!

# service_b 가 뜰 때까지 잠깐 대기
sleep 1

# service_a 실행 (백그라운드)
echo "[run.sh] service_a 시작..."
go run "$SCRIPT_DIR/service_a/main.go" &
PID_A=$!

# Ctrl+C 시 두 프로세스 모두 종료
trap "echo '[run.sh] 종료...'; kill $PID_B $PID_A 2>/dev/null" SIGINT SIGTERM

# 두 프로세스가 끝날 때까지 대기
wait $PID_B $PID_A
