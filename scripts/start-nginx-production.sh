#!/usr/bin/env bash
# melodyflix - production launcher (build + start services + nginx)
# Uses node dist (not tsx dev), serves static frontends from apps/*/dist
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT/logs"
PID_DIR="$ROOT/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

# Load env
if [ -f "$ROOT/.env" ]; then
  set -a; source "$ROOT/.env"; set +a
fi

echo "==> Step 1/4: building all (packages + services + frontends)"
bash "$ROOT/scripts/build-all.sh"

echo ""
echo "==> Step 2/4: stopping old processes"
pkill -9 -f "tsx watch" 2>/dev/null || true
for p in 4001 4002 4003 4004 4005; do
  if command -v fuser >/dev/null 2>&1; then fuser -k -n tcp "$p" 2>/dev/null || true; fi
done
sleep 2
for svc in auth channel videos notifications live; do
  [ -f "$PID_DIR/$svc.pid" ] && kill -9 "$(cat "$PID_DIR/$svc.pid")" 2>/dev/null || true
  rm -f "$PID_DIR/$svc.pid"
done

echo ""
echo "==> Step 3/4: starting backend services (node dist)"
start_service() {
  local name="$1" dir="$2"
  if [ ! -d "$dir/dist" ]; then
    echo "  ⚠️  $name: dist/ missing"; return 1
  fi
  ( cd "$dir" && nohup node dist/index.js > "$LOG_DIR/$name.log" 2>&1 & echo $! > "$PID_DIR/$name.pid" )
  echo "  → $name started (pid $(cat "$PID_DIR/$name.pid"))"
}
start_service "auth"          "$ROOT/services/auth"
sleep 1
start_service "channel"       "$ROOT/services/channel"
sleep 1
start_service "videos"        "$ROOT/services/videos"
sleep 1
start_service "notifications" "$ROOT/services/notifications"
sleep 1
start_service "live"          "$ROOT/services/live"

echo ""
echo "==> Waiting for services to be healthy"
for i in {1..20}; do
  sleep 2
  ok=0
  for p in 4001 4002 4003 4004 4005; do
    c=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$p/health" 2>/dev/null || echo 000)
    [ "$c" = "200" ] && ok=$((ok+1))
  done
  echo "  t=$((i*2))s: $ok/5 healthy"
  [ "$ok" = "5" ] && break
done

echo ""
echo "==> Step 4/4: nginx"
if ! pgrep -x nginx >/dev/null; then
  nginx || echo "  ⚠️  nginx start failed (check /var/log/nginx/error.log)"
else
  nginx -s reload || true
  echo "  nginx reloaded"
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "🎬 melodyflix production is running"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  Frontend (static via nginx):"
echo "    Web:   http://<host>:5174"
echo "    Admin: http://<host>:5173"
echo ""
echo "  Backend services:"
for p in 4001 4002 4003 4004 4005; do
  c=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$p/health" 2>/dev/null || echo 000)
  printf "    %s: %s\n" "$p" "$c"
done
echo ""
echo "  Logs: $LOG_DIR"
echo "  PIDs: $PID_DIR"
echo ""
echo "  Stop all: bash scripts/stop-all.sh"
