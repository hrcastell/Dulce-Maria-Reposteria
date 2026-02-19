const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");
const { getPool } = require("../db");

const router = express.Router();

/**
 * GET /public/cake-builder
 * Retorna categorías + opciones activas para el configurador público
 */
router.get(["", "/"], async (req, res) => {
  try {
    const pool = getPool();
    const cats = await pool.query(
      `SELECT id, type, label, sort_order FROM cake_config_category WHERE is_active=true ORDER BY sort_order ASC`
    );
    const opts = await pool.query(
      `SELECT id, category_id, label, description, extra_price_clp, is_default, diameter_cm, sort_order
       FROM cake_config_option
       WHERE is_active=true
       ORDER BY category_id, sort_order ASC`
    );
    const byCategory = {};
    for (const o of opts.rows) {
      if (!byCategory[o.category_id]) byCategory[o.category_id] = [];
      byCategory[o.category_id].push(o);
    }
    const categories = cats.rows.map(c => ({ ...c, options: byCategory[c.id] || [] }));
    res.json({ ok: true, categories });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * POST /public/cake-orders
 * Registra un pedido de torta personalizada
 */
router.post("/orders", async (req, res) => {
  const schema = z.object({
    customer_name: z.string().min(2).max(200),
    customer_phone: z.string().min(6).max(30),
    customer_email: z.string().email().optional().nullable(),
    customer_address: z.string().max(400).optional().nullable(),
    size_option_id: z.string().uuid().optional().nullable(),
    layers_option_id: z.string().uuid().optional().nullable(),
    sponge_option_id: z.string().uuid().optional().nullable(),
    filling_option_id: z.string().uuid().optional().nullable(),
    decoration_option_id: z.string().uuid().optional().nullable(),
    base_price_clp: z.number().int().nonnegative(),
    extras_price_clp: z.number().int().nonnegative(),
    total_price_clp: z.number().int().nonnegative(),
    notes: z.string().max(500).optional().nullable(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const d = parsed.data;
  const deposit = Math.ceil(d.total_price_clp * 0.5);
  const orderNumber = `CAKE-${Date.now()}`;

  try {
    const pool = getPool();
    const r = await pool.query(
      `INSERT INTO cake_orders
         (id, order_number, customer_name, customer_phone, customer_email, customer_address,
          size_option_id, layers_option_id, sponge_option_id, filling_option_id, decoration_option_id,
          base_price_clp, extras_price_clp, total_price_clp, deposit_clp, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'PENDING_PAYMENT')
       RETURNING id, order_number, total_price_clp, deposit_clp`,
      [
        crypto.randomUUID(), orderNumber, d.customer_name, d.customer_phone, d.customer_email ?? null, d.customer_address ?? null,
        d.size_option_id ?? null, d.layers_option_id ?? null, d.sponge_option_id ?? null,
        d.filling_option_id ?? null, d.decoration_option_id ?? null,
        d.base_price_clp, d.extras_price_clp, d.total_price_clp, deposit, d.notes ?? null
      ]
    );

    const order = r.rows[0];
    res.json({ ok: true, order_id: order.id, order_number: order.order_number, deposit_clp: order.deposit_clp, total_price_clp: order.total_price_clp });
  } catch (e) {
    console.error("Error creating cake order:", e);
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;
