#!/bin/bash
# melodyflix - setup HTTPS/TLS with Let's Encrypt
# Prerequisites: domain already points to this VPS IP
set -e

if [ "$EUID" -ne 0 ]; then
  echo "Run as root: sudo bash scripts/setup-ssl.sh <domain> [admin-domain]"
  exit 1
fi

DOMAIN="$1"
ADMIN_DOMAIN="$2"

if [ -z "$DOMAIN" ]; then
  echo "Usage: sudo bash scripts/setup-ssl.sh melodyflix.com admin.melodyflix.com"
  exit 1
fi

echo "Setting up TLS for: $DOMAIN"
echo ""

echo "[1/6] Installing certbot..."
apt update -y
apt install -y certbot python3-certbot-nginx

echo ""
echo "[2/6] Backing up nginx config..."
cp /etc/nginx/sites-available/melodyflix /etc/nginx/sites-available/melodyflix.bak.$(date +%s) 2>/dev/null || true

echo ""
echo "[3/6] Updating server_name..."
if [ -f /etc/nginx/sites-available/melodyflix ]; then
  sed -i "0,/server_name _;/s//server_name ${DOMAIN} www.${DOMAIN};/" /etc/nginx/sites-available/melodyflix
  if [ -n "$ADMIN_DOMAIN" ]; then
    sed -i "0,/server_name _;/s//server_name ${ADMIN_DOMAIN};/" /etc/nginx/sites-available/melodyflix
  fi
  nginx -t
  systemctl reload nginx
fi

echo ""
echo "[4/6] Obtaining Let's Encrypt certificates..."
CERT_ARGS="-d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --redirect --nginx"
if [ -n "$ADMIN_DOMAIN" ]; then
  CERT_ARGS="$CERT_ARGS -d $ADMIN_DOMAIN"
fi

if [ -n "$CERTBOT_EMAIL" ]; then
  CERT_ARGS="$CERT_ARGS --email $CERTBOT_EMAIL"
else
  CERT_ARGS="$CERT_ARGS --register-unsafely-without-email"
fi

certbot $CERT_ARGS

echo ""
echo "[5/6] Verifying auto-renewal..."
systemctl status certbot.timer --no-pager 2>/dev/null | head -5 || true
certbot renew --dry-run

echo ""
echo "[6/6] Enabling HSTS header..."
if [ -f /etc/nginx/snippets/melodyflix-security.conf ]; then
  sed -i "s|^# add_header Strict-Transport-Security|add_header Strict-Transport-Security|" /etc/nginx/snippets/melodyflix-security.conf
  nginx -t
  systemctl reload nginx
  echo "HSTS enabled."
fi

echo ""
echo "HTTPS setup complete!"
echo ""
echo "Verify:"
echo "  curl -I https://$DOMAIN/"
if [ -n "$ADMIN_DOMAIN" ]; then
  echo "  curl -I https://$ADMIN_DOMAIN/"
fi
