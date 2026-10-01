#!/bin/bash
# melodyflix - RAM-friendly start script (no tsx watch)
# Uses tsx without watch mode + starts services one by one
set -e

echo "🚀 melodyflix lite start..."

# Kill old processes
pkill -9 -f "tsx" 2>/dev/null || true
pkill -9 -f "nginx" 2>/dev/null || true
sleep 2

cd /root/melodyflix

start_service() {
  local name=$1
  local dir=$2
  echo "▶️  Starting $name..."
  cd "$dir"
  nohup npx tsx src/index.ts > "/tmp/${name}-lite.log" 2>&1 &
  cd /root/melodyflix
  sleep 8
}

# Start services one by one with delays
start_service auth services/auth
start_service channel services/channel
start_service videos services/videos
start_service notifications services/notifications
start_service live services/live

echo ""
echo "⏳ Waiting 15s for all services to stabilize..."
sleep 15

# Start nginx
echo "🌐 Starting nginx..."
nginx
sleep 3

# Health check
echo ""
echo "=== Health check ==="
for p in 4001 4002 4003 4004 4005; do
  echo -n "  $p: "
  curl -s --max-time 3 "http://127.0.0.1:${p}/health" || echo -n "DOWN"
  echo ""
done
echo -n "  web:   "
curl -s -o /dev/null -w "%{http_code}\n" --max-time 3 http://127.0.0.1:5174
echo -n "  admin: "
curl -s -o /dev/null -w "%{http_code}\n" --max-time 3 http://127.0.0.1:5173

echo ""
echo "=== RAM ==="
free -h
echo ""
echo "🎬 melodyflix is running!"
