# Zhuravlik

Zhuravlik is a small self-hosted messenger for private dialogs and rooms. It is built for families, local communities, small teams, and anyone who wants a closed chat space they can run on their own server or Raspberry Pi.

The project uses a simple stack: `Node.js`, `Express`, `Socket.IO`, `SQLite`, and plain frontend code without a heavy framework.

## What It Does

- private dialogs
- public and private rooms
- invitations and join requests
- room roles: `owner`, `admin`, `member`
- room rules for posting and inviting
- replies, edits, soft delete, forwarding, reactions
- polls, image uploads, files, shared media/links/files
- unread counters, typing, read status, pinned/muted/archived chats
- profile screens for rooms and direct dialogs
- admin console and room moderation tools
- session management and browser notifications

## Stack

- backend: `Node.js`, `Express`, `Socket.IO`
- database: `SQLite`
- auth: JWT access token + refresh session cookie
- uploads: `multer`
- frontend: `HTML`, `CSS`, `Vanilla JS`

## Quick Start

```bash
npm install
cp .env.example .env
npm start
```

By default the app runs on `http://localhost:3010`.

## Environment

Copy `.env.example` and set the values you actually need.

Important variables:

- `NODE_ENV` - `development` or `production`
- `HOST` - usually `127.0.0.1` behind nginx/caddy
- `PORT` - app port
- `JWT_SECRET` - required in production
- `CORS_ORIGIN` - required in production
- `DB_PATH` - SQLite database file
- `UPLOADS_DIR` - uploads directory
- `ACCESS_TOKEN_TTL` - access token lifetime, default `15m`
- `REFRESH_TOKEN_TTL_DAYS` - refresh session lifetime, default `30`
- `HTTPS_KEY_PATH` / `HTTPS_CERT_PATH` - optional direct HTTPS in Node
- `WEB_PUSH_PUBLIC_KEY` / `WEB_PUSH_PRIVATE_KEY` / `WEB_PUSH_SUBJECT` - optional web push settings

## Install on Server

For Debian, Ubuntu, and Raspberry Pi OS there is a ready installer:

```bash
sudo bash scripts/install-anywhere.sh
```

Example with custom values:

```bash
sudo DOMAIN=chat.example.com APP_DIR=/opt/zhuravlik bash scripts/install-anywhere.sh
```

Default bootstrap admin:

- login: `admin`
- password: `!QAZxsw2`

Override it if needed:

```bash
sudo ADMIN_USERNAME=myadmin ADMIN_PASSWORD='strong-password' ADMIN_DISPLAY_NAME='Main Admin' bash scripts/install-anywhere.sh
```

## Automatic Updates

The repository includes a simple updater for Linux servers.

Install it with:

```bash
sudo bash scripts/install-auto-update.sh
```

It can:

- check GitHub for new commits
- pull updates with `git pull --ff-only`
- install dependencies
- restart the app service
- make lightweight backups before update

Useful commands:

```bash
systemctl status zhur-messenger-update.timer
journalctl -u zhur-messenger-update.service -f
```

## Run Behind Nginx

Typical production setup:

- app listens on `127.0.0.1:3010`
- nginx or caddy terminates HTTPS
- SQLite database and uploads live outside the repo root if possible

Example nginx config:

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

## Docker

```bash
cp .env.example .env
mkdir -p data uploads/avatars uploads/messages uploads/rooms uploads/files
docker compose up -d --build
```

## Files You Should Persist

- `data/messenger.db`
- `uploads/avatars`
- `uploads/messages`
- `uploads/rooms`
- `uploads/files`

## Health Check

Endpoint:

```text
GET /health
```

Example response:

```json
{
  "ok": true,
  "uptime": 123,
  "users": 5,
  "env": "production"
}
```

## Security Notes

- set a strong `JWT_SECRET` in production
- set `CORS_ORIGIN` explicitly in production
- run the app behind HTTPS
- keep `.env`, database files, and backups private
- uploaded images and supported documents are checked before being accepted
- files from `/uploads/files` are served as attachments

This is a self-hosted messenger, not an end-to-end encrypted one. The server can access message contents.

## Docs

- deployment notes: `DEPLOY.md`
- Russian user guide: `USER_GUIDE_RU.md`
- Russian PDF guide: `USER_GUIDE_RU.pdf`

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
- `POST /api/rooms/:roomId/messages`
- `GET /api/media/shared`
- `GET /api/admin/overview`

## Notes

This project has grown around real usage and practical deployment needs, especially on small servers and Raspberry Pi devices. The codebase is intentionally straightforward to run, inspect, and maintain.
