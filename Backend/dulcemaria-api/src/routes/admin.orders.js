const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");

const { getPool } = require("../db");
const { requireRole } = require("../middleware/auth");
const { validateUuidParam } = require("../middleware/validate-uuid");

const router = express.Router();

const ORDER_STATUS = ["PENDING_PAYMENT","PAID","PREPARING","READY","DELIVERED","CANCELLED"];
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
router.get("/:id", requireRole("SUPERADMIN", "ADMIN", "STAFF"), validateUuidParam("id"), async (req, res) => {
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
      `SELECT id, product_id, product_name_snapshot, unit_price_clp, qty, line_total_clp, created_at,
              variant_id, variant_name, selected_toppings
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
      variantId: z.string().uuid().optional().nullable(),
      toppings: z.array(z.string().uuid()).optional().default([]), // IDs de toppings
    })).min(1),

    deliveryMethod: z.enum(DELIVERY_METHOD).default("PICKUP"),
    deliveryFeeClp: z.number().int().nonnegative().default(0),

    paymentMethod: z.enum(PAYMENT_METHOD).default("CASH"),
    paymentStatus: z.enum(PAYMENT_STATUS).default("PAID"),

    status: z.enum(ORDER_STATUS).default("DELIVERED"),
    
    discountAmountClp: z.number().int().nonnegative().default(0),
    finalPriceOverrideClp: z.number().int().nonnegative().optional().nullable(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const {
    customerId, items, deliveryMethod, deliveryFeeClp, paymentMethod, paymentStatus, status,
    discountAmountClp, finalPriceOverrideClp
  } = parsed.data;

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const c = await client.query("SELECT id FROM customers WHERE id=$1 LIMIT 1", [customerId]);
    if (c.rowCount === 0) throw new Error("Cliente no existe");

    // 1. Fetch Products
    const productIds = items.map(i => i.productId);
    const pr = await client.query(
      `SELECT id, name, price_clp, stock_qty, is_active
       FROM products
       WHERE id = ANY($1::uuid[])
       FOR UPDATE`,
      [productIds]
    );
    if (pr.rowCount !== new Set(productIds).size) {
      // Note: simple check, might fail if duplicate productIds in items (should merge them or handle separately)
      // For now assume user sends unique product lines or valid products
    }
    const productsMap = new Map(pr.rows.map(p => [p.id, p]));

    // 2. Fetch Variants if needed
    const variantIds = items.map(i => i.variantId).filter(Boolean);
    let variantsMap = new Map();
    if (variantIds.length > 0) {
      const vr = await client.query(
        `SELECT id, product_id, name, price_override_clp, stock_qty, is_active
         FROM product_variants
         WHERE id = ANY($1::uuid[])
         FOR UPDATE`,
        [variantIds]
      );
      variantsMap = new Map(vr.rows.map(v => [v.id, v]));
    }

    // 3. Fetch Toppings if needed
    const allToppingIds = items.flatMap(i => i.toppings);
    let toppingsMap = new Map();
    if (allToppingIds.length > 0) {
      const tr = await client.query(
        `SELECT id, product_id, name, price_clp, type
         FROM product_toppings
         WHERE id = ANY($1::uuid[])`,
        [allToppingIds]
      );
      toppingsMap = new Map(tr.rows.map(t => [t.id, t]));
    }

    // Validación + cálculo
    let subtotal = 0;
    const orderItemsData = [];

    for (const it of items) {
      const p = productsMap.get(it.productId);
      if (!p) throw new Error(`Producto no encontrado: ${it.productId}`);
      if (!p.is_active) throw new Error(`Producto inactivo: ${p.name}`);

      let unitPrice = Number(p.price_clp);
      let variantName = null;
      let variantId = null;

      // Handle Variant
      if (it.variantId) {
        const v = variantsMap.get(it.variantId);
        if (!v) throw new Error(`Variante no encontrada: ${it.variantId}`);
        if (v.product_id !== p.id) throw new Error(`Variante ${v.name} no pertenece a ${p.name}`);
        if (!v.is_active) throw new Error(`Variante inactiva: ${v.name}`);

        variantId = v.id;
        variantName = v.name;
        
        // Price override?
        if (v.price_override_clp !== null) {
          unitPrice = Number(v.price_override_clp);
        }

        // Check stock on VARIANT
        const available = Number(v.stock_qty);
        if (it.qty > available) {
          throw new Error(`Stock insuficiente para "${p.name} - ${v.name}". Disponible: ${available}`);
        }

        // Deduct variant stock (trigger will update product stock)
        await client.query(
          `UPDATE product_variants SET stock_qty = stock_qty - $1, updated_at=NOW() WHERE id=$2`,
          [it.qty, v.id]
        );

      } else {
        // No variant -> check Product stock
        // Solo si NO tiene variantes obligatorias (asumimos que si el front manda sin variantId es un producto simple)
        // Ojo: si el plan dice que el stock se mueve por variantes, productos sin variantes siguen usando stock_qty de products.
        const available = Number(p.stock_qty);
        if (it.qty > available) {
          throw new Error(`Stock insuficiente para "${p.name}". Disponible: ${available}`);
        }
        await client.query(
          `UPDATE products SET stock_qty = stock_qty - $1, updated_at=NOW() WHERE id=$2`,
          [it.qty, p.id]
        );
      }

      // Handle Toppings
      const selectedToppings = [];
      for (const tid of it.toppings) {
        const t = toppingsMap.get(tid);
        if (!t) throw new Error(`Topping no encontrado: ${tid}`);
        if (t.product_id !== p.id) throw new Error(`Topping ${t.name} no pertenece a ${p.name}`);
        
        // Add price
        if (t.price_clp > 0) {
          unitPrice += Number(t.price_clp);
        }
        selectedToppings.push({ id: t.id, name: t.name, price: t.price_clp });
      }

      const lineTotal = unitPrice * it.qty;
      subtotal += lineTotal;

      orderItemsData.push({
        id: crypto.randomUUID(),
        productId: p.id,
        productName: p.name,
        variantId,
        variantName,
        selectedToppings: selectedToppings.length ? JSON.stringify(selectedToppings) : null,
        unitPrice,
        qty: it.qty,
        lineTotal
      });
    }

    // Final Totals
    const delivery = Number(deliveryFeeClp || 0);
    const discount = Number(discountAmountClp || 0);
    let total = subtotal + delivery - discount;
    if (total < 0) total = 0;

    // Apply Override if exists
    if (finalPriceOverrideClp !== undefined && finalPriceOverrideClp !== null) {
      total = finalPriceOverrideClp;
    }

    // Insert order
    const orderId = crypto.randomUUID();
    const orderCode = `ORD-${Date.now()}`;
    
    const o = await client.query(
      `INSERT INTO orders (
          id, order_code, customer_id, status, payment_status, payment_method, delivery_method,
          subtotal_clp, delivery_fee_clp, discount_amount_clp, final_price_override_clp, total_clp,
          created_at, updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
       RETURNING id, order_no, order_code, status, total_clp`,
      [
        orderId, orderCode, customerId, status, paymentStatus, paymentMethod, deliveryMethod,
        subtotal, delivery, discount, finalPriceOverrideClp ?? null, total
      ]
    );

    // Insert items
    for (const item of orderItemsData) {
      await client.query(
        `INSERT INTO order_items (
           id, order_id, product_id, product_name_snapshot, variant_id, variant_name, selected_toppings,
           unit_price_clp, qty, line_total_clp, created_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
        [
          item.id, orderId, item.productId, item.productName, item.variantId, item.variantName, item.selectedToppings,
          item.unitPrice, item.qty, item.lineTotal
        ]
      );
    }

    await client.query("COMMIT");

    return res.json({
      ok: true,
      order: {
        id: o.rows[0].id,
        orderNo: o.rows[0].order_no,
        orderCode: o.rows[0].order_code,
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
router.patch("/:id/status", requireRole("SUPERADMIN", "ADMIN", "STAFF"), validateUuidParam("id"), async (req, res) => {
  const schema = z.object({
    status: z.enum(ORDER_STATUS),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { id } = req.params;
  const { status } = parsed.data;

  try {
    const pool = getPool();

    const r = await pool.query(
      `UPDATE orders
       SET status=$1, updated_at=NOW()
       WHERE id=$2
       RETURNING id, order_no, status, payment_status, updated_at`,
      [status, id]
    );

    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Orden no encontrada" });

    return res.json({ ok: true, order: r.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * PATCH /admin/orders/:id/payment
 * Actualiza estado de pago
 */
router.patch("/:id/payment", requireRole("SUPERADMIN", "ADMIN", "STAFF"), validateUuidParam("id"), async (req, res) => {
  const schema = z.object({
    paymentStatus: z.enum(PAYMENT_STATUS),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { id } = req.params;
  const { paymentStatus } = parsed.data;

  try {
    const pool = getPool();

    const r = await pool.query(
      `UPDATE orders
       SET payment_status=$1, updated_at=NOW()
       WHERE id=$2
       RETURNING id, order_no, status, payment_status, updated_at`,
      [paymentStatus, id]
    );

    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Orden no encontrada" });

    return res.json({ ok: true, order: r.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;
