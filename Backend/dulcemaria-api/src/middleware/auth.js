const jwt = require("jsonwebtoken");
const { getPool } = require("../db");
const { isPlatformOwner } = require("../lib/platformOwner");
const { isProductionMode } = require("../config/runtime");
const { buildSessionCookie } = require("../lib/sessionCookie");
const { getOriginPolicy, normalizeOrigin } = require("../lib/originPolicy");
const { logServerError } = require("../lib/httpErrors");
const { hasPermission } = require("../lib/permissions");

const JWT_ISSUER = "dulcemaria-api";
const JWT_AUDIENCE = "dulcemaria-admin";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** Cookie de sesión vigente para este proceso (__Host-dm_session en producción). */
function sessionCookie() {
  return buildSessionCookie({ production: isProductionMode() });
}

/**
 * Usuario de la sesión. Si la migración aún no agregó
 * users.permissions_configured_at (arranque en modo tolerante con un fallo
 * pasajero), se lee sin esa columna: valen los permisos del rol y el panel
 * sigue funcionando en vez de responder 503 a todos.
 */
async function loadSessionUser(userId) {
  const pool = getPool();
  try {
    return await pool.query(
      `SELECT id, email, role, is_active, session_version, permissions, permissions_configured_at
       FROM users WHERE id=$1 LIMIT 1`,
      [userId]
    );
  } catch (e) {
    if (e?.code !== "42703") throw e;
    return pool.query(
      `SELECT id, email, role, is_active, session_version, permissions FROM users WHERE id=$1 LIMIT 1`,
      [userId]
    );
  }
}

/**
 * Autenticación por cookie HttpOnly (único mecanismo: el encabezado
 * Authorization: Bearer ya no se acepta). Además de verificar la firma, relee
 * el usuario en cada request: debe existir, estar activo y su session_version
 * debe coincidir con el claim `sv` del token (revocación inmediata).
 */
async function requireAuth(req, res, next) {
  const token = readCookie(req, sessionCookie().name);
  if (!token) return res.status(401).json({ ok: false, error: "Autenticación requerida." });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  } catch {
    return res.status(401).json({ ok: false, error: "Sesión inválida o expirada." });
  }
  if (typeof payload.sub !== "string" || !UUID_PATTERN.test(payload.sub) || !Number.isInteger(payload.sv)) {
    return res.status(401).json({ ok: false, error: "Sesión inválida o expirada." });
  }

  try {
    const result = await loadSessionUser(payload.sub);
    const user = result.rows[0];
    if (!user || !user.is_active || Number(user.session_version) !== payload.sv) {
      return res.status(401).json({ ok: false, error: "Sesión inválida o expirada." });
    }
    req.user = {
      sub: user.id,
      email: user.email,
      role: user.role,
      sv: Number(user.session_version),
      // Matriz guardada (ver lib/permissions.js): la evalúa requirePermission.
      permissions: user.permissions,
      permissions_configured_at: user.permissions_configured_at,
    };
    return next();
  } catch (e) {
    // Una falla de la BD no es una sesión inválida: no forzar el cierre de sesión del panel.
    logServerError("requireAuth", e);
    return res.status(503).json({ ok: false, error: "Servicio temporalmente no disponible." });
  }
}

/** Orígenes del panel: los únicos aceptados en mutaciones autenticadas con cookie. */
function getTrustedOrigins() {
  return getOriginPolicy().admin;
}

/**
 * CSRF: toda mutación (cualquier método salvo GET/HEAD/OPTIONS) debe venir
 * con un Origin del panel. Sin Origin o con "null" se rechaza.
 */
function requireTrustedOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = normalizeOrigin(req.get("origin"));
  if (!origin || !getTrustedOrigins().has(origin)) {
    return res.status(403).json({ ok: false, error: "Origen de la solicitud no permitido." });
  }
  return next();
}

function requireRole(...allowed) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role || !allowed.includes(role)) {
      return res.status(403).json({ ok: false, error: "No tienes permisos para esta acción." });
    }
    next();
  };
}

/**
 * Matriz de permisos del usuario (users.permissions) para productos, clientes
 * y órdenes: SUPERADMIN pasa siempre, el rol es el techo y una bandera
 * ausente vale lo que el rol puede hacer hoy (reglas en lib/permissions.js).
 * Va DESPUÉS de requireRole en cada ruta.
 */
function requirePermission(resource, action) {
  return (req, res, next) => {
    if (!hasPermission(req.user, resource, action)) {
      return res.status(403).json({ ok: false, error: "No tienes permisos para esta acción.", code: "PERMISSION_DENIED" });
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
    return res.status(403).json({ ok: false, error: "No tienes permisos para esta acción." });
  }
  next();
}

module.exports = {
  JWT_ISSUER,
  JWT_AUDIENCE,
  sessionCookie,
  requireAuth,
  requireRole,
  requirePermission,
  requirePlatformOwner,
  requireTrustedOrigin,
};
