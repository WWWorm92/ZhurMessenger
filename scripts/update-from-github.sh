#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/root/projects/Messenger}"
BRANCH="${BRANCH:-main}"
REMOTE="${REMOTE:-origin}"
SERVICE_NAME="${SERVICE_NAME:-zhur-messenger}"
LOG_FILE="${LOG_FILE:-/var/log/zhur-messenger-update.log}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"

mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$BACKUP_DIR"

exec >>"$LOG_FILE" 2>&1

echo
echo "[$(date '+%F %T')] Starting auto-update check"

cd "$APP_DIR"

if [ ! -d .git ]; then
  echo "Not a git repository: $APP_DIR"
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is dirty, skipping auto-update"
  exit 0
fi

git fetch "$REMOTE" "$BRANCH"

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "$REMOTE/$BRANCH")"

if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
  echo "Already up to date: $LOCAL_SHA"
  exit 0
fi

echo "Updating from $LOCAL_SHA to $REMOTE_SHA"

TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
if [ -f "$APP_DIR/messenger.db" ]; then
  cp "$APP_DIR/messenger.db" "$BACKUP_DIR/messenger-$TIMESTAMP.db"
fi
if [ -d "$APP_DIR/data" ]; then
  tar -czf "$BACKUP_DIR/data-$TIMESTAMP.tar.gz" -C "$APP_DIR" data >/dev/null 2>&1 || true
fi
if [ -d "$APP_DIR/uploads" ]; then
  tar -czf "$BACKUP_DIR/uploads-$TIMESTAMP.tar.gz" -C "$APP_DIR" uploads >/dev/null 2>&1 || true
fi

git pull --ff-only "$REMOTE" "$BRANCH"

if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

if systemctl list-unit-files | grep -q "^${SERVICE_NAME}\.service"; then
  systemctl restart "$SERVICE_NAME"
else
  pkill -f "node .*server/index.js" || true
  nohup env PORT="${PORT:-3010}" HOST="${HOST:-127.0.0.1}" node "$APP_DIR/server/index.js" >/tmp/zhur-messenger.log 2>&1 &
fi

echo "[$(date '+%F %T')] Update complete"
