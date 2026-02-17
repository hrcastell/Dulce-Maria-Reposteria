const express = require("express");
const jwt = require("jsonwebtoken");
const { z } = require("zod");

const { getPool } = require("../db");
const { verifyPassword } = require("../utils/password");
const { loginLimiter, bootstrapLimiter } = require("../middleware/rate-limit");

const crypto = require("crypto");
const { hashPassword } = require("../utils/password");

function requireBootstrapToken(req, res) {
  const token = req.query.token || "";
  const expected = process.env.BOOTSTRAP_TOKEN || "";
  if (!expected) return { ok: false, status: 500, error: "BOOTSTRAP_TOKEN no está configurado en cPanel." };
  if (!token) return { ok: false, status: 401, error: "Falta token (?token=...)." };

  const a = Buffer.from(String(token));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, status: 403, error: "Token inválido." };
  }
  return { ok: true };
}


const router = express.Router();

router.post("/login", loginLimiter, async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { email, password } = parsed.data;

  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, email, password_hash, role, is_active
       FROM users
       WHERE email=$1
       LIMIT 1`,
      [email.toLowerCase()]
    );

    if (r.rowCount === 0) return res.status(401).json({ ok: false, error: "Credenciales inválidas" });

    const user = r.rows[0];
    if (!user.is_active) return res.status(403).json({ ok: false, error: "Usuario inactivo" });

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: "Credenciales inválidas" });

    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({ ok: true, token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.post("/bootstrap", bootstrapLimiter, async (req, res) => {
  const auth = requireBootstrapToken(req, res);
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

  const email = (process.env.ADMIN_EMAIL || "").toLowerCase();
  const pass = process.env.ADMIN_PASSWORD || "";

  if (!email || !pass) {
    return res.status(500).json({ ok: false, error: "Faltan ADMIN_EMAIL o ADMIN_PASSWORD en cPanel." });
  }

  try {
    const pool = getPool();
    const passwordHash = await hashPassword(pass);

    // Upsert SUPERADMIN
    const existing = await pool.query("SELECT id FROM users WHERE email=$1 LIMIT 1", [email]);
    let id;

    if (existing.rowCount > 0) {
      id = existing.rows[0].id;
      await pool.query(
        `UPDATE users
         SET password_hash=$1, role='SUPERADMIN', is_active=true, updated_at=NOW()
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

    const token = jwt.sign({ sub: id, email, role: "SUPERADMIN" }, process.env.JWT_SECRET, { expiresIn: "7d" });
    return res.json({ ok: true, message: "SUPERADMIN listo.", token, user: { id, email, role: "SUPERADMIN" } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});


module.exports = router;