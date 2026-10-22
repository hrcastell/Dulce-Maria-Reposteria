const express = require("express");
const jwt = require("jsonwebtoken");
const { z } = require("zod");

const { getPool } = require("../db");
const { verifyPassword, hashPassword, needsRehash } = require("../utils/password");
const { loginLimiter, loginAccountLimiter, bootstrapLimiter } = require("../middleware/rate-limit");
const {
  JWT_ISSUER,
  JWT_AUDIENCE,
  sessionCookie,
  requireAuth,
  requireTrustedOrigin,
} = require("../middleware/auth");
const { isPlatformOwner } = require("../lib/platformOwner");
const { validationError, sendError, logServerError } = require("../lib/httpErrors");
const { resolveEffectivePermissions } = require("../lib/permissions");

const crypto = require("crypto");
const DUMMY_PASSWORD_HASH = require("bcryptjs").hashSync(
  crypto.randomBytes(32).toString("hex"),
  12
);
const INVALID_CREDENTIALS = "Credenciales inválidas.";

function requireBootstrapToken(req, res) {
  if (process.env.ENABLE_BOOTSTRAP !== "true") {
    return { ok: false, status: 404, error: "No encontrado." };
  }
  const token = req.get("x-bootstrap-token") || "";
  const expected = process.env.BOOTSTRAP_TOKEN || "";
  if (!expected) return { ok: false, status: 503, error: "Bootstrap no disponible: falta BOOTSTRAP_TOKEN." };
  if (!token) return { ok: false, status: 401, error: "Falta el encabezado x-bootstrap-token." };

  const a = Buffer.from(String(token));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, status: 403, error: "Token inválido." };
  }
  return { ok: true };
}

/**
 * JWT mínimo: solo `sub` (id del usuario) y `sv` (users.session_version).
 * Email y rol se releen de la BD en cada request; no viajan en el token.
 */
function signSession(user) {
  return jwt.sign(
    { sub: user.id, sv: Number(user.session_version) || 0 },
    process.env.JWT_SECRET,
    {
      algorithm: "HS256",
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: "8h",
      jwtid: crypto.randomUUID(),
    }
  );
}

function setSessionCookie(res, token) {
  const { name, options } = sessionCookie();
  res.cookie(name, token, options);
}

function clearSessionCookies(res) {
  for (const { name, options } of sessionCookie().clearCookies) res.clearCookie(name, options);
}

const router = express.Router();

router.post("/login", loginLimiter, loginAccountLimiter, async (req, res) => {
  const schema = z.object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(200),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  const email = parsed.data.email.toLowerCase();
  const { password } = parsed.data;

  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, email, password_hash, role, is_active, session_version
       FROM users
       WHERE email=$1
       LIMIT 1`,
      [email]
    );

    if (r.rowCount === 0) {
      // Mismo costo que una verificación real: no revela si el email existe.
      await verifyPassword(password, DUMMY_PASSWORD_HASH);
      return res.status(401).json({ ok: false, error: INVALID_CREDENTIALS });
    }

    const user = r.rows[0];
    // La contraseña se verifica SIEMPRE antes de mirar is_active: una cuenta
    // inactiva responde exactamente igual que una contraseña incorrecta.
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok || !user.is_active) return res.status(401).json({ ok: false, error: INVALID_CREDENTIALS });

    // Re-hash transparente de hashes heredados (PBKDF2 o bcrypt con costo < 12).
    // No cambia session_version: las sesiones abiertas siguen válidas.
    if (needsRehash(user.password_hash)) {
      try {
        const upgraded = await hashPassword(password);
        await pool.query(
          `UPDATE users SET password_hash=$1 WHERE id=$2 AND password_hash=$3`,
          [upgraded, user.id, user.password_hash]
        );
      } catch (e) {
        logServerError("login: re-hash de contraseña", e);
      }
    }

    setSessionCookie(res, signSession(user));

    return res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        is_platform_owner: isPlatformOwner(user.email),
      },
    });
  } catch (e) {
    return sendError(res, e, { context: "POST /auth/login" });
  }
});

/**
 * Cierra la sesión de este navegador. No exige un token válido: una cookie
 * vencida o manipulada también se borra (antes respondía 401 y la dejaba).
 */
router.post("/logout", requireTrustedOrigin, (req, res) => {
  clearSessionCookies(res);
  return res.json({ ok: true });
});

/**
 * Cierra TODAS las sesiones del usuario actual (todos los dispositivos):
 * incrementa session_version, lo que invalida cualquier token emitido antes.
 */
router.post("/logout-all", requireAuth, requireTrustedOrigin, async (req, res) => {
  try {
    await getPool().query(
      `UPDATE users SET session_version = session_version + 1, updated_at = NOW() WHERE id = $1`,
      [req.user.sub]
    );
    clearSessionCookies(res);
    return res.json({ ok: true });
  } catch (e) {
    return sendError(res, e, { context: "POST /auth/logout-all" });
  }
});

// Obtener información del usuario actual
router.get("/me", requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, email, full_name, role, is_active, created_at
       FROM users
       WHERE id=$1
       LIMIT 1`,
      [req.user.sub]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Usuario no encontrado" });
    }

    const user = r.rows[0];
    return res.json({
      ok: true,
      user: {
        ...user,
        // Matriz EFECTIVA (la que aplica el servidor), ver lib/permissions.js.
        permissions: resolveEffectivePermissions(req.user),
        is_platform_owner: isPlatformOwner(user.email),
      },
    });
  } catch (e) {
    return sendError(res, e, { context: "GET /auth/me" });
  }
});

/**
 * Bootstrap HTTP: SOLO desarrollo (validateEnv prohíbe ENABLE_BOOTSTRAP en
 * producción). En producción el primer SUPERADMIN y las recuperaciones se
 * hacen con `npm run admin:create-superadmin` / `npm run admin:reset-password`.
 */
router.post("/bootstrap", bootstrapLimiter, async (req, res) => {
  const auth = requireBootstrapToken(req, res);
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

  const email = (process.env.ADMIN_EMAIL || "").toLowerCase();
  const pass = process.env.ADMIN_PASSWORD || "";

  if (!email || !pass) {
    return res.status(400).json({ ok: false, error: "Faltan ADMIN_EMAIL o ADMIN_PASSWORD en el entorno." });
  }

  try {
    const pool = getPool();
    const passwordHash = await hashPassword(pass);

    // Upsert SUPERADMIN
    const existing = await pool.query("SELECT id FROM users WHERE email=$1 LIMIT 1", [email]);
    let id;

    if (existing.rowCount > 0) {
      id = existing.rows[0].id;
      // Reescribir la contraseña cierra las sesiones previas de esa cuenta.
      await pool.query(
        `UPDATE users
         SET password_hash=$1, role='SUPERADMIN', is_active=true,
             session_version = session_version + 1, updated_at=NOW()
         WHERE id=$2`,
        [passwordHash, id]
      );
    } else {
      id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'SUPERADMIN',true,NOW(),NOW())`,
        [id, email, passwordHash, "Dulce María - Superadmin"]
      );
    }

    return res.json({
      ok: true,
      message: "SUPERADMIN listo. Desactiva ENABLE_BOOTSTRAP y elimina ADMIN_PASSWORD/BOOTSTRAP_TOKEN del entorno.",
    });
  } catch (e) {
    return sendError(res, e, { context: "POST /auth/bootstrap" });
  }
});


module.exports = router;
