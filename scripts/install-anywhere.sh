#!/usr/bin/env bash
set -euo pipefail

APP_NAME="zhur-messenger"
APP_USER="${SUDO_USER:-${USER:-root}}"
APP_DIR_DEFAULT="/opt/ZhurMessenger"
APP_DIR="${APP_DIR:-$APP_DIR_DEFAULT}"
APP_PORT="${APP_PORT:-3010}"
APP_HOST="${APP_HOST:-127.0.0.1}"
INSTALL_NGINX="${INSTALL_NGINX:-1}"
INSTALL_SYSTEMD="${INSTALL_SYSTEMD:-1}"
DOMAIN="${DOMAIN:-}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

log() {
  printf '\n==> %s\n' "$1"
}

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Run this script as root: sudo bash scripts/install-anywhere.sh"
    exit 1
  fi
}

ensure_linux() {
  if [ ! -f /etc/os-release ]; then
    echo "Unsupported system: /etc/os-release not found"
    exit 1
  fi
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian|raspbian)
      ;;
    *)
      echo "This installer currently supports Ubuntu/Debian/Raspberry Pi OS"
      exit 1
      ;;
  esac
}

install_packages() {
  log "Installing system packages"
  apt-get update
  apt-get install -y git curl ca-certificates build-essential rsync

  if ! command -v node >/dev/null 2>&1; then
    log "Installing Node.js 20"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi

  if [ "$INSTALL_NGINX" = "1" ]; then
    apt-get install -y nginx
  fi
}

prepare_app_dir() {
  log "Preparing application directory: $APP_DIR"
  mkdir -p "$APP_DIR"
  rsync -a --delete \
    --exclude node_modules \
    --exclude .git \
    --exclude messenger.db \
    --exclude uploads \
    --exclude data \
    --exclude certs \
    "$REPO_DIR/" "$APP_DIR/"

  mkdir -p "$APP_DIR/data"
  mkdir -p "$APP_DIR/uploads/avatars"
  mkdir -p "$APP_DIR/uploads/messages"

  if [ ! -f "$APP_DIR/.env" ]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  fi
}

write_env() {
  log "Preparing .env"
  python3 - <<PY
from pathlib import Path
env_path = Path(${APP_DIR@Q}) / '.env'
text = env_path.read_text() if env_path.exists() else ''
lines = [line for line in text.splitlines() if line.strip()]
values = {}
for line in lines:
    if '=' in line and not line.lstrip().startswith('#'):
        k, v = line.split('=', 1)
        values[k] = v
values.update({
    'NODE_ENV': 'production',
    'HOST': ${APP_HOST@Q},
    'PORT': ${APP_PORT@Q},
    'DB_PATH': './data/messenger.db',
    'UPLOADS_DIR': './uploads',
})
if ${DOMAIN@Q}:
    values['CORS_ORIGIN'] = f'https://{${DOMAIN@Q}}'
required_order = [
    'NODE_ENV', 'HOST', 'PORT', 'JWT_SECRET', 'CORS_ORIGIN', 'DB_PATH', 'UPLOADS_DIR',
    'ACCESS_TOKEN_TTL', 'REFRESH_TOKEN_TTL_DAYS', 'WEB_PUSH_PUBLIC_KEY'
]
for key in required_order:
    values.setdefault(key, '')
output = '\n'.join(f'{k}={values.get(k, "")}' for k in required_order) + '\n'
env_path.write_text(output)
PY

  if ! grep -q '^JWT_SECRET=' "$APP_DIR/.env" || grep -q '^JWT_SECRET=$' "$APP_DIR/.env"; then
    local secret
    secret="$(openssl rand -hex 32)"
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$secret|" "$APP_DIR/.env"
  fi
}

install_node_deps() {
  log "Installing application dependencies"
  cd "$APP_DIR"
  npm install
}

write_systemd_unit() {
  if [ "$INSTALL_SYSTEMD" != "1" ]; then
    return
  fi

  log "Creating systemd service"
  cat > "/etc/systemd/system/${APP_NAME}.service" <<EOF
[Unit]
Description=Pulse Messenger
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node $APP_DIR/server/index.js
Restart=always
RestartSec=5
EnvironmentFile=$APP_DIR/.env
User=root

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "$APP_NAME"
  systemctl restart "$APP_NAME"
}

write_nginx_config() {
  if [ "$INSTALL_NGINX" != "1" ]; then
    return
  fi

  log "Creating nginx site"
  local server_name
  if [ -n "$DOMAIN" ]; then
    server_name="$DOMAIN www.$DOMAIN"
  else
    server_name="_"
  fi

  cat > "/etc/nginx/sites-available/${APP_NAME}" <<EOF
server {
    listen 80;
    server_name $server_name;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

  ln -sf "/etc/nginx/sites-available/${APP_NAME}" "/etc/nginx/sites-enabled/${APP_NAME}"
  nginx -t
  systemctl reload nginx
}

show_summary() {
  cat <<EOF

Installation complete.

App directory: $APP_DIR
Environment:    $APP_DIR/.env
Database path:  $APP_DIR/data/messenger.db
Uploads path:   $APP_DIR/uploads

Useful commands:
  systemctl status $APP_NAME
  journalctl -u $APP_NAME -f
  curl http://127.0.0.1:$APP_PORT/health

Next steps:
  1. Copy your old database to: $APP_DIR/data/messenger.db
  2. Copy uploads into: $APP_DIR/uploads/
  3. Edit $APP_DIR/.env if needed
EOF

  if [ -n "$DOMAIN" ]; then
    cat <<EOF
  4. Point DNS of $DOMAIN to this server
  5. Enable HTTPS with certbot when DNS is ready:
     certbot --nginx -d $DOMAIN -d www.$DOMAIN
EOF
  fi
}

need_root
ensure_linux
install_packages
prepare_app_dir
write_env
install_node_deps
write_systemd_unit
write_nginx_config
show_summary
