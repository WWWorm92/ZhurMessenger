#!/usr/bin/env bash
set -euo pipefail

APP_NAME="zhur-messenger"
APP_USER="${SUDO_USER:-${USER:-root}}"
APP_DIR_DEFAULT="/opt/ZhurMessenger"
APP_DIR="${APP_DIR:-}"
APP_PORT="${APP_PORT:-}"
APP_HOST="${APP_HOST:-}"
INSTALL_NGINX="${INSTALL_NGINX:-}"
INSTALL_SYSTEMD="${INSTALL_SYSTEMD:-}"
DOMAIN="${DOMAIN:-}"
ENABLE_HTTPS="${ENABLE_HTTPS:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
USE_DEV_CERT="${USE_DEV_CERT:-}"
INSTALL_AUTO_UPDATE="${INSTALL_AUTO_UPDATE:-}"
AUTO_UPDATE_BRANCH="${AUTO_UPDATE_BRANCH:-main}"
AUTO_UPDATE_REMOTE="${AUTO_UPDATE_REMOTE:-origin}"
ADMIN_USERNAME="${ADMIN_USERNAME:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
ADMIN_DISPLAY_NAME="${ADMIN_DISPLAY_NAME:-}"
APP_PROTOCOL="http"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

log() {
  printf '\n==> %s\n' "$1"
}

prompt_value() {
  local __var_name="$1"
  local __label="$2"
  local __help="$3"
  local __default="$4"
  local __current="${!__var_name:-}"
  local __value=""

  if [ -n "$__current" ]; then
    return
  fi

  if [ -t 0 ]; then
    [ -n "$__help" ] && printf '%s\n' "$__help"
    if [ -n "$__default" ]; then
      read -r -p "$__label [$__default]: " __value
      __value="${__value:-$__default}"
    else
      read -r -p "$__label: " __value
    fi
  else
    __value="$__default"
  fi

  printf -v "$__var_name" '%s' "$__value"
}

prompt_secret() {
  local __var_name="$1"
  local __label="$2"
  local __help="$3"
  local __default="$4"
  local __current="${!__var_name:-}"
  local __value=""

  if [ -n "$__current" ]; then
    return
  fi

  if [ -t 0 ]; then
    [ -n "$__help" ] && printf '%s\n' "$__help"
    if [ -n "$__default" ]; then
      read -r -s -p "$__label [hidden]: " __value
      printf '\n'
      __value="${__value:-$__default}"
    else
      read -r -s -p "$__label: " __value
      printf '\n'
    fi
  else
    __value="$__default"
  fi

  printf -v "$__var_name" '%s' "$__value"
}

prompt_yes_no() {
  local __var_name="$1"
  local __label="$2"
  local __help="$3"
  local __default="$4"
  local __current="${!__var_name:-}"
  local __value=""

  if [ -n "$__current" ]; then
    return
  fi

  if [ -t 0 ]; then
    [ -n "$__help" ] && printf '%s\n' "$__help"
    if [ "$__default" = "1" ]; then
      read -r -p "$__label [Y/n]: " __value
    else
      read -r -p "$__label [y/N]: " __value
    fi
  fi

  case "${__value,,}" in
    y|yes|1)
      __value="1"
      ;;
    n|no|0)
      __value="0"
      ;;
    *)
      __value="$__default"
      ;;
  esac

  printf -v "$__var_name" '%s' "$__value"
}

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Запусти этот скрипт от root: sudo bash scripts/install-anywhere.sh"
    exit 1
  fi
}

ensure_linux() {
  if [ ! -f /etc/os-release ]; then
    echo "Неподдерживаемая система: не найден /etc/os-release"
    exit 1
  fi
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian|raspbian)
      ;;
    *)
      echo "Этот установщик поддерживает только Ubuntu/Debian/Raspberry Pi OS"
      exit 1
      ;;
  esac
}

