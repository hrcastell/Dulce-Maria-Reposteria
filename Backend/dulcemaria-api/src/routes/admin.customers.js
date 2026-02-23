const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");

const { getPool } = require("../db");
const { requireRole } = require("../middleware/auth");
const { validateUuidParam } = require("../middleware/validate-uuid");

const router = express.Router();

/**
 * Normalize string for comparison (remove accents, lowercase, trim extra spaces)
 */
function normalizeString(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/\s+/g, " ") // Normalize spaces
    .trim();
}

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

    // Check for duplicate name (normalized)
    const normalizedName = normalizeString(d.fullName);
    const allCustomers = await pool.query("SELECT full_name FROM customers");
    const duplicateName = allCustomers.rows.find(c => normalizeString(c.full_name) === normalizedName);
    if (duplicateName) {
      return res.status(409).json({ 
        ok: false, 
        error: `Ya existe un cliente con el nombre "${duplicateName.full_name}"` 
      });
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

    // Fetch the created customer to return consistent format
    const r = await pool.query(
      `SELECT id, email, full_name, phone, address, notes, created_at, updated_at
       FROM customers WHERE id=$1 LIMIT 1`,
      [id]
    );

    return res.json({ ok: true, customer: r.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * PATCH /admin/customers/:id
 * Actualiza cliente
 */
router.patch("/:id", requireRole("SUPERADMIN", "ADMIN", "STAFF"), validateUuidParam("id"), async (req, res) => {
  const { id } = req.params;

  const schema = z.object({
    email: z.string().email().optional().nullable(),
    fullName: z.string().min(2).optional(),
    phone: z.string().min(6).optional().nullable(),
    address: z.string().min(3).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const d = parsed.data;

  try {
    const pool = getPool();

    const exists = await pool.query("SELECT 1 FROM customers WHERE id=$1 LIMIT 1", [id]);
    if (exists.rowCount === 0) return res.status(404).json({ ok: false, error: "Cliente no encontrado" });

    if (d.email) {
      const ex = await pool.query("SELECT 1 FROM customers WHERE email=$1 AND id<>$2 LIMIT 1", [String(d.email).toLowerCase(), id]);
      if (ex.rowCount > 0) return res.status(409).json({ ok: false, error: "Cliente con ese email ya existe" });
    }

    const fields = [];
    const values = [];
    let n = 1;

    if (d.email !== undefined) {
      fields.push(`email=$${n++}`);
      values.push(d.email ? String(d.email).toLowerCase() : null);
    }
    if (d.fullName) {
      fields.push(`full_name=$${n++}`);
      values.push(d.fullName);
    }
    if (d.phone !== undefined) {
      fields.push(`phone=$${n++}`);
      values.push(d.phone ?? null);
    }
    if (d.address !== undefined) {
      fields.push(`address=$${n++}`);
      values.push(d.address ?? null);
    }
    if (d.notes !== undefined) {
      fields.push(`notes=$${n++}`);
      values.push(d.notes ?? null);
    }

    if (fields.length === 0) {
      return res.status(400).json({ ok: false, error: "No hay campos para actualizar" });
    }

    fields.push(`updated_at=NOW()`);
    values.push(id);

    await pool.query(
      `UPDATE customers SET ${fields.join(", ")} WHERE id=$${n}`,
      values
    );

    const r = await pool.query(
      `SELECT id, email, full_name, phone, address, notes, created_at, updated_at
       FROM customers WHERE id=$1 LIMIT 1`,
      [id]
    );

    return res.json({ ok: true, customer: r.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * DELETE /admin/customers/:id
 * Elimina cliente
 */
router.delete("/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  const { id } = req.params;

  try {
    const pool = getPool();

    const exists = await pool.query("SELECT 1 FROM customers WHERE id=$1 LIMIT 1", [id]);
    if (exists.rowCount === 0) return res.status(404).json({ ok: false, error: "Cliente no encontrado" });

    // Verificar si tiene órdenes
    const orders = await pool.query("SELECT 1 FROM orders WHERE customer_id=$1 LIMIT 1", [id]);
    if (orders.rowCount > 0) {
      return res.status(409).json({ ok: false, error: "No se puede eliminar un cliente con órdenes asociadas" });
    }

    await pool.query("DELETE FROM customers WHERE id=$1", [id]);

    return res.json({ ok: true, message: "Cliente eliminado", customerId: id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;
