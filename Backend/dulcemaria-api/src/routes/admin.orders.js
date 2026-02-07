const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");

const { getPool } = require("../db");
const { requireRole } = require("../middleware/auth");

const router = express.Router();

const ORDER_STATUS = ["PENDING_CONFIRMATION","CONFIRMED","PREPARING","READY","DELIVERED","CANCELLED"];
const PAYMENT_STATUS = ["PENDING","PAID","FAILED","REFUNDED"];
const PAYMENT_METHOD = ["TRANSFER","CASH","ONLINE"];
const DELIVERY_METHOD = ["PICKUP","DELIVERY"];

/**
 * GET /admin/orders?from&to&status
 * Rango: from/to pueden ser ISO (2026-02-06) o timestamp (2026-02-06T00:00:00Z)
 */
router.get("/", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  const status = String(req.query.status || "").trim();

  try {
    const pool = getPool();

    const where = [];
    const vals = [];
    let n = 1;

    if (from) { where.push(`o.created_at >= $${n++}::timestamptz`); vals.push(from); }
    if (to) { where.push(`o.created_at < $${n++}::timestamptz`); vals.push(to); }
    if (status) { where.push(`o.status = $${n++}`); vals.push(status); }

    const sql = `
      SELECT
        o.id, o.order_no, o.status, o.payment_status, o.payment_method, o.delivery_method,
        o.subtotal_clp, o.delivery_fee_clp, o.total_clp, o.created_at,
        c.id AS customer_id, c.full_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY o.created_at DESC
      LIMIT 100
    `;

    const r = await pool.query(sql, vals);
    return res.json({ ok: true, items: r.rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * GET /admin/orders/:id
 * Detalle de una venta (cabecera + items)
 */
router.get("/:id", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const { id } = req.params;

  try {
    const pool = getPool();

    const o = await pool.query(
      `SELECT o.*, c.full_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone, c.address AS customer_address
       FROM orders o
       JOIN customers c ON c.id=o.customer_id
       WHERE o.id=$1`,
      [id]
    );

    if (o.rowCount === 0) return res.status(404).json({ ok: false, error: "Orden no encontrada" });

    const items = await pool.query(
      `SELECT id, product_id, product_name_snapshot, unit_price_clp, qty, line_total_clp, created_at
       FROM order_items
       WHERE order_id=$1
       ORDER BY created_at ASC`,
      [id]
    );

    return res.json({ ok: true, order: o.rows[0], items: items.rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * POST /admin/orders
 * Crea venta (transaccional): valida stock, descuenta stock, inserta orden + items
 */
router.post("/", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const schema = z.object({
    customerId: z.string().uuid(),
    items: z.array(z.object({
      productId: z.string().uuid(),
      qty: z.number().int().positive(),
    })).min(1),

    deliveryMethod: z.enum(DELIVERY_METHOD).default("PICKUP"),
    deliveryFeeClp: z.number().int().nonnegative().default(0),

    paymentMethod: z.enum(PAYMENT_METHOD).default("CASH"),
    paymentStatus: z.enum(PAYMENT_STATUS).default("PAID"),

    status: z.enum(ORDER_STATUS).default("DELIVERED"),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { customerId, items, deliveryMethod, deliveryFeeClp, paymentMethod, paymentStatus, status } = parsed.data;

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const c = await client.query("SELECT id FROM customers WHERE id=$1 LIMIT 1", [customerId]);
    if (c.rowCount === 0) throw new Error("Cliente no existe");

    const productIds = items.map(i => i.productId);

    // Lock filas para evitar over-sell en concurrencia
    const pr = await client.query(
      `SELECT id, name, price_clp, stock_qty, is_active
       FROM products
       WHERE id = ANY($1::uuid[])
       FOR UPDATE`,
      [productIds]
    );

    if (pr.rowCount !== productIds.length) {
      throw new Error("Uno o más productos no existen.");
    }

    const map = new Map(pr.rows.map(p => [p.id, p]));

    // Validación + cálculo
    let subtotal = 0;
    for (const it of items) {
      const p = map.get(it.productId);

      if (!p.is_active) {
        const msg = `Producto inactivo: ${p.name}`;
        const err = new Error(msg);
        err.statusCode = 400;
        throw err;
      }

      const available = Number(p.stock_qty);
      const requested = Number(it.qty);

      if (requested > available) {
        const msg = `Stock insuficiente para "${p.name}". Disponible: ${available}, solicitado: ${requested}`;
        const err = new Error(msg);
        err.statusCode = 400;
        throw err;
      }

      subtotal += Number(p.price_clp) * requested;
    }

    const total = subtotal + Number(deliveryFeeClp || 0);

    // Insert order
    const orderId = crypto.randomUUID();
    const o = await client.query(
      `INSERT INTO orders (id, customer_id, status, payment_status, payment_method, delivery_method,
                           subtotal_clp, delivery_fee_clp, total_clp, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
       RETURNING id, order_no, status, total_clp`,
      [orderId, customerId, status, paymentStatus, paymentMethod, deliveryMethod, subtotal, deliveryFeeClp, total]
    );

    // Items + stock update
    for (const it of items) {
      const p = map.get(it.productId);
      const unit = Number(p.price_clp);
      const line = unit * Number(it.qty);

      await client.query(
        `INSERT INTO order_items (id, order_id, product_id, product_name_snapshot,
                                  unit_price_clp, qty, line_total_clp, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
        [crypto.randomUUID(), orderId, it.productId, p.name, unit, it.qty, line]
      );

      await client.query(
        `UPDATE products
         SET stock_qty = stock_qty - $1, updated_at=NOW()
         WHERE id=$2`,
        [it.qty, it.productId]
      );
    }

    await client.query("COMMIT");

    return res.json({
      ok: true,
      order: {
        id: o.rows[0].id,
        orderNo: o.rows[0].order_no,
        status: o.rows[0].status,
        totalClp: o.rows[0].total_clp
      }
    });
  } catch (e) {
    await client.query("ROLLBACK");

    const statusCode = Number(e?.statusCode || 400);
    return res.status(statusCode).json({ ok: false, error: String(e?.message ?? e) });
  } finally {
    client.release();
  }
});

/**
 * PATCH /admin/orders/:id/status
 * Cambia estado y/o estado de pago
 */
router.patch("/:id/status", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const schema = z.object({
    status: z.enum(ORDER_STATUS).optional(),
    paymentStatus: z.enum(PAYMENT_STATUS).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { id } = req.params;
  const { status, paymentStatus } = parsed.data;

  if (status === undefined && paymentStatus === undefined) {
    return res.status(400).json({ ok: false, error: "Nada para actualizar" });
  }

  try {
    const pool = getPool();

    const fields = [];
    const vals = [];
    let n = 1;

    if (status !== undefined) { fields.push(`status=$${n++}`); vals.push(status); }
    if (paymentStatus !== undefined) { fields.push(`payment_status=$${n++}`); vals.push(paymentStatus); }

    vals.push(id);

    const q = `
      UPDATE orders
      SET ${fields.join(", ")}, updated_at=NOW()
      WHERE id=$${n}
      RETURNING id, order_no, status, payment_status, updated_at
    `;

    const r = await pool.query(q, vals);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Orden no encontrada" });

    return res.json({ ok: true, order: r.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;
