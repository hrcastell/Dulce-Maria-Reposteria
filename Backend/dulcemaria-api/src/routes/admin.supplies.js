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
      `SELECT id, name, unit, last_price_clp, stock_qty, reference_qty, last_updated, notes, is_active, created_at
       FROM supplies
       ${search ? "WHERE name ILIKE $1" : "WHERE is_active = true"}
       ORDER BY name ASC`,
      search ? [`%${search}%`] : []
    );
    const items = r.rows.map((row) => ({ ...row, stock_qty: Number(row.stock_qty), reference_qty: Number(row.reference_qty) }));
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.post("/", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(200),
    unit: z.string().max(50).optional().nullable(),
    last_price_clp: z.number().int().nonnegative().optional().nullable(),
    stock_qty: z.number().nonnegative().optional(),
    reference_qty: z.number().positive().optional(),
    notes: z.string().max(500).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  try {
    const pool = getPool();
    const d = parsed.data;
    const r = await pool.query(
      `INSERT INTO supplies (id, name, unit, last_price_clp, stock_qty, reference_qty, last_updated, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [crypto.randomUUID(), d.name, d.unit ?? null, d.last_price_clp ?? null, d.stock_qty ?? 0, d.reference_qty ?? 1, d.last_price_clp ? new Date() : null, d.notes ?? null]
    );
    const supply = { ...r.rows[0], stock_qty: Number(r.rows[0].stock_qty), reference_qty: Number(r.rows[0].reference_qty) };
    res.json({ ok: true, supply });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.patch("/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(200).optional(),
    unit: z.string().max(50).optional().nullable(),
    last_price_clp: z.number().int().nonnegative().optional().nullable(),
    stock_qty: z.number().nonnegative().optional(),
    reference_qty: z.number().positive().optional(),
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
  if (d.stock_qty !== undefined) { fields.push(`stock_qty=$${n++}`); values.push(d.stock_qty); }
  if (d.reference_qty !== undefined) { fields.push(`reference_qty=$${n++}`); values.push(d.reference_qty); }
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
    const supply = { ...r.rows[0], stock_qty: Number(r.rows[0].stock_qty), reference_qty: Number(r.rows[0].reference_qty) };
    res.json({ ok: true, supply });
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
      `SELECT e.id, e.supply_id, e.provider_id, e.description, e.amount_clp, e.expense_date, e.notes, e.created_at,
              s.name AS supply_name, p.name AS provider_name
       FROM expense_records e
       LEFT JOIN supplies s ON s.id = e.supply_id
       LEFT JOIN providers p ON p.id = e.provider_id
       WHERE DATE_TRUNC('month', e.expense_date) = DATE_TRUNC('month', $1::date)
       ORDER BY e.expense_date DESC, e.created_at DESC`,
      [startDate]
    );

    const expenseIds = r.rows.map((row) => row.id);
    const itemsByExpense = new Map();
    if (expenseIds.length > 0) {
      const itemsRes = await pool.query(
        `SELECT id, expense_record_id, supply_id, product_name_snapshot, quantity, unit_price_clp, total_clp
         FROM expense_record_items
         WHERE expense_record_id = ANY($1::uuid[])
         ORDER BY created_at ASC`,
        [expenseIds]
      );
      for (const item of itemsRes.rows) {
        if (!itemsByExpense.has(item.expense_record_id)) itemsByExpense.set(item.expense_record_id, []);
        itemsByExpense.get(item.expense_record_id).push(item);
      }
    }

    const items = r.rows.map((row) => ({ ...row, items: itemsByExpense.get(row.id) || [] }));
    const total = r.rows.reduce((s, row) => s + (row.amount_clp || 0), 0);
    res.json({ ok: true, items, total_clp: total });
  } catch (e) {
    console.error("[supplies/expenses GET]", e);
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.post("/expenses", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  const itemSchema = z.object({
    supply_id: z.string().uuid(),
    product_name: z.string().min(1).max(200),
    quantity: z.number().positive(),
    unit_price_clp: z.number().int().nonnegative(),
    total_clp: z.number().int().nonnegative(),
  });
  const schema = z.object({
    description: z.string().min(1).max(300),
    amount_clp: z.number().int().positive().optional().nullable(),
    expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    supply_id: z.string().uuid().optional().nullable(),
    provider_id: z.string().uuid().optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
    items: z.array(itemSchema).min(1).max(200).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const d = parsed.data;
  const hasItems = !!d.items && d.items.length > 0;
  // El total_clp de cada línea se recalcula acá en vez de confiar en el que manda el cliente.
  const items = hasItems ? d.items.map((item) => ({ ...item, total_clp: Math.round(item.quantity * item.unit_price_clp) })) : [];
  const amount = hasItems ? items.reduce((s, i) => s + i.total_clp, 0) : d.amount_clp;

  if (!amount || amount <= 0) {
    return res.status(400).json({ ok: false, error: "Debes ingresar un monto o al menos un producto en el detalle" });
  }

  const pool = getPool();
  let client;
  try {
    client = await pool.connect();
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
  try {
    await client.query("BEGIN");

    const id = crypto.randomUUID();
    const expenseDate = d.expense_date || new Date().toISOString().split("T")[0];
    const r = await client.query(
      `INSERT INTO expense_records (id, description, amount_clp, expense_date, supply_id, provider_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, d.description, amount, expenseDate, hasItems ? null : (d.supply_id ?? null), d.provider_id ?? null, d.notes ?? null]
    );

    if (hasItems) {
      for (const item of items) {
        await client.query(
          `INSERT INTO expense_record_items (id, expense_record_id, supply_id, product_name_snapshot, quantity, unit_price_clp, total_clp)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [crypto.randomUUID(), id, item.supply_id, item.product_name, item.quantity, item.unit_price_clp, item.total_clp]
        );
        // Solo actualiza el "último precio" si esta boleta es igual o más reciente que
        // el último precio ya registrado, para que un gasto retroactivo no pise un precio más nuevo.
        await client.query(
          `UPDATE supplies SET last_price_clp=$1, last_updated=$3::timestamptz
           WHERE id=$2 AND (last_updated IS NULL OR last_updated <= $3::timestamptz)`,
          [item.unit_price_clp, item.supply_id, expenseDate]
        );
        // La compra suma stock al insumo. Se revierte si el gasto se borra (ver DELETE).
        await client.query(
          `UPDATE supplies SET stock_qty = stock_qty + $1 WHERE id=$2`,
          [item.quantity, item.supply_id]
        );
      }
    }

    await client.query("COMMIT");
    res.json({ ok: true, expense: r.rows[0] });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Rollback failed:", rollbackErr.message);
    }
    if (e?.code === "23503") {
      return res.status(400).json({ ok: false, error: "El insumo o proveedor seleccionado ya no existe" });
    }
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  } finally {
    client.release();
  }
});

router.delete("/expenses/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  const pool = getPool();
  let client;
  try {
    client = await pool.connect();
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
  try {
    await client.query("BEGIN");

    // Revierte el stock que había sumado este gasto antes de borrarlo (ver POST /expenses).
    const itemsRes = await client.query(
      `SELECT supply_id, quantity FROM expense_record_items WHERE expense_record_id=$1`,
      [req.params.id]
    );
    for (const item of itemsRes.rows) {
      await client.query(`UPDATE supplies SET stock_qty = stock_qty - $1 WHERE id=$2`, [item.quantity, item.supply_id]);
    }

    const r = await client.query("DELETE FROM expense_records WHERE id=$1 RETURNING id", [req.params.id]);
    if (r.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Gasto no encontrado" });
    }

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Rollback failed:", rollbackErr.message);
    }
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  } finally {
    client.release();
  }
});

module.exports = router;
