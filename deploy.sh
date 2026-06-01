#!/bin/bash
# ============================================================
#  Keyword Analyzer - AWS EC2 Deployment via GitHub
#  Run on a fresh Ubuntu 22.04 EC2 instance
#
#  Usage:
#    1. SSH into EC2:   ssh -i your-key.pem ubuntu@<EC2-IP>
#    2. Run:            bash <(curl -s https://raw.githubusercontent.com/<YOUR_USER>/<REPO>/main/deploy.sh)
#    3. Or upload & run: scp deploy.sh ubuntu@<EC2-IP>:~/ && ssh ubuntu@<EC2-IP> bash deploy.sh
# ============================================================
set -e

# ── CONFIG — update these ────────────────────────────────────
REPO_URL="https://github.com/Spidy092/seo-social.git"
APP_DIR="$HOME/keyword-analyzer"
NODE_VERSION="20"
APP_PORT=3000

echo "🚀 Keyword Analyzer — AWS Deployment"
echo "======================================"

# ── 1. System update ─────────────────────────────────────────
echo "📦 Updating system..."
sudo apt update -y && sudo apt upgrade -y
sudo apt install -y git curl build-essential

# ── 2. Install Node.js LTS ───────────────────────────────────
echo "🟢 Installing Node.js $NODE_VERSION..."
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
sudo apt install -y nodejs
echo "   ✅ Node.js $(node -v) | npm $(npm -v)"

# ── 3. Install PM2 ───────────────────────────────────────────
echo "⚙️  Installing PM2..."
sudo npm install -g pm2
echo "   ✅ PM2 $(pm2 -v)"

# ── 4. Install Nginx ─────────────────────────────────────────
echo "🌐 Installing Nginx..."
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# ── 5. Clone repo ─────────────────────────────────────────────
echo "📥 Cloning repository..."
if [ -d "$APP_DIR" ]; then
    echo "   Repo exists — pulling latest..."
    cd "$APP_DIR" && git pull origin main
else
    git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# ── 6. Create .env if missing ────────────────────────────────
if [ ! -f ".env" ]; then
    echo ""
    echo "⚠️  No .env file found!"
    echo "   Copy .env.example and fill in your values:"
    echo ""
    cp .env.example .env
    echo "   📝 Edit now: nano $APP_DIR/.env"
    echo "   Then re-run: pm2 start ecosystem.config.js --env production"
    echo ""
    read -p "Press ENTER after editing .env to continue..." _
fi

# ── 7. Create logs directory ──────────────────────────────────
mkdir -p logs

# ── 8. Install dependencies ───────────────────────────────────
echo "📦 Installing npm dependencies..."
npm install --production
echo "   ✅ Dependencies installed"

# ── 9. Start with PM2 ────────────────────────────────────────
echo "🚀 Starting app with PM2..."
pm2 delete keyword-analyzer 2>/dev/null || true
pm2 start ecosystem.config.js --env production
pm2 save

# Auto-start PM2 on reboot
echo "⚙️  Configuring PM2 startup..."
pm2 startup | grep "sudo" | bash || true
pm2 save

# ── 10. Configure Nginx ──────────────────────────────────────
echo "🌐 Configuring Nginx..."
sudo cp nginx.conf /etc/nginx/sites-available/keyword-analyzer
sudo ln -sf /etc/nginx/sites-available/keyword-analyzer /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# ── Done ──────────────────────────────────────────────────────
PUBLIC_IP=$(curl -s ifconfig.me)
echo ""
echo "======================================"
echo "🎉 Deployment Complete!"
echo "======================================"
echo "  🌍 App URL:    http://$PUBLIC_IP"
echo "  📊 PM2 status: pm2 status"
echo "  📄 Logs:       pm2 logs keyword-analyzer"
echo "  🔄 Restart:    pm2 restart keyword-analyzer"
echo "  ♻️  Update:     cd $APP_DIR && git pull && pm2 restart keyword-analyzer"
echo ""
echo "  Next: Point your domain DNS A record → $PUBLIC_IP"
echo "        Then run: sudo certbot --nginx (for HTTPS/SSL)"
echo "======================================"
