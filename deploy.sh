#!/usr/bin/env bash
# ============================================================
# Keyword Analyzer - Ubuntu/EC2 deployment
#
# First deploy, using the public IP:
#   bash deploy.sh
#
# Deploy with a domain after DNS points to the server:
#   DOMAIN=keyword.example.com bash deploy.sh
#
# Optional overrides:
#   REPO_URL=https://github.com/Spidy092/keyword-analyzer.git BRANCH=main APP_PORT=3000 bash deploy.sh
# ============================================================
set -Eeuo pipefail

REPO_URL="${REPO_URL:-https://github.com/Spidy092/keyword-analyzer.git}"
BRANCH="${BRANCH:-main}"
DEPLOY_DIR="${DEPLOY_DIR:-$HOME/keyword-analyzer}"
APP_PORT="${APP_PORT:-3000}"
NODE_MAJOR="${NODE_MAJOR:-20}"
APP_NAME="${APP_NAME:-keyword-analyzer}"
DOMAIN="${DOMAIN:-_}"

DB_NAME="${DB_NAME:-keyword_analyzer}"
DB_USER="${DB_USER:-keyword_user}"
DB_PASSWORD="${DB_PASSWORD:-keyword_pass}"

log() {
    printf '\n\033[1;34m==>\033[0m %s\n' "$1"
}

ok() {
    printf '   \033[1;32mOK\033[0m %s\n' "$1"
}

require_ubuntu() {
    if ! command -v apt >/dev/null 2>&1; then
        echo "This deployment script expects Ubuntu/Debian with apt."
        exit 1
    fi
}

public_ip() {
    curl -fsS --max-time 3 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}'
}

postgres_exec() {
    sudo -u postgres psql -v ON_ERROR_STOP=1 "$@"
}

ensure_postgres() {
    log "Installing and configuring PostgreSQL"
    sudo apt install -y postgresql postgresql-contrib
    sudo systemctl enable postgresql
    sudo systemctl start postgresql

    if ! postgres_exec -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
        postgres_exec -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';"
        ok "Created database user ${DB_USER}"
    else
        ok "Database user ${DB_USER} already exists"
    fi

    if ! postgres_exec -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
        postgres_exec -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
        ok "Created database ${DB_NAME}"
    else
        ok "Database ${DB_NAME} already exists"
    fi
}

resolve_app_dir() {
    if [ -f "$DEPLOY_DIR/package.json" ]; then
        printf '%s\n' "$DEPLOY_DIR"
        return
    fi

    if [ -f "$DEPLOY_DIR/keyword-analyzer/package.json" ]; then
        printf '%s\n' "$DEPLOY_DIR/keyword-analyzer"
        return
    fi

    echo "Could not find package.json in $DEPLOY_DIR or $DEPLOY_DIR/keyword-analyzer." >&2
    exit 1
}

write_env_if_missing() {
    local app_dir="$1"
    local ip="$2"
    local app_url

    if [ "$DOMAIN" = "_" ]; then
        app_url="http://${ip}"
    else
        app_url="http://${DOMAIN}"
    fi

    if [ -f "$app_dir/.env" ]; then
        ok ".env already exists"
        return
    fi

    log "Creating production .env"
    local session_secret
    session_secret="$(openssl rand -base64 48 | tr -d '\n')"

    cat > "$app_dir/.env" <<ENV_EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=${APP_PORT}
APP_URL=${app_url}

DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}

SESSION_SECRET=${session_secret}
LOG_LEVEL=info

# Add these when you are ready to enable the related integrations.
SERPER_API_KEY=
OPENPAGERANK_API_KEY=
OPENROUTER_API_KEY=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=
ENV_EOF

    chmod 600 "$app_dir/.env"
    ok "Created $app_dir/.env"
}

write_nginx_site() {
    local server_name="$1"

    log "Configuring nginx reverse proxy"
    sudo tee "/etc/nginx/sites-available/${APP_NAME}" >/dev/null <<NGINX_EOF
server {
    listen 80;
    server_name ${server_name};

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 120s;
    }

    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;
    add_header X-XSS-Protection "1; mode=block";

    gzip on;
    gzip_types text/plain application/json application/javascript text/css;
}
NGINX_EOF

    sudo ln -sf "/etc/nginx/sites-available/${APP_NAME}" "/etc/nginx/sites-enabled/${APP_NAME}"
    sudo rm -f /etc/nginx/sites-enabled/default
    sudo nginx -t
    sudo systemctl reload nginx
    ok "nginx is proxying port 80 to ${APP_PORT}"
}

main() {
    require_ubuntu

    log "Updating system packages"
    sudo apt update -y
    sudo apt install -y git curl ca-certificates build-essential openssl nginx
    sudo systemctl enable nginx
    sudo systemctl start nginx

    log "Installing Node.js ${NODE_MAJOR}"
    if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q "^v${NODE_MAJOR}\\."; then
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
        sudo apt install -y nodejs
    fi
    ok "Node $(node -v), npm $(npm -v)"

    log "Installing PM2"
    sudo npm install -g pm2
    ok "PM2 $(pm2 -v)"

    ensure_postgres

    log "Fetching application code"
    if [ -d "$DEPLOY_DIR/.git" ]; then
        git -C "$DEPLOY_DIR" fetch origin "$BRANCH"
        git -C "$DEPLOY_DIR" checkout "$BRANCH"
        git -C "$DEPLOY_DIR" pull --ff-only origin "$BRANCH"
    elif [ -d "$DEPLOY_DIR" ]; then
        ok "$DEPLOY_DIR exists; using existing files"
    else
        git clone --branch "$BRANCH" "$REPO_URL" "$DEPLOY_DIR"
    fi

    APP_DIR="$(resolve_app_dir)"
    cd "$APP_DIR"
    ok "Application directory: $APP_DIR"

    local ip
    ip="$(public_ip)"
    write_env_if_missing "$APP_DIR" "$ip"

    log "Installing application dependencies"
    npm install --omit=dev

    log "Running database migration"
    npm run migrate

    log "Starting application with PM2"
    mkdir -p logs
    pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
    pm2 start ecosystem.config.js --env production
    pm2 save
    sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null || true

    write_nginx_site "$DOMAIN"

    log "Checking health endpoint"
    sleep 3
    if curl -fsS "http://127.0.0.1:${APP_PORT}/health" >/dev/null; then
        ok "App health check passed"
    else
        echo "Health check failed. Run: pm2 logs ${APP_NAME}"
        exit 1
    fi

    local url
    if [ "$DOMAIN" = "_" ]; then
        url="http://${ip}"
    else
        url="http://${DOMAIN}"
    fi

    cat <<DONE_EOF

============================================================
Deployment complete
============================================================
App URL:      ${url}
App dir:      ${APP_DIR}
PM2 status:   pm2 status
Logs:         pm2 logs ${APP_NAME}
Restart:      pm2 restart ${APP_NAME}
Update:       cd ${DEPLOY_DIR} && git pull --ff-only origin ${BRANCH} && cd ${APP_DIR} && npm install --omit=dev && npm run migrate && pm2 restart ${APP_NAME}

Domain later:
  1. Point your DNS A record to ${ip}
  2. Re-run: DOMAIN=yourdomain.com bash ${APP_DIR}/deploy.sh
  3. Install SSL: sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d yourdomain.com
============================================================
DONE_EOF
}

main "$@"
