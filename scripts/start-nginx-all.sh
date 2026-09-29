#!/bin/bash
# melodyflix - start all (5 backend + nginx)
echo "🚀 Starting melodyflix (full nginx mode)..."

pkill -9 -f "tsx watch" 2>/dev/null
pkill -9 -f "nginx" 2>/dev/null
sleep 3

# Backend services
cd ~/melodyflix/services/auth && nohup pnpm dev > /tmp/auth.log 2>&1 &
cd ~/melodyflix/services/channel && nohup pnpm dev > /tmp/channel.log 2>&1 &
cd ~/melodyflix/services/videos && nohup pnpm dev > /tmp/videos.log 2>&1 &
cd ~/melodyflix/services/notifications && nohup pnpm dev > /tmp/notifications.log 2>&1 &
cd ~/melodyflix/services/live && nohup pnpm dev > /tmp/live.log 2>&1 &

echo "Waiting 15s for backends..."
sleep 15

# Nginx
echo "Starting nginx..."
nginx
sleep 3

echo ""
echo "=== Health check ==="
for p in 4001 4002 4003 4004 4005; do
  echo -n "  $p: "
  curl -s --max-time 2 http://127.0.0.1:$p/health 2>/dev/null || echo -n "DOWN"
  echo ""
done
echo -n "  web:   "
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5174
echo -n "  admin: "
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5173

echo ""
echo "🎬 melodyflix is running!"
echo ""
echo "   Web:    http://localhost:5174"
echo "   Admin:  http://localhost:5173"
echo ""
