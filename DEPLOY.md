# Перенос Pulse Messenger на другую машину

Эта инструкция подходит для VPS, Raspberry Pi, домашнего сервера и любой Linux-машины.

## Быстрый автоматический вариант

Если нужна полуавтоматическая установка на Ubuntu / Debian / Raspberry Pi OS, используй готовый скрипт:

```bash
sudo bash scripts/install-anywhere.sh
```

С доменом и кастомной директорией:

```bash
sudo DOMAIN=chat.example.com APP_DIR=/opt/ZhurMessenger bash scripts/install-anywhere.sh
```

Что делает скрипт:

- ставит системные зависимости
- ставит Node.js 20, если его нет
- копирует проект в целевую директорию
- создает `.env`, `data/`, `uploads/`
- ставит npm-зависимости
- создает `systemd` unit
- создает nginx-конфиг

После скрипта тебе останется:

- скопировать старую БД
- скопировать `uploads/`
- при наличии домена включить HTTPS через certbot

## Автоматические обновления с GitHub

Если хочешь, чтобы сервер сам подтягивал новые версии из GitHub, используй готовый таймер:

```bash
sudo bash scripts/install-auto-update.sh
```

После установки:

- каждые 2 минуты идет проверка `origin/main`
- если в GitHub есть новый коммит:
  - делается `git pull --ff-only`
  - ставятся зависимости
  - перезапускается сервис `zhur-messenger`

Проверка:

```bash
systemctl status zhur-messenger-update.timer
journalctl -u zhur-messenger-update.service -f
```

## 1. Что нужно перенести

Обязательно переноси:

- код проекта
- базу данных SQLite
- загруженные файлы
- переменные окружения

Практически это значит:

- проект: весь репозиторий `ZhurMessenger`
- база: `messenger.db` или файл из `DB_PATH`
- файлы: папка `uploads/`
- конфиг: `.env`

Если используешь новую структуру из `.env.example`, то лучше хранить так:

- `data/messenger.db`
- `uploads/avatars/`
- `uploads/messages/`

## 2. Подготовка новой машины

### Установить зависимости

Для Ubuntu / Debian:

```bash
sudo apt update
sudo apt install -y git curl build-essential nginx
```

Установить Node.js 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Проверка:

```bash
node -v
npm -v
```

## 3. Забрать проект с GitHub

```bash
git clone https://github.com/WWWorm92/ZhurMessenger.git
cd ZhurMessenger
npm install
```

## 4. Подготовить каталоги данных

```bash
mkdir -p data
mkdir -p uploads/avatars
mkdir -p uploads/messages
```

## 5. Перенести данные со старой машины

Если база еще лежит старым способом как `messenger.db` в корне:

```bash
scp root@OLD_SERVER:/root/projects/Messenger/messenger.db ./data/messenger.db
scp -r root@OLD_SERVER:/root/projects/Messenger/uploads ./
```

Если уже используешь новую структуру:

```bash
scp root@OLD_SERVER:/path/to/old/data/messenger.db ./data/messenger.db
scp -r root@OLD_SERVER:/path/to/old/uploads ./
```

Проверить, что файлы есть:

```bash
ls -la data
ls -la uploads
```

## 6. Создать `.env`

Скопируй шаблон:

```bash
cp .env.example .env
```

Минимально отредактируй:

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3010

JWT_SECRET=CHANGE_ME_TO_LONG_RANDOM_SECRET
CORS_ORIGIN=https://your-domain.example

DB_PATH=./data/messenger.db
UPLOADS_DIR=./uploads

ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL_DAYS=30
```

Если домена пока нет, временно можно поставить:

```env
CORS_ORIGIN=
```

## 7. Проверить запуск вручную

```bash
npm start
```

Проверить health endpoint:

```bash
curl http://127.0.0.1:3010/health
```

Если все нормально, останови процесс `Ctrl+C` и настрой автозапуск.

## 8. Настроить systemd

Создай файл:

```bash
sudo nano /etc/systemd/system/zhur-messenger.service
```

Содержимое:

```ini
[Unit]
Description=Pulse Messenger
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/ZhurMessenger
ExecStart=/usr/bin/node /opt/ZhurMessenger/server/index.js
Restart=always
RestartSec=5
EnvironmentFile=/opt/ZhurMessenger/.env
User=root

[Install]
WantedBy=multi-user.target
```

Если проект лежит не в `/opt/ZhurMessenger`, подставь свой путь.

Дальше:

```bash
sudo systemctl daemon-reload
sudo systemctl enable zhur-messenger
sudo systemctl start zhur-messenger
sudo systemctl status zhur-messenger
```

Логи:

```bash
journalctl -u zhur-messenger -f
```

## 9. Настроить nginx

Если домен уже есть, самый нормальный вариант - проксировать через nginx.

Пример конфига:

```nginx
server {
    listen 80;
    server_name your-domain.example www.your-domain.example;

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

Потом:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 10. Включить HTTPS

Если домен уже смотрит на машину:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example -d www.your-domain.example
```

После этого сайт будет доступен по HTTPS.

## 11. Если переносишь на Raspberry Pi

Рекомендации:

- лучше хранить `data/` и `uploads/` на SSD, а не на microSD
- оставить SQLite, если пользователей немного
- не выставлять Node напрямую наружу, только через nginx/caddy
- регулярно бэкапить:
  - `data/messenger.db`
  - `uploads/`

## 12. Быстрый способ через Docker

Если удобнее Docker:

```bash
git clone https://github.com/WWWorm92/ZhurMessenger.git
cd ZhurMessenger
cp .env.example .env
mkdir -p data uploads/avatars uploads/messages
docker compose up -d --build
```

## 13. Что проверить после переноса

- открывается главная страница
- логин работает
- старые сообщения на месте
- аватары и картинки открываются
- комнаты и приглашения работают
- WebSocket не падает
- `GET /health` возвращает `ok: true`

## 14. Как обновлять проект потом

На новой машине:

```bash
cd /opt/ZhurMessenger
git pull
npm install
sudo systemctl restart zhur-messenger
```

Если Docker:

```bash
docker compose up -d --build
```

## 15. Минимальный чеклист переноса без ошибок

1. Поставить Node.js / nginx
2. Склонировать репозиторий
3. Скопировать `.env`
4. Скопировать `messenger.db`
5. Скопировать `uploads/`
6. Проверить `npm start`
7. Поднять `systemd`
8. Подключить nginx
9. Подключить HTTPS
10. Проверить `/health`

Если хочешь максимально безопасный перенос без потери данных, сначала останови старый сервер, потом копируй базу и `uploads`, и только после этого запускай новую машину.
