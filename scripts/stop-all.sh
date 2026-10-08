#!/usr/bin/env bash
# melodyflix - stop all production services
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT/pids"

echo "==> Stopping melodyflix services"
for svc in auth channel videos notifications live; do
  pid_file="$PID_DIR/$svc.pid"
  if [ -f "$pid_file" ]; then
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      echo "  → stopping $svc (pid $pid)"
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
  fi
done

# Also clean up any stragglers
pkill -f "node dist/index.js" 2>/dev/null || true
echo "==> Done"
