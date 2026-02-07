const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");

const { getPool } = require("../db");
const { requireRole } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /admin/customers?q=...
 * Lista/busca clientes (máx 50)
 */
router.get("/", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const q = String(req.query.q || "").trim();

  try {
    const pool = getPool();

    if (!q) {
      const r = await pool.query(
        `SELECT id, email, full_name, phone, address, notes, created_at, updated_at
         FROM customers
         ORDER BY created_at DESC
         LIMIT 50`
      );
      return res.json({ ok: true, items: r.rows });
    }

    const r = await pool.query(
      `SELECT id, email, full_name, phone, address, notes, created_at, updated_at
       FROM customers
       WHERE (email ILIKE $1 OR full_name ILIKE $1 OR phone ILIKE $1)
       ORDER BY created_at DESC
       LIMIT 50`,
      [`%${q}%`]
    );

    return res.json({ ok: true, items: r.rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * POST /admin/customers
 * Crea cliente
 */
router.post("/", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const schema = z.object({
    email: z.string().email().optional().nullable(),
    fullName: z.string().min(2),
    phone: z.string().min(6).optional().nullable(),
    address: z.string().min(3).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const d = parsed.data;

  try {
    const pool = getPool();

    if (d.email) {
      const ex = await pool.query("SELECT 1 FROM customers WHERE email=$1 LIMIT 1", [String(d.email).toLowerCase()]);
      if (ex.rowCount > 0) return res.status(409).json({ ok: false, error: "Cliente con ese email ya existe" });
    }

    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO customers (id, email, full_name, phone, address, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
      [
        id,
        d.email ? String(d.email).toLowerCase() : null,
        d.fullName,
        d.phone ?? null,
        d.address ?? null,
        d.notes ?? null,
      ]
    );

    return res.json({ ok: true, customer: { id, email: d.email ?? null, fullName: d.fullName } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;
