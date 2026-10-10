#!/bin/bash
# melodyflix service watchdog — auto-restart down services
cd /home/melodyfl/melodyflix || exit 1

# Load env
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

declare -A SERVICES=(
  ["auth"]=4001
  ["channel"]=4002
  ["videos"]=4003
  ["notifications"]=4004
  ["live"]=4005
)

LOG="/home/melodyfl/melodyflix/logs/watchdog.log"
mkdir -p "$(dirname "$LOG")"

for svc in "${!SERVICES[@]}"; do
  port=${SERVICES[$svc]}
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://127.0.0.1:$port/health" 2>/dev/null)
  if [ "$code" != "200" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $svc DOWN (code=$code), restarting..." >> "$LOG"
    fuser -k -n tcp "$port" 2>/dev/null
    sleep 1
    cd "/home/melodyfl/melodyflix/services/$svc" || continue
    NODE_BIN="/home/melodyfl/.nvm/versions/node/v22.23.3/bin/node"
    nohup "$NODE_BIN" dist/index.js > "/tmp/$svc-prod.log" 2>&1 &
    cd /home/melodyfl/melodyflix
    sleep 2
  fi
done
