const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");

const { getPool } = require("../db");
const { requireRole } = require("../middleware/auth");
const { validateUuidParam } = require("../middleware/validate-uuid");
const { evaluateAndChargeFee } = require("../lib/platformFeeEngine");

const router = express.Router();

const ORDER_STATUS = ["PENDING_PAYMENT","PAID","PREPARING","READY","DELIVERED","CANCELLED"];
const PAYMENT_STATUS = ["PENDING","PAID","FAILED","REFUNDED"];
const PAYMENT_METHOD = ["TRANSFER","CASH","ONLINE"];
const DELIVERY_METHOD = ["PICKUP","DELIVERY"];

/**
 * Valida un array de líneas {productId, qty, variantId?, toppings?} contra
 * products/product_variants/product_toppings, y DESCUENTA el stock
 * correspondiente (por variante si aplica, si no por producto) dentro de la
 * transacción del `client` dado. Usado tanto por POST / (crear) como por
 * PUT /:id (editar) — en edición, el caller debe restituir el stock de los
 * items VIEJOS (ver restoreOrderItemsStock) antes de llamar a esto con la
 * lista NUEVA, para no perder ni duplicar inventario.
 *
 * Devuelve { orderItemsData, subtotal }. Lanza si algo no es válido
 * (producto/variante/topping inexistente, inactivo, o sin stock
 * suficiente) — el caller debe hacer ROLLBACK de toda la transacción.
 */
async function resolveAndReserveOrderItems(client, items) {
  const productIds = items.map((i) => i.productId);
  const pr = await client.query(
    `SELECT id, name, price_clp, stock_qty, is_active
     FROM products
     WHERE id = ANY($1::uuid[])
     FOR UPDATE`,
    [productIds]
  );
  const productsMap = new Map(pr.rows.map((p) => [p.id, p]));

  const variantIds = items.map((i) => i.variantId).filter(Boolean);
  let variantsMap = new Map();
  if (variantIds.length > 0) {
    const vr = await client.query(
      `SELECT id, product_id, name, price_override_clp, stock_qty, is_active
       FROM product_variants
       WHERE id = ANY($1::uuid[])
       FOR UPDATE`,
      [variantIds]
    );
    variantsMap = new Map(vr.rows.map((v) => [v.id, v]));
  }

  const allToppingIds = items.flatMap((i) => i.toppings);
  let toppingsMap = new Map();
  if (allToppingIds.length > 0) {
    const tr = await client.query(
      `SELECT id, product_id, name, price_clp, type
       FROM product_toppings
       WHERE id = ANY($1::uuid[])`,
      [allToppingIds]
    );
    toppingsMap = new Map(tr.rows.map((t) => [t.id, t]));
  }

  let subtotal = 0;
  const orderItemsData = [];

  for (const it of items) {
    const p = productsMap.get(it.productId);
    if (!p) throw new Error(`Producto no encontrado: ${it.productId}`);
    if (!p.is_active) throw new Error(`Producto inactivo: ${p.name}`);

    let unitPrice = Number(p.price_clp);
    let variantName = null;
    let variantId = null;

    if (it.variantId) {
      const v = variantsMap.get(it.variantId);
      if (!v) throw new Error(`Variante no encontrada: ${it.variantId}`);
      if (v.product_id !== p.id) throw new Error(`Variante ${v.name} no pertenece a ${p.name}`);
      if (!v.is_active) throw new Error(`Variante inactiva: ${v.name}`);

      variantId = v.id;
      variantName = v.name;

      if (v.price_override_clp !== null) {
        unitPrice = Number(v.price_override_clp);
      }

      const available = Number(v.stock_qty);
      if (it.qty > available) {
        throw new Error(`Stock insuficiente para "${p.name} - ${v.name}". Disponible: ${available}`);
      }

      await client.query(
        `UPDATE product_variants SET stock_qty = stock_qty - $1, updated_at=NOW() WHERE id=$2`,
        [it.qty, v.id]
      );
    } else {
      const available = Number(p.stock_qty);
      if (it.qty > available) {
        throw new Error(`Stock insuficiente para "${p.name}". Disponible: ${available}`);
      }
      await client.query(
        `UPDATE products SET stock_qty = stock_qty - $1, updated_at=NOW() WHERE id=$2`,
        [it.qty, p.id]
      );
    }

    const selectedToppings = [];
    for (const tid of it.toppings) {
      const t = toppingsMap.get(tid);
      if (!t) throw new Error(`Topping no encontrado: ${tid}`);
      if (t.product_id !== p.id) throw new Error(`Topping ${t.name} no pertenece a ${p.name}`);

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
      lineTotal,
    });
  }

  return { orderItemsData, subtotal };
}

