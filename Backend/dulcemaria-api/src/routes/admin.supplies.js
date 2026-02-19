const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");
const { getPool } = require("../db");
const { requireRole } = require("../middleware/auth");
const { validateUuidParam } = require("../middleware/validate-uuid");

const router = express.Router();

// ===== SUPPLIES (Insumos) =====

router.get(["", "/"], requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const search = String(req.query.q || "").trim();
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, name, unit, last_price_clp, last_updated, notes, is_active, created_at
       FROM supplies
       ${search ? "WHERE name ILIKE $1" : "WHERE is_active = true"}
       ORDER BY name ASC`,
      search ? [`%${search}%`] : []
    );
    res.json({ ok: true, items: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.post("/", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(200),
    unit: z.string().max(50).optional().nullable(),
    last_price_clp: z.number().int().nonnegative().optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  try {
    const pool = getPool();
    const d = parsed.data;
    const r = await pool.query(
      `INSERT INTO supplies (id, name, unit, last_price_clp, last_updated, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [crypto.randomUUID(), d.name, d.unit ?? null, d.last_price_clp ?? null, d.last_price_clp ? new Date() : null, d.notes ?? null]
    );
    res.json({ ok: true, supply: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.patch("/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(200).optional(),
    unit: z.string().max(50).optional().nullable(),
    last_price_clp: z.number().int().nonnegative().optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
    is_active: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const d = parsed.data;
  const fields = [];
  const values = [];
  let n = 1;

  if (d.name !== undefined) { fields.push(`name=$${n++}`); values.push(d.name); }
  if ("unit" in d) { fields.push(`unit=$${n++}`); values.push(d.unit ?? null); }
  if ("last_price_clp" in d) {
    fields.push(`last_price_clp=$${n++}`); values.push(d.last_price_clp ?? null);
    fields.push(`last_updated=$${n++}`); values.push(d.last_price_clp != null ? new Date() : null);
  }
  if ("notes" in d) { fields.push(`notes=$${n++}`); values.push(d.notes ?? null); }
  if (d.is_active !== undefined) { fields.push(`is_active=$${n++}`); values.push(d.is_active); }

  if (fields.length === 0) return res.status(400).json({ ok: false, error: "Nada que actualizar" });
  fields.push(`updated_at=NOW()`);
  values.push(req.params.id);

  try {
    const pool = getPool();
    const r = await pool.query(
      `UPDATE supplies SET ${fields.join(",")} WHERE id=$${n} RETURNING *`,
      values
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Insumo no encontrado" });
    res.json({ ok: true, supply: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.get("/ping", requireRole("SUPERADMIN", "ADMIN", "STAFF"), (req, res) => {
  res.json({ ok: true, route: "admin.supplies" });
});

// ===== EXPENSES (Gastos) =====

router.get("/expenses", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const year = String(req.query.year || new Date().getFullYear());
  const month = String(req.query.month || String(new Date().getMonth() + 1).padStart(2, "0"));
  const startDate = `${year}-${month.padStart(2, "0")}-01`;

  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT e.id, e.supply_id, e.description, e.amount_clp, e.expense_date, e.notes, e.created_at,
              s.name AS supply_name
       FROM expense_records e
       LEFT JOIN supplies s ON s.id = e.supply_id
       WHERE DATE_TRUNC('month', e.expense_date) = DATE_TRUNC('month', $1::date)
       ORDER BY e.expense_date DESC, e.created_at DESC`,
      [startDate]
    );

    const total = r.rows.reduce((s, row) => s + (row.amount_clp || 0), 0);
    res.json({ ok: true, items: r.rows, total_clp: total });
  } catch (e) {
    console.error("[supplies/expenses GET]", e);
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.post("/expenses", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  const schema = z.object({
    description: z.string().min(1).max(300),
    amount_clp: z.number().int().positive(),
    expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    supply_id: z.string().uuid().optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  try {
    const pool = getPool();
    const d = parsed.data;
    const r = await pool.query(
      `INSERT INTO expense_records (id, description, amount_clp, expense_date, supply_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [crypto.randomUUID(), d.description, d.amount_clp, d.expense_date || new Date().toISOString().split("T")[0], d.supply_id ?? null, d.notes ?? null]
    );
    res.json({ ok: true, expense: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.delete("/expenses/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.query("DELETE FROM expense_records WHERE id=$1 RETURNING id", [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Gasto no encontrado" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;