install_packages() {
  log "Установка системных пакетов"
  apt-get update
  apt-get install -y git curl ca-certificates build-essential rsync openssl

  if ! command -v node >/dev/null 2>&1; then
    log "Установка Node.js 20"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi

  if [ "$INSTALL_NGINX" = "1" ]; then
    apt-get install -y nginx
  fi

  if [ "$ENABLE_HTTPS" = "1" ]; then
    apt-get install -y certbot python3-certbot-nginx
  fi
}

prepare_app_dir() {
  log "Подготовка каталога приложения: $APP_DIR"
  mkdir -p "$APP_DIR"
  local rsync_args=(
    -a
    --delete
    --exclude node_modules
    --exclude .env
    --exclude messenger.db
    --exclude uploads
    --exclude data
    --exclude certs
  )
  if [ "$INSTALL_AUTO_UPDATE" != "1" ]; then
    rsync_args+=(--exclude .git)
  fi
  rsync "${rsync_args[@]}" "$REPO_DIR/" "$APP_DIR/"

  mkdir -p "$APP_DIR/data"
  mkdir -p "$APP_DIR/uploads/avatars"
  mkdir -p "$APP_DIR/uploads/messages"
  mkdir -p "$APP_DIR/uploads/rooms"
  mkdir -p "$APP_DIR/uploads/files"

  if [ ! -f "$APP_DIR/.env" ]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  fi
}

