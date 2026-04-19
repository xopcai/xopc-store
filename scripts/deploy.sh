#!/bin/bash

# ============================================
# xopc-store 部署
#   bash scripts/deploy.sh           增量部署
#   bash scripts/deploy.sh --fresh   清空远端目录与 PM2 后全量部署（数据库与 .env 重置）
# ============================================

set -e

FRESH=0
if [[ "${1:-}" == "--fresh" ]]; then
  FRESH=1
fi

# 须在环境中指定，例如: export XOPC_SERVER=user@your-server
SERVER="${XOPC_SERVER:?请设置环境变量 XOPC_SERVER，例如 export XOPC_SERVER=user@your-host}"
REMOTE_DIR="${XOPC_STORE_REMOTE_DIR:-/var/www/xopc-store}"
DOMAIN="${XOPC_STORE_DOMAIN:-store.example.com}"
API_PORT="${XOPC_STORE_API_PORT:-3002}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo_step() {
    echo -e "${GREEN}==>${NC} $1"
}

echo_warn() {
    echo -e "${YELLOW}WARNING:${NC} $1"
}

echo_error() {
    echo -e "${RED}ERROR:${NC} $1"
}

check_command() {
    if ! command -v "$1" &> /dev/null; then
        echo_error "$1 is not installed"
        exit 1
    fi
}

main() {
    echo "=========================================="
    if [[ "$FRESH" == "1" ]]; then echo "  xopc-store 部署  [--fresh]"; else echo "  xopc-store 部署"; fi
    echo "  服务器: $SERVER"
    echo "  远程目录: $REMOTE_DIR"
    echo "  域名: $DOMAIN (HTTPS)"
    echo "  API: 127.0.0.1:$API_PORT"
    echo "=========================================="
    echo ""

    if [[ "$FRESH" == "1" ]]; then
        echo_step "清空远端旧部署..."
        ssh -o ConnectTimeout=10 "$SERVER" bash -s << REMOTE_CLEAN
set -e
export PATH="\$HOME/.nvm/versions/node/\$(ls \$HOME/.nvm/versions/node | tail -1)/bin:\$PATH"
pm2 delete xopc-store-api 2>/dev/null || true
pm2 save 2>/dev/null || true
rm -rf "$REMOTE_DIR"
echo "✓ 已删除 $REMOTE_DIR"
REMOTE_CLEAN
    fi

    echo_step "检查本地环境..."
    check_command "rsync"
    check_command "ssh"
    check_command "pnpm"

    echo_step "检查远程服务器..."
    ssh -o ConnectTimeout=10 "$SERVER" "echo 'SSH OK'" || { echo_error "无法连接到服务器"; exit 1; }

    echo ""
    echo_step "步骤 1/4: 本地构建..."
    pnpm install
    pnpm build
    echo -e "${GREEN}✓ 构建成功${NC}"

    echo ""
    echo_step "步骤 2/4: 同步到服务器..."
    rsync -avz \
        --include='.env.example' \
        --exclude='.env*' \
        --exclude='node_modules' \
        --exclude='.git' \
        --exclude='data' \
        --exclude='apps/server/data' \
        --exclude='.DS_Store' \
        --exclude='*.log' \
        --exclude='.npmrc' \
        --exclude='third-party' \
        ./ "$SERVER:$REMOTE_DIR/"
    echo -e "${GREEN}✓ 同步完成${NC}"

    echo ""
    echo_step "步骤 3/4: 远程依赖、schema push、PM2..."
    ssh "$SERVER" bash -s << REMOTE_SCRIPT
set -e
REMOTE_DIR="$REMOTE_DIR"
DOMAIN="$DOMAIN"
FRESH="$FRESH"
cd "\$REMOTE_DIR"

export PATH="\$HOME/.nvm/versions/node/\$(ls \$HOME/.nvm/versions/node | tail -1)/bin:\$PATH"

export CI=1
pnpm install --frozen-lockfile

mkdir -p apps/server/data/packages

if [[ "\$FRESH" == "1" ]] || [[ ! -f "apps/server/.env" ]]; then
  cp -f .env.example apps/server/.env
  echo "已写入 apps/server/.env（自 .env.example）。请配置 GITHUB_* 与 JWT_SECRET。"
fi

echo "数据库迁移由 API 进程启动时自动执行 (drizzle migrate)；确保 apps/server/drizzle 已随代码同步。"

echo "重启 API (PM2)..."
pm2 restart xopc-store-api 2>/dev/null || pm2 start deploy/ecosystem.config.cjs --only xopc-store-api
pm2 save

echo "✓ PM2 已更新"
REMOTE_SCRIPT
    echo -e "${GREEN}✓ 依赖与 PM2 完成${NC}"

    echo ""
    echo_step "步骤 4/4: Nginx + SSL..."
    ssh "$SERVER" bash -s << NGINX_SCRIPT
set -e
REMOTE_DIR="$REMOTE_DIR"
DOMAIN="$DOMAIN"
API_PORT="$API_PORT"
WEB_ROOT="\$REMOTE_DIR/apps/web/dist"

sed -e "s/@DOMAIN@/\$DOMAIN/g" -e "s/@API_PORT@/\$API_PORT/g" -e "s|@WEB_ROOT@|\$WEB_ROOT|g" \\
  "\$REMOTE_DIR/deploy/nginx.store.conf.template" > /etc/nginx/conf.d/xopc-store.conf

nginx -t
systemctl reload nginx

if [ ! -f "/etc/letsencrypt/live/\$DOMAIN/fullchain.pem" ]; then
  certbot certonly --nginx -d "\$DOMAIN" --non-interactive --agree-tos \\
    --register-unsafely-without-email --no-eff-email
fi

if [ -f "/etc/letsencrypt/live/\$DOMAIN/fullchain.pem" ]; then
  sed -e "s/@DOMAIN@/\$DOMAIN/g" -e "s/@API_PORT@/\$API_PORT/g" -e "s|@WEB_ROOT@|\$WEB_ROOT|g" \\
    "\$REMOTE_DIR/deploy/nginx.store.ssl.conf.template" > /etc/nginx/conf.d/xopc-store.conf
  nginx -t
  systemctl reload nginx
  echo "✓ 已启用 HTTPS"
else
  echo "WARN: 未取得 \$DOMAIN 证书"
  exit 1
fi
NGINX_SCRIPT

    echo ""
    echo_step "验证 https://$DOMAIN ..."
    sleep 2
    code=$(curl -sLo /dev/null -w "%{http_code}" "https://$DOMAIN/" || echo "000")
    if [ "$code" = "200" ]; then
        echo -e "${GREEN}✓ https://$DOMAIN — OK${NC}"
    else
        echo_warn "首页 HTTP $code"
    fi
    h=$(curl -sLo /dev/null -w "%{http_code}" "https://$DOMAIN/health" || echo "000")
    if [ "$h" = "200" ]; then
        echo -e "${GREEN}✓ https://$DOMAIN/health — OK${NC}"
    else
        echo_warn "健康检查 /health HTTP $h"
    fi

    echo ""
    echo "=========================================="
    echo -e "${GREEN}  部署流程结束${NC}"
    echo "=========================================="
}

main
