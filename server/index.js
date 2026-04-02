const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const webpush = require("web-push");
const { Server } = require("socket.io");

const { initDb, run, get, all } = require("./db");
const { signToken, createSessionId, verifyToken, authMiddleware, USING_DEFAULT_JWT_SECRET } = require("./auth");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const NODE_ENV = process.env.NODE_ENV || "development";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "";
const WEB_PUSH_PUBLIC_KEY = String(process.env.WEB_PUSH_PUBLIC_KEY || "").trim();
const WEB_PUSH_PRIVATE_KEY = String(process.env.WEB_PUSH_PRIVATE_KEY || "").trim();
const WEB_PUSH_SUBJECT = String(process.env.WEB_PUSH_SUBJECT || "mailto:admin@example.com").trim();
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
const HTTPS_KEY_PATH = String(process.env.HTTPS_KEY_PATH || "").trim();
const HTTPS_CERT_PATH = String(process.env.HTTPS_CERT_PATH || "").trim();
const UPLOADS_ROOT = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, "..", "uploads");
const AVATAR_DIR = path.join(UPLOADS_ROOT, "avatars");
const MESSAGE_IMAGE_DIR = path.join(UPLOADS_ROOT, "messages");
const ROOM_AVATAR_DIR = path.join(UPLOADS_ROOT, "rooms");
const MESSAGE_FILE_DIR = path.join(UPLOADS_ROOT, "files");
const RESERVED_ROOM_SLUGS = new Set(["api", "uploads", "room", "health", "sw-js", "sw", "manifest", "manifest-webmanifest", "login", "auth"]);

fs.mkdirSync(AVATAR_DIR, { recursive: true });
fs.mkdirSync(MESSAGE_IMAGE_DIR, { recursive: true });
fs.mkdirSync(ROOM_AVATAR_DIR, { recursive: true });
fs.mkdirSync(MESSAGE_FILE_DIR, { recursive: true });

const app = express();
let server;
if (HTTPS_KEY_PATH && HTTPS_CERT_PATH && fs.existsSync(HTTPS_KEY_PATH) && fs.existsSync(HTTPS_CERT_PATH)) {
  server = https.createServer(
    {
      key: fs.readFileSync(HTTPS_KEY_PATH),
      cert: fs.readFileSync(HTTPS_CERT_PATH),
    },
    app
  );
  console.log(`[tls] HTTPS enabled with cert: ${HTTPS_CERT_PATH}`);
} else {
  server = http.createServer(app);
  if (HTTPS_KEY_PATH || HTTPS_CERT_PATH) {
    console.warn("[tls] HTTPS cert/key not found, falling back to HTTP");
  }
}
const io = new Server(server);

const WEB_PUSH_ENABLED = Boolean(WEB_PUSH_PUBLIC_KEY && WEB_PUSH_PRIVATE_KEY);
if (WEB_PUSH_ENABLED) {
  webpush.setVapidDetails(WEB_PUSH_SUBJECT, WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY);
}

const socketsByUser = new Map();

app.use((req, res, next) => {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "connect-src 'self' ws: wss:",
    "worker-src 'self' blob:",
    "form-action 'self'",
  ].join("; ");
  res.setHeader("Content-Security-Policy", csp);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=()");
  next();
});

if (NODE_ENV === "production" && !CORS_ORIGIN) {
  throw new Error("CORS_ORIGIN must be set in production");
}

if (CORS_ORIGIN) {
  const allowlist = CORS_ORIGIN.split(",").map((item) => item.trim()).filter(Boolean);
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin || allowlist.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Not allowed by CORS"));
      },
    })
  );
} else {
  app.use(cors());
}