/**
 * Devuelve al stock las cantidades de las líneas YA GUARDADAS de una orden —
 * usado en PUT /:id antes de borrar y re-reservar con la lista nueva, para
 * no perder inventario en cada edición.
 */
async function restoreOrderItemsStock(client, orderId) {
  const oldItems = await client.query(
    `SELECT product_id, variant_id, qty FROM order_items WHERE order_id = $1`,
    [orderId]
  );
  for (const item of oldItems.rows) {
    if (item.variant_id) {
      await client.query(
        `UPDATE product_variants SET stock_qty = stock_qty + $1, updated_at=NOW() WHERE id=$2`,
        [item.qty, item.variant_id]
      );
    } else {
      await client.query(
        `UPDATE products SET stock_qty = stock_qty + $1, updated_at=NOW() WHERE id=$2`,
        [item.qty, item.product_id]
      );
    }
  }
}

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
      LIMIT 1000000000
    `;

    const r = await pool.query(sql, vals);
    return res.json({ ok: true, items: r.rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * GET /admin/orders/pending-notifications
 * Returns pending orders created in last 24h for real-time admin notification
 *
 * Registrada ANTES de /:id a propósito: Express matchea rutas en orden de
 * registro, así que si esta fuera declarada después, /:id la capturaría
 * primero (tratando "pending-notifications" como el :id) y validateUuidParam
 * la rechazaría con 400 en cada poll.
 */
router.get("/pending-notifications", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT o.id, o.order_no, o.status, o.payment_status, o.total_clp, o.created_at,
        c.full_name AS customer_name, c.phone AS customer_phone
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       WHERE o.status = 'PENDING_PAYMENT'
         AND o.created_at >= NOW() - INTERVAL '24 hours'
       ORDER BY o.created_at DESC
       LIMIT 50`
    );

    // Also check cake_orders
    const cakeR = await pool.query(
      `SELECT co.id, co.order_number, co.status, co.total_price_clp, co.created_at,
        co.customer_name, co.customer_phone
       FROM cake_orders co
       WHERE co.status = 'PENDING'
         AND co.created_at >= NOW() - INTERVAL '24 hours'
       ORDER BY co.created_at DESC
       LIMIT 50`
    );

    return res.json({
      ok: true,
      orders: r.rows,
      cake_orders: cakeR.rows,
      total: r.rowCount + cakeR.rowCount
    });
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

    // Fecha real de la venta (para registrar ventas de días anteriores sin
    // tocar la BD a mano). Opcional: si no viene, created_at usa NOW() como siempre.
    orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const {
    customerId, items, deliveryMethod, deliveryFeeClp, paymentMethod, paymentStatus, status,
    discountAmountClp, finalPriceOverrideClp, orderDate
  } = parsed.data;

  const pool = getPool();
  let client;
  try {
    client = await pool.connect();
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }

  try {
    await client.query("BEGIN");

    const c = await client.query("SELECT id FROM customers WHERE id=$1 LIMIT 1", [customerId]);
    if (c.rowCount === 0) throw new Error("Cliente no existe");

    const { orderItemsData, subtotal } = await resolveAndReserveOrderItems(client, items);

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

    // OJO con la fecha: `$::date + CURRENT_TIME` (la versión anterior de esto)
    // combina una fecha-calendario CHILENA con el offset de CURRENT_TIME, que
    // refleja el timezone de la SESIÓN de Postgres (normalmente UTC, no
    // Chile) — de noche en Chile, UTC ya cayó en el día siguiente, así que el
    // resultado quedaba corrido un día para atrás al mostrarse de vuelta en
    // hora chilena. Se arma la hora actual explícitamente en America/Santiago
    // (NOW() AT TIME ZONE ...) y se reinterpreta el combinado como hora
    // chilena otra vez — nunca depende del timezone que tenga configurado el
    // servidor de Postgres.
    const o = await client.query(
      `INSERT INTO orders (
          id, order_code, customer_id, status, payment_status, payment_method, delivery_method,
          subtotal_clp, delivery_fee_clp, discount_amount_clp, final_price_override_clp, total_clp,
          created_at, updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE(($13::date + (NOW() AT TIME ZONE 'America/Santiago')::time) AT TIME ZONE 'America/Santiago', NOW()),NOW())
       RETURNING id, order_no, order_code, status, total_clp`,
      [
        orderId, orderCode, customerId, status, paymentStatus, paymentMethod, deliveryMethod,
        subtotal, delivery, discount, finalPriceOverrideClp ?? null, total, orderDate ?? null
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

    // Motor de Tarifa: si la orden nace ya cerrada (status=DELIVERED es el
    // default — modelo POS, la mayoría de las órdenes se cargan así), se
    // cobra la tarifa de plataforma en la MISMA transacción. Esto garantiza
    // que jamás pueda quedar una orden DELIVERED sin su fila de cobro.
    const createdOrder = o.rows[0];
    if (createdOrder.status === "DELIVERED") {
      await evaluateAndChargeFee(client, createdOrder);
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
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Rollback failed:", rollbackErr.message);
    }

    const statusCode = Number(e?.statusCode || 400);
    return res.status(statusCode).json({ ok: false, error: String(e?.message ?? e) });
  } finally {
    client.release();
  }
});

