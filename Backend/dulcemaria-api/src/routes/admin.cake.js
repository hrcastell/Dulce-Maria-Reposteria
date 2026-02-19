const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");
const { getPool } = require("../db");
const { requireRole } = require("../middleware/auth");
const { validateUuidParam } = require("../middleware/validate-uuid");

const router = express.Router();

// ===== CONFIG =====

router.get("/config", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  try {
    const pool = getPool();
    const cats = await pool.query(
      `SELECT id, type, label, sort_order, is_active FROM cake_config_category ORDER BY sort_order ASC`
    );
    const opts = await pool.query(
      `SELECT id, category_id, label, description, extra_price_clp, is_default, diameter_cm, is_active, sort_order
       FROM cake_config_option ORDER BY category_id, sort_order ASC`
    );
    const byCategory = {};
    for (const o of opts.rows) {
      if (!byCategory[o.category_id]) byCategory[o.category_id] = [];
      byCategory[o.category_id].push(o);
    }
    const result = cats.rows.map(c => ({ ...c, options: byCategory[c.id] || [] }));
    res.json({ ok: true, categories: result });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.patch("/config/categories/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  const schema = z.object({
    label: z.string().min(1).max(100).optional(),
    sort_order: z.number().int().optional(),
    is_active: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const fields = [], values = [];
  let n = 1;
  const d = parsed.data;
  if (d.label !== undefined) { fields.push(`label=$${n++}`); values.push(d.label); }
  if (d.sort_order !== undefined) { fields.push(`sort_order=$${n++}`); values.push(d.sort_order); }
  if (d.is_active !== undefined) { fields.push(`is_active=$${n++}`); values.push(d.is_active); }
  if (!fields.length) return res.status(400).json({ ok: false, error: "Nada que actualizar" });
  values.push(req.params.id);

  try {
    const pool = getPool();
    const r = await pool.query(`UPDATE cake_config_category SET ${fields.join(",")} WHERE id=$${n} RETURNING *`, values);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Categoría no encontrada" });
    res.json({ ok: true, category: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.post("/config/options", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  const schema = z.object({
    category_id: z.string().uuid(),
    label: z.string().min(1).max(100),
    description: z.string().max(300).optional().nullable(),
    extra_price_clp: z.number().int().nonnegative().default(0),
    is_default: z.boolean().default(false),
    diameter_cm: z.number().int().positive().optional().nullable(),
    sort_order: z.number().int().default(0),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  try {
    const pool = getPool();
    const d = parsed.data;
    const r = await pool.query(
      `INSERT INTO cake_config_option (id, category_id, label, description, extra_price_clp, is_default, diameter_cm, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [crypto.randomUUID(), d.category_id, d.label, d.description ?? null, d.extra_price_clp, d.is_default, d.diameter_cm ?? null, d.sort_order]
    );
    res.json({ ok: true, option: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.patch("/config/options/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  const schema = z.object({
    label: z.string().min(1).max(100).optional(),
    description: z.string().max(300).optional().nullable(),
    extra_price_clp: z.number().int().nonnegative().optional(),
    is_default: z.boolean().optional(),
    diameter_cm: z.number().int().positive().optional().nullable(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const fields = [], values = [];
  let n = 1;
  const d = parsed.data;
  if (d.label !== undefined) { fields.push(`label=$${n++}`); values.push(d.label); }
  if ("description" in d) { fields.push(`description=$${n++}`); values.push(d.description ?? null); }
  if (d.extra_price_clp !== undefined) { fields.push(`extra_price_clp=$${n++}`); values.push(d.extra_price_clp); }
  if (d.is_default !== undefined) { fields.push(`is_default=$${n++}`); values.push(d.is_default); }
  if ("diameter_cm" in d) { fields.push(`diameter_cm=$${n++}`); values.push(d.diameter_cm ?? null); }
  if (d.is_active !== undefined) { fields.push(`is_active=$${n++}`); values.push(d.is_active); }
  if (d.sort_order !== undefined) { fields.push(`sort_order=$${n++}`); values.push(d.sort_order); }
  if (!fields.length) return res.status(400).json({ ok: false, error: "Nada que actualizar" });
  values.push(req.params.id);

  try {
    const pool = getPool();
    const r = await pool.query(`UPDATE cake_config_option SET ${fields.join(",")} WHERE id=$${n} RETURNING *`, values);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Opción no encontrada" });
    res.json({ ok: true, option: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.delete("/config/options/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.query("DELETE FROM cake_config_option WHERE id=$1 RETURNING id", [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Opción no encontrada" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// ===== ORDERS =====

router.get("/orders", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const status = String(req.query.status || "").trim();
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, order_number, customer_name, customer_phone, customer_email,
              total_price_clp, deposit_clp, status, created_at
       FROM cake_orders
       ${status ? "WHERE status=$1" : ""}
       ORDER BY created_at DESC
       LIMIT 100`,
      status ? [status] : []
    );
    res.json({ ok: true, items: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.patch("/orders/:id/status", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  const schema = z.object({ status: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  try {
    const pool = getPool();
    const r = await pool.query(
      "UPDATE cake_orders SET status=$1 WHERE id=$2 RETURNING *",
      [parsed.data.status, req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Pedido no encontrado" });
    res.json({ ok: true, order: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;
