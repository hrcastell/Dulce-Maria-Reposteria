const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");
const { getPool } = require("../db");

const router = express.Router();

/**
 * POST /public/orders
 * Crea una orden desde el sitio web público (sin autenticación).
 * Busca o crea el cliente por teléfono, crea la orden con status PENDING_PAYMENT.
 */
router.post("/", async (req, res) => {
  const schema = z.object({
    customer_name: z.string().min(2).max(200),
    customer_phone: z.string().min(6).max(30),
    customer_address: z.string().max(400).optional().nullable(),
    items: z.array(z.object({
      product_id: z.string().uuid(),
      variant_id: z.string().uuid().nullable().optional(),
      product_name: z.string().min(1),
      qty: z.number().int().positive(),
      unit_price_clp: z.number().int().positive(),
    })).min(1),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const { customer_name, customer_phone, customer_address, items } = parsed.data;
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Buscar o crear cliente por teléfono
    let customerId;
    const existing = await client.query(
      `SELECT id FROM customers WHERE phone = $1 LIMIT 1`,
      [customer_phone]
    );

    if (existing.rowCount > 0) {
      customerId = existing.rows[0].id;
      // Actualizar nombre y dirección si los tiene
      await client.query(
        `UPDATE customers SET full_name = $1, address = COALESCE($2, address), updated_at = NOW() WHERE id = $3`,
        [customer_name, customer_address || null, customerId]
      );
    } else {
      customerId = crypto.randomUUID();
      await client.query(
        `INSERT INTO customers (id, full_name, phone, address, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [customerId, customer_name, customer_phone, customer_address || null]
      );
    }

    // Calcular totales
    const subtotal = items.reduce((s, i) => s + i.unit_price_clp * i.qty, 0);
    const total = subtotal;

    // Crear orden
    const orderId = crypto.randomUUID();
    const orderCode = `WEB-${Date.now()}`;

    const orderResult = await client.query(
      `INSERT INTO orders (id, order_code, customer_id, status, payment_status, payment_method,
                           delivery_method, subtotal_clp, delivery_fee_clp, total_clp, created_at, updated_at)
       VALUES ($1, $2, $3, 'PENDING_PAYMENT', 'PENDING', 'TRANSFER', 'DELIVERY', $4, 0, $5, NOW(), NOW())
       RETURNING id, order_no, order_code`,
      [orderId, orderCode, customerId, subtotal, total]
    );

    const order = orderResult.rows[0];

    // Crear items de la orden
    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (id, order_id, product_id, product_name_snapshot,
                                  unit_price_clp, qty, line_total_clp, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          crypto.randomUUID(),
          orderId,
          item.product_id,
          item.product_name,
          item.unit_price_clp,
          item.qty,
          item.unit_price_clp * item.qty,
        ]
      );
    }

    await client.query("COMMIT");

    return res.json({
      ok: true,
      order_id: order.id,
      order_number: order.order_code,
      order_no: order.order_no,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Error creating public order:", e);
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  } finally {
    client.release();
  }
});

module.exports = router;
