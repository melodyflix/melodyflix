#!/bin/bash
# melodyflix - mini start (auth + videos only, for Termux testing)
set -e

echo "🚀 melodyflix MINI start (auth + videos only)..."

pkill -9 -f "tsx" 2>/dev/null || true
sleep 2

cd /root/melodyflix

echo "▶️  Starting auth..."
cd services/auth
nohup npx tsx src/index.ts > /tmp/auth-mini.log 2>&1 &
cd /root/melodyflix
sleep 10

echo "▶️  Starting videos..."
cd services/videos
nohup npx tsx src/index.ts > /tmp/videos-mini.log 2>&1 &
cd /root/melodyflix
sleep 15

echo ""
echo "=== Health ==="
echo -n "  4001 auth:   "
curl -s --max-time 3 http://127.0.0.1:4001/health || echo -n "DOWN"
echo ""
echo -n "  4003 videos: "
curl -s --max-time 3 http://127.0.0.1:4003/health || echo -n "DOWN"
echo ""
echo ""
echo "=== RAM ==="
free -h
echo ""
echo "✅ Mini mode ready (no nginx, no channel/notifications/live)"
