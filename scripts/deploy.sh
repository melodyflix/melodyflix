#!/bin/bash
# melodyflix - one-command deployment script for fresh Ubuntu VPS
# Tested on: Ubuntu 22.04 / 24.04 (x86_64 and ARM64)
set -e

echo "╔══════════════════════════════════════════════════╗"
echo "║   melodyflix - automated VPS deployment            ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

if [ "$EUID" -ne 0 ]; then
  echo "❌ Run as root: sudo bash deploy.sh"
  exit 1
fi

REPO_URL="https://github.com/melodyflix/melodyflix.git"
APP_DIR="/root/melodyflix"
DB_PASS="melodyflix_db_$(openssl rand -hex 6)"
JWT_SECRET="$(openssl rand -hex 32)"

echo "📦 Step 1/8: Updating system..."
apt update -y && apt upgrade -y

echo ""
echo "📦 Step 2/8: Installing core packages..."
apt install -y curl wget git nano build-essential python3 ffmpeg nginx \
  redis-server postgresql postgresql-contrib openssl ufw

echo ""
echo "📦 Step 3/8: Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
corepack enable
corepack prepare pnpm@latest --activate
node -v
pnpm -v

echo ""
echo "📦 Step 4/8: Configuring PostgreSQL..."
systemctl enable postgresql
systemctl start postgresql
sleep 3

su - postgres -c "psql -c \"CREATE USER melodyflix WITH PASSWORD '${DB_PASS}';\"" 2>/dev/null || echo "User exists"
su - postgres -c "psql -c \"CREATE DATABASE melodyflix OWNER melodyflix;\"" 2>/dev/null || echo "DB exists"
su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE melodyflix TO melodyflix;\""

echo ""
echo "📦 Step 5/8: Configuring Redis..."
systemctl enable redis-server
systemctl start redis-server
redis-cli ping

echo ""
echo "📦 Step 6/8: Cloning melodyflix from GitHub..."
if [ -d "$APP_DIR" ]; then
  echo "Directory exists, pulling latest..."
  cd "$APP_DIR"
  git pull
else
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

echo ""
echo "📦 Step 7/8: Creating production .env..."
mkdir -p "$APP_DIR/configs"
cat > "$APP_DIR/configs/.env.production" << ENVEOF
NODE_ENV=production
LOG_LEVEL=info

DB_TYPE=sqlite

REDIS_URL=redis://127.0.0.1:6379

STORAGE_TYPE=local
STORAGE_PATH=$APP_DIR/data/videos

JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=7d

VIDEO_DATA_ROOT=$APP_DIR/data/videos
CHANNEL_DATA_ROOT=$APP_DIR/data/channels
LIVE_HLS_ROOT=$APP_DIR/data/live
ENVEOF

# Symlink so all services pick it up
ln -sf "$APP_DIR/configs/.env.production" "$APP_DIR/.env"

echo ""
echo "📦 Step 8/8: Installing dependencies & building..."
cd "$APP_DIR"
pnpm install

echo ""
echo "  Building web app..."
cd "$APP_DIR/apps/web" && pnpm build
echo "  Building admin app..."
cd "$APP_DIR/apps/admin" && pnpm build

echo ""
echo "🎉 Deployment complete!"
echo ""
echo "═══════════════════════════════════════════════════"
echo ""
echo "📋 IMPORTANT - Save these:"
echo "   JWT_SECRET: $JWT_SECRET"
echo "   DB_PASSWORD: $DB_PASS"
echo "   Location: $APP_DIR/configs/.env.production"
echo ""
echo "▶️  To start melodyflix:"
echo "   cd $APP_DIR"
echo "   bash scripts/start-nginx-all.sh"
echo ""
echo "▶️  Firewall setup:"
echo "   ufw allow 22/tcp"
echo "   ufw allow 80/tcp"
echo "   ufw allow 443/tcp"
echo "   ufw allow 5173/tcp"
echo "   ufw allow 5174/tcp"
echo "   ufw enable"
echo ""
echo "═══════════════════════════════════════════════════"
