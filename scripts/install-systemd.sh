#!/bin/bash
# melodyflix - install systemd units
# Run once on a fresh VPS after deploy.sh
set -e

if [ "$EUID" -ne 0 ]; then
  echo "Run as root: sudo bash scripts/install-systemd.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEMD_DIR="${SCRIPT_DIR}/systemd"

echo "Installing melodyflix systemd units..."

# Create log directory
mkdir -p /var/log/melodyflix
chmod 755 /var/log/melodyflix

# Ensure .env exists
if [ ! -f /root/melodyflix/.env ]; then
  echo "WARNING: /root/melodyflix/.env missing. Create it before starting services."
  echo "You can copy configs/.env.production to .env"
fi

# Copy units
for unit in melodyflix.target melodyflix-auth.service melodyflix-channel.service \
             melodyflix-videos.service melodyflix-notifications.service melodyflix-live.service; do
  if [ -f "${SYSTEMD_DIR}/${unit}" ]; then
    cp "${SYSTEMD_DIR}/${unit}" /etc/systemd/system/
    echo "  installed: ${unit}"
  else
    echo "  MISSING: ${unit}"
  fi
done

# Reload + enable
systemctl daemon-reload
systemctl enable melodyflix.target
for svc in melodyflix-auth melodyflix-channel melodyflix-videos melodyflix-notifications melodyflix-live; do
  systemctl enable "${svc}.service"
done

echo ""
echo "systemd units installed and enabled."
echo ""
echo "To start:   systemctl start melodyflix.target"
echo "To stop:    systemctl stop melodyflix.target"
echo "To status:  systemctl status melodyflix.target"
echo "To logs:    journalctl -u melodyflix-videos -f"
