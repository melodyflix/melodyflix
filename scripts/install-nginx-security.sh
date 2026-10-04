#!/bin/bash
# melodyflix - install Nginx rate limiting + security headers
# Non-destructive: adds snippets + includes them in the site config
set -e

if [ "$EUID" -ne 0 ]; then
  echo "Run as root: sudo bash scripts/install-nginx-security.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGINX_DIR="${SCRIPT_DIR}/nginx"
SNIPPETS="/etc/nginx/snippets"
SITE="/etc/nginx/sites-available/melodyflix"

# Backup existing site
if [ -f "$SITE" ]; then
  cp "$SITE" "${SITE}.bak.$(date +%s)"
  echo "Backed up: ${SITE}"
fi

# Install snippets
cp "${NGINX_DIR}/rate-limit.conf" "${SNIPPETS}/melodyflix-ratelimit.conf"
cp "${NGINX_DIR}/security.conf" "${SNIPPETS}/melodyflix-security.conf"
echo "Installed snippets to ${SNIPPETS}"

# Add include lines to site config (if not already present)
if [ -f "$SITE" ]; then
  if ! grep -q "melodyflix-ratelimit.conf" "$SITE"; then
    # Insert after 'server {' for security headers
    sed -i '0,/server {/s//server {\n    include snippets\/melodyflix-security.conf;/' "$SITE"
    echo "Added security headers include"
  fi

  if ! grep -q "melodyflix-ratelimit.conf" "$SITE"; then
    # Add rate limit includes inside server blocks (before location /)
    sed -i '0,/location \/ {/s//include snippets\/melodyflix-ratelimit.conf;\n\n    location \/ {/' "$SITE"
    echo "Added rate limit include (top-level)"
  fi
fi

# Validate config
nginx -t

# Reload
systemctl reload nginx
echo ""
echo "Nginx security config installed + reloaded."
echo ""
echo "Verify:"
echo "  curl -I http://localhost:5174/"
echo "  Should see X-Content-Type-Options, X-Frame-Options headers"
