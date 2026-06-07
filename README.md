# Pulse Messenger

Обычный рабочий мессенджер на `Node.js + Express + Socket.IO + SQLite`.

Здесь есть личные чаты, комнаты, приглашения, реакции, опросы, загрузка картинок, админка, модерация и управление сессиями.

## Что умеет

- личные диалоги и чаты в комнатах
- публичные и закрытые комнаты с приглашениями
- роли в комнате: `owner`, `admin`, `member`
- настройки комнаты: кто может писать и приглашать
- журнал модерации
- ответы, редактирование, удаление сообщений и реакции
- загрузка изображений с предпросмотром
- опросы в чатах
- админка для управления пользователями
- архивирование, мут и закрепление чатов
- управление сессиями и устройствами
- service worker и базовая поддержка уведомлений

## Технологии

- backend: `Node.js`, `Express`, `Socket.IO`
- база: `SQLite`
- авторизация: `JWT`, refresh-сессии, `bcryptjs`
- загрузки: `multer`
- frontend: `HTML`, `CSS`, `Vanilla JS`

## Быстрый запуск

```bash
npm install
cp .env.example .env
npm start
```

После этого открой `http://localhost:3010` или поменяй `PORT` в `.env`.

## Установка на сервер

Для Ubuntu, Debian и Raspberry Pi OS есть установщик:

```bash
sudo bash scripts/install-anywhere.sh
```

Он сам спросит всё нужное и доведёт установку до конца.

Если нужен домен, можно сразу передать переменные:

```bash
sudo DOMAIN=chat.example.com APP_DIR=/opt/ZhurMessenger bash scripts/install-anywhere.sh
```

По умолчанию первый админ создаётся так:

- логин: `admin`
- пароль: `!QAZxsw2`

Можно задать свои значения:

```bash
sudo ADMIN_USERNAME=myadmin ADMIN_PASSWORD='strong-password' ADMIN_DISPLAY_NAME='Главный админ' bash scripts/install-anywhere.sh
```

## Автообновление

Если нужно, можно поставить автообновление из GitHub:

```bash
sudo bash scripts/install-auto-update.sh
```

Что делает автообновление:

- проверяет `origin/main` каждые 2 минуты
- если есть новые коммиты, делает `git pull --ff-only`
- переустанавливает зависимости
- перезапускает сервис
- делает backup базы и uploads перед обновлением

Проверка статуса:

```bash
systemctl status zhur-messenger-update.timer
journalctl -u zhur-messenger-update.service -f
```

## Переменные окружения

Скопируй `.env.example` в `.env` и поправь при необходимости.

- `NODE_ENV` - режим работы, обычно `production`
- `HOST` - адрес привязки, обычно `127.0.0.1`
- `PORT` - порт приложения
- `JWT_SECRET` - обязателен в production
- `CORS_ORIGIN` - разрешённый адрес фронта
- `DB_PATH` - путь к SQLite базе
- `UPLOADS_DIR` - каталог для загрузок
- `ACCESS_TOKEN_TTL` - время жизни access token, по умолчанию `15m`
- `REFRESH_TOKEN_TTL_DAYS` - срок жизни refresh-сессий, по умолчанию `30`
- `HTTPS_KEY_PATH` / `HTTPS_CERT_PATH` - если нужен HTTPS прямо в Node
- `WEB_PUSH_PUBLIC_KEY` - публичный ключ web push
- `WEB_PUSH_PRIVATE_KEY` - приватный ключ web push
- `WEB_PUSH_SUBJECT` - контакт для VAPID, например `mailto:admin@example.com`

## Продакшен

Нормальная схема такая:

- приложение слушает `127.0.0.1:3010`
- снаружи стоит `nginx` или `caddy`
- HTTPS завершает прокси
- база лежит в `data/messenger.db`
- файлы лежат в `uploads/`

Для Docker тоже есть готовый `docker-compose.yml`.

## Что важно сохранить

- `data/messenger.db`
- `uploads/avatars`
- `uploads/messages`

## Проверка здоровья

`GET /health`

Пример ответа:

```json
{
  "ok": true,
  "uptime": 123,
  "users": 5,
  "env": "production"
}
```

## Основные API-ручки

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

## Заметка

Если переносишь старую установку, сначала скопируй базу и `uploads`, а потом уже запускай установщик. Так меньше шансов что-то потерять.
