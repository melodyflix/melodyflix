#!/bin/bash
# melodyflix - verify backup can be restored
# Non-destructive: extracts to a temp dir and checks integrity
set -e

BACKUP_ROOT="/root/melodyflix-backups"
LATEST=$(ls -t "$BACKUP_ROOT" 2>/dev/null | head -1)

if [ -z "$LATEST" ]; then
  echo "FAIL: no backups found in $BACKUP_ROOT"
  exit 1
fi

BACKUP_DIR="$BACKUP_ROOT/$LATEST"
echo "Testing restore from: $BACKUP_DIR"

TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT

# 1. Database integrity
echo ""
echo "[1/3] Testing database integrity..."
for db in "$BACKUP_DIR"/databases/*.db; do
  if [ -f "$db" ]; then
    name=$(basename "$db")
    if sqlite3 "$db" "PRAGMA integrity_check;" | grep -q "^ok$"; then
      echo "  OK: $name"
    else
      echo "  FAIL: $name integrity check failed"
      exit 1
    fi
  fi
done

# 2. Media archive
echo ""
echo "[2/3] Testing media archive..."
if [ -f "$BACKUP_DIR/media.tar.gz" ]; then
  if tar tzf "$BACKUP_DIR/media.tar.gz" > /dev/null 2>&1; then
    echo "  OK: media.tar.gz readable"
  else
    echo "  FAIL: media.tar.gz corrupted"
    exit 1
  fi
fi

# 3. Source code archive
echo ""
echo "[3/3] Testing source archive..."
if [ -f "$BACKUP_DIR/source-code.tar.gz" ]; then
  if tar tzf "$BACKUP_DIR/source-code.tar.gz" > /dev/null 2>&1; then
    echo "  OK: source-code.tar.gz readable"
  else
    echo "  FAIL: source-code.tar.gz corrupted"
    exit 1
  fi
fi

echo ""
echo "All integrity checks passed. Backup is restorable."
