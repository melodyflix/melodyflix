#!/bin/bash
# melodyflix - uninstall systemd units
set -e
if [ "$EUID" -ne 0 ]; then echo "Run as root"; exit 1; fi

systemctl stop melodyflix.target 2>/dev/null || true
for svc in melodyflix-auth melodyflix-channel melodyflix-videos melodyflix-notifications melodyflix-live; do
  systemctl disable "${svc}.service" 2>/dev/null || true
  rm -f "/etc/systemd/system/${svc}.service"
done
systemctl disable melodyflix.target 2>/dev/null || true
rm -f /etc/systemd/system/melodyflix.target
systemctl daemon-reload
echo "melodyflix systemd units removed."
