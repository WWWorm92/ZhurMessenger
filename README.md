# Pulse Messenger

Realtime messenger on `Node.js + Express + Socket.IO + SQLite` with private chats, rooms, invitations, reactions, polls, image uploads, admin console, room moderation, PWA basics, and session management.

## Features

- private dialogs and room chats
- public and private rooms with invitations
- room roles: `owner / admin / member`
- room policies: who can post and invite
- moderation audit log
- message replies, edits, soft delete, reactions
- image uploads with preview
- polls in chats
- admin console for user management
- archived/muted/pinned chats
- session/device management
- service worker + notification groundwork

## Tech Stack

- backend: `Node.js`, `Express`, `Socket.IO`
- database: `SQLite`
- auth: `JWT`, refresh sessions, `bcryptjs`
- uploads: `multer`
- frontend: `HTML`, `CSS`, `Vanilla JS`

## Quick Start

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3010` or configure `PORT` in `.env`.

## One-command Install

For Ubuntu, Debian, and Raspberry Pi OS there is a ready installer:

```bash
sudo bash scripts/install-anywhere.sh
```

Optional variables:

```bash
sudo DOMAIN=chat.example.com APP_DIR=/opt/ZhurMessenger bash scripts/install-anywhere.sh
```

## Automatic Updates From GitHub

The project includes a polling auto-updater for Linux servers.

Install it:

```bash
sudo bash scripts/install-auto-update.sh
```

What it does:

- checks `origin/main` every 2 minutes
- if new commits exist, runs `git pull --ff-only`
- installs dependencies
- restarts `zhur-messenger`
- creates lightweight backups of DB/uploads before update

Useful commands:

```bash
systemctl status zhur-messenger-update.timer
journalctl -u zhur-messenger-update.service -f
```

## Environment Variables

Copy `.env.example` and adjust values.

- `NODE_ENV` - `development` or `production`
- `HOST` - bind host, usually `127.0.0.1` behind reverse proxy or `0.0.0.0` in container
- `PORT` - app port
- `JWT_SECRET` - required in production
- `CORS_ORIGIN` - allowed frontend origin, for example `https://chat.example.com`
- `DB_PATH` - SQLite file path
- `UPLOADS_DIR` - upload storage path
- `ACCESS_TOKEN_TTL` - short-lived access token ttl, default `15m`
- `REFRESH_TOKEN_TTL_DAYS` - refresh session ttl in days, default `30`
- `HTTPS_KEY_PATH` / `HTTPS_CERT_PATH` - optional direct HTTPS in Node
- `WEB_PUSH_PUBLIC_KEY` - optional web-push public key

## Deploy Anywhere

Full migration guide: `DEPLOY.md`

### Option 1: Plain Node + reverse proxy

Best for VPS, Raspberry Pi, home server.

```bash
npm install
cp .env.example .env
mkdir -p data uploads/avatars uploads/messages
npm start
```

Recommended production setup:

- app listens on `127.0.0.1:3010`
- nginx/caddy terminates HTTPS and proxies to the app
- `DB_PATH=./data/messenger.db`
- `UPLOADS_DIR=./uploads`

### Option 2: Docker

```bash
cp .env.example .env
mkdir -p data uploads/avatars uploads/messages
docker compose up -d --build
```

App will be available on port `3010` unless changed in compose/proxy.

## Reverse Proxy Example (Nginx)

```nginx
server {
    listen 443 ssl;
    server_name chat.example.com;

    ssl_certificate /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Raspberry Pi Notes

- use `Node 20 LTS`
- keep `data/` and `uploads/` on SSD if possible
- run app with `systemd` or Docker
- put nginx/caddy in front for HTTPS
- keep SQLite backups

## Health Check

`GET /health`

Example response:

```json
{
  "ok": true,
  "uptime": 123,
  "users": 5,
  "env": "production"
}
```

## Main API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/auth/sessions`
- `DELETE /api/auth/sessions/:sessionId`
- `PATCH /api/profile`
- `PATCH /api/profile/password`
- `GET /api/users`
- `GET /api/messages/:userId`
- `POST /api/messages/:userId`
- `GET /api/rooms`
- `POST /api/rooms`
- `GET /api/rooms/:roomId`
- `PATCH /api/rooms/:roomId`
- `GET /api/rooms/:roomId/audit`
- `POST /api/rooms/:roomId/messages`
- `POST /api/admin/users`

## Files You Should Persist

- `data/messenger.db`
- `uploads/avatars`
- `uploads/messages`

## Publish to GitHub

This repo is now prepared for GitHub publication:

- secrets are not committed by default
- runtime data is ignored by `.gitignore`
- deploy config is documented
- Docker deployment is included

To publish manually:

```bash
git init
git add .
git commit -m "Initial Pulse Messenger release"
git branch -M main
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

If you want me to create the git repo locally and prepare the exact push commands for your GitHub repo URL, send me the repo URL.
