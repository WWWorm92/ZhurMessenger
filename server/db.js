const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, "..", "messenger.db");
const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }

      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows);
    });
  });
}

async function tableColumns(tableName) {
  return all(`PRAGMA table_info(${tableName})`);
}

async function ensureColumn(tableName, columnName, definition) {
  const columns = await tableColumns(tableName);
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    await run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_url TEXT DEFAULT '',
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await ensureColumn("users", "avatar_url", "TEXT DEFAULT ''");
  await ensureColumn("users", "is_admin", "INTEGER NOT NULL DEFAULT 0");

  await run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'text',
      image_url TEXT DEFAULT NULL,
      poll_id INTEGER DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(sender_id) REFERENCES users(id),
      FOREIGN KEY(receiver_id) REFERENCES users(id)
    )
  `);

  await ensureColumn("messages", "message_type", "TEXT NOT NULL DEFAULT 'text'");
  await ensureColumn("messages", "image_url", "TEXT DEFAULT NULL");
  await ensureColumn("messages", "poll_id", "INTEGER DEFAULT NULL");
  await ensureColumn("messages", "reply_to_message_id", "INTEGER DEFAULT NULL");
  await ensureColumn("messages", "edited_at", "TEXT DEFAULT NULL");
  await ensureColumn("messages", "deleted_at", "TEXT DEFAULT NULL");

  await run(`
    CREATE INDEX IF NOT EXISTS idx_messages_dialog
    ON messages(sender_id, receiver_id, created_at)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS chat_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      access_type TEXT NOT NULL DEFAULT 'public',
      invite_code TEXT UNIQUE,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(created_by) REFERENCES users(id)
    )
  `);

  await ensureColumn("chat_rooms", "access_type", "TEXT NOT NULL DEFAULT 'public'");
  await ensureColumn("chat_rooms", "invite_code", "TEXT");
  await ensureColumn("chat_rooms", "avatar_url", "TEXT DEFAULT ''");
  await ensureColumn("chat_rooms", "description", "TEXT DEFAULT ''");
  await ensureColumn("chat_rooms", "slug", "TEXT");
  await ensureColumn("chat_rooms", "who_can_post", "TEXT NOT NULL DEFAULT 'members'");
  await ensureColumn("chat_rooms", "who_can_invite", "TEXT NOT NULL DEFAULT 'admins'");
  await run("UPDATE chat_rooms SET who_can_post = 'members' WHERE who_can_post IS NULL OR who_can_post = ''");
  await run("UPDATE chat_rooms SET who_can_invite = 'admins' WHERE who_can_invite IS NULL OR who_can_invite = ''");

  const roomColumns = await tableColumns("chat_rooms");
  if (roomColumns.some((column) => column.name === "is_public")) {
    await run(
      "UPDATE chat_rooms SET access_type = CASE WHEN is_public = 1 THEN 'public' ELSE 'private' END WHERE access_type IS NULL OR access_type = ''"
    );
  }

  await run("UPDATE chat_rooms SET access_type = 'private' WHERE access_type = 'invite'");
  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_rooms_slug
    ON chat_rooms(slug)
    WHERE slug IS NOT NULL AND slug != ''
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS room_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT DEFAULT (datetime('now')),
      UNIQUE(room_id, user_id),
      FOREIGN KEY(room_id) REFERENCES chat_rooms(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await ensureColumn("room_members", "role", "TEXT NOT NULL DEFAULT 'member'");
  await run("UPDATE room_members SET role = 'member' WHERE role IS NULL OR role = ''");
  await run(
    "INSERT OR IGNORE INTO room_members (room_id, user_id, role) SELECT id, created_by, 'owner' FROM chat_rooms WHERE created_by IS NOT NULL"
  );
  await run(
    "UPDATE room_members SET role = 'owner' WHERE EXISTS (SELECT 1 FROM chat_rooms r WHERE r.id = room_members.room_id AND r.created_by = room_members.user_id)"
  );

  await run(`
    CREATE TABLE IF NOT EXISTS room_invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      invited_by INTEGER DEFAULT NULL,
      accepted_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(room_id, user_id),
      FOREIGN KEY(room_id) REFERENCES chat_rooms(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await ensureColumn("room_invitations", "invited_by", "INTEGER DEFAULT NULL");
  await ensureColumn("room_invitations", "accepted_at", "TEXT DEFAULT NULL");

  await run(`
    CREATE TABLE IF NOT EXISTS room_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'text',
      image_url TEXT DEFAULT NULL,
      poll_id INTEGER DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(room_id) REFERENCES chat_rooms(id),
      FOREIGN KEY(sender_id) REFERENCES users(id)
    )
  `);

  await ensureColumn(
    "room_messages",
    "message_type",
    "TEXT NOT NULL DEFAULT 'text'"
  );
  await ensureColumn("room_messages", "image_url", "TEXT DEFAULT NULL");
  await ensureColumn("room_messages", "poll_id", "INTEGER DEFAULT NULL");
  await ensureColumn("room_messages", "reply_to_message_id", "INTEGER DEFAULT NULL");
  await ensureColumn("room_messages", "edited_at", "TEXT DEFAULT NULL");
  await ensureColumn("room_messages", "deleted_at", "TEXT DEFAULT NULL");

  await run(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(scope, message_id, user_id, emoji),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_message_reactions_scope_message
    ON message_reactions(scope, message_id)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS polls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      creator_id INTEGER NOT NULL,
      is_closed INTEGER NOT NULL DEFAULT 0,
      allow_multiple INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(creator_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS poll_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      FOREIGN KEY(poll_id) REFERENCES polls(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS poll_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER NOT NULL,
      option_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(poll_id, option_id, user_id),
      FOREIGN KEY(poll_id) REFERENCES polls(id),
      FOREIGN KEY(option_id) REFERENCES poll_options(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_polls_creator
    ON polls(creator_id, created_at)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_poll_options_poll
    ON poll_options(poll_id)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_poll_votes_poll_user
    ON poll_votes(poll_id, user_id)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_room_members_room_user
    ON room_members(room_id, user_id)
  `);

  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_rooms_invite_code
    ON chat_rooms(invite_code)
    WHERE invite_code IS NOT NULL
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_room_messages_room_created
    ON room_messages(room_id, created_at)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS dm_reads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      peer_id INTEGER NOT NULL,
      last_read_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, peer_id),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(peer_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS room_reads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL,
      last_read_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, room_id),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(room_id) REFERENCES chat_rooms(id)
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_dm_reads_user_peer
    ON dm_reads(user_id, peer_id)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_room_reads_user_room
    ON room_reads(user_id, room_id)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS pinned_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      pinned_by INTEGER NOT NULL,
      pinned_at TEXT DEFAULT (datetime('now')),
      UNIQUE(scope, target_id),
      FOREIGN KEY(pinned_by) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_pinned_scope_target
    ON pinned_messages(scope, target_id)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS user_chat_prefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      scope TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      muted INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, scope, target_id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await ensureColumn("user_chat_prefs", "pinned", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("user_chat_prefs", "muted", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("user_chat_prefs", "archived", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("user_chat_prefs", "updated_at", "TEXT DEFAULT (datetime('now'))");

  await run(`
    CREATE INDEX IF NOT EXISTS idx_user_chat_prefs_user_scope
    ON user_chat_prefs(user_id, scope, archived, pinned, updated_at)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT,
      auth TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, endpoint),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await ensureColumn("push_subscriptions", "p256dh", "TEXT");
  await ensureColumn("push_subscriptions", "auth", "TEXT");
  await ensureColumn("push_subscriptions", "user_agent", "TEXT");
  await ensureColumn("push_subscriptions", "created_at", "TEXT DEFAULT (datetime('now'))");

  await run(`
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
    ON push_subscriptions(user_id, created_at)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      user_agent TEXT,
      ip TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now')),
      revoked_at TEXT DEFAULT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await ensureColumn("user_sessions", "user_agent", "TEXT");
  await ensureColumn("user_sessions", "ip", "TEXT");
  await ensureColumn("user_sessions", "created_at", "TEXT DEFAULT (datetime('now'))");
  await ensureColumn("user_sessions", "last_seen_at", "TEXT DEFAULT (datetime('now'))");
  await ensureColumn("user_sessions", "revoked_at", "TEXT DEFAULT NULL");
  await ensureColumn("user_sessions", "refresh_token_hash", "TEXT DEFAULT NULL");
  await ensureColumn("user_sessions", "refresh_expires_at", "TEXT DEFAULT NULL");

  await run(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
    ON user_sessions(user_id, revoked_at, last_seen_at)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS room_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      actor_user_id INTEGER NOT NULL,
      target_user_id INTEGER DEFAULT NULL,
      action TEXT NOT NULL,
      payload TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(room_id) REFERENCES chat_rooms(id),
      FOREIGN KEY(actor_user_id) REFERENCES users(id),
      FOREIGN KEY(target_user_id) REFERENCES users(id)
    )
  `);

  await ensureColumn("room_audit_log", "target_user_id", "INTEGER DEFAULT NULL");
  await ensureColumn("room_audit_log", "action", "TEXT NOT NULL DEFAULT 'unknown'");
  await ensureColumn("room_audit_log", "payload", "TEXT DEFAULT NULL");
  await ensureColumn("room_audit_log", "created_at", "TEXT DEFAULT (datetime('now'))");

  await run(`
    CREATE INDEX IF NOT EXISTS idx_room_audit_room_created
    ON room_audit_log(room_id, created_at)
  `);

  const defaultRoom = await get("SELECT id FROM chat_rooms WHERE name = ?", [
    "General",
  ]);
  if (!defaultRoom) {
    await run(
      "INSERT INTO chat_rooms (name, access_type) VALUES (?, 'public')",
      ["General"]
    );
  }
}

module.exports = {
  db,
  run,
  get,
  all,
  initDb,
};
