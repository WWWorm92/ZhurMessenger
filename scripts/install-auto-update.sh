#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/root/projects/Messenger}"
SERVICE_NAME="${SERVICE_NAME:-zhur-messenger}"
TIMER_NAME="${TIMER_NAME:-zhur-messenger-update}"
BRANCH="${BRANCH:-main}"
REMOTE="${REMOTE:-origin}"
SCHEDULE="${SCHEDULE:-*:0/2}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash scripts/install-auto-update.sh"
  exit 1
fi

cat > "/etc/systemd/system/${TIMER_NAME}.service" <<EOF
[Unit]
Description=Update Pulse Messenger from GitHub

[Service]
Type=oneshot
Environment=APP_DIR=$APP_DIR
Environment=SERVICE_NAME=$SERVICE_NAME
Environment=BRANCH=$BRANCH
Environment=REMOTE=$REMOTE
ExecStart=/bin/bash $APP_DIR/scripts/update-from-github.sh
EOF

cat > "/etc/systemd/system/${TIMER_NAME}.timer" <<EOF
[Unit]
Description=Run Pulse Messenger auto-update periodically

[Timer]
OnCalendar=$SCHEDULE
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now "${TIMER_NAME}.timer"
systemctl list-timers --all | grep "$TIMER_NAME" || true

echo
echo "Auto-update timer installed."
echo "Service: ${TIMER_NAME}.service"
echo "Timer:   ${TIMER_NAME}.timer"
