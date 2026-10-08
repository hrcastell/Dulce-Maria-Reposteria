const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");
const { getPool } = require("../db");

const router = express.Router();

function publicOrderCode() {
  return `WEB-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

router.post("/", async (req, res) => {
  const schema = z.object({
    customer_name: z.string().trim().min(2).max(200),
    customer_phone: z.string().trim().regex(/^\+?[0-9 ()-]{6,30}$/),
    customer_address: z.string().trim().max(400).optional().nullable(),
    items: z.array(z.object({
      product_id: z.string().uuid(),
      variant_id: z.string().uuid().nullable().optional(),
      qty: z.number().int().positive().max(50),
    }).strict()).min(1).max(30),
  }).strict();

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "Datos del pedido inválidos" });
  }

  const { customer_name, customer_phone, customer_address, items } = parsed.data;
  const client = await getPool().connect().catch(() => null);
  if (!client) return res.status(503).json({ ok: false, error: "Servicio temporalmente no disponible" });

  try {
    await client.query("BEGIN");

    const productIds = [...new Set(items.map((item) => item.product_id))];
    const productResult = await client.query(
      `SELECT id, name, price_clp, stock_qty, is_active
       FROM products WHERE id = ANY($1::uuid[]) FOR SHARE`,
      [productIds]
    );
    const products = new Map(productResult.rows.map((product) => [product.id, product]));

    const variantResult = await client.query(
      `SELECT id, product_id, name, price_override_clp, stock_qty, is_active
       FROM product_variants WHERE product_id = ANY($1::uuid[]) FOR SHARE`,
      [productIds]
    );
    const variants = new Map(variantResult.rows.map((variant) => [variant.id, variant]));

    const quantities = new Map();
    const resolvedItems = [];
    let subtotal = 0;

    for (const item of items) {
      const product = products.get(item.product_id);
      if (!product || !product.is_active) {
        return await rollbackWith(client, res, 400, "Uno de los productos ya no está disponible");
      }

      let unitPrice = Number(product.price_clp);
      let variant = null;
      if (item.variant_id) {
        variant = variants.get(item.variant_id);
        if (!variant || !variant.is_active || variant.product_id !== product.id) {
          return await rollbackWith(client, res, 400, "Variante de producto inválida");
        }
        unitPrice = variant.price_override_clp == null
          ? unitPrice
          : Number(variant.price_override_clp);
      } else {
        const hasVariants = variantResult.rows.some(
          (candidate) => candidate.product_id === product.id && candidate.is_active
        );
        if (hasVariants) {
          return await rollbackWith(client, res, 400, "Debes seleccionar una variante");
        }
      }

      const stockKey = variant ? `variant:${variant.id}` : `product:${product.id}`;
      const requested = (quantities.get(stockKey) || 0) + item.qty;
      quantities.set(stockKey, requested);
      const available = Number(variant ? variant.stock_qty : product.stock_qty);
      if (requested > available) {
        return await rollbackWith(client, res, 409, `Stock insuficiente para ${product.name}`);
      }

      const lineTotal = unitPrice * item.qty;
      subtotal += lineTotal;
      resolvedItems.push({ product, variant, qty: item.qty, unitPrice, lineTotal });
    }

    if (!Number.isSafeInteger(subtotal) || subtotal <= 0 || subtotal > 100000000) {
      return await rollbackWith(client, res, 400, "Total del pedido inválido");
    }

    // Un checkout público nunca modifica la ficha privada de un cliente ya
    // existente solo por conocer su teléfono. Se crea una ficha propia del
    // pedido; la conciliación/duplicados queda en manos del panel autenticado.
    const customerId = crypto.randomUUID();
    await client.query(
      `INSERT INTO customers (id,full_name,phone,address,created_at,updated_at)
       VALUES ($1,$2,$3,$4,NOW(),NOW())`,
      [customerId, customer_name, customer_phone, customer_address || null]
    );

    const orderId = crypto.randomUUID();
    const orderResult = await client.query(
      `INSERT INTO orders (id,order_code,customer_id,status,payment_status,payment_method,
                           delivery_method,subtotal_clp,delivery_fee_clp,total_clp,created_at,updated_at)
       VALUES ($1,$2,$3,'PENDING_PAYMENT','PENDING','TRANSFER','DELIVERY',$4,0,$4,NOW(),NOW())
       RETURNING id,order_no,order_code,total_clp`,
      [orderId, publicOrderCode(), customerId, subtotal]
    );

    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO order_items (id,order_id,product_id,product_name_snapshot,variant_id,variant_name,
                                  unit_price_clp,qty,line_total_clp,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
        [crypto.randomUUID(), orderId, item.product.id, item.product.name,
         item.variant?.id || null, item.variant?.name || null,
         item.unitPrice, item.qty, item.lineTotal]
      );
    }

    await client.query("COMMIT");
    const order = orderResult.rows[0];
    return res.status(201).json({
      ok: true,
      order_id: order.id,
      order_number: order.order_code,
      order_no: order.order_no,
      total_clp: Number(order.total_clp),
    });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Error creating public order:", error);
    return res.status(500).json({ ok: false, error: "No se pudo crear el pedido" });
  } finally {
    client.release();
  }
});

async function rollbackWith(client, res, status, error) {
  await client.query("ROLLBACK");
  return res.status(status).json({ ok: false, error });
}

module.exports = router;