/**
 * PUT /admin/orders/:id
 * Edición completa de una orden ya creada: cliente, items, entrega, pago,
 * fecha. Exclusivo de ADMIN/SUPERADMIN (no STAFF) — a pedido explícito del
 * dueño del producto. El estado (status) NO se toca acá: sigue siendo
 * responsabilidad exclusiva de PATCH /:id/status, para no tener dos
 * caminos que puedan pisarse entre sí.
 *
 * Reconciliación de stock: se restituye el stock de los items VIEJOS y se
 * vuelve a reservar con la lista NUEVA (misma validación/descuento que
 * POST /, vía resolveAndReserveOrderItems) — evita duplicar o perder
 * inventario en cada edición.
 *
 * NO dispara el Motor de Tarifa de nuevo: si la orden ya estaba DELIVERED y
 * ya generó su cobro, ese registro del ledger queda congelado tal cual — el
 * diseño del motor es explícito en que un total_clp editado después NUNCA
 * debe recalcular un cobro ya emitido.
 *
 * Bloqueada para órdenes CANCELLED: su stock ya quedó en un estado
 * ambiguo (cancelar hoy no restituye stock — gap preexistente, sin
 * relación con este cambio) y tocarlo acá arriesgaría corromper el
 * inventario todavía más.
 */
