const jwt = require("jsonwebtoken");
const { isPlatformOwner } = require("../lib/platformOwner");

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { sub, email, role }
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
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

module.exports = { requireAuth, requireRole, requirePlatformOwner };