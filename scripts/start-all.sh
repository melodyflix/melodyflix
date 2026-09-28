#!/bin/bash
# melodyflix - start all services (frontend + backend)
echo "🚀 Starting melodyflix platform..."
echo ""

pkill -9 -f "tsx watch" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 2

~/melodyflix/scripts/start-infra.sh 2>/dev/null || echo "⚠️  infra start skipped"

echo ""
echo "Starting backend services..."

cd ~/melodyflix/services/auth
nohup pnpm dev > /tmp/auth.log 2>&1 &
echo "  ✓ auth          (port 4001)"

cd ~/melodyflix/services/channel
nohup pnpm dev > /tmp/channel.log 2>&1 &
echo "  ✓ channel       (port 4002)"

cd ~/melodyflix/services/videos
nohup pnpm dev > /tmp/videos.log 2>&1 &
echo "  ✓ videos        (port 4003)"

cd ~/melodyflix/services/notifications
nohup pnpm dev > /tmp/notifications.log 2>&1 &
echo "  ✓ notifications (port 4004)"

echo ""
echo "Starting frontend apps..."

cd ~/melodyflix/apps/web
nohup pnpm dev > /tmp/web.log 2>&1 &
echo "  ✓ web           (port 5174)"

cd ~/melodyflix/apps/admin
nohup pnpm dev > /tmp/admin.log 2>&1 &
echo "  ✓ admin         (port 5173)"

sleep 12

echo ""
echo "Health check:"
for p in 4001 4002 4003 4004; do
  result=$(curl -s --max-time 2 http://127.0.0.1:$p/health || echo "FAILED")
  echo "  $p: $result"
done

echo ""
echo "🎬 melodyflix is running!"
echo ""
echo "   Web:    http://localhost:5174"
echo "   Admin:  http://localhost:5173"
