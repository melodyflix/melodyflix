#!/bin/bash
# melodyflix - backup script (Ubuntu side)
set -e

BACKUP_ROOT="/root/melodyflix-backups"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_DIR="${BACKUP_ROOT}/${TIMESTAMP}"

echo "🚀 melodyflix backup starting..."
echo "Destination: ${BACKUP_DIR}"
echo ""

mkdir -p "${BACKUP_DIR}"

# 1. Databases
echo "📀 Backing up databases..."
mkdir -p "${BACKUP_DIR}/databases"
for svc in auth channel videos notifications; do
  DB="/root/melodyflix/services/${svc}/data/melodyflix.db"
  if [ -f "$DB" ]; then
    cp "$DB" "${BACKUP_DIR}/databases/${svc}.db"
    echo "  ✓ ${svc}.db ($(du -h "$DB" | cut -f1))"
  fi
done

# 2. Media (videos, avatars, banners)
echo ""
echo "🎬 Backing up media..."
if [ -d /root/melodyflix/data ]; then
  tar czf "${BACKUP_DIR}/media.tar.gz" \
    -C /root/melodyflix \
    data 2>/dev/null || echo "  ⚠ media backup skipped"
  echo "  ✓ media.tar.gz ($(du -h "${BACKUP_DIR}/media.tar.gz" | cut -f1))"
fi

# 3. Source code (small, redundant with GitHub but safe)
echo ""
echo "📝 Backing up source code..."
tar czf "${BACKUP_DIR}/source-code.tar.gz" \
  -C /root/melodyflix \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.git' \
  --exclude='data' \
  --exclude='*.db' \
  apps services packages scripts configs 2>/dev/null
echo "  ✓ source-code.tar.gz ($(du -h "${BACKUP_DIR}/source-code.tar.gz" | cut -f1))"

# 4. Manifest
echo ""
echo "📋 Creating manifest..."
cat > "${BACKUP_DIR}/manifest.txt" <<EOF
melodyflix backup
Timestamp: ${TIMESTAMP}
Date: $(date)

Files:
$(ls -lh "${BACKUP_DIR}" | tail -n +2)
EOF

# 5. Old backup cleanup (keep only last 5)
echo ""
echo "🧹 Cleaning old backups (keeping last 5)..."
cd "${BACKUP_ROOT}"
ls -t | tail -n +6 | xargs -r rm -rf
echo "  ✓ Done"

echo ""
echo "✅ Backup complete!"
echo ""
echo "Location: ${BACKUP_DIR}"
echo "Total size: $(du -sh "${BACKUP_DIR}" | cut -f1)"
echo ""
echo "To copy to phone's Downloads, run in Termux:"
echo "  bash ~/melodyflix-scripts/copy-backup.sh"
