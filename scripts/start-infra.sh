#!/bin/bash
# melodyflix infrastructure starter
echo "🚀 Starting Melodyflix infrastructure..."
echo ""

# PostgreSQL
if pg_lsclusters 2>/dev/null | grep -q "online"; then
  echo "✓ PostgreSQL already running"
else
  pg_ctlcluster 16 main start 2>/dev/null || pg_createcluster 16 main --start
  echo "✓ PostgreSQL started"
fi

# Redis
if redis-cli ping > /dev/null 2>&1; then
  echo "✓ Redis already running"
else
  redis-server --daemonize yes
  echo "✓ Redis started"
fi

# MinIO
if curl -s http://127.0.0.1:9000/minio/health/live > /dev/null 2>&1; then
  echo "✓ MinIO already running"
else
  mkdir -p ~/minio-data
  MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin \
    minio server ~/minio-data --address ":9000" --console-address ":9001" --daemon
  sleep 2
  echo "✓ MinIO started"
fi

echo ""
echo "🎬 melodyflix infrastructure ready!"
echo "   PostgreSQL : 127.0.0.1:5432"
echo "   Redis      : 127.0.0.1:6379"
echo "   MinIO API  : 127.0.0.1:9000"
echo "   MinIO UI   : 127.0.0.1:9001"