app.use(express.json({ limit: "1mb" }));
app.use(
  "/uploads/files",
  express.static(MESSAGE_FILE_DIR, {
    setHeaders(res, filePath) {
      const basename = path.basename(filePath).toLowerCase();
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", `attachment; filename="${basename.replace(/"/g, "")}"`);
    },
  })
);
app.use("/uploads", express.static(UPLOADS_ROOT, {
  setHeaders(res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
  },
}));
app.use(express.static(path.join(__dirname, "..", "public")));

function createRateLimiter({ windowMs, max, keyFn }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, state] of hits.entries()) {
      if (state.resetAt <= now) {
        hits.delete(key);
      }
    }
  }, Math.max(30000, Math.floor(windowMs / 2))).unref();

  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    const current = hits.get(key);

    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (current.count >= max) {
      res.status(429).json({ error: "Too many requests, try again later" });
      return;
    }

    current.count += 1;
    next();
  };
}

const authRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 25,
  keyFn: (req) => `${req.ip}:${req.path}`,
});

const messageRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 45,
  keyFn: (req) => `${req.user?.id || req.ip}:msg`,
});

const uploadRateLimit = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  keyFn: (req) => `${req.user?.id || req.ip}:upload`,
});

const searchRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 40,
  keyFn: (req) => `${req.user?.id || req.ip}:search`,
});

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarUrl: user.avatar_url || "",
    isAdmin: Boolean(user.is_admin),
    createdAt: user.created_at,
  };
}

function asInt(value) {
  const num = Number(value);
  return Number.isInteger(num) ? num : null;
}

function mustBeValidId(value) {
  const id = asInt(value);
  return id && id > 0 ? id : null;
}

function normalizeText(value, maxLength = 2000) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  return text.slice(0, maxLength);
}

function parseLimit(value, fallback = 60, max = 200) {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    return fallback;
  }
  return Math.min(num, max);
}

async function markDmRead(userId, peerId) {
  await run(
    `
    INSERT INTO dm_reads (user_id, peer_id, last_read_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id, peer_id)
    DO UPDATE SET last_read_at = datetime('now')
    `,
    [userId, peerId]
  );
}

async function markRoomRead(userId, roomId) {
  await run(
    `
    INSERT INTO room_reads (user_id, room_id, last_read_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id, room_id)
    DO UPDATE SET last_read_at = datetime('now')
    `,
    [userId, roomId]
  );
}

async function getDmUnreadMap(userId) {
  const rows = await all(
    `
    SELECT m.sender_id AS peer_id, COUNT(*) AS unread
    FROM messages m
    LEFT JOIN dm_reads r
      ON r.user_id = ?
     AND r.peer_id = m.sender_id
    WHERE m.receiver_id = ?
      AND m.deleted_at IS NULL
      AND datetime(m.created_at) > datetime(COALESCE(r.last_read_at, '1970-01-01 00:00:00'))
    GROUP BY m.sender_id
    `,
    [userId, userId]
  );

  const map = new Map();
  for (const row of rows) {
    map.set(row.peer_id, Number(row.unread || 0));
  }
  return map;
}

async function getRoomUnreadMap(userId) {
  const rows = await all(
    `
    SELECT m.room_id, COUNT(*) AS unread
    FROM room_messages m
    JOIN room_members rm
      ON rm.room_id = m.room_id
     AND rm.user_id = ?
    LEFT JOIN room_reads rr
      ON rr.user_id = ?
     AND rr.room_id = m.room_id
    WHERE m.sender_id != ?
      AND m.deleted_at IS NULL
      AND datetime(m.created_at) > datetime(COALESCE(rr.last_read_at, '1970-01-01 00:00:00'))
    GROUP BY m.room_id
    `,
    [userId, userId, userId]
  );

  const map = new Map();
  for (const row of rows) {
    map.set(row.room_id, Number(row.unread || 0));
  }
  return map;
}

async function getChatPrefsMap(userId, scope) {
  const rows = await all(
    `
    SELECT target_id, pinned, muted, archived
    FROM user_chat_prefs
    WHERE user_id = ? AND scope = ?
    `,
    [userId, scope]
  );
  const map = new Map();
  for (const row of rows) {
    map.set(row.target_id, {
      pinned: Boolean(row.pinned),
      muted: Boolean(row.muted),
      archived: Boolean(row.archived),
    });
  }
  return map;
}

async function getPinnedFor(scope, targetId, userId) {
  const row = await get(
    `
    SELECT message_id, pinned_by, pinned_at
    FROM pinned_messages
    WHERE scope = ? AND target_id = ?
    `,
    [scope, targetId]
  );

  if (!row) {
    return null;
  }

  if (scope === "dm") {
    const msg = await get(
      `
      SELECT id, sender_id, receiver_id, content, message_type, image_url, poll_id, reply_to_message_id, edited_at, deleted_at, created_at
      FROM messages
      WHERE id = ?
      `,
      [row.message_id]
    );
    if (!msg) {
      return null;
    }
    return buildDmPayload(msg, userId);
  }

  const msg = await get(
    `
    SELECT
      m.id,
      m.room_id,
      m.sender_id,
      m.content,
      m.message_type,
      m.image_url,
      m.poll_id,
      m.reply_to_message_id,
      m.edited_at,
      m.deleted_at,
      m.created_at,
      u.username,
      u.display_name,
      u.avatar_url,
      u.is_admin
    FROM room_messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.id = ?
    `,
    [row.message_id]
  );
  if (!msg) {
    return null;
  }
  return buildRoomPayload(msg, userId);
}

function onlineUserIds() {
  return Array.from(socketsByUser.keys());
}

function broadcastPresence() {
  io.emit("presence:update", onlineUserIds());
}

function publicFilePath(kind, filename) {
  return `/uploads/${kind}/${filename}`;
}

function slugifyRoomName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function isReservedRoomSlug(slug) {
  return RESERVED_ROOM_SLUGS.has(String(slug || "").toLowerCase());
}

async function makeUniqueRoomSlug(base, excludeRoomId = null) {
  const seed = slugifyRoomName(base) || `room-${Date.now()}`;
  let slug = seed;
  let i = 1;
  while (true) {
    if (isReservedRoomSlug(slug)) {
      i += 1;
      slug = `${seed}-${i}`.slice(0, 56);
      continue;
    }
    const existing = excludeRoomId
      ? await get("SELECT id FROM chat_rooms WHERE slug = ? AND id != ?", [slug, excludeRoomId])
      : await get("SELECT id FROM chat_rooms WHERE slug = ?", [slug]);
    if (!existing) {
      return slug;
    }
    i += 1;
    slug = `${seed}-${i}`.slice(0, 56);
  }
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.ip || "";
}

function cookieValue(req, key) {
  const raw = String(req.headers.cookie || "");
  if (!raw) {
    return "";
  }
  const parts = raw.split(";");
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=");
    if (k === key) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return "";
}

function makeRefreshToken() {
  if (crypto.randomUUID) {
    return `${crypto.randomUUID()}${crypto.randomUUID()}`;
  }
  return crypto.randomBytes(32).toString("hex");
}

function refreshTokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function refreshExpirySql() {
  return `datetime('now', '+${Math.max(1, REFRESH_TOKEN_TTL_DAYS)} days')`;
}

function setRefreshCookie(res, token) {
  res.cookie("refresh_token", token, {
    httpOnly: true,
    secure: NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(1, REFRESH_TOKEN_TTL_DAYS) * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie("refresh_token", {
    httpOnly: true,
    secure: NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

async function createAuthSession(req, userId) {
  const sessionId = createSessionId();
  const refreshToken = makeRefreshToken();
  const refreshHash = refreshTokenHash(refreshToken);
  const ua = normalizeText(req.headers["user-agent"], 700);
  const ip = normalizeText(clientIp(req), 120);
  await run(
    `
    INSERT INTO user_sessions (id, user_id, user_agent, ip, refresh_token_hash, refresh_expires_at, created_at, last_seen_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ${refreshExpirySql()}, datetime('now'), datetime('now'), NULL)
    `,
    [sessionId, userId, ua || null, ip || null, refreshHash]
  );
  return { sessionId, refreshToken };
}

async function touchAuthSession(sessionId) {
  if (!sessionId) {
    return;
  }
  await run(
    "UPDATE user_sessions SET last_seen_at = datetime('now') WHERE id = ? AND revoked_at IS NULL",
    [sessionId]
  );
}

async function sendWebPushToUser(userId, payload) {
  if (!WEB_PUSH_ENABLED || !userId) {
    return;
  }

  const subscriptions = await all(
    "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
    [userId]
  );
  if (!subscriptions.length) {
    return;
  }

  const body = JSON.stringify(payload);
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        body
      );
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await run("DELETE FROM push_subscriptions WHERE id = ?", [subscription.id]);
      }
    }
  }
}

function extensionFromMime(mimeType) {
  if (mimeType === "image/jpeg") {
    return ".jpg";
  }
  if (mimeType === "image/png") {
    return ".png";
  }
  if (mimeType === "image/webp") {
    return ".webp";
  }
  if (mimeType === "image/gif") {
    return ".gif";
  }
  return "";
}

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function createImageUploadStorage(targetDir) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, targetDir),
    filename: (req, file, cb) => {
      const ext = extensionFromMime(file.mimetype) || path.extname(file.originalname || "");
      cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
    },
  });
}

function imageFilter(req, file, cb) {
  const mime = String(file.mimetype || "").toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
    cb(new Error("Only image files are allowed"));
    return;
  }
  cb(null, true);
}

async function readFileHeader(filePath, bytes = 16) {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function headerStartsWith(buffer, signature) {
  return Buffer.isBuffer(buffer) && buffer.length >= signature.length && signature.every((byte, idx) => buffer[idx] === byte);
}

function looksLikeText(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return false;
  }
  for (const byte of buffer) {
    if (byte === 0) {
      return false;
    }
  }
  return true;
}

async function validateUploadedImage(filePath) {
  const header = await readFileHeader(filePath, 12);
  return (
    headerStartsWith(header, [0xff, 0xd8, 0xff]) ||
    headerStartsWith(header, [0x89, 0x50, 0x4e, 0x47]) ||
    headerStartsWith(header, [0x47, 0x49, 0x46, 0x38]) ||
    (header.length >= 12 && header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP")
  );
}

async function validateUploadedDocument(filePath, originalName) {
  const ext = path.extname(String(originalName || "")).toLowerCase();
  const header = await readFileHeader(filePath, 16);
  if ([".txt", ".csv"].includes(ext)) {
    return looksLikeText(header);
  }
  if (ext === ".pdf") {
    return headerStartsWith(header, [0x25, 0x50, 0x44, 0x46]);
  }
  if ([".doc", ".xls"].includes(ext)) {
    return headerStartsWith(header, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  }
  if ([".docx", ".xlsx", ".zip"].includes(ext)) {
    return headerStartsWith(header, [0x50, 0x4b, 0x03, 0x04]);
  }
  if (ext === ".7z") {
    return headerStartsWith(header, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
  }
  if (ext === ".rar") {
    return headerStartsWith(header, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]);
  }
  return false;
}

async function removeFileIfExists(filePath) {
  if (!filePath) {
    return;
  }
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // ignore cleanup failures
  }
}

const ALLOWED_FILE_EXTENSIONS = new Set([".pdf", ".txt", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".zip", ".7z", ".rar"]);
const ALLOWED_FILE_MIME_PREFIXES = [
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.ms-excel",
  "text/csv",
  "application/zip",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/octet-stream",
];

function messageFileFilter(req, file, cb) {
  const ext = path.extname(String(file.originalname || "")).toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();
  if (!ALLOWED_FILE_EXTENSIONS.has(ext)) {
    cb(new Error("File type is not allowed"));
    return;
  }
  if (!ALLOWED_FILE_MIME_PREFIXES.some((allowed) => mime.startsWith(allowed))) {
    cb(new Error("File mime type is not allowed"));
    return;
  }
  cb(null, true);
}

const avatarUpload = multer({
  storage: createImageUploadStorage(AVATAR_DIR),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFilter,
});

const messageImageUpload = multer({
  storage: createImageUploadStorage(MESSAGE_IMAGE_DIR),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: imageFilter,
});

const roomAvatarUpload = multer({
  storage: createImageUploadStorage(ROOM_AVATAR_DIR),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFilter,
});

const messageFileUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, MESSAGE_FILE_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${file.originalname.replace(/[^a-zA-Z0-9._-]+/g, "-")}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: messageFileFilter,
});


async function joinUserToPublicRooms(userId) {
  const rooms = await all("SELECT id FROM chat_rooms WHERE access_type = 'public'");
  for (const room of rooms) {
    await run(
      "INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)",
      [room.id, userId]
    );
  }
}

async function getRoomMemberIds(roomId) {
  const rows = await all("SELECT user_id FROM room_members WHERE room_id = ?", [roomId]);
  return rows.map((row) => row.user_id);
}

async function getRoomForUser(userId, roomId) {
  return get(
    `
    SELECT r.id, r.name, r.access_type, r.created_by, r.created_at, r.avatar_url, r.description, r.slug, r.who_can_post, r.who_can_invite, m.role AS my_role, m.is_muted AS my_muted, m.can_post_media AS my_can_post_media
    FROM chat_rooms r
    JOIN room_members m ON m.room_id = r.id
    WHERE r.id = ? AND m.user_id = ?
    `,
    [roomId, userId]
  );
}

async function getPollWithOptions(pollId, userId) {
  const poll = await get(
    `
    SELECT id, question, creator_id, is_closed, allow_multiple, created_at
    FROM polls
    WHERE id = ?
    `,
    [pollId]
  );

  if (!poll) {
    return null;
  }

  const options = await all(
    `
    SELECT
      o.id,
      o.text,
      COUNT(v.id) AS votes,
      EXISTS(
        SELECT 1
        FROM poll_votes own
        WHERE own.option_id = o.id AND own.user_id = ?
      ) AS voted_by_me
    FROM poll_options o
    LEFT JOIN poll_votes v ON v.option_id = o.id
    WHERE o.poll_id = ?
    GROUP BY o.id
    ORDER BY o.id ASC
    `,
    [userId, pollId]
  );

  return {
    id: poll.id,
    question: poll.question,
    creatorId: poll.creator_id,
    isClosed: Boolean(poll.is_closed),
    allowMultiple: Boolean(poll.allow_multiple),
    createdAt: poll.created_at,
    options: options.map((option) => ({
      id: option.id,
      text: option.text,
      votes: Number(option.votes),
      votedByMe: Boolean(option.voted_by_me),
    })),
  };
}

async function attachPolls(messages, userId) {
  const pollIds = [...new Set(messages.map((message) => message.poll_id).filter(Boolean))];
  const pollMap = new Map();
  await Promise.all(
    pollIds.map(async (pollId) => {
      const poll = await getPollWithOptions(pollId, userId);
      if (poll) {
        pollMap.set(pollId, poll);
      }
    })
  );

  return messages.map((message) => ({
    ...message,
    poll: message.poll_id ? pollMap.get(message.poll_id) || null : null,
  }));
}

async function getReactionsByMessage(scope, messageIds, userId) {
  if (!messageIds.length) {
    return new Map();
  }

  const placeholders = messageIds.map(() => "?").join(", ");
  const rows = await all(
    `
    SELECT
      message_id,
      emoji,
      COUNT(*) AS count,
      MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS reacted_by_me
    FROM message_reactions
    WHERE scope = ? AND message_id IN (${placeholders})
    GROUP BY message_id, emoji
    ORDER BY count DESC, emoji ASC
    `,
    [userId, scope, ...messageIds]
  );

  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.message_id) || [];
    list.push({
      emoji: row.emoji,
      count: Number(row.count),
      reactedByMe: Boolean(row.reacted_by_me),
    });
    map.set(row.message_id, list);
  }
  return map;
}

async function attachMeta(scope, rows, userId) {
  const withPolls = await attachPolls(rows, userId);
  const reactions = await getReactionsByMessage(
    scope,
    withPolls.map((item) => item.id),
    userId
  );

  return withPolls.map((item) => ({
    ...item,
    reactions: reactions.get(item.id) || [],
  }));
}

function normalizeEmoji(input) {
  const text = String(input || "").trim();
  if (!text) {
    return "";
  }
  return Array.from(text).slice(0, 2).join("");
}

function roomPayload(room, joined) {
  return {
    id: room.id,
    name: room.name,
    accessType: room.access_type,
    createdBy: room.created_by,
    createdAt: room.created_at,
    avatarUrl: room.avatar_url || "",
    description: room.description || "",
    slug: room.slug || "",
    myRole: room.my_role || null,
    myMuted: Boolean(room.my_muted),
    myCanPostMedia: room.my_can_post_media === undefined ? true : Boolean(room.my_can_post_media),
    whoCanPost: room.who_can_post || "members",
    whoCanInvite: room.who_can_invite || "admins",
  };
}

function canManageRoom(me, room, myRole = null) {
  if (me?.is_admin) {
    return true;
  }
  if (room?.created_by && room.created_by === me?.id) {
    return true;
  }
  return myRole === "owner" || myRole === "admin";
}

function canOwnRoom(me, room, myRole = null) {
  if (me?.is_admin) {
    return true;
  }
  if (room?.created_by && room.created_by === me?.id) {
    return true;
  }
  return myRole === "owner";
}

function canPostToRoom(me, room, myRole = null) {
  if (me?.is_admin) {
    return true;
  }
  const mode = room?.who_can_post || "members";
  if (mode === "admins") {
    return myRole === "owner" || myRole === "admin";
  }
  return Boolean(myRole);
}

function canInviteToRoom(me, room, myRole = null) {
  if (me?.is_admin) {
    return true;
  }
  const mode = room?.who_can_invite || "admins";
  if (mode === "members") {
    return Boolean(myRole);
  }
  return myRole === "owner" || myRole === "admin";
}

function canModerateRoomTarget(me, room, myRole = null, targetRole = "member") {
  if (me?.is_admin) {
    return true;
  }
  if (myRole === "owner") {
    return targetRole !== "owner";
  }
  if (myRole === "admin") {
    return targetRole === "member";
  }
  return false;
}

async function appendRoomAudit(roomId, actorUserId, action, { targetUserId = null, payload = null } = {}) {
  const payloadText = payload ? JSON.stringify(payload).slice(0, 3000) : null;
  await run(
    `
    INSERT INTO room_audit_log (room_id, actor_user_id, target_user_id, action, payload, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    `,
    [roomId, actorUserId, targetUserId, action, payloadText]
  );
}

async function deleteRoomCascade(roomId, actorUserId = null) {
  const room = await get("SELECT * FROM chat_rooms WHERE id = ?", [roomId]);
  if (!room) {
    return null;
  }

  const memberRows = await all("SELECT user_id FROM room_members WHERE room_id = ?", [roomId]);
  const memberIds = [...new Set(memberRows.map((item) => item.user_id))];

  const roomMessages = await all("SELECT id, poll_id FROM room_messages WHERE room_id = ?", [roomId]);
  const roomMessageIds = roomMessages.map((item) => item.id);
  const pollIds = [...new Set(roomMessages.map((item) => item.poll_id).filter(Boolean))];

  if (roomMessageIds.length) {
    const msgPlaceholders = roomMessageIds.map(() => "?").join(", ");
    await run(
      `DELETE FROM message_reactions WHERE scope = 'room' AND message_id IN (${msgPlaceholders})`,
      roomMessageIds
    );
  }

  if (pollIds.length) {
    const pollPlaceholders = pollIds.map(() => "?").join(", ");
    await run(`DELETE FROM poll_votes WHERE poll_id IN (${pollPlaceholders})`, pollIds);
    await run(`DELETE FROM poll_options WHERE poll_id IN (${pollPlaceholders})`, pollIds);
    await run(`DELETE FROM polls WHERE id IN (${pollPlaceholders})`, pollIds);
  }

  if (actorUserId) {
    await appendRoomAudit(roomId, actorUserId, "room_deleted", {
      payload: { deletedMessages: roomMessageIds.length },
    });
  }

  await run("DELETE FROM room_messages WHERE room_id = ?", [roomId]);
  await run("DELETE FROM room_reads WHERE room_id = ?", [roomId]);
  await run("DELETE FROM room_members WHERE room_id = ?", [roomId]);
  await run("DELETE FROM room_invitations WHERE room_id = ?", [roomId]);
  await run("DELETE FROM room_audit_log WHERE room_id = ?", [roomId]);
  await run("DELETE FROM pinned_messages WHERE scope = 'room' AND target_id = ?", [roomId]);
  await run("DELETE FROM user_chat_prefs WHERE scope = 'room' AND target_id = ?", [roomId]);
  await run("DELETE FROM chat_rooms WHERE id = ?", [roomId]);

  io.emit("rooms:update");
  for (const userId of memberIds) {
    const sockets = socketsByUser.get(userId);
    if (!sockets) {
      continue;
    }
    for (const socketId of sockets) {
      io.to(socketId).emit("room:deleted", { roomId });
    }
  }

  return { room, memberIds, deletedMessages: roomMessageIds.length };
}

async function requireAdmin(req, res, next) {
  try {
    const row = await get("SELECT is_admin FROM users WHERE id = ?", [req.user.id]);
    if (!row?.is_admin) {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    next();
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
}

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    next(new Error("Unauthorized"));
    return;
  }

  try {
    const decoded = verifyToken(token);
    if (decoded.sid) {
      const session = await get(
        "SELECT id FROM user_sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
        [decoded.sid, decoded.id]
      );
      if (!session) {
        next(new Error("Unauthorized"));
        return;
      }
      await touchAuthSession(decoded.sid);
    }
    const user = await get("SELECT * FROM users WHERE id = ?", [decoded.id]);
    if (!user) {
      next(new Error("Unauthorized"));
      return;
    }

    socket.user = sanitizeUser(user);
    next();
  } catch (error) {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  const userId = socket.user.id;

  const existing = socketsByUser.get(userId) || new Set();
  existing.add(socket.id);
  socketsByUser.set(userId, existing);
  broadcastPresence();

  socket.on("disconnect", () => {
    const current = socketsByUser.get(userId);
    if (!current) {
      return;
    }

    current.delete(socket.id);
    if (current.size === 0) {
      socketsByUser.delete(userId);
    }
    broadcastPresence();
  });

  socket.on("typing:update", async (payload = {}) => {
    try {
      const scope = payload.scope === "room" ? "room" : "dm";
      const targetId = mustBeValidId(payload.targetId);
      const isTyping = Boolean(payload.isTyping);
      if (!targetId) {
        return;
      }

      if (scope === "dm") {
        if (targetId === userId) {
          return;
        }
        const peer = await get("SELECT id FROM users WHERE id = ?", [targetId]);
        if (!peer) {
          return;
        }

        const sockets = socketsByUser.get(targetId);
        if (!sockets) {
          return;
        }
        for (const socketId of sockets) {
          io.to(socketId).emit("typing:update", {
            scope: "dm",
            targetId: userId,
            userId,
            isTyping,
          });
        }
        return;
      }

      const room = await getRoomForUser(userId, targetId);
      if (!room) {
        return;
      }

      const memberIds = await getRoomMemberIds(targetId);
      for (const memberId of memberIds) {
        if (memberId === userId) {
          continue;
        }
        const sockets = socketsByUser.get(memberId);
        if (!sockets) {
          continue;
        }
        for (const socketId of sockets) {
          io.to(socketId).emit("typing:update", {
            scope: "room",
            targetId,
            userId,
            isTyping,
          });
        }
      }
    } catch (error) {
      // ignore typing errors
    }
  });
});

app.post("/api/auth/register", authRateLimit, async (req, res) => {
  try {
    const stats = await get("SELECT COUNT(*) AS count FROM users");
    if (Number(stats?.count || 0) > 0) {
      res.status(403).json({ error: "Public registration is disabled" });
      return;
    }

    const username = normalizeText(req.body.username, 24).toLowerCase();
    const password = String(req.body.password || "");
    const displayName = normalizeText(req.body.displayName, 40);

    if (username.length < 3 || username.length > 24) {
      res.status(400).json({ error: "Username must be 3-24 chars" });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 chars" });
      return;
    }

    if (displayName.length < 2 || displayName.length > 40) {
      res.status(400).json({ error: "Display name must be 2-40 chars" });
      return;
    }

    const exists = await get("SELECT id FROM users WHERE username = ?", [username]);
    if (exists) {
      res.status(409).json({ error: "Username already exists" });
      return;
    }

    const isAdmin = 1;

    const passwordHash = await bcrypt.hash(password, 10);
    const inserted = await run(
      "INSERT INTO users (username, password_hash, display_name, is_admin) VALUES (?, ?, ?, ?)",
      [username, passwordHash, displayName, isAdmin]
    );

    await joinUserToPublicRooms(inserted.id);

    const user = await get("SELECT * FROM users WHERE id = ?", [inserted.id]);
    const session = await createAuthSession(req, user.id);
    const token = signToken(user, { sessionId: session.sessionId });
    setRefreshCookie(res, session.refreshToken);
    res.status(201).json({ token, user: sanitizeUser(user) });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/auth/login", authRateLimit, async (req, res) => {
  try {
    const username = normalizeText(req.body.username, 24).toLowerCase();
    const password = String(req.body.password || "");

    const user = await get("SELECT * FROM users WHERE username = ?", [username]);
    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    await joinUserToPublicRooms(user.id);

    const session = await createAuthSession(req, user.id);
    const token = signToken(user, { sessionId: session.sessionId });
    setRefreshCookie(res, session.refreshToken);
    res.json({ token, user: sanitizeUser(user) });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/health", async (req, res) => {
  try {
    const stats = await get("SELECT COUNT(*) AS users FROM users");
    res.json({
      ok: true,
      uptime: Math.round(process.uptime()),
      users: Number(stats?.users || 0),
      env: NODE_ENV,
    });
  } catch (error) {
    res.status(500).json({ ok: false });
  }
});

app.post("/api/auth/refresh", async (req, res) => {
  try {
    const token = cookieValue(req, "refresh_token");
    if (!token) {
      res.status(401).json({ error: "No refresh token" });
      return;
    }

    const hash = refreshTokenHash(token);
    const session = await get(
      `
      SELECT id, user_id
      FROM user_sessions
      WHERE refresh_token_hash = ?
        AND revoked_at IS NULL
        AND datetime(COALESCE(refresh_expires_at, '1970-01-01 00:00:00')) > datetime('now')
      LIMIT 1
      `,
      [hash]
    );
    if (!session) {
      clearRefreshCookie(res);
      res.status(401).json({ error: "Refresh token expired" });
      return;
    }

    const user = await get("SELECT * FROM users WHERE id = ?", [session.user_id]);
    if (!user) {
      await run("UPDATE user_sessions SET revoked_at = datetime('now') WHERE id = ?", [session.id]);
      clearRefreshCookie(res);
      res.status(401).json({ error: "User not found" });
      return;
    }

    const nextRefreshToken = makeRefreshToken();
    const nextHash = refreshTokenHash(nextRefreshToken);
    await run(
      `
      UPDATE user_sessions
      SET refresh_token_hash = ?, refresh_expires_at = ${refreshExpirySql()}, last_seen_at = datetime('now')
      WHERE id = ?
      `,
      [nextHash, session.id]
    );

    const accessToken = signToken(user, { sessionId: session.id });
    setRefreshCookie(res, nextRefreshToken);
    res.json({ token: accessToken, user: sanitizeUser(user) });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/auth/me", authMiddleware, async (req, res) => {
  try {
    await touchAuthSession(req.user.sid);
    await joinUserToPublicRooms(req.user.id);
    const user = await get("SELECT * FROM users WHERE id = ?", [req.user.id]);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({ user: sanitizeUser(user) });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/auth/sessions", authMiddleware, async (req, res) => {
  try {
    const sessions = await all(
      `
      SELECT id, user_agent, ip, created_at, last_seen_at, revoked_at
      FROM user_sessions
      WHERE user_id = ?
      ORDER BY datetime(created_at) DESC
      `,
      [req.user.id]
    );

    res.json({
      sessions: sessions.map((session) => ({
        id: session.id,
        userAgent: session.user_agent || "",
        ip: session.ip || "",
        createdAt: session.created_at,
        lastSeenAt: session.last_seen_at,
        revokedAt: session.revoked_at,
        isCurrent: session.id === req.user.sid,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/auth/logout", authMiddleware, async (req, res) => {
  try {
    if (req.user.sid) {
      await run("UPDATE user_sessions SET revoked_at = datetime('now') WHERE id = ?", [req.user.sid]);
    }
    clearRefreshCookie(res);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/auth/sessions/:sessionId", authMiddleware, async (req, res) => {
  try {
    const sessionId = normalizeText(req.params.sessionId, 128);
    if (!sessionId) {
      res.status(400).json({ error: "Invalid session id" });
      return;
    }

    const session = await get("SELECT id, user_id FROM user_sessions WHERE id = ?", [sessionId]);
    if (!session || session.user_id !== req.user.id) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    await run("UPDATE user_sessions SET revoked_at = datetime('now') WHERE id = ?", [sessionId]);
    const revokedCurrent = sessionId === req.user.sid;
    if (revokedCurrent) {
      clearRefreshCookie(res);
    }
    res.json({ ok: true, revokedCurrent });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/notifications/vapid-public-key", authMiddleware, async (req, res) => {
  res.json({ publicKey: WEB_PUSH_PUBLIC_KEY || null });
});

app.post("/api/notifications/subscriptions", authMiddleware, async (req, res) => {
  try {
    const endpoint = normalizeText(req.body.endpoint, 1200);
    const keys = req.body.keys || {};
    const p256dh = normalizeText(keys.p256dh, 600);
    const auth = normalizeText(keys.auth, 300);
    const userAgent = normalizeText(req.body.userAgent, 600);

    if (!endpoint) {
      res.status(400).json({ error: "Subscription endpoint is required" });
      return;
    }

    await run(
      `
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, endpoint)
      DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent
      `,
      [req.user.id, endpoint, p256dh || null, auth || null, userAgent || null]
    );

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/notifications/subscriptions", authMiddleware, async (req, res) => {
  try {
    const endpoint = normalizeText(req.body.endpoint, 1200);
    if (endpoint) {
      await run("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?", [req.user.id, endpoint]);
    } else {
      await run("DELETE FROM push_subscriptions WHERE user_id = ?", [req.user.id]);
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.patch("/api/profile", authMiddleware, async (req, res) => {
  try {
    const displayName = normalizeText(req.body.displayName, 40);
    if (displayName.length < 2 || displayName.length > 40) {
      res.status(400).json({ error: "Display name must be 2-40 chars" });
      return;
    }

    await run("UPDATE users SET display_name = ? WHERE id = ?", [displayName, req.user.id]);

    const user = await get("SELECT * FROM users WHERE id = ?", [req.user.id]);
    io.emit("users:update");
    res.json({ user: sanitizeUser(user) });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.patch("/api/profile/password", authMiddleware, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");

    if (!currentPassword) {
      res.status(400).json({ error: "Current password is required" });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ error: "New password must be at least 6 chars" });
      return;
    }

    const user = await get("SELECT id, password_hash FROM users WHERE id = ?", [req.user.id]);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const validCurrent = await bcrypt.compare(currentPassword, user.password_hash);
    if (!validCurrent) {
      res.status(400).json({ error: "Current password is incorrect" });
      return;
    }

    const sameAsCurrent = await bcrypt.compare(newPassword, user.password_hash);
    if (sameAsCurrent) {
      res.status(400).json({ error: "New password must be different" });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await run("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, req.user.id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post(
  "/api/uploads/avatar",
  authMiddleware,
  uploadRateLimit,
  (req, res, next) => avatarUpload.single("avatar")(req, res, next),
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "Avatar file required" });
        return;
      }
      if (!(await validateUploadedImage(req.file.path))) {
        await removeFileIfExists(req.file.path);
        res.status(400).json({ error: "Invalid image signature" });
        return;
      }

      const avatarPath = publicFilePath("avatars", req.file.filename);
      await run("UPDATE users SET avatar_url = ? WHERE id = ?", [avatarPath, req.user.id]);
      const user = await get("SELECT * FROM users WHERE id = ?", [req.user.id]);
      io.emit("users:update");
      res.json({ user: sanitizeUser(user), avatarUrl: avatarPath });
    } catch (error) {
      res.status(500).json({ error: "Failed to upload avatar" });
    }
  }
);

app.post(
  "/api/uploads/room-avatar",
  authMiddleware,
  uploadRateLimit,
  roomAvatarUpload.single("avatar"),
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "Avatar file is required" });
        return;
      }
      if (!(await validateUploadedImage(req.file.path))) {
        await removeFileIfExists(req.file.path);
        res.status(400).json({ error: "Invalid image signature" });
        return;
      }
      res.status(201).json({
        avatarUrl: publicFilePath("rooms", req.file.filename),
      });
    } catch (error) {
      res.status(400).json({ error: error.message || "Upload failed" });
    }
  }
);

app.post(
  "/api/uploads/message-image",
  authMiddleware,
  uploadRateLimit,
  (req, res, next) => messageImageUpload.single("image")(req, res, next),
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "Image file required" });
      return;
    }
    if (!(await validateUploadedImage(req.file.path))) {
      await removeFileIfExists(req.file.path);
      res.status(400).json({ error: "Invalid image signature" });
      return;
    }

    const imageUrl = publicFilePath("messages", req.file.filename);
    res.json({ imageUrl });
  }
);

app.post(
  "/api/uploads/message-file",
  authMiddleware,
  uploadRateLimit,
  messageFileUpload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "File required" });
        return;
      }
      if (!(await validateUploadedDocument(req.file.path, req.file.originalname))) {
        await removeFileIfExists(req.file.path);
        res.status(400).json({ error: "Invalid file signature" });
        return;
      }
      res.status(201).json({
        fileUrl: publicFilePath("files", req.file.filename),
        fileName: req.file.originalname,
        fileSize: req.file.size,
      });
    } catch (error) {
      res.status(400).json({ error: error.message || "Upload failed" });
    }
  }
);

app.get("/api/users", authMiddleware, async (req, res) => {
  try {
    const users = await all(
      `
      SELECT
        u.id,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_admin,
        u.created_at,
        (
          SELECT MAX(us.last_seen_at)
          FROM user_sessions us
          WHERE us.user_id = u.id
        ) AS last_seen_at,
        (
          SELECT m.content
          FROM messages m
          WHERE ((m.sender_id = ? AND m.receiver_id = u.id) OR (m.sender_id = u.id AND m.receiver_id = ?))
            AND m.deleted_at IS NULL
          ORDER BY m.id DESC
          LIMIT 1
        ) AS last_message,
        (
          SELECT m.file_name
          FROM messages m
          WHERE ((m.sender_id = ? AND m.receiver_id = u.id) OR (m.sender_id = u.id AND m.receiver_id = ?))
            AND m.deleted_at IS NULL
          ORDER BY m.id DESC
          LIMIT 1
        ) AS last_file_name,
        (
          SELECT m.message_type
          FROM messages m
          WHERE ((m.sender_id = ? AND m.receiver_id = u.id) OR (m.sender_id = u.id AND m.receiver_id = ?))
            AND m.deleted_at IS NULL
          ORDER BY m.id DESC
          LIMIT 1
        ) AS last_message_type,
        (
          SELECT m.created_at
          FROM messages m
          WHERE ((m.sender_id = ? AND m.receiver_id = u.id) OR (m.sender_id = u.id AND m.receiver_id = ?))
            AND m.deleted_at IS NULL
          ORDER BY m.id DESC
          LIMIT 1
        ) AS last_message_at
      FROM users u
      WHERE u.id != ?
      ORDER BY u.display_name ASC
      `,
      [
        req.user.id,
        req.user.id,
        req.user.id,
        req.user.id,
        req.user.id,
        req.user.id,
        req.user.id,
        req.user.id,
        req.user.id,
      ]
    );

    const online = new Set(onlineUserIds());
    const unreadMap = await getDmUnreadMap(req.user.id);
    const prefsMap = await getChatPrefsMap(req.user.id, "dm");
    res.json({
      users: users.map((user) => ({
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_url || "",
        isAdmin: Boolean(user.is_admin),
        createdAt: user.created_at,
        lastSeenAt: user.last_seen_at || null,
        online: online.has(user.id),
        unreadCount: unreadMap.get(user.id) || 0,
        lastMessage: user.last_message || "",
        lastFileName: user.last_file_name || "",
        lastMessageType: user.last_message_type || "text",
        lastMessageAt: user.last_message_at || null,
        pinned: prefsMap.get(user.id)?.pinned || false,
        muted: prefsMap.get(user.id)?.muted || false,
        archived: prefsMap.get(user.id)?.archived || false,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.patch("/api/chat-prefs", authMiddleware, async (req, res) => {
  try {
    const scope = req.body.scope === "room" ? "room" : "dm";
    const targetId = mustBeValidId(req.body.targetId);
    if (!targetId) {
      res.status(400).json({ error: "Invalid target id" });
      return;
    }

    const hasPinned = req.body.pinned !== undefined;
    const hasMuted = req.body.muted !== undefined;
    const hasArchived = req.body.archived !== undefined;
    if (!hasPinned && !hasMuted && !hasArchived) {
      res.status(400).json({ error: "No chat preferences provided" });
      return;
    }

    if (scope === "dm") {
      const user = await get("SELECT id FROM users WHERE id = ?", [targetId]);
      if (!user || targetId === req.user.id) {
        res.status(404).json({ error: "Dialog target not found" });
        return;
      }
    } else {
      const room = await get("SELECT id FROM chat_rooms WHERE id = ?", [targetId]);
      if (!room) {
        res.status(404).json({ error: "Room not found" });
        return;
      }
    }

    const existing = await get(
      "SELECT pinned, muted, archived FROM user_chat_prefs WHERE user_id = ? AND scope = ? AND target_id = ?",
      [req.user.id, scope, targetId]
    );
    const nextPinned = hasPinned ? (req.body.pinned ? 1 : 0) : Number(existing?.pinned || 0);
    const nextMuted = hasMuted ? (req.body.muted ? 1 : 0) : Number(existing?.muted || 0);
    const nextArchived = hasArchived ? (req.body.archived ? 1 : 0) : Number(existing?.archived || 0);

    await run(
      `
      INSERT INTO user_chat_prefs (user_id, scope, target_id, pinned, muted, archived, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, scope, target_id)
      DO UPDATE SET
        pinned = excluded.pinned,
        muted = excluded.muted,
        archived = excluded.archived,
        updated_at = datetime('now')
      `,
      [req.user.id, scope, targetId, nextPinned, nextMuted, nextArchived]
    );

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

async function createPollFromInput(creatorId, pollInput) {
  const question = normalizeText(pollInput?.question, 180);
  const options = Array.isArray(pollInput?.options)
    ? pollInput.options.map((item) => normalizeText(item, 120)).filter(Boolean)
    : [];
  const allowMultiple = Boolean(pollInput?.allowMultiple);

  if (question.length < 3) {
    throw new Error("Poll question must be at least 3 chars");
  }

  if (options.length < 2 || options.length > 10) {
    throw new Error("Poll must have 2-10 options");
  }

  const inserted = await run(
    "INSERT INTO polls (question, creator_id, allow_multiple) VALUES (?, ?, ?)",
    [question, creatorId, allowMultiple ? 1 : 0]
  );

  for (const option of options) {
    await run("INSERT INTO poll_options (poll_id, text) VALUES (?, ?)", [inserted.id, option]);
  }

  return inserted.id;
}

async function buildDmPayload(row, userId) {
  const poll = row.poll_id ? await getPollWithOptions(row.poll_id, userId) : null;
  const reactions = await getReactionsByMessage("dm", [row.id], userId);
  return {
    id: row.id,
    senderId: row.sender_id,
    receiverId: row.receiver_id,
    content: row.content,
    type: row.message_type,
    imageUrl: row.image_url || "",
    fileUrl: row.file_url || "",
    fileName: row.file_name || "",
    fileSize: row.file_size || null,
    forwardedFromName: row.forwarded_from_name || "",
    poll,
    replyToMessageId: row.reply_to_message_id,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    reactions: reactions.get(row.id) || [],
    createdAt: row.created_at,
  };
}

async function buildRoomPayload(row, userId) {
  const poll = row.poll_id ? await getPollWithOptions(row.poll_id, userId) : null;
  const reactions = await getReactionsByMessage("room", [row.id], userId);
  return {
    id: row.id,
    roomId: row.room_id,
    senderId: row.sender_id,
    content: row.content,
    type: row.message_type,
    imageUrl: row.image_url || "",
    fileUrl: row.file_url || "",
    fileName: row.file_name || "",
    fileSize: row.file_size || null,
    forwardedFromName: row.forwarded_from_name || "",
    poll,
    replyToMessageId: row.reply_to_message_id,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    reactions: reactions.get(row.id) || [],
    createdAt: row.created_at,
    sender: {
      id: row.sender_id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url || "",
      isAdmin: Boolean(row.is_admin),
    },
  };
}

app.get("/api/messages/:userId", authMiddleware, async (req, res) => {
  try {
    const peerUserId = mustBeValidId(req.params.userId);
    if (!peerUserId) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    const beforeId = mustBeValidId(req.query.beforeId);
    const limit = parseLimit(req.query.limit, 60, 200);

    const rows = await all(
      `
      SELECT
        m.id,
        m.sender_id,
        m.receiver_id,
        m.content,
        m.message_type,
        m.image_url,
        m.file_url,
        m.file_name,
        m.file_size,
        m.forwarded_from_name,
        m.poll_id,
        m.reply_to_message_id,
        m.edited_at,
        m.deleted_at,
        m.created_at
      FROM messages m
      WHERE ((m.sender_id = ? AND m.receiver_id = ?)
         OR (m.sender_id = ? AND m.receiver_id = ?))
        ${beforeId ? "AND m.id < ?" : ""}
      ORDER BY m.id DESC
      LIMIT ?
      `,
      beforeId
        ? [req.user.id, peerUserId, peerUserId, req.user.id, beforeId, limit]
        : [req.user.id, peerUserId, peerUserId, req.user.id, limit]
    );

    const orderedRows = rows.reverse();
    const messages = await attachMeta("dm", orderedRows, req.user.id);
    await markDmRead(req.user.id, peerUserId);
    const peerRead = await get(
      "SELECT last_read_at FROM dm_reads WHERE user_id = ? AND peer_id = ?",
      [peerUserId, req.user.id]
    );
    const pinned = await getPinnedFor("dm", peerUserId, req.user.id);

    const sockets = socketsByUser.get(peerUserId);
    if (sockets) {
      for (const socketId of sockets) {
        io.to(socketId).emit("dm:read", {
          peerUserId: req.user.id,
          readAt: new Date().toISOString(),
        });
      }
    }

    res.json({
      pinned,
      peerLastReadAt: peerRead?.last_read_at || null,
      hasMore: rows.length === limit,
      messages: messages.map((message) => ({
        id: message.id,
        senderId: message.sender_id,
        receiverId: message.receiver_id,
        content: message.content,
        type: message.message_type,
        imageUrl: message.image_url || "",
        fileUrl: message.file_url || "",
        fileName: message.file_name || "",
        fileSize: message.file_size || null,
        forwardedFromName: message.forwarded_from_name || "",
        poll: message.poll,
        replyToMessageId: message.reply_to_message_id,
        editedAt: message.edited_at,
        deletedAt: message.deleted_at,
        reactions: message.reactions,
        createdAt: message.created_at,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/messages/:userId", authMiddleware, messageRateLimit, async (req, res) => {
  try {
    const peerUserId = mustBeValidId(req.params.userId);
    if (!peerUserId) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    if (peerUserId === req.user.id) {
      res.status(400).json({ error: "You cannot message yourself" });
      return;
    }

    const peer = await get("SELECT id FROM users WHERE id = ?", [peerUserId]);
    if (!peer) {
      res.status(404).json({ error: "Recipient not found" });
      return;
    }

    const content = normalizeText(req.body.content, 2000);
    const imageUrl = normalizeText(req.body.imageUrl, 500);
    const fileUrl = normalizeText(req.body.fileUrl, 500);
    const fileName = normalizeText(req.body.fileName, 180);
    const fileSize = Number(req.body.fileSize || 0) || null;
    const forwardedFromName = normalizeText(req.body.forwardedFromName, 120);
    const pollInput = req.body.poll || null;
    const replyToMessageId = mustBeValidId(req.body.replyToMessageId);

    let messageType = "text";
    let pollId = null;

    if (pollInput) {
      pollId = await createPollFromInput(req.user.id, pollInput);
      messageType = "poll";
    } else if (imageUrl) {
      messageType = "image";
    } else if (fileUrl) {
      messageType = "file";
    }

    if (!content && !imageUrl && !fileUrl && !pollId) {
      res.status(400).json({ error: "Empty message" });
      return;
    }

    if (replyToMessageId) {
      const replied = await get(
        `
        SELECT id FROM messages
        WHERE id = ?
          AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
        `,
        [replyToMessageId, req.user.id, peerUserId, peerUserId, req.user.id]
      );
      if (!replied) {
        res.status(400).json({ error: "Reply target not found" });
        return;
      }
    }

    const inserted = await run(
      `
      INSERT INTO messages (sender_id, receiver_id, content, message_type, image_url, file_url, file_name, file_size, poll_id, reply_to_message_id, forwarded_from_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        req.user.id,
        peerUserId,
        content,
        messageType,
        imageUrl || null,
        fileUrl || null,
        fileName || null,
        fileSize,
        pollId,
        replyToMessageId || null,
        forwardedFromName || null,
      ]
    );

    const created = await get(
      "SELECT id, sender_id, receiver_id, content, message_type, image_url, file_url, file_name, file_size, poll_id, reply_to_message_id, forwarded_from_name, edited_at, deleted_at, created_at FROM messages WHERE id = ?",
      [inserted.id]
    );

    const recipients = [peerUserId, req.user.id];
    for (const userId of recipients) {
      const payload = await buildDmPayload(created, userId);
      const sockets = socketsByUser.get(userId);
      if (!sockets) {
        continue;
      }
      for (const socketId of sockets) {
        io.to(socketId).emit("message:new", payload);
      }
    }

    await sendWebPushToUser(peerUserId, {
      title: req.user.displayName || req.user.username,
      body: content || (fileName ? `Файл: ${fileName}` : imageUrl ? "Изображение" : "Новое сообщение"),
      url: "/",
    });

    const responsePayload = await buildDmPayload(created, req.user.id);
    res.status(201).json({ message: responsePayload });
  } catch (error) {
    const text = error?.message || "";
    if (text.startsWith("Poll ")) {
      res.status(400).json({ error: text });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/dialogs/:userId", authMiddleware, async (req, res) => {
  try {
    const peerUserId = mustBeValidId(req.params.userId);
    if (!peerUserId) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    if (peerUserId === req.user.id) {
      res.status(400).json({ error: "You cannot clear dialog with yourself" });
      return;
    }

    const peer = await get("SELECT id FROM users WHERE id = ?", [peerUserId]);
    if (!peer) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const dialogMessages = await all(
      `
      SELECT id
      FROM messages
      WHERE (sender_id = ? AND receiver_id = ?)
         OR (sender_id = ? AND receiver_id = ?)
      `,
      [req.user.id, peerUserId, peerUserId, req.user.id]
    );

    const messageIds = dialogMessages.map((item) => item.id);
    if (messageIds.length) {
      const placeholders = messageIds.map(() => "?").join(", ");
      await run(
        `DELETE FROM message_reactions WHERE scope = 'dm' AND message_id IN (${placeholders})`,
        messageIds
      );
      await run(`DELETE FROM messages WHERE id IN (${placeholders})`, messageIds);
    }

    const participants = [req.user.id, peerUserId];
    for (const userId of participants) {
      const sockets = socketsByUser.get(userId);
      if (!sockets) {
        continue;
      }
      for (const socketId of sockets) {
        io.to(socketId).emit("dialog:cleared", {
          userId,
          peerUserId: userId === req.user.id ? peerUserId : req.user.id,
        });
      }
    }

    res.json({ ok: true, deleted: messageIds.length });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.patch("/api/messages/item/:messageId", authMiddleware, async (req, res) => {
  try {
    const messageId = mustBeValidId(req.params.messageId);
    if (!messageId) {
      res.status(400).json({ error: "Invalid message id" });
      return;
    }

    const row = await get(
      "SELECT * FROM messages WHERE id = ? AND (sender_id = ? OR receiver_id = ?)",
      [messageId, req.user.id, req.user.id]
    );
    if (!row) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const me = await get("SELECT is_admin FROM users WHERE id = ?", [req.user.id]);
    if (row.sender_id !== req.user.id && !me?.is_admin) {
      res.status(403).json({ error: "Cannot edit this message" });
      return;
    }

    if (row.deleted_at) {
      res.status(400).json({ error: "Message is deleted" });
      return;
    }

    const content = normalizeText(req.body.content, 2000);
    if (!content) {
      res.status(400).json({ error: "Content cannot be empty" });
      return;
    }

    await run("UPDATE messages SET content = ?, edited_at = datetime('now') WHERE id = ?", [
      content,
      messageId,
    ]);

    const updated = await get("SELECT * FROM messages WHERE id = ?", [messageId]);

    for (const participantId of [updated.sender_id, updated.receiver_id]) {
      const payload = await buildDmPayload(updated, participantId);
      const sockets = socketsByUser.get(participantId);
      if (!sockets) {
        continue;
      }
      for (const socketId of sockets) {
        io.to(socketId).emit("message:update", payload);
      }
    }

    const responsePayload = await buildDmPayload(updated, req.user.id);
    res.json({ message: responsePayload });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/messages/item/:messageId", authMiddleware, async (req, res) => {
  try {
    const messageId = mustBeValidId(req.params.messageId);
    if (!messageId) {
      res.status(400).json({ error: "Invalid message id" });
      return;
    }

    const row = await get(
      "SELECT * FROM messages WHERE id = ? AND (sender_id = ? OR receiver_id = ?)",
      [messageId, req.user.id, req.user.id]
    );
    if (!row) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const me = await get("SELECT is_admin FROM users WHERE id = ?", [req.user.id]);
    if (row.sender_id !== req.user.id && !me?.is_admin) {
      res.status(403).json({ error: "Cannot delete this message" });
      return;
    }

    await run(
      "UPDATE messages SET content = '', message_type = 'text', image_url = NULL, file_url = NULL, file_name = NULL, file_size = NULL, poll_id = NULL, forwarded_from_name = NULL, deleted_at = datetime('now'), edited_at = datetime('now') WHERE id = ?",
      [messageId]
    );
    await run("DELETE FROM message_reactions WHERE scope = 'dm' AND message_id = ?", [messageId]);

    const updated = await get("SELECT * FROM messages WHERE id = ?", [messageId]);

    for (const participantId of [updated.sender_id, updated.receiver_id]) {
      const payload = await buildDmPayload(updated, participantId);
      const sockets = socketsByUser.get(participantId);
      if (!sockets) {
        continue;
      }
      for (const socketId of sockets) {
        io.to(socketId).emit("message:update", payload);
      }
    }

    const responsePayload = await buildDmPayload(updated, req.user.id);
    res.json({ message: responsePayload });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/messages/item/:messageId/reactions", authMiddleware, async (req, res) => {
  try {
    const messageId = mustBeValidId(req.params.messageId);
    const emoji = normalizeEmoji(req.body.emoji);
    if (!messageId || !emoji) {
      res.status(400).json({ error: "Invalid reaction" });
      return;
    }

    const row = await get(
      "SELECT * FROM messages WHERE id = ? AND (sender_id = ? OR receiver_id = ?)",
      [messageId, req.user.id, req.user.id]
    );
    if (!row) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const exists = await get(
      "SELECT id FROM message_reactions WHERE scope = 'dm' AND message_id = ? AND user_id = ? AND emoji = ?",
      [messageId, req.user.id, emoji]
    );

    if (exists) {
      await run("DELETE FROM message_reactions WHERE id = ?", [exists.id]);
    } else {
      await run(
        "INSERT INTO message_reactions (scope, message_id, user_id, emoji) VALUES ('dm', ?, ?, ?)",
        [messageId, req.user.id, emoji]
      );
    }

    const updated = await get("SELECT * FROM messages WHERE id = ?", [messageId]);

    for (const participantId of [updated.sender_id, updated.receiver_id]) {
      const payload = await buildDmPayload(updated, participantId);
      const sockets = socketsByUser.get(participantId);
      if (!sockets) {
        continue;
      }
      for (const socketId of sockets) {
        io.to(socketId).emit("message:update", payload);
      }
    }

    const responsePayload = await buildDmPayload(updated, req.user.id);
    res.json({ message: responsePayload });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/rooms", authMiddleware, async (req, res) => {
  try {
    const me = await get("SELECT id, is_admin FROM users WHERE id = ?", [req.user.id]);
    const rooms = await all(
      `
      SELECT
        r.id,
        r.name,
        r.access_type,
        r.created_by,
        r.created_at,
        r.avatar_url,
        r.description,
        r.slug,
        (
          SELECT rm.content
          FROM room_messages rm
          WHERE rm.room_id = r.id
            AND rm.deleted_at IS NULL
          ORDER BY rm.id DESC
          LIMIT 1
        ) AS last_message,
        (
          SELECT rm.message_type
          FROM room_messages rm
          WHERE rm.room_id = r.id
            AND rm.deleted_at IS NULL
          ORDER BY rm.id DESC
          LIMIT 1
        ) AS last_message_type,
        (
          SELECT rm.created_at
          FROM room_messages rm
          WHERE rm.room_id = r.id
            AND rm.deleted_at IS NULL
          ORDER BY rm.id DESC
          LIMIT 1
        ) AS last_message_at,
        (
          SELECT own.role
          FROM room_members own
          WHERE own.room_id = r.id AND own.user_id = ?
          LIMIT 1
        ) AS my_role,
        COUNT(m.user_id) AS members_count,
        EXISTS(
          SELECT 1
          FROM room_members own
          WHERE own.room_id = r.id AND own.user_id = ?
        ) AS joined,
        EXISTS(
          SELECT 1
          FROM room_invitations inv
          WHERE inv.room_id = r.id AND inv.user_id = ?
        ) AS has_invitation,
        EXISTS(
          SELECT 1
          FROM room_join_requests reqs
          WHERE reqs.room_id = r.id AND reqs.user_id = ?
        ) AS has_join_request
      FROM chat_rooms r
      LEFT JOIN room_members m ON m.room_id = r.id
      WHERE r.access_type = 'public'
         OR EXISTS(
           SELECT 1
           FROM room_members own
           WHERE own.room_id = r.id AND own.user_id = ?
         )
         OR EXISTS(
            SELECT 1
            FROM room_invitations inv
            WHERE inv.room_id = r.id AND inv.user_id = ?
          )
         OR EXISTS(
            SELECT 1
            FROM room_join_requests reqs
            WHERE reqs.room_id = r.id AND reqs.user_id = ?
         )
         OR ? = 1
      GROUP BY r.id
      ORDER BY r.created_at ASC
      `,
      [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, me?.is_admin ? 1 : 0]
    );

    const unreadMap = await getRoomUnreadMap(req.user.id);
    const prefsMap = await getChatPrefsMap(req.user.id, "room");
    res.json({
      rooms: rooms.map((room) => ({
        ...roomPayload(room, Boolean(room.joined) || Boolean(me?.is_admin)),
        joined: Boolean(room.joined),
        hasInvitation: Boolean(room.has_invitation),
        hasJoinRequest: Boolean(room.has_join_request),
        membersCount: Number(room.members_count),
        canManage: canManageRoom(me, room, room.my_role || null),
        canOwn: canOwnRoom(me, room, room.my_role || null),
        canPost: canPostToRoom(me, room, room.my_role || null),
        canInvite: canInviteToRoom(me, room, room.my_role || null),
        unreadCount: unreadMap.get(room.id) || 0,
        lastMessage: room.last_message || "",
        lastMessageType: room.last_message_type || "text",
        lastMessageAt: room.last_message_at || null,
        pinned: prefsMap.get(room.id)?.pinned || false,
        muted: prefsMap.get(room.id)?.muted || false,
        archived: prefsMap.get(room.id)?.archived || false,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/rooms", authMiddleware, async (req, res) => {
  try {
    const name = normalizeText(req.body.name, 40);
    const requestedAccess = String(req.body.accessType || "").toLowerCase();
    const accessType =
      requestedAccess === "private" || requestedAccess === "invite" ? "private" : "public";
    const description = normalizeText(req.body.description, 300);
    const avatarUrl = normalizeText(req.body.avatarUrl, 500);
    const requestedSlug = normalizeText(req.body.slug, 64).toLowerCase();

    if (name.length < 2 || name.length > 40) {
      res.status(400).json({ error: "Room name must be 2-40 chars" });
      return;
    }

    const exists = await get("SELECT id FROM chat_rooms WHERE lower(name) = lower(?)", [name]);
    if (exists) {
      res.status(409).json({ error: "Room already exists" });
      return;
    }

    let slug = "";
    if (requestedSlug) {
      slug = slugifyRoomName(requestedSlug);
      if (slug.length < 3) {
        res.status(400).json({ error: "Room link must be at least 3 chars" });
        return;
      }
      if (isReservedRoomSlug(slug)) {
        res.status(400).json({ error: "Room link is reserved" });
        return;
      }
      const slugExists = await get("SELECT id FROM chat_rooms WHERE slug = ?", [slug]);
      if (slugExists) {
        res.status(409).json({ error: "Room link already exists" });
        return;
      }
    } else {
      slug = await makeUniqueRoomSlug(name);
    }

    const inserted = await run(
      "INSERT INTO chat_rooms (name, access_type, created_by, avatar_url, description, slug) VALUES (?, ?, ?, ?, ?, ?)",
      [name, accessType, req.user.id, avatarUrl || null, description || null, slug]
    );

    await run("INSERT OR IGNORE INTO room_members (room_id, user_id, role) VALUES (?, ?, 'owner')", [
      inserted.id,
      req.user.id,
    ]);

    await appendRoomAudit(inserted.id, req.user.id, "room_created", {
      accessType,
    });

    const room = await get("SELECT * FROM chat_rooms WHERE id = ?", [inserted.id]);
    io.emit("rooms:update");

    res.status(201).json({
      room: {
        ...roomPayload(room, true),
        joined: true,
        membersCount: 1,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/rooms/:roomId/join", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    if (!roomId) {
      res.status(400).json({ error: "Invalid room id" });
      return;
    }

    const room = await get("SELECT * FROM chat_rooms WHERE id = ?", [roomId]);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    const banned = await get("SELECT 1 FROM room_bans WHERE room_id = ? AND user_id = ?", [roomId, req.user.id]);
    if (banned && room.created_by !== req.user.id) {
      res.status(403).json({ error: "You are banned from this room" });
      return;
    }

    if (room.access_type === "private") {
      const isInvited = await get(
        "SELECT 1 FROM room_invitations WHERE room_id = ? AND user_id = ?",
        [roomId, req.user.id]
      );
      const me = await get("SELECT id, is_admin FROM users WHERE id = ?", [req.user.id]);
      const isCreator = room.created_by === req.user.id;
      if (!isInvited && !me?.is_admin && !isCreator) {
        res.status(403).json({ error: "You need an invitation to join this room" });
        return;
      }
      await run("DELETE FROM room_invitations WHERE room_id = ? AND user_id = ?", [roomId, req.user.id]);
    }

    await run("INSERT OR IGNORE INTO room_members (room_id, user_id, role) VALUES (?, ?, 'member')", [
      roomId,
      req.user.id,
    ]);

    await appendRoomAudit(roomId, req.user.id, "member_joined", {
      targetUserId: req.user.id,
      payload: { via: room.access_type === "private" ? "invited_join" : "public_join" },
    });

    io.emit("rooms:update");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/rooms/:roomId/invite-candidates", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    if (!roomId) {
      res.status(400).json({ error: "Invalid room id" });
      return;
    }

    const room = await get("SELECT * FROM chat_rooms WHERE id = ?", [roomId]);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    const me = await get("SELECT id, is_admin FROM users WHERE id = ?", [req.user.id]);
    const myMembership = await get("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?", [
      roomId,
      req.user.id,
    ]);
    const myRole = myMembership?.role || null;
    const canManage = canManageRoom(me, room, myRole);
    if (!myMembership && !canManage) {
      res.status(403).json({ error: "Join room first" });
      return;
    }

    if (!canInviteToRoom(me, room, myRole)) {
      res.status(403).json({ error: "Only creator or admin can invite users" });
      return;
    }

    const users = await all(
      `
      SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_admin
      FROM users u
      WHERE u.id != ?
        AND u.id NOT IN (
          SELECT rm.user_id
          FROM room_members rm
          WHERE rm.room_id = ?
        )
      ORDER BY u.display_name COLLATE NOCASE ASC
      `,
      [req.user.id, roomId]
    );

    const online = new Set(onlineUserIds());
    res.json({
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        avatarUrl: u.avatar_url || "",
        isAdmin: Boolean(u.is_admin),
        online: online.has(u.id),
      })),
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/rooms/:roomId/invite-user", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    const userId = mustBeValidId(req.body.userId);
    if (!roomId || !userId) {
      res.status(400).json({ error: "Invalid room or user id" });
      return;
    }

    const room = await get("SELECT * FROM chat_rooms WHERE id = ?", [roomId]);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    const me = await get("SELECT id, is_admin FROM users WHERE id = ?", [req.user.id]);
    const myMembership = await get("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?", [
      roomId,
      req.user.id,
    ]);
    const myRole = myMembership?.role || null;
    const canManage = canManageRoom(me, room, myRole);
    if (!myMembership && !canManage) {
      res.status(403).json({ error: "Join room first" });
      return;
    }

    if (!canInviteToRoom(me, room, myRole)) {
      res.status(403).json({ error: "Only creator or admin can invite users" });
      return;
    }

    const target = await get("SELECT id FROM users WHERE id = ?", [userId]);
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    await run(
      `
      INSERT INTO room_invitations (room_id, user_id, invited_by, accepted_at, created_at)
      VALUES (?, ?, ?, NULL, datetime('now'))
      ON CONFLICT(room_id, user_id)
      DO UPDATE SET invited_by = excluded.invited_by, accepted_at = NULL, created_at = datetime('now')
      `,
      [roomId, userId, req.user.id]
    );

    await appendRoomAudit(roomId, req.user.id, "invite_sent", {
      targetUserId: userId,
    });

    const invitation = await get(
      `
      SELECT
        ri.id,
        ri.room_id,
        ri.user_id,
        ri.created_at,
        r.name AS room_name,
        inviter.id AS inviter_id,
        inviter.username AS inviter_username,
        inviter.display_name AS inviter_display_name,
        inviter.avatar_url AS inviter_avatar_url
      FROM room_invitations ri
      JOIN chat_rooms r ON r.id = ri.room_id
      LEFT JOIN users inviter ON inviter.id = ri.invited_by
      WHERE ri.room_id = ? AND ri.user_id = ?
      `,
      [roomId, userId]
    );

    io.emit("rooms:update");
    const sockets = socketsByUser.get(userId);
    if (sockets) {
      for (const socketId of sockets) {
        io.to(socketId).emit("room:invitation", {
          invitation: invitation
            ? {
                id: invitation.id,
                roomId: invitation.room_id,
                roomName: invitation.room_name,
                createdAt: invitation.created_at,
                inviter: invitation.inviter_id
                  ? {
                      id: invitation.inviter_id,
                      username: invitation.inviter_username,
                      displayName: invitation.inviter_display_name,
                      avatarUrl: invitation.inviter_avatar_url || "",
                    }
                  : null,
              }
            : null,
        });
      }
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/rooms/:roomId", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    if (!roomId) {
      res.status(400).json({ error: "Invalid room id" });
      return;
    }

    const room = await get("SELECT * FROM chat_rooms WHERE id = ?", [roomId]);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    const me = await get("SELECT id, is_admin FROM users WHERE id = ?", [req.user.id]);
    if (!me?.is_admin && room.created_by !== req.user.id) {
      res.status(403).json({ error: "Only creator or admin can delete room" });
      return;
    }

    const result = await deleteRoomCascade(roomId, req.user.id);
    res.json({ ok: true, roomId, deletedMessages: result?.deletedMessages || 0 });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/invitations", authMiddleware, async (req, res) => {
  try {
    const invitations = await all(
      `
      SELECT
        ri.id,
        ri.room_id,
        ri.created_at,
        r.name AS room_name,
        r.access_type,
        inviter.id AS inviter_id,
        inviter.username AS inviter_username,
        inviter.display_name AS inviter_display_name,
        inviter.avatar_url AS inviter_avatar_url
      FROM room_invitations ri
      JOIN chat_rooms r ON r.id = ri.room_id
      LEFT JOIN users inviter ON inviter.id = ri.invited_by
      WHERE ri.user_id = ?
      ORDER BY datetime(ri.created_at) DESC
      `,
      [req.user.id]
    );

    res.json({
      invitations: invitations.map((invitation) => ({
        id: invitation.id,
        roomId: invitation.room_id,
        roomName: invitation.room_name,
        roomAccessType: invitation.access_type,
        createdAt: invitation.created_at,
        inviter: invitation.inviter_id
          ? {
              id: invitation.inviter_id,
              username: invitation.inviter_username,
              displayName: invitation.inviter_display_name,
              avatarUrl: invitation.inviter_avatar_url || "",
            }
          : null,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/invitations/:invitationId/accept", authMiddleware, async (req, res) => {
  try {
    const invitationId = mustBeValidId(req.params.invitationId);
    if (!invitationId) {
      res.status(400).json({ error: "Invalid invitation id" });
      return;
    }

    const invitation = await get(
      `
      SELECT ri.id, ri.room_id, r.name AS room_name
      FROM room_invitations ri
      JOIN chat_rooms r ON r.id = ri.room_id
      WHERE ri.id = ? AND ri.user_id = ?
      `,
      [invitationId, req.user.id]
    );
    if (!invitation) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }

    await run("INSERT OR IGNORE INTO room_members (room_id, user_id, role) VALUES (?, ?, 'member')", [
      invitation.room_id,
      req.user.id,
    ]);
    await appendRoomAudit(invitation.room_id, req.user.id, "member_joined", {
      targetUserId: req.user.id,
      payload: { via: "invitation" },
    });
    await run("UPDATE room_invitations SET accepted_at = datetime('now') WHERE id = ?", [invitationId]);
    await run("DELETE FROM room_invitations WHERE id = ?", [invitationId]);

    io.emit("rooms:update");
    res.json({ ok: true, roomId: invitation.room_id, roomName: invitation.room_name });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/invitations/:invitationId/decline", authMiddleware, async (req, res) => {
  try {
    const invitationId = mustBeValidId(req.params.invitationId);
    if (!invitationId) {
      res.status(400).json({ error: "Invalid invitation id" });
      return;
    }

    const invitation = await get("SELECT id FROM room_invitations WHERE id = ? AND user_id = ?", [
      invitationId,
      req.user.id,
    ]);
    if (!invitation) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }

    await run("DELETE FROM room_invitations WHERE id = ?", [invitationId]);
    io.emit("rooms:update");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/rooms/:roomId/request-join", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    if (!roomId) {
      res.status(400).json({ error: "Invalid room id" });
      return;
    }
    const room = await get("SELECT * FROM chat_rooms WHERE id = ?", [roomId]);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    const member = await get("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?", [roomId, req.user.id]);
    if (member) {
      res.status(400).json({ error: "Already in room" });
      return;
    }
    const banned = await get("SELECT 1 FROM room_bans WHERE room_id = ? AND user_id = ?", [roomId, req.user.id]);
    if (banned) {
      res.status(403).json({ error: "You are banned from this room" });
      return;
    }
    await run(
      "INSERT INTO room_join_requests (room_id, user_id, created_at) VALUES (?, ?, datetime('now')) ON CONFLICT(room_id, user_id) DO NOTHING",
      [roomId, req.user.id]
    );
    await appendRoomAudit(roomId, req.user.id, "join_requested", { targetUserId: req.user.id });
    io.emit("rooms:update");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/rooms/:roomId/requests", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    if (!roomId) {
      res.status(400).json({ error: "Invalid room id" });
      return;
    }
    const room = await get("SELECT * FROM chat_rooms WHERE id = ?", [roomId]);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    const me = await get("SELECT id, is_admin FROM users WHERE id = ?", [req.user.id]);
    const myMembership = await get("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?", [roomId, req.user.id]);
    if (!canManageRoom(me, room, myMembership?.role || null)) {
      res.status(403).json({ error: "Only room admins can view requests" });
      return;
    }
    const rows = await all(
      `
      SELECT r.user_id, r.created_at, u.username, u.display_name, u.avatar_url
      FROM room_join_requests r
      JOIN users u ON u.id = r.user_id
      WHERE r.room_id = ?
      ORDER BY datetime(r.created_at) DESC
      `,
      [roomId]
    );
    res.json({
      requests: rows.map((row) => ({
        userId: row.user_id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url || "",
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/rooms/:roomId/requests/:userId/approve", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    const userId = mustBeValidId(req.params.userId);
    if (!roomId || !userId) {
      res.status(400).json({ error: "Invalid room or user id" });
      return;
    }
    const room = await get("SELECT * FROM chat_rooms WHERE id = ?", [roomId]);
    const me = await get("SELECT id, is_admin FROM users WHERE id = ?", [req.user.id]);
    const myMembership = await get("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?", [roomId, req.user.id]);
    if (!room || !canManageRoom(me, room, myMembership?.role || null)) {
      res.status(403).json({ error: "Only room admins can manage requests" });
      return;
    }
    await run("DELETE FROM room_join_requests WHERE room_id = ? AND user_id = ?", [roomId, userId]);
    await run("INSERT OR IGNORE INTO room_members (room_id, user_id, role) VALUES (?, ?, 'member')", [roomId, userId]);
    await appendRoomAudit(roomId, req.user.id, "join_request_approved", { targetUserId: userId });
    io.emit("rooms:update");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/rooms/:roomId/requests/:userId", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    const userId = mustBeValidId(req.params.userId);
    if (!roomId || !userId) {
      res.status(400).json({ error: "Invalid room or user id" });
      return;
    }
    const room = await get("SELECT * FROM chat_rooms WHERE id = ?", [roomId]);
    const me = await get("SELECT id, is_admin FROM users WHERE id = ?", [req.user.id]);
    const myMembership = await get("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?", [roomId, req.user.id]);
    if (!room || !canManageRoom(me, room, myMembership?.role || null)) {
      res.status(403).json({ error: "Only room admins can manage requests" });
      return;
    }
    await run("DELETE FROM room_join_requests WHERE room_id = ? AND user_id = ?", [roomId, userId]);
    await appendRoomAudit(roomId, req.user.id, "join_request_declined", { targetUserId: userId });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/rooms/:roomId", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    if (!roomId) {
      res.status(400).json({ error: "Invalid room id" });
      return;
    }

    const room = await get("SELECT * FROM chat_rooms WHERE id = ?", [roomId]);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    const joined = await get("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?", [
      roomId,
      req.user.id,
    ]);
    const me = await get("SELECT id, is_admin FROM users WHERE id = ?", [req.user.id]);
    const myRole = joined?.role || null;
    const canManage = canManageRoom(me, room, myRole);
    const canOwn = canOwnRoom(me, room, myRole);
    const canPost = canPostToRoom(me, room, myRole);
    const canInvite = canInviteToRoom(me, room, myRole);

    const members = await all(
      "SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_admin, rm.role, rm.is_muted, rm.can_post_media FROM room_members rm JOIN users u ON u.id = rm.user_id WHERE rm.room_id = ?",
      [roomId]
    );
    const online = new Set(onlineUserIds());

    res.json({
      ...roomPayload({ ...room, my_role: myRole }, Boolean(joined) || Boolean(me?.is_admin)),
      joined: Boolean(joined),
      canManage,
      canInvite,
      canOwn,
      canPost,
      members: members.map((m) => ({
        id: m.id,
        username: m.username,
        displayName: m.display_name,
        avatarUrl: m.avatar_url || "",
        isAdmin: Boolean(m.is_admin),
        role: m.role || "member",
        isMuted: Boolean(m.is_muted),
        canPostMedia: Boolean(m.can_post_media),
        online: online.has(m.id),
      })),
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/room-slug/:slug", authMiddleware, async (req, res) => {
  try {
    const slug = slugifyRoomName(req.params.slug);
    if (!slug) {
      res.status(400).json({ error: "Invalid room slug" });
      return;
    }

    const room = await get("SELECT * FROM chat_rooms WHERE slug = ?", [slug]);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    const joined = await get("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?", [room.id, req.user.id]);
    const me = await get("SELECT id, is_admin FROM users WHERE id = ?", [req.user.id]);
    const myRole = joined?.role || null;
    res.json({
      room: {
        ...roomPayload({ ...room, my_role: myRole }, Boolean(joined) || Boolean(me?.is_admin)),
        joined: Boolean(joined),
        canManage: canManageRoom(me, room, myRole),
        canOwn: canOwnRoom(me, room, myRole),
        canPost: canPostToRoom(me, room, myRole),
        canInvite: canInviteToRoom(me, room, myRole),
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/public/room-slug/:slug", async (req, res) => {
  try {
    const slug = slugifyRoomName(req.params.slug);
    if (!slug) {
      res.status(400).json({ error: "Invalid room slug" });
      return;
    }

    const room = await get(
      `
      SELECT
        r.id,
        r.name,
        r.access_type,
        r.avatar_url,
        r.description,
        r.slug,
        COUNT(rm.user_id) AS members_count
      FROM chat_rooms r
      LEFT JOIN room_members rm ON rm.room_id = r.id
      WHERE r.slug = ?
      GROUP BY r.id
      `,
      [slug]
    );
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    res.json({
      room: {
        id: room.id,
        name: room.name,
        accessType: room.access_type,
        avatarUrl: room.avatar_url || "",
        description: room.description || "",
        slug: room.slug || "",
        membersCount: Number(room.members_count || 0),
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/rooms/:roomId/members/:userId", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    const userId = mustBeValidId(req.params.userId);
    if (!roomId || !userId) {
      res.status(400).json({ error: "Invalid room or user id" });
      return;
    }

    const room = await get("SELECT * FROM chat_rooms WHERE id = ?", [roomId]);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    const me = await get("SELECT id, is_admin FROM users WHERE id = ?", [req.user.id]);
    const myMembership = await get("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?", [
      roomId,
      req.user.id,
    ]);
    const canManage = canManageRoom(me, room, myMembership?.role || null);
    if (!canManage) {
      res.status(403).json({ error: "Only creator or admin can manage members" });
      return;
    }

    if (room.created_by === userId) {
      res.status(400).json({ error: "Room creator cannot be removed" });
      return;
    }

    const membership = await get("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?", [
      roomId,
      userId,
    ]);
    if (!membership) {
      res.status(404).json({ error: "User is not a member" });
      return;
    }

    const myRole = myMembership?.role || null;
    const targetRole = membership.role || "member";
    if (!me?.is_admin) {
      if (myRole === "admin" && targetRole !== "member") {
        res.status(403).json({ error: "Room admin can remove only members" });
        return;
      }
      if (myRole === "member") {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }
    }

    await run("DELETE FROM room_members WHERE room_id = ? AND user_id = ?", [roomId, userId]);
    await appendRoomAudit(roomId, req.user.id, "member_removed", {
      targetUserId: userId,
    });
    io.emit("rooms:update");

    const sockets = socketsByUser.get(userId);
    if (sockets) {
      for (const socketId of sockets) {
        io.to(socketId).emit("room:member:kicked", { roomId, roomName: room.name });
      }
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.patch("/api/rooms/:roomId", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    if (!roomId) {
      res.status(400).json({ error: "Invalid room id" });
      return;
    }

    const room = await get("SELECT * FROM chat_rooms WHERE id = ?", [roomId]);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    const me = await get("SELECT id, is_admin FROM users WHERE id = ?", [req.user.id]);
    const myMembership = await get("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?", [
      roomId,
      req.user.id,
    ]);
    if (!canOwnRoom(me, room, myMembership?.role || null)) {
      res.status(403).json({ error: "Only room owner or admin can update room settings" });
      return;
    }

    const payload = {};
    if (req.body.name !== undefined) {
      const name = normalizeText(req.body.name, 40);
      if (name.length < 2 || name.length > 40) {
        res.status(400).json({ error: "Room name must be 2-40 chars" });
        return;
      }
      const exists = await get("SELECT id FROM chat_rooms WHERE lower(name) = lower(?) AND id != ?", [
        name,
        roomId,
      ]);
      if (exists) {
        res.status(409).json({ error: "Room already exists" });
        return;
      }
      payload.name = name;
    }

    if (req.body.description !== undefined) {
      payload.description = normalizeText(req.body.description, 300);
    }

    if (req.body.avatarUrl !== undefined) {
      payload.avatarUrl = normalizeText(req.body.avatarUrl, 500);
    }

    if (req.body.slug !== undefined) {
      const requestedSlug = normalizeText(req.body.slug, 64).toLowerCase();
      const slug = slugifyRoomName(requestedSlug);
      if (slug.length < 3) {
        res.status(400).json({ error: "Room link must be at least 3 chars" });
        return;
      }
      if (isReservedRoomSlug(slug)) {
        res.status(400).json({ error: "Room link is reserved" });
        return;
      }
      const exists = await get("SELECT id FROM chat_rooms WHERE slug = ? AND id != ?", [slug, roomId]);
      if (exists) {
        res.status(409).json({ error: "Room link already exists" });
        return;
      }
      payload.slug = slug;
    }

    if (req.body.accessType !== undefined) {
      const requestedAccess = String(req.body.accessType || "").toLowerCase();
      payload.accessType = requestedAccess === "private" ? "private" : "public";
    }

    if (req.body.whoCanPost !== undefined) {
      const policy = String(req.body.whoCanPost || "").toLowerCase();
      if (!["members", "admins"].includes(policy)) {
        res.status(400).json({ error: "Invalid whoCanPost policy" });
        return;
      }
      payload.whoCanPost = policy;
    }

    if (req.body.whoCanInvite !== undefined) {
      const policy = String(req.body.whoCanInvite || "").toLowerCase();
      if (!["members", "admins"].includes(policy)) {
        res.status(400).json({ error: "Invalid whoCanInvite policy" });
        return;
      }
      payload.whoCanInvite = policy;
    }

    if (!payload.name && !payload.accessType && !payload.whoCanPost && !payload.whoCanInvite && payload.description === undefined && payload.avatarUrl === undefined && !payload.slug) {
      res.status(400).json({ error: "No changes provided" });
      return;
    }

    await run(
      "UPDATE chat_rooms SET name = COALESCE(?, name), access_type = COALESCE(?, access_type), who_can_post = COALESCE(?, who_can_post), who_can_invite = COALESCE(?, who_can_invite), description = COALESCE(?, description), avatar_url = COALESCE(?, avatar_url), slug = COALESCE(?, slug) WHERE id = ?",
      [
        payload.name || null,
        payload.accessType || null,
        payload.whoCanPost || null,
        payload.whoCanInvite || null,
        payload.description !== undefined ? payload.description : null,
        payload.avatarUrl !== undefined ? payload.avatarUrl : null,
        payload.slug || null,
        roomId,
      ]
    );

    await appendRoomAudit(roomId, req.user.id, "room_settings_updated", {
      payload,
    });

    const updatedRoom = await get("SELECT * FROM chat_rooms WHERE id = ?", [roomId]);
    io.emit("rooms:update");
    res.json({ room: roomPayload({ ...updatedRoom, my_role: myMembership?.role || null }, true) });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.patch("/api/rooms/:roomId/members/:userId", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    const userId = mustBeValidId(req.params.userId);
    const nextRole = req.body.role !== undefined ? String(req.body.role || "").toLowerCase() : null;
    const nextMuted = req.body.isMuted !== undefined ? Boolean(req.body.isMuted) : null;
    const nextCanPostMedia = req.body.canPostMedia !== undefined ? Boolean(req.body.canPostMedia) : null;
    if (!roomId || !userId || (nextRole === null && nextMuted === null && nextCanPostMedia === null)) {
      res.status(400).json({ error: "Invalid payload" });
      return;
    }
    if (nextRole !== null && !["member", "admin"].includes(nextRole)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }

    const room = await get("SELECT * FROM chat_rooms WHERE id = ?", [roomId]);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    const me = await get("SELECT id, is_admin FROM users WHERE id = ?", [req.user.id]);
    const myMembership = await get("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?", [
      roomId,
      req.user.id,
    ]);
    const myRole = myMembership?.role || null;
    const target = await get("SELECT role, is_muted, can_post_media FROM room_members WHERE room_id = ? AND user_id = ?", [
      roomId,
      userId,
    ]);
    if (!target) {
      res.status(404).json({ error: "User is not a member" });
      return;
    }

    if (nextRole !== null && !canOwnRoom(me, room, myRole)) {
      res.status(403).json({ error: "Only room owner or admin can change roles" });
      return;
    }

    if ((nextRole !== null || nextMuted !== null || nextCanPostMedia !== null) && !canModerateRoomTarget(me, room, myRole, target.role || "member")) {
      res.status(403).json({ error: "Insufficient permissions for this user" });
      return;
    }

    if (room.created_by === userId) {
      res.status(400).json({ error: "Room owner role cannot be changed" });
      return;
    }

    await run(
      "UPDATE room_members SET role = COALESCE(?, role), is_muted = COALESCE(?, is_muted), can_post_media = COALESCE(?, can_post_media) WHERE room_id = ? AND user_id = ?",
      [nextRole, nextMuted === null ? null : (nextMuted ? 1 : 0), nextCanPostMedia === null ? null : (nextCanPostMedia ? 1 : 0), roomId, userId]
    );
    await appendRoomAudit(roomId, req.user.id, "member_restrictions_changed", {
      targetUserId: userId,
      payload: { role: nextRole, isMuted: nextMuted, canPostMedia: nextCanPostMedia },
    });
    io.emit("rooms:update");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/rooms/:roomId/leave", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    if (!roomId) {
      res.status(400).json({ error: "Invalid room id" });
      return;
    }

    const room = await get("SELECT * FROM chat_rooms WHERE id = ?", [roomId]);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    const membership = await get("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?", [
      roomId,
      req.user.id,
    ]);
    if (!membership) {
      res.status(404).json({ error: "You are not a member of this room" });
      return;
    }

    if (membership.role === "owner" && room.created_by === req.user.id) {
      res.status(400).json({ error: "Room owner cannot leave. Delete room or transfer ownership first" });
      return;
    }

    await run("DELETE FROM room_members WHERE room_id = ? AND user_id = ?", [roomId, req.user.id]);
    await appendRoomAudit(roomId, req.user.id, "member_left", {
      targetUserId: req.user.id,
    });
    io.emit("rooms:update");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/rooms/:roomId/ban-user", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    const userId = mustBeValidId(req.body.userId);
    if (!roomId || !userId) {
      res.status(400).json({ error: "Invalid room or user id" });
      return;
    }
    const room = await get("SELECT * FROM chat_rooms WHERE id = ?", [roomId]);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    const me = await get("SELECT id, is_admin FROM users WHERE id = ?", [req.user.id]);
    const myMembership = await get("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?", [roomId, req.user.id]);
    const targetMembership = await get("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?", [roomId, userId]);
    if (!canModerateRoomTarget(me, room, myMembership?.role || null, targetMembership?.role || "member")) {
      res.status(403).json({ error: "Insufficient permissions for this user" });
      return;
    }
    if (room.created_by === userId) {
      res.status(400).json({ error: "Room owner cannot be banned" });
      return;
    }
    await run(
      "INSERT INTO room_bans (room_id, user_id, banned_by, created_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(room_id, user_id) DO UPDATE SET banned_by = excluded.banned_by, created_at = datetime('now')",
      [roomId, userId, req.user.id]
    );
    await run("DELETE FROM room_members WHERE room_id = ? AND user_id = ?", [roomId, userId]);
    await appendRoomAudit(roomId, req.user.id, "member_banned", { targetUserId: userId });
    io.emit("rooms:update");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/rooms/:roomId/bans/:userId", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    const userId = mustBeValidId(req.params.userId);
    if (!roomId || !userId) {
      res.status(400).json({ error: "Invalid room or user id" });
      return;
    }
    const room = await get("SELECT * FROM chat_rooms WHERE id = ?", [roomId]);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    const me = await get("SELECT id, is_admin FROM users WHERE id = ?", [req.user.id]);
    const myMembership = await get("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?", [roomId, req.user.id]);
    if (!canManageRoom(me, room, myMembership?.role || null)) {
      res.status(403).json({ error: "Only room admins can manage bans" });
      return;
    }
    await run("DELETE FROM room_bans WHERE room_id = ? AND user_id = ?", [roomId, userId]);
    await appendRoomAudit(roomId, req.user.id, "member_unbanned", { targetUserId: userId });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/rooms/:roomId/bans", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    if (!roomId) {
      res.status(400).json({ error: "Invalid room id" });
      return;
    }
    const room = await get("SELECT * FROM chat_rooms WHERE id = ?", [roomId]);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    const me = await get("SELECT id, is_admin FROM users WHERE id = ?", [req.user.id]);
    const myMembership = await get("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?", [roomId, req.user.id]);
    if (!canManageRoom(me, room, myMembership?.role || null)) {
      res.status(403).json({ error: "Only room admins can view bans" });
      return;
    }

    const rows = await all(
      `
      SELECT
        b.user_id,
        b.created_at,
        u.username,
        u.display_name,
        u.avatar_url,
        actor.display_name AS banned_by_name
      FROM room_bans b
      JOIN users u ON u.id = b.user_id
      LEFT JOIN users actor ON actor.id = b.banned_by
      WHERE b.room_id = ?
      ORDER BY datetime(b.created_at) DESC
      `,
      [roomId]
    );

    res.json({
      bans: rows.map((row) => ({
        userId: row.user_id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url || "",
        bannedAt: row.created_at,
        bannedByName: row.banned_by_name || "Система",
      })),
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/rooms/:roomId/audit", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    const limit = parseLimit(req.query.limit, 50, 200);
    if (!roomId) {
      res.status(400).json({ error: "Invalid room id" });
      return;
    }

    const room = await get("SELECT * FROM chat_rooms WHERE id = ?", [roomId]);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    const me = await get("SELECT id, is_admin FROM users WHERE id = ?", [req.user.id]);
    const myMembership = await get("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?", [
      roomId,
      req.user.id,
    ]);
    if (!canManageRoom(me, room, myMembership?.role || null)) {
      res.status(403).json({ error: "Only room admins can view audit log" });
      return;
    }

    const rows = await all(
      `
      SELECT
        l.id,
        l.action,
        l.payload,
        l.created_at,
        actor.id AS actor_id,
        actor.username AS actor_username,
        actor.display_name AS actor_display_name,
        target.id AS target_id,
        target.username AS target_username,
        target.display_name AS target_display_name
      FROM room_audit_log l
      JOIN users actor ON actor.id = l.actor_user_id
      LEFT JOIN users target ON target.id = l.target_user_id
      WHERE l.room_id = ?
      ORDER BY l.id DESC
      LIMIT ?
      `,
      [roomId, limit]
    );

    res.json({
      events: rows.map((row) => ({
        id: row.id,
        action: row.action,
        payload: (() => {
          if (!row.payload) {
            return null;
          }
          try {
            return JSON.parse(row.payload);
          } catch (error) {
            return null;
          }
        })(),
        createdAt: row.created_at,
        actor: {
          id: row.actor_id,
          username: row.actor_username,
          displayName: row.actor_display_name,
        },
        target: row.target_id
          ? {
              id: row.target_id,
              username: row.target_username,
              displayName: row.target_display_name,
            }
          : null,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/rooms/:roomId/messages", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    if (!roomId) {
      res.status(400).json({ error: "Invalid room id" });
      return;
    }

    const room = await getRoomForUser(req.user.id, roomId);
    if (!room) {
      res.status(403).json({ error: "Join room first" });
      return;
    }

    const me = await get("SELECT id, is_admin FROM users WHERE id = ?", [req.user.id]);
    if (!canPostToRoom(me, room, room.my_role || null)) {
      res.status(403).json({ error: "You do not have permission to post in this room" });
      return;
    }
    if (room.my_muted) {
      res.status(403).json({ error: "You are muted in this room" });
      return;
    }

    const beforeId = mustBeValidId(req.query.beforeId);
    const limit = parseLimit(req.query.limit, 60, 200);

    const rows = await all(
      `
      SELECT
        m.id,
        m.room_id,
        m.sender_id,
        m.content,
        m.message_type,
        m.image_url,
        m.file_url,
        m.file_name,
        m.file_size,
        m.forwarded_from_name,
        m.poll_id,
        m.reply_to_message_id,
        m.edited_at,
        m.deleted_at,
        m.created_at,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_admin
      FROM room_messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.room_id = ?
      ${beforeId ? "AND m.id < ?" : ""}
      ORDER BY m.id DESC
      LIMIT ?
      `,
      beforeId ? [roomId, beforeId, limit] : [roomId, limit]
    );

    const orderedRows = rows.reverse();
    const messages = await attachMeta("room", orderedRows, req.user.id);
    await markRoomRead(req.user.id, roomId);
    const pinned = await getPinnedFor("room", roomId, req.user.id);

    res.json({
      pinned,
      hasMore: rows.length === limit,
      messages: messages.map((message) => ({
        id: message.id,
        roomId: message.room_id,
        senderId: message.sender_id,
        content: message.content,
        type: message.message_type,
        imageUrl: message.image_url || "",
        fileUrl: message.file_url || "",
        fileName: message.file_name || "",
        fileSize: message.file_size || null,
        forwardedFromName: message.forwarded_from_name || "",
        poll: message.poll,
        replyToMessageId: message.reply_to_message_id,
        editedAt: message.edited_at,
        deletedAt: message.deleted_at,
        reactions: message.reactions,
        createdAt: message.created_at,
        sender: {
          id: message.sender_id,
          username: message.username,
          displayName: message.display_name,
          avatarUrl: message.avatar_url || "",
          isAdmin: Boolean(message.is_admin),
        },
      })),
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/rooms/:roomId/messages", authMiddleware, messageRateLimit, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    if (!roomId) {
      res.status(400).json({ error: "Invalid room id" });
      return;
    }

    const room = await getRoomForUser(req.user.id, roomId);
    if (!room) {
      res.status(403).json({ error: "Join room first" });
      return;
    }

    const content = normalizeText(req.body.content, 2000);
    const imageUrl = normalizeText(req.body.imageUrl, 500);
    const fileUrl = normalizeText(req.body.fileUrl, 500);
    const fileName = normalizeText(req.body.fileName, 180);
    const fileSize = Number(req.body.fileSize || 0) || null;
    const forwardedFromName = normalizeText(req.body.forwardedFromName, 120);
    const pollInput = req.body.poll || null;
    const replyToMessageId = mustBeValidId(req.body.replyToMessageId);

    let messageType = "text";
    let pollId = null;

    if (pollInput) {
      pollId = await createPollFromInput(req.user.id, pollInput);
      messageType = "poll";
    } else if (imageUrl) {
      if (room.my_can_post_media === 0) {
        res.status(403).json({ error: "You cannot post media in this room" });
        return;
      }
      messageType = "image";
    } else if (fileUrl) {
      if (room.my_can_post_media === 0) {
        res.status(403).json({ error: "You cannot post files in this room" });
        return;
      }
      messageType = "file";
    }

    if (!content && !imageUrl && !fileUrl && !pollId) {
      res.status(400).json({ error: "Empty message" });
      return;
    }

    if (replyToMessageId) {
      const replied = await get(
        "SELECT id FROM room_messages WHERE id = ? AND room_id = ?",
        [replyToMessageId, roomId]
      );
      if (!replied) {
        res.status(400).json({ error: "Reply target not found" });
        return;
      }
    }

    const inserted = await run(
      `
      INSERT INTO room_messages (room_id, sender_id, content, message_type, image_url, file_url, file_name, file_size, poll_id, reply_to_message_id, forwarded_from_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        roomId,
        req.user.id,
        content,
        messageType,
        imageUrl || null,
        fileUrl || null,
        fileName || null,
        fileSize,
        pollId,
        replyToMessageId || null,
        forwardedFromName || null,
      ]
    );

    const row = await get(
      `
      SELECT
        m.id,
        m.room_id,
        m.sender_id,
        m.content,
        m.message_type,
        m.image_url,
        m.file_url,
        m.file_name,
        m.file_size,
        m.forwarded_from_name,
        m.poll_id,
        m.reply_to_message_id,
        m.edited_at,
        m.deleted_at,
        m.created_at,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_admin
      FROM room_messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.id = ?
      `,
      [inserted.id]
    );

    const memberIds = await getRoomMemberIds(roomId);
    for (const memberId of memberIds) {
      const payload = await buildRoomPayload(row, memberId);
      const sockets = socketsByUser.get(memberId);
      if (!sockets) {
        continue;
      }
      for (const socketId of sockets) {
        io.to(socketId).emit("room:message:new", payload);
      }
    }

    for (const memberId of memberIds) {
      if (memberId === req.user.id) {
        continue;
      }
      await sendWebPushToUser(memberId, {
        title: `# ${room.name}`,
        body: content || (fileName ? `Файл: ${fileName}` : imageUrl ? "Изображение" : "Новое сообщение"),
        url: "/",
      });
    }

    const responsePayload = await buildRoomPayload(row, req.user.id);
    res.status(201).json({ message: responsePayload });
  } catch (error) {
    const text = error?.message || "";
    if (text.startsWith("Poll ")) {
      res.status(400).json({ error: text });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

app.patch("/api/rooms/:roomId/messages/:messageId", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    const messageId = mustBeValidId(req.params.messageId);
    if (!roomId || !messageId) {
      res.status(400).json({ error: "Invalid room or message id" });
      return;
    }

    const membership = await getRoomForUser(req.user.id, roomId);
    if (!membership) {
      res.status(403).json({ error: "Join room first" });
      return;
    }

    const row = await get("SELECT * FROM room_messages WHERE id = ? AND room_id = ?", [
      messageId,
      roomId,
    ]);
    if (!row) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const me = await get("SELECT is_admin FROM users WHERE id = ?", [req.user.id]);
    if (row.sender_id !== req.user.id && !me?.is_admin) {
      res.status(403).json({ error: "Cannot edit this message" });
      return;
    }

    if (row.deleted_at) {
      res.status(400).json({ error: "Message is deleted" });
      return;
    }

    const content = normalizeText(req.body.content, 2000);
    if (!content) {
      res.status(400).json({ error: "Content cannot be empty" });
      return;
    }

    await run("UPDATE room_messages SET content = ?, edited_at = datetime('now') WHERE id = ?", [
      content,
      messageId,
    ]);

    const updated = await get(
      `
      SELECT m.*, u.username, u.display_name, u.avatar_url, u.is_admin
      FROM room_messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.id = ?
      `,
      [messageId]
    );
    const memberIds = await getRoomMemberIds(roomId);
    for (const memberId of memberIds) {
      const payload = await buildRoomPayload(updated, memberId);
      const sockets = socketsByUser.get(memberId);
      if (!sockets) {
        continue;
      }
      for (const socketId of sockets) {
        io.to(socketId).emit("room:message:update", payload);
      }
    }

    const responsePayload = await buildRoomPayload(updated, req.user.id);
    res.json({ message: responsePayload });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/rooms/:roomId/messages/:messageId", authMiddleware, async (req, res) => {
  try {
    const roomId = mustBeValidId(req.params.roomId);
    const messageId = mustBeValidId(req.params.messageId);
    if (!roomId || !messageId) {
      res.status(400).json({ error: "Invalid room or message id" });
      return;
    }

    const membership = await getRoomForUser(req.user.id, roomId);
    if (!membership) {
      res.status(403).json({ error: "Join room first" });
      return;
    }

    const row = await get("SELECT * FROM room_messages WHERE id = ? AND room_id = ?", [
      messageId,
      roomId,
    ]);
    if (!row) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const me = await get("SELECT is_admin FROM users WHERE id = ?", [req.user.id]);
    if (row.sender_id !== req.user.id && !me?.is_admin) {
      res.status(403).json({ error: "Cannot delete this message" });
      return;
    }

    await run(
      "UPDATE room_messages SET content = '', message_type = 'text', image_url = NULL, file_url = NULL, file_name = NULL, file_size = NULL, poll_id = NULL, forwarded_from_name = NULL, deleted_at = datetime('now'), edited_at = datetime('now') WHERE id = ?",
      [messageId]
    );
    await run("DELETE FROM message_reactions WHERE scope = 'room' AND message_id = ?", [messageId]);

    const updated = await get(
      `
      SELECT m.*, u.username, u.display_name, u.avatar_url, u.is_admin
      FROM room_messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.id = ?
      `,
      [messageId]
    );
    const memberIds = await getRoomMemberIds(roomId);
    for (const memberId of memberIds) {
      const payload = await buildRoomPayload(updated, memberId);
      const sockets = socketsByUser.get(memberId);
      if (!sockets) {
        continue;
      }
      for (const socketId of sockets) {
        io.to(socketId).emit("room:message:update", payload);
      }
    }

    const responsePayload = await buildRoomPayload(updated, req.user.id);
    res.json({ message: responsePayload });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post(
  "/api/rooms/:roomId/messages/:messageId/reactions",
  authMiddleware,
  async (req, res) => {
    try {
      const roomId = mustBeValidId(req.params.roomId);
      const messageId = mustBeValidId(req.params.messageId);
      const emoji = normalizeEmoji(req.body.emoji);
      if (!roomId || !messageId || !emoji) {
        res.status(400).json({ error: "Invalid reaction" });
        return;
      }

      const membership = await getRoomForUser(req.user.id, roomId);
      if (!membership) {
        res.status(403).json({ error: "Join room first" });
        return;
      }

      const row = await get("SELECT * FROM room_messages WHERE id = ? AND room_id = ?", [
        messageId,
        roomId,
      ]);
      if (!row) {
        res.status(404).json({ error: "Message not found" });
        return;
      }

      const exists = await get(
        "SELECT id FROM message_reactions WHERE scope = 'room' AND message_id = ? AND user_id = ? AND emoji = ?",
        [messageId, req.user.id, emoji]
      );

      if (exists) {
        await run("DELETE FROM message_reactions WHERE id = ?", [exists.id]);
      } else {
        await run(
          "INSERT INTO message_reactions (scope, message_id, user_id, emoji) VALUES ('room', ?, ?, ?)",
          [messageId, req.user.id, emoji]
        );
      }

      const updated = await get(
        `
        SELECT m.*, u.username, u.display_name, u.avatar_url, u.is_admin
        FROM room_messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.id = ?
        `,
        [messageId]
      );
      const memberIds = await getRoomMemberIds(roomId);
      for (const memberId of memberIds) {
        const payload = await buildRoomPayload(updated, memberId);
        const sockets = socketsByUser.get(memberId);
        if (!sockets) {
          continue;
        }
        for (const socketId of sockets) {
          io.to(socketId).emit("room:message:update", payload);
        }
      }

      const responsePayload = await buildRoomPayload(updated, req.user.id);
      res.json({ message: responsePayload });
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

app.post("/api/pins", authMiddleware, async (req, res) => {
  try {
    const scope = req.body.scope === "room" ? "room" : "dm";
    const targetId = mustBeValidId(req.body.targetId);
    const messageId = mustBeValidId(req.body.messageId);
    if (!targetId || !messageId) {
      res.status(400).json({ error: "Invalid target or message id" });
      return;
    }

    if (scope === "dm") {
      const msg = await get(
        `
        SELECT id
        FROM messages
        WHERE id = ?
          AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
        `,
        [messageId, req.user.id, targetId, targetId, req.user.id]
      );
      if (!msg) {
        res.status(404).json({ error: "Message not found in this dialog" });
        return;
      }
    } else {
      const room = await getRoomForUser(req.user.id, targetId);
      if (!room) {
        res.status(403).json({ error: "Join room first" });
        return;
      }

      const msg = await get(
        "SELECT id FROM room_messages WHERE id = ? AND room_id = ?",
        [messageId, targetId]
      );
      if (!msg) {
        res.status(404).json({ error: "Message not found in this room" });
        return;
      }
    }

    await run(
      `
      INSERT INTO pinned_messages (scope, target_id, message_id, pinned_by, pinned_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(scope, target_id)
      DO UPDATE SET message_id = excluded.message_id, pinned_by = excluded.pinned_by, pinned_at = datetime('now')
      `,
      [scope, targetId, messageId, req.user.id]
    );

    io.emit("pins:update", { scope, targetId });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/pins", authMiddleware, async (req, res) => {
  try {
    const scope = req.body.scope === "room" ? "room" : "dm";
    const targetId = mustBeValidId(req.body.targetId);
    if (!targetId) {
      res.status(400).json({ error: "Invalid target id" });
      return;
    }

    if (scope === "room") {
      const room = await getRoomForUser(req.user.id, targetId);
      if (!room) {
        res.status(403).json({ error: "Join room first" });
        return;
      }
    }

    await run("DELETE FROM pinned_messages WHERE scope = ? AND target_id = ?", [scope, targetId]);
    io.emit("pins:update", { scope, targetId });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/search/messages", authMiddleware, searchRateLimit, async (req, res) => {
  try {
    const q = normalizeText(req.query.q, 120);
    const scopeRaw = String(req.query.scope || "dm").toLowerCase();
    const scope = ["dm", "room", "all"].includes(scopeRaw) ? scopeRaw : "dm";
    const include = String(req.query.include || "").toLowerCase();
    const targetId = mustBeValidId(req.query.targetId);
    const limit = parseLimit(req.query.limit, 40, 100);

    if (!q) {
      res.status(400).json({ error: "Query is required" });
      return;
    }

    const qNorm = q.toLocaleLowerCase("ru-RU");

    if (scope === "dm") {
      if (!targetId) {
        res.status(400).json({ error: "targetId is required for dm scope" });
        return;
      }
      const rows = await all(
        `
        SELECT id, sender_id, receiver_id, content, created_at
        FROM messages
        WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
          AND deleted_at IS NULL
        ORDER BY id DESC
        LIMIT 500
        `,
        [req.user.id, targetId, targetId, req.user.id]
      );

      const filtered = rows
        .filter((row) => String(row.content || "").toLocaleLowerCase("ru-RU").includes(qNorm))
        .slice(0, limit);

      res.json({
        results: filtered.map((row) => ({
          id: row.id,
          senderId: row.sender_id,
          content: row.content,
          createdAt: row.created_at,
          scope,
        })),
      });
      return;
    }

    if (scope === "room") {
      if (!targetId) {
        res.status(400).json({ error: "targetId is required for room scope" });
        return;
      }

      const room = await getRoomForUser(req.user.id, targetId);
      if (!room) {
        res.status(403).json({ error: "Join room first" });
        return;
      }

      const rows = await all(
        `
        SELECT id, sender_id, content, created_at
        FROM room_messages
        WHERE room_id = ?
          AND deleted_at IS NULL
        ORDER BY id DESC
        LIMIT 500
        `,
        [targetId]
      );

      const filtered = rows
        .filter((row) => String(row.content || "").toLocaleLowerCase("ru-RU").includes(qNorm))
        .slice(0, limit);

      res.json({
        results: filtered.map((row) => ({
          id: row.id,
          senderId: row.sender_id,
          content: row.content,
          createdAt: row.created_at,
          scope,
        })),
      });
      return;
    }

    const includeDm = include !== "room";
    const includeRoom = include !== "dm";

    let dmResults = [];
    if (includeDm) {
      const dmRows = await all(
        `
        SELECT
          m.id,
          m.sender_id,
          m.receiver_id,
          m.content,
          m.created_at,
          peer.id AS peer_id,
          peer.display_name AS peer_display_name
        FROM messages m
        JOIN users peer
          ON peer.id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END
        WHERE (m.sender_id = ? OR m.receiver_id = ?)
          AND m.deleted_at IS NULL
        ORDER BY m.id DESC
        LIMIT 1200
        `,
        [req.user.id, req.user.id, req.user.id]
      );

      dmResults = dmRows
        .filter((row) => String(row.content || "").toLocaleLowerCase("ru-RU").includes(qNorm))
        .map((row) => ({
          id: row.id,
          senderId: row.sender_id,
          content: row.content,
          createdAt: row.created_at,
          scope: "dm",
          targetId: row.peer_id,
          targetName: row.peer_display_name,
        }));
    }

    let roomResults = [];
    if (includeRoom) {
      const roomRows = await all(
        `
        SELECT
          m.id,
          m.sender_id,
          m.content,
          m.created_at,
          m.room_id,
          r.name AS room_name
        FROM room_messages m
        JOIN chat_rooms r ON r.id = m.room_id
        JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = ?
        WHERE m.deleted_at IS NULL
        ORDER BY m.id DESC
        LIMIT 1200
        `,
        [req.user.id]
      );

      roomResults = roomRows
        .filter((row) => String(row.content || "").toLocaleLowerCase("ru-RU").includes(qNorm))
        .map((row) => ({
          id: row.id,
          senderId: row.sender_id,
          content: row.content,
          createdAt: row.created_at,
          scope: "room",
          targetId: row.room_id,
          targetName: row.room_name,
        }));
    }

    const combined = [...dmResults, ...roomResults]
      .sort((a, b) => asUtcDateNumber(b.createdAt) - asUtcDateNumber(a.createdAt))
      .slice(0, limit);

    res.json({ results: combined });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

function extractLinks(text) {
  const value = String(text || "");
  const matches = value.match(/https?:\/\/[^\s]+/gi) || [];
  return [...new Set(matches)].slice(0, 5);
}

app.get("/api/media/shared", authMiddleware, async (req, res) => {
  try {
    const scope = String(req.query.scope || "dm").toLowerCase();
    const targetId = mustBeValidId(req.query.targetId);
    const limit = parseLimit(req.query.limit, 60, 200);
    if (!targetId || !["dm", "room"].includes(scope)) {
      res.status(400).json({ error: "Invalid scope or target id" });
      return;
    }

    if (scope === "dm") {
      const rows = await all(
        `
        SELECT id, sender_id, receiver_id, content, message_type, image_url, file_url, file_name, file_size, created_at
        FROM messages
        WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
          AND deleted_at IS NULL
        ORDER BY id DESC
        LIMIT ?
        `,
        [req.user.id, targetId, targetId, req.user.id, limit * 4]
      );
      const media = rows.filter((row) => row.message_type === "image").slice(0, limit);
      const files = rows.filter((row) => row.message_type === "file").slice(0, limit);
      const links = rows
        .flatMap((row) => extractLinks(row.content).map((url) => ({ id: row.id, createdAt: row.created_at, url, senderId: row.sender_id })))
        .slice(0, limit);
      res.json({
        media: media.map((row) => ({
          id: row.id,
          type: row.message_type,
          imageUrl: row.image_url || "",
          createdAt: row.created_at,
          senderId: row.sender_id,
        })),
        files: files.map((row) => ({
          id: row.id,
          fileUrl: row.file_url || "",
          fileName: row.file_name || "",
          fileSize: row.file_size || null,
          createdAt: row.created_at,
          senderId: row.sender_id,
        })),
        links,
      });
      return;
    }

    const room = await getRoomForUser(req.user.id, targetId);
    if (!room) {
      res.status(403).json({ error: "Join room first" });
      return;
    }

    const rows = await all(
      `
      SELECT id, room_id, sender_id, content, message_type, image_url, file_url, file_name, file_size, created_at
      FROM room_messages
      WHERE room_id = ?
        AND deleted_at IS NULL
      ORDER BY id DESC
      LIMIT ?
      `,
      [targetId, limit * 4]
    );
    const media = rows.filter((row) => row.message_type === "image").slice(0, limit);
    const files = rows.filter((row) => row.message_type === "file").slice(0, limit);
    const links = rows
      .flatMap((row) => extractLinks(row.content).map((url) => ({ id: row.id, createdAt: row.created_at, url, senderId: row.sender_id })))
      .slice(0, limit);
    res.json({
      media: media.map((row) => ({
        id: row.id,
        type: row.message_type,
        imageUrl: row.image_url || "",
        createdAt: row.created_at,
        senderId: row.sender_id,
      })),
      files: files.map((row) => ({
        id: row.id,
        fileUrl: row.file_url || "",
        fileName: row.file_name || "",
        fileSize: row.file_size || null,
        createdAt: row.created_at,
        senderId: row.sender_id,
      })),
      links,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

function asUtcDateNumber(value) {
  if (!value) {
    return 0;
  }
  const text = String(value);
  const normalized = text.includes("T") || text.endsWith("Z") ? text : `${text.replace(" ", "T")}Z`;
  const ts = new Date(normalized).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

app.post("/api/polls/:pollId/vote", authMiddleware, async (req, res) => {
  try {
    const pollId = mustBeValidId(req.params.pollId);
    if (!pollId) {
      res.status(400).json({ error: "Invalid poll id" });
      return;
    }

    const poll = await get("SELECT * FROM polls WHERE id = ?", [pollId]);
    if (!poll) {
      res.status(404).json({ error: "Poll not found" });
      return;
    }

    if (poll.is_closed) {
      res.status(400).json({ error: "Poll is closed" });
      return;
    }

    const payloadIds = Array.isArray(req.body.optionIds)
      ? req.body.optionIds
      : req.body.optionId
        ? [req.body.optionId]
        : [];
    const optionIds = [...new Set(payloadIds.map((value) => mustBeValidId(value)).filter(Boolean))];
    if (optionIds.length === 0) {
      res.status(400).json({ error: "Choose at least one option" });
      return;
    }

    if (!poll.allow_multiple && optionIds.length > 1) {
      res.status(400).json({ error: "This poll allows only one option" });
      return;
    }

    const options = await all("SELECT id FROM poll_options WHERE poll_id = ?", [pollId]);
    const allowed = new Set(options.map((opt) => opt.id));
    for (const optionId of optionIds) {
      if (!allowed.has(optionId)) {
        res.status(400).json({ error: "Option does not belong to poll" });
        return;
      }
    }

    await run("DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?", [pollId, req.user.id]);
    for (const optionId of optionIds) {
      await run(
        "INSERT OR IGNORE INTO poll_votes (poll_id, option_id, user_id) VALUES (?, ?, ?)",
        [pollId, optionId, req.user.id]
      );
    }

    const updatedPoll = await getPollWithOptions(pollId, req.user.id);
    io.emit("poll:update", updatedPoll);
    res.json({ poll: updatedPoll });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/polls/:pollId/close", authMiddleware, async (req, res) => {
  try {
    const pollId = mustBeValidId(req.params.pollId);
    if (!pollId) {
      res.status(400).json({ error: "Invalid poll id" });
      return;
    }

    const poll = await get("SELECT * FROM polls WHERE id = ?", [pollId]);
    if (!poll) {
      res.status(404).json({ error: "Poll not found" });
      return;
    }

    const me = await get("SELECT id, is_admin FROM users WHERE id = ?", [req.user.id]);
    if (!me?.is_admin && poll.creator_id !== req.user.id) {
      res.status(403).json({ error: "Only creator or admin can close poll" });
      return;
    }

    await run("UPDATE polls SET is_closed = 1 WHERE id = ?", [pollId]);
    const updatedPoll = await getPollWithOptions(pollId, req.user.id);
    io.emit("poll:update", updatedPoll);
    res.json({ poll: updatedPoll });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/admin/overview", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const users = await get("SELECT COUNT(*) AS count FROM users");
    const rooms = await get("SELECT COUNT(*) AS count FROM chat_rooms");
    const dms = await get("SELECT COUNT(*) AS count FROM messages");
    const roomMessages = await get("SELECT COUNT(*) AS count FROM room_messages");
    const polls = await get("SELECT COUNT(*) AS count FROM polls");

    res.json({
      stats: {
        users: Number(users?.count || 0),
        rooms: Number(rooms?.count || 0),
        dmMessages: Number(dms?.count || 0),
        roomMessages: Number(roomMessages?.count || 0),
        polls: Number(polls?.count || 0),
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/admin/users", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const users = await all(
      "SELECT id, username, display_name, avatar_url, is_admin, created_at FROM users ORDER BY created_at ASC"
    );
    res.json({
      users: users.map((user) => ({
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_url || "",
        isAdmin: Boolean(user.is_admin),
        createdAt: user.created_at,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/admin/users", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const username = normalizeText(req.body.username, 24).toLowerCase();
    const password = String(req.body.password || "");
    const displayName = normalizeText(req.body.displayName, 40);
    const isAdmin = Boolean(req.body.isAdmin);

    if (username.length < 3 || username.length > 24) {
      res.status(400).json({ error: "Username must be 3-24 chars" });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 chars" });
      return;
    }

    if (displayName.length < 2 || displayName.length > 40) {
      res.status(400).json({ error: "Display name must be 2-40 chars" });
      return;
    }

    const exists = await get("SELECT id FROM users WHERE username = ?", [username]);
    if (exists) {
      res.status(409).json({ error: "Username already exists" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const inserted = await run(
      "INSERT INTO users (username, password_hash, display_name, is_admin) VALUES (?, ?, ?, ?)",
      [username, passwordHash, displayName, isAdmin ? 1 : 0]
    );

    await joinUserToPublicRooms(inserted.id);

    const user = await get(
      "SELECT id, username, display_name, avatar_url, is_admin, created_at FROM users WHERE id = ?",
      [inserted.id]
    );
    io.emit("users:update");
    res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_url || "",
        isAdmin: Boolean(user.is_admin),
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.patch("/api/admin/users/:userId", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const userId = mustBeValidId(req.params.userId);
    if (!userId) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    if (userId === req.user.id) {
      res.status(400).json({ error: "You cannot change your own admin role" });
      return;
    }

    const isAdmin = Boolean(req.body.isAdmin);
    const user = await get("SELECT id FROM users WHERE id = ?", [userId]);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    await run("UPDATE users SET is_admin = ? WHERE id = ?", [isAdmin ? 1 : 0, userId]);
    io.emit("users:update");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.patch("/api/admin/users/:userId/password", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const userId = mustBeValidId(req.params.userId);
    if (!userId) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    if (userId === req.user.id) {
      res.status(400).json({ error: "Use profile settings to change your own password" });
      return;
    }

    const newPassword = String(req.body.newPassword || "");
    if (newPassword.length < 6) {
      res.status(400).json({ error: "New password must be at least 6 chars" });
      return;
    }

    const user = await get("SELECT id FROM users WHERE id = ?", [userId]);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await run("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, userId]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/admin/users/:userId", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const userId = mustBeValidId(req.params.userId);
    if (!userId) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    if (userId === req.user.id) {
      res.status(400).json({ error: "You cannot delete your own account" });
      return;
    }

    const user = await get("SELECT id, username, display_name FROM users WHERE id = ?", [userId]);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const ownedRooms = await all("SELECT id FROM chat_rooms WHERE created_by = ?", [userId]);
    for (const room of ownedRooms) {
      await deleteRoomCascade(room.id, req.user.id);
    }

    const dmRows = await all(
      "SELECT id, poll_id FROM messages WHERE sender_id = ? OR receiver_id = ?",
      [userId, userId]
    );
    const dmMessageIds = dmRows.map((item) => item.id);
    const dmPollIds = [...new Set(dmRows.map((item) => item.poll_id).filter(Boolean))];

    const ownRoomRows = await all("SELECT id, poll_id FROM room_messages WHERE sender_id = ?", [userId]);
    const ownRoomMessageIds = ownRoomRows.map((item) => item.id);
    const ownRoomPollIds = [...new Set(ownRoomRows.map((item) => item.poll_id).filter(Boolean))];

    const allPollIds = [...new Set([...dmPollIds, ...ownRoomPollIds])];

    if (dmMessageIds.length) {
      const placeholders = dmMessageIds.map(() => "?").join(", ");
      await run(`DELETE FROM message_reactions WHERE scope = 'dm' AND message_id IN (${placeholders})`, dmMessageIds);
    }
    if (ownRoomMessageIds.length) {
      const placeholders = ownRoomMessageIds.map(() => "?").join(", ");
      await run(
        `DELETE FROM message_reactions WHERE scope = 'room' AND message_id IN (${placeholders})`,
        ownRoomMessageIds
      );
    }
    if (allPollIds.length) {
      const placeholders = allPollIds.map(() => "?").join(", ");
      await run(`DELETE FROM poll_votes WHERE poll_id IN (${placeholders}) OR user_id = ?`, [...allPollIds, userId]);
      await run(`DELETE FROM poll_options WHERE poll_id IN (${placeholders})`, allPollIds);
      await run(`DELETE FROM polls WHERE id IN (${placeholders})`, allPollIds);
    } else {
      await run("DELETE FROM poll_votes WHERE user_id = ?", [userId]);
    }

    await run("DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?", [userId, userId]);
    await run("DELETE FROM room_messages WHERE sender_id = ?", [userId]);
    await run("DELETE FROM room_members WHERE user_id = ?", [userId]);
    await run("DELETE FROM room_invitations WHERE user_id = ? OR invited_by = ?", [userId, userId]);
    await run("DELETE FROM dm_reads WHERE user_id = ? OR peer_id = ?", [userId, userId]);
    await run("DELETE FROM room_reads WHERE user_id = ?", [userId]);
    await run("DELETE FROM pinned_messages WHERE pinned_by = ?", [userId]);
    await run("DELETE FROM user_chat_prefs WHERE user_id = ?", [userId]);
    await run("DELETE FROM push_subscriptions WHERE user_id = ?", [userId]);
    await run("DELETE FROM user_sessions WHERE user_id = ?", [userId]);
    await run("DELETE FROM room_audit_log WHERE actor_user_id = ? OR target_user_id = ?", [userId, userId]);
    await run("DELETE FROM users WHERE id = ?", [userId]);

    io.emit("users:update");
    io.emit("rooms:update");
    res.json({ ok: true, deletedUserId: userId });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.use((err, req, res, next) => {
  if (!err) {
    next();
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "File too large" });
      return;
    }
    res.status(400).json({ error: err.message || "Upload failed" });
    return;
  }

  if (err.message === "Only image files are allowed") {
    res.status(400).json({ error: err.message });
    return;
  }

  res.status(500).json({ error: "Internal server error" });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

async function start() {
  try {
    if (NODE_ENV === "production" && USING_DEFAULT_JWT_SECRET) {
      throw new Error("JWT_SECRET is not set for production");
    }

    await initDb();
    server.listen(PORT, HOST, () => {
      const protocol = server instanceof https.Server ? "https" : "http";
      console.log(`Messenger started at ${protocol}://${HOST}:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
}

start();
