#!/bin/bash
set -euo pipefail

# Pawtropolis Server Setup — run once on a fresh server
# Usage: ssh bash-ec2 'bash -s' < scripts/setup-server.sh

REMOTE_PATH="/home/ubuntu/pawtropolis-tech"

echo "=== Pawtropolis Server Setup ==="

# 1. Build tools for native modules (better-sqlite3)
echo "[1/5] Checking build tools..."
if ! dpkg -s build-essential &>/dev/null 2>&1; then
  echo "Installing build-essential + python3..."
  sudo apt-get update && sudo apt-get install -y build-essential python3
else
  echo "Build tools already installed."
fi

# 2. Nginx
echo "[2/5] Checking Nginx..."
if ! command -v nginx &>/dev/null; then
  echo "Installing Nginx..."
  sudo apt-get update && sudo apt-get install -y nginx
fi
nginx -v 2>&1

echo "Installing Nginx site config..."
sudo cp ${REMOTE_PATH}/nginx/pawtropolis.tech.conf /etc/nginx/sites-available/pawtropolis.tech
sudo ln -sf /etc/nginx/sites-available/pawtropolis.tech /etc/nginx/sites-enabled/pawtropolis.tech
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
echo "Nginx configured and reloaded."

# 3. PM2
echo "[3/5] Checking PM2..."
if ! command -v pm2 &>/dev/null; then
  echo "Installing PM2..."
  npm install -g pm2
fi
pm2 -v

# 4. PM2 startup (auto-start on reboot)
echo "[4/5] Configuring PM2 startup..."
pm2 startup systemd -u ubuntu --hp /home/ubuntu 2>/dev/null || true

# 5. Environment check
echo "[5/5] Checking .env..."
if [ ! -f ${REMOTE_PATH}/.env ]; then
  echo "WARNING: .env file not found at ${REMOTE_PATH}/.env"
  echo "Copy your .env file before deploying."
else
  echo ".env exists."
  # Check critical web vars
  for var in DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET OAUTH2_REDIRECT_URI GUILD_ID DB_PATH; do
    if grep -q "^${var}=" ${REMOTE_PATH}/.env; then
      echo "  ✓ ${var}"
    else
      echo "  ✗ ${var} — MISSING, add to .env"
    fi
  done
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Manual steps remaining:"
echo "  1. Ensure OAUTH2_REDIRECT_URI=https://pawtropolis.tech/auth/callback in .env"
echo "  2. Add redirect URI in Discord Developer Portal: https://pawtropolis.tech/auth/callback"
echo "  3. Verify Cloudflare A record: pawtropolis.tech → 34.193.75.138 (proxied)"
echo "  4. Run ./deploy.sh from local machine"
echo "  5. After first deploy: pm2 save"
