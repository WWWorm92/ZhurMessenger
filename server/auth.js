const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { get } = require("./db");

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const USING_DEFAULT_JWT_SECRET = JWT_SECRET === "dev_secret_change_me";
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || "15m";

function createSessionId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString("hex");
}

function signToken(user, { sessionId = null } = {}) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      isAdmin: Boolean(user.is_admin),
      sid: sessionId || undefined,
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    res.status(401).json({ error: "No token provided" });
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
        res.status(401).json({ error: "Session expired" });
        return;
      }
    }
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid token" });
  }
}

module.exports = {
  signToken,
  createSessionId,
  verifyToken,
  authMiddleware,
  ACCESS_TOKEN_TTL,
  USING_DEFAULT_JWT_SECRET,
};