router.put("/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  const schema = z.object({
    customerId: z.string().uuid(),
    items: z.array(z.object({
      productId: z.string().uuid(),
      qty: z.number().int().positive(),
      variantId: z.string().uuid().optional().nullable(),
      toppings: z.array(z.string().uuid()).optional().default([]),
    })).min(1),

    deliveryMethod: z.enum(DELIVERY_METHOD).default("PICKUP"),
    deliveryFeeClp: z.number().int().nonnegative().default(0),

    paymentMethod: z.enum(PAYMENT_METHOD).default("CASH"),
    paymentStatus: z.enum(PAYMENT_STATUS).default("PAID"),

    discountAmountClp: z.number().int().nonnegative().default(0),
    finalPriceOverrideClp: z.number().int().nonnegative().optional().nullable(),

    orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { id } = req.params;
  const {
    customerId, items, deliveryMethod, deliveryFeeClp, paymentMethod, paymentStatus,
    discountAmountClp, finalPriceOverrideClp, orderDate
  } = parsed.data;

  const pool = getPool();
  let client;
  try {
    client = await pool.connect();
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }

  try {
    await client.query("BEGIN");

    const existing = await client.query(`SELECT id, status FROM orders WHERE id=$1 FOR UPDATE`, [id]);
    if (existing.rowCount === 0) {
      const notFound = new Error("Orden no encontrada");
      notFound.statusCode = 404;
      throw notFound;
    }
    if (existing.rows[0].status === "CANCELLED") {
      const cancelledErr = new Error("No se puede editar una orden cancelada");
      cancelledErr.statusCode = 400;
      throw cancelledErr;
    }

    const c = await client.query("SELECT id FROM customers WHERE id=$1 LIMIT 1", [customerId]);
    if (c.rowCount === 0) throw new Error("Cliente no existe");

    // Restituye el stock de los items actuales ANTES de borrarlos, para no
    // perder inventario al re-reservar con la lista nueva.
    await restoreOrderItemsStock(client, id);
    await client.query(`DELETE FROM order_items WHERE order_id=$1`, [id]);

    const { orderItemsData, subtotal } = await resolveAndReserveOrderItems(client, items);

    const delivery = Number(deliveryFeeClp || 0);
    const discount = Number(discountAmountClp || 0);
    let total = subtotal + delivery - discount;
    if (total < 0) total = 0;

    if (finalPriceOverrideClp !== undefined && finalPriceOverrideClp !== null) {
      total = finalPriceOverrideClp;
    }

    // Mismo fix de timezone que en POST / (ver comentario ahí): nunca
    // `$::date + CURRENT_TIME` (offset de la sesión de Postgres, no de
    // Chile) — se ancla explícitamente a America/Santiago de los dos lados.
    const o = await client.query(
      `UPDATE orders SET
         customer_id=$1, payment_status=$2, payment_method=$3, delivery_method=$4,
         subtotal_clp=$5, delivery_fee_clp=$6, discount_amount_clp=$7, final_price_override_clp=$8,
         total_clp=$9, created_at=COALESCE(($10::date + (NOW() AT TIME ZONE 'America/Santiago')::time) AT TIME ZONE 'America/Santiago', created_at),
         updated_at=NOW()
       WHERE id=$11
       RETURNING id, order_no, order_code, status, total_clp`,
      [
        customerId, paymentStatus, paymentMethod, deliveryMethod,
        subtotal, delivery, discount, finalPriceOverrideClp ?? null, total, orderDate ?? null, id
      ]
    );

    for (const item of orderItemsData) {
      await client.query(
        `INSERT INTO order_items (
           id, order_id, product_id, product_name_snapshot, variant_id, variant_name, selected_toppings,
           unit_price_clp, qty, line_total_clp, created_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
        [
          item.id, id, item.productId, item.productName, item.variantId, item.variantName, item.selectedToppings,
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
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Rollback failed:", rollbackErr.message);
    }

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

  const pool = getPool();
  let client;
  try {
    client = await pool.connect();
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }

  try {
    await client.query("BEGIN");

    const r = await client.query(
      `UPDATE orders
       SET status=$1, updated_at=NOW()
       WHERE id=$2
       RETURNING id, order_no, order_code, status, payment_status, total_clp, updated_at`,
      [status, id]
    );

    if (r.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Orden no encontrada" });
    }

    const updatedOrder = r.rows[0];

    // Motor de Tarifa: cobra por la orden cerrada, en la misma transacción
    // que el cambio de status (atomicidad: nunca queda DELIVERED sin
    // cobro, ni viceversa). No hace falta comparar contra el status
    // anterior — evaluateAndChargeFee es idempotente por construcción
    // (UNIQUE(order_id) + ON CONFLICT DO NOTHING), así que cubre solo esta
    // vez, doble-click, y el caso DELIVERED→CANCELLED→DELIVERED de nuevo
    // (no se cobra dos veces la segunda vez que vuelve a DELIVERED).
    if (updatedOrder.status === "DELIVERED") {
      await evaluateAndChargeFee(client, updatedOrder);
    }

    await client.query("COMMIT");

    return res.json({ ok: true, order: updatedOrder });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Rollback failed:", rollbackErr.message);
    }
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  } finally {
    client.release();
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
