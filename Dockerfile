FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data /app/uploads/avatars /app/uploads/messages

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3010 \
    DB_PATH=/app/data/messenger.db \
    UPLOADS_DIR=/app/uploads

EXPOSE 3010

CMD ["node", "server/index.js"]
