const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");

const { getPool } = require("../db");
const { requireRole, requirePermission } = require("../middleware/auth");
const { validateUuidParam } = require("../middleware/validate-uuid");
const { validationError } = require("../lib/httpErrors");
const { searchTerm, optionalQuery } = require("../lib/schemas");
// Misma normalizaci\u00f3n que usa el checkout web para reconocer fichas (sin tildes, min\u00fasculas).
const { normalizePersonName: normalizeString } = require("../lib/customerIdentity");

const router = express.Router();

// `source`: ADMIN = ficha del panel (privada); WEB = creada por un pedido del
// sitio p\u00fablico. El checkout web solo reutiliza fichas WEB y nunca las modifica.
const CUSTOMER_COLUMNS = "id, email, full_name, phone, address, notes, source, created_at, updated_at";

/**
 * GET /admin/customers?q=...
 * Lista/busca clientes (máx 50)
 */
const listQuerySchema = z.object({ q: optionalQuery(searchTerm) });

router.get("/", requireRole("SUPERADMIN", "ADMIN", "STAFF"), requirePermission("customers", "canView"), async (req, res) => {
  const query = listQuerySchema.safeParse(req.query);
  if (!query.success) return validationError(res, query.error);
  const q = query.data.q || "";

  try {
    const pool = getPool();

    if (!q) {
      const r = await pool.query(
        `SELECT ${CUSTOMER_COLUMNS}
         FROM customers
         ORDER BY created_at DESC
         LIMIT 1000000000`
      );
      return res.json({ ok: true, items: r.rows });
    }

    const r = await pool.query(
      `SELECT ${CUSTOMER_COLUMNS}
       FROM customers
       WHERE (email ILIKE $1 OR full_name ILIKE $1 OR phone ILIKE $1)
       ORDER BY created_at DESC
       LIMIT 1000000000`,
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
router.post("/", requireRole("SUPERADMIN", "ADMIN", "STAFF"), requirePermission("customers", "canCreate"), async (req, res) => {
  const schema = z.object({
    email: z.string().email().max(254).optional().nullable(),
    fullName: z.string().min(2).max(200),
    phone: z.string().min(6).max(50).optional().nullable(),
    address: z.string().min(3).max(400).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  const d = parsed.data;

  try {
    const pool = getPool();

    if (d.email) {
      const ex = await pool.query("SELECT 1 FROM customers WHERE email=$1 LIMIT 1", [String(d.email).toLowerCase()]);
      if (ex.rowCount > 0) return res.status(409).json({ ok: false, error: "Cliente con ese email ya existe" });
    }

    // Nombre duplicado (normalizado) entre las fichas del PANEL: las creadas
    // por pedidos web no bloquean registrar a esa persona (C-13).
    const normalizedName = normalizeString(d.fullName);
    const allCustomers = await pool.query("SELECT full_name FROM customers WHERE source = 'ADMIN'");
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
      `SELECT ${CUSTOMER_COLUMNS}
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
 * Actualiza cliente. Editar una ficha creada por la web la vuelve del panel
 * (source = ADMIN): desde entonces el checkout público ya no la reutiliza.
 */
router.patch("/:id", requireRole("SUPERADMIN", "ADMIN", "STAFF"), validateUuidParam("id"), requirePermission("customers", "canEdit"), async (req, res) => {
  const { id } = req.params;

  const schema = z.object({
    email: z.string().email().max(254).optional().nullable(),
    fullName: z.string().min(2).max(200).optional(),
    phone: z.string().min(6).max(50).optional().nullable(),
    address: z.string().min(3).max(400).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

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

    fields.push(`source='ADMIN'`);
    fields.push(`updated_at=NOW()`);
    values.push(id);

    await pool.query(
      `UPDATE customers SET ${fields.join(", ")} WHERE id=$${n}`,
      values
    );

    const r = await pool.query(
      `SELECT ${CUSTOMER_COLUMNS}
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
router.delete("/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), requirePermission("customers", "canDelete"), async (req, res) => {
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
