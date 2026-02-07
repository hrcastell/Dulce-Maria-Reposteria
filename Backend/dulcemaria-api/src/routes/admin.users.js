const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");

const { getPool } = require("../db");
const { hashPassword } = require("../utils/password");
const { requireRole } = require("../middleware/auth");

const router = express.Router();

// Solo SUPERADMIN puede crear usuarios
router.post("/", requireRole("SUPERADMIN"), async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    fullName: z.string().min(1).optional(),
    role: z.enum(["ADMIN", "STAFF"]).default("STAFF"), // no permitimos crear SUPERADMIN por API
    isActive: z.boolean().default(true),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { email, password, fullName, role, isActive } = parsed.data;

  try {
    const pool = getPool();

    const exists = await pool.query("SELECT 1 FROM users WHERE email=$1 LIMIT 1", [email.toLowerCase()]);
    if (exists.rowCount > 0) return res.status(409).json({ ok: false, error: "Ese email ya existe" });

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);

    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
      [id, email.toLowerCase(), passwordHash, fullName ?? null, role, isActive]
    );

    return res.json({ ok: true, user: { id, email: email.toLowerCase(), role, isActive } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Listar usuarios (SUPERADMIN/ADMIN)
router.get("/", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, email, full_name, role, is_active, created_at
       FROM users
       ORDER BY created_at DESC`
    );
    return res.json({ ok: true, items: r.rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;