write_env() {
  log "Подготовка файла .env"
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
    scheme = 'https' if ${ENABLE_HTTPS@Q} == '1' else 'http'
    values['CORS_ORIGIN'] = f'{scheme}://{${DOMAIN@Q}}'
if ${HTTPS_KEY_PATH@Q}:
    values['HTTPS_KEY_PATH'] = ${HTTPS_KEY_PATH@Q}
if ${HTTPS_CERT_PATH@Q}:
    values['HTTPS_CERT_PATH'] = ${HTTPS_CERT_PATH@Q}
required_order = [
    'NODE_ENV', 'HOST', 'PORT', 'JWT_SECRET', 'CORS_ORIGIN', 'DB_PATH', 'UPLOADS_DIR',
    'HTTPS_KEY_PATH', 'HTTPS_CERT_PATH',
    'ACCESS_TOKEN_TTL', 'REFRESH_TOKEN_TTL_DAYS', 'WEB_PUSH_PUBLIC_KEY', 'WEB_PUSH_PRIVATE_KEY', 'WEB_PUSH_SUBJECT'
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

  chmod 600 "$APP_DIR/.env"
}

install_node_deps() {
  log "Установка зависимостей приложения"
  cd "$APP_DIR"
  npm install
}

setup_dev_certificate() {
  if [ "$USE_DEV_CERT" != "1" ]; then
    return
  fi

  log "Создание локального HTTPS-сертификата"
  bash "$APP_DIR/scripts/gen-dev-cert.sh"
  export HTTPS_KEY_PATH="$APP_DIR/certs/localhost-key.pem"
  export HTTPS_CERT_PATH="$APP_DIR/certs/localhost-cert.pem"
  APP_PROTOCOL="https"
  INSTALL_NGINX="0"
}

install_auto_update_timer() {
  if [ "$INSTALL_AUTO_UPDATE" != "1" ]; then
    return
  fi

  log "Установка автообновления из GitHub"
  APP_DIR="$APP_DIR" SERVICE_NAME="$APP_NAME" TIMER_NAME="${APP_NAME}-update" BRANCH="$AUTO_UPDATE_BRANCH" REMOTE="$AUTO_UPDATE_REMOTE" PORT="$APP_PORT" HOST="$APP_HOST" bash "$APP_DIR/scripts/install-auto-update.sh"
}

app_health_url() {
  printf '%s://127.0.0.1:%s/health' "$APP_PROTOCOL" "$APP_PORT"
}

app_api_url() {
  printf '%s://127.0.0.1:%s' "$APP_PROTOCOL" "$APP_PORT"
}

write_systemd_unit() {
  if [ "$INSTALL_SYSTEMD" != "1" ]; then
    return
  fi

  log "Создание systemd-сервиса"
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

start_app_process() {
  if [ "$INSTALL_SYSTEMD" = "1" ]; then
    return
  fi

  log "Запуск приложения в фоне"
  if [ -f "$APP_DIR/.env" ]; then
    nohup bash -c 'set -a; . "$1"; set +a; exec node "$2"' _ "$APP_DIR/.env" "$APP_DIR/server/index.js" >/tmp/zhur-messenger.log 2>&1 &
  else
    nohup env PORT="$APP_PORT" HOST="$APP_HOST" node "$APP_DIR/server/index.js" >/tmp/zhur-messenger.log 2>&1 &
  fi
}

wait_for_service() {
  log "Ожидание готовности приложения"
  local ok=0
  for _ in $(seq 1 30); do
    if curl -fsS -k "$(app_health_url)" >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 1
  done
  if [ "$ok" != "1" ]; then
    echo "Приложение не успело подняться вовремя"
    systemctl status "$APP_NAME" --no-pager || true
    exit 1
  fi
}

bootstrap_admin_user() {
  log "Проверка, нужен ли первый админ"
  local count
  count="$(node -e "const sqlite3=require('sqlite3').verbose(); const db=new sqlite3.Database(process.argv[1]); db.get('SELECT COUNT(*) AS count FROM users', (err,row)=>{ console.log(String(err ? 0 : ((row&&row.count)||0))); db.close(); });" "$APP_DIR/data/messenger.db")"
  if [ "$count" != "0" ]; then
    echo "Пользователи уже есть, создание админа пропущено"
    return
  fi

  curl -fsS -k -X POST "$(app_api_url)/api/auth/register" \
    -H "Content-Type: application/json" \
    --data-binary "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\",\"displayName\":\"$ADMIN_DISPLAY_NAME\"}" >/dev/null
  echo "Создан первый админ: $ADMIN_USERNAME"
}

write_nginx_config() {
  if [ "$INSTALL_NGINX" != "1" ]; then
    return
  fi

  log "Создание nginx-конфига"
  local server_name
  if [ -n "$DOMAIN" ]; then
    server_name="$DOMAIN"
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

setup_https_certificate() {
  if [ "$ENABLE_HTTPS" != "1" ]; then
    return
  fi

  if [ "$INSTALL_NGINX" != "1" ]; then
    echo "Для HTTPS нужен nginx, включаю его установку."
    INSTALL_NGINX="1"
  fi

  if [ -z "$DOMAIN" ]; then
    echo "HTTPS был включён, но домен не указан."
    exit 1
  fi

  if [ -z "$CERTBOT_EMAIL" ]; then
    echo "Для HTTPS нужен CERTBOT_EMAIL."
    exit 1
  fi

  log "Запрос сертификата Let's Encrypt"
  certbot --nginx \
    --non-interactive \
    --agree-tos \
    --redirect \
    -m "$CERTBOT_EMAIL" \
    -d "$DOMAIN"
}

show_summary() {
  if [ "$INSTALL_SYSTEMD" = "1" ]; then
    cat <<EOF

Установка завершена.

Каталог приложения: $APP_DIR
Файл настроек:      $APP_DIR/.env
База данных:        $APP_DIR/data/messenger.db
Загрузки:           $APP_DIR/uploads

Полезные команды:
  systemctl status $APP_NAME
  journalctl -u $APP_NAME -f
  curl -k $(app_health_url)

Если переносишь старые данные:
  1. Скопируй старую базу в: $APP_DIR/data/messenger.db
  2. Скопируй файлы в: $APP_DIR/uploads/
  3. При необходимости поправь $APP_DIR/.env
EOF
  else
    cat <<EOF

Установка завершена.

Каталог приложения: $APP_DIR
Файл настроек:      $APP_DIR/.env
База данных:        $APP_DIR/data/messenger.db
Загрузки:           $APP_DIR/uploads

Полезные команды:
  tail -f /tmp/zhur-messenger.log
  curl -k $(app_health_url)

Если переносишь старые данные:
  1. Скопируй старую базу в: $APP_DIR/data/messenger.db
  2. Скопируй файлы в: $APP_DIR/uploads/
  3. При необходимости поправь $APP_DIR/.env
EOF
  fi

  if [ "$INSTALL_AUTO_UPDATE" = "1" ]; then
    cat <<EOF

Автообновление включено:
  systemctl status ${APP_NAME}-update.timer
  journalctl -u ${APP_NAME}-update.service -f
EOF
  fi

  if [ "$USE_DEV_CERT" = "1" ]; then
    cat <<EOF

Локальный HTTPS включен через самоподписанный сертификат.
EOF
  fi

  if [ "$ENABLE_HTTPS" = "1" ]; then
    cat <<EOF

HTTPS через Let's Encrypt включен через nginx.
EOF
  fi
}

need_root
ensure_linux

prompt_value APP_DIR "Каталог приложения" "Здесь будут лежать файлы мессенджера на сервере. Обычно это можно не менять." "$APP_DIR_DEFAULT"
prompt_value APP_PORT "Порт приложения" "Это локальный порт, на котором будет слушать мессенджер. Обычно подходит значение по умолчанию." "3010"
prompt_value APP_HOST "Адрес привязки" "Адрес, на котором будет слушать приложение. За nginx обычно оставляют 127.0.0.1." "127.0.0.1"
prompt_value DOMAIN "Домен (оставь пустым, если работаешь только по IP)" "Если сайт будет открываться по домену, введи его здесь. Если нужен только IP, оставь пустым." "$DOMAIN"
prompt_yes_no INSTALL_NGINX "Установить nginx" "nginx будет принимать внешний трафик и нужен для HTTPS." "1"
prompt_yes_no INSTALL_SYSTEMD "Установить и включить systemd-сервис" "systemd будет держать приложение запущенным и поднимать его после перезагрузки." "1"
if [ -n "$DOMAIN" ]; then
  prompt_yes_no ENABLE_HTTPS "Включить HTTPS через Let's Encrypt" "Скрипт сам запросит бесплатный SSL-сертификат для домена и включит HTTPS." "1"
  if [ "$ENABLE_HTTPS" = "1" ]; then
    INSTALL_NGINX="1"
    prompt_value CERTBOT_EMAIL "Почта для Let's Encrypt" "Нужна для уведомлений об истечении сертификата и безопасности. Укажи реальный ящик." "$CERTBOT_EMAIL"
  fi
else
  ENABLE_HTTPS="0"
  prompt_yes_no USE_DEV_CERT "Включить локальный HTTPS через самоподписанный сертификат" "Это создаст сертификат для localhost и включит HTTPS напрямую в приложении. nginx тогда не нужен." "0"
  if [ "$USE_DEV_CERT" = "1" ]; then
    INSTALL_NGINX="0"
  fi
fi
prompt_yes_no INSTALL_AUTO_UPDATE "Включить автообновление из GitHub" "Скрипт сохранит git-историю и поставит таймер, который будет подтягивать новые коммиты автоматически." "0"
if [ "$INSTALL_AUTO_UPDATE" = "1" ]; then
  prompt_value AUTO_UPDATE_REMOTE "Имя Git-удалённого репозитория" "Обычно это origin. Если не знаешь, оставь как есть." "$AUTO_UPDATE_REMOTE"
  prompt_value AUTO_UPDATE_BRANCH "Ветка Git" "Ветка, которую нужно отслеживать. Обычно это main." "$AUTO_UPDATE_BRANCH"
fi
prompt_value ADMIN_USERNAME "Логин администратора" "Это будет первый логин администратора в мессенджере. Выбирай простой и уникальный." "admin"
prompt_secret ADMIN_PASSWORD "Пароль администратора" "Придумай надёжный пароль. Он будет нужен для входа в админ-аккаунт." "!QAZxsw2"
prompt_value ADMIN_DISPLAY_NAME "Имя администратора" "Это имя будет отображаться в приложении для первого админа." "Admin"

install_packages
prepare_app_dir
setup_dev_certificate
write_env
install_node_deps
write_systemd_unit
start_app_process
wait_for_service
bootstrap_admin_user
write_nginx_config
setup_https_certificate
install_auto_update_timer
show_summary
