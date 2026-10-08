const jwt = require("jsonwebtoken");
const { getPool } = require("../db");
const { isPlatformOwner } = require("../lib/platformOwner");

const AUTH_COOKIE = "dm_session";
const JWT_ISSUER = "dulcemaria-api";
const JWT_AUDIENCE = "dulcemaria-admin";

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1));
    } catch {
      return null;
    }
  }
  return null;
}

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const bearerToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const token = bearerToken || readCookie(req, AUTH_COOKIE);

  if (!token) return res.status(401).json({ ok: false, error: "Authentication required" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    const result = await getPool().query(
      `SELECT id, email, role, is_active FROM users WHERE id=$1 LIMIT 1`,
      [payload.sub]
    );
    if (result.rowCount === 0 || !result.rows[0].is_active) {
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }
    const user = result.rows[0];
    req.user = { sub: user.id, email: user.email, role: user.role };
    req.authSource = bearerToken ? "bearer" : "cookie";
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
}

function getTrustedOrigins() {
  const configured = (process.env.FRONTEND_URL || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([
    "https://admin.dulcemaria.hrcastell.com",
    ...(process.env.NODE_ENV === "production" ? [] : ["http://localhost:3000"]),
    ...configured,
  ]);
}

function requireTrustedOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || req.authSource === "bearer") {
    return next();
  }
  const origin = req.get("origin");
  if (!origin || !getTrustedOrigins().has(origin)) {
    return res.status(403).json({ ok: false, error: "Untrusted request origin" });
  }
  return next();
}

function requireRole(...allowed) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role || !allowed.includes(role)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    next();
  };
}

/**
 * Protege las rutas del Motor de Tarifa (/admin/platform-fees/*).
 * Compara SOLO req.user.email contra PLATFORM_OWNER_EMAIL — nunca cae de
 * vuelta a un chequeo de rol. El dueño de la panadería jamás debe ver esto,
 * aunque su rol sea SUPERADMIN en su propia instancia.
 * Debe montarse DESPUÉS de requireAuth (necesita req.user ya poblado).
 */
function requirePlatformOwner(req, res, next) {
  if (!isPlatformOwner(req.user?.email)) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }
  next();
}

module.exports = {
  AUTH_COOKIE,
  JWT_ISSUER,
  JWT_AUDIENCE,
  requireAuth,
  requireRole,
  requirePlatformOwner,
  requireTrustedOrigin,
};
