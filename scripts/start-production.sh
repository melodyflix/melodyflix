#!/usr/bin/env bash
# melodyflix - start all services in production mode (node dist, not tsx)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT/logs"
PID_DIR="$ROOT/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

# Load env if present
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

cd "$ROOT"

start_service() {
  local name="$1" dir="$2" port="$3"
  local log="$LOG_DIR/$name.log"
  local pid_file="$PID_DIR/$name.pid"

  if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    echo "  $name already running (pid $(cat "$pid_file"))"
    return
  fi

  if [ ! -d "$dir/dist" ]; then
    echo "  ⚠️  $name: dist/ missing — run scripts/build-all.sh first"
    return 1
  fi

  echo "  → starting $name (port $port)"
  ( cd "$dir" && nohup node dist/index.js > "$log" 2>&1 & echo $! > "$pid_file" )
}

echo "==> Starting melodyflix services (production)"
start_service "auth"          "services/auth"          4001
sleep 1
start_service "channel"       "services/channel"       4002
sleep 1
start_service "videos"        "services/videos"        4003
sleep 1
start_service "notifications" "services/notifications" 4004
sleep 1
start_service "live"          "services/live"          4005

echo ""
echo "==> Waiting for health checks"
for i in {1..15}; do
  sleep 2
  local_ok=0
  for p in 4001 4002 4003 4004 4005; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$p/health" 2>/dev/null || echo "000")
    [ "$code" = "200" ] && local_ok=$((local_ok+1))
  done
  echo "  t=$((i*2))s: $local_ok/5 services healthy"
  [ "$local_ok" = "5" ] && break
done

echo ""
echo "==> Health check summary"
for p in 4001 4002 4003 4004 4005; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$p/health" 2>/dev/null || echo "000")
  printf "  port %s: %s\n" "$p" "$code"
done

echo ""
echo "==> Logs: $LOG_DIR/<service>.log"
echo "==> PIDs: $PID_DIR/<service>.pid"
