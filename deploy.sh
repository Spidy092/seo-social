#!/bin/bash
# ============================================================
#  Keyword Analyzer - AWS EC2 Deployment Script
#  Run this on a fresh Ubuntu 22.04 EC2 instance
#  Usage: bash deploy.sh
# ============================================================
set -e

echo "🚀 Starting Keyword Analyzer deployment..."

# ── 1. System update ─────────────────────────────────────────
sudo apt update && sudo apt upgrade -y

# ── 2. Install Node.js 20 LTS ────────────────────────────────
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
echo "✅ Node.js $(node -v) installed"

# ── 3. Install PM2 (process manager) ─────────────────────────
sudo npm install -g pm2
echo "✅ PM2 $(pm2 -v) installed"

# ── 4. Install Nginx ─────────────────────────────────────────
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
echo "✅ Nginx installed"

# ── 5. Install app dependencies ───────────────────────────────
cd ~/keyword-analyzer
npm install --production
echo "✅ Dependencies installed"

# ── 6. Start app with PM2 ────────────────────────────────────
pm2 start ecosystem.config.js
pm2 save
pm2 startup | tail -1 | sudo bash
echo "✅ App started with PM2"

# ── 7. Configure Nginx ───────────────────────────────────────
sudo cp nginx.conf /etc/nginx/sites-available/keyword-analyzer
sudo ln -sf /etc/nginx/sites-available/keyword-analyzer /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
echo "✅ Nginx configured"

echo ""
echo "🎉 Deployment complete!"
echo "   App running at: http://$(curl -s ifconfig.me)"
echo "   PM2 status: pm2 status"
echo "   Logs: pm2 logs keyword-analyzer"
