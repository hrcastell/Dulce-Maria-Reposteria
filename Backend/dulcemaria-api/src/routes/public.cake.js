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
      `SELECT id, category_id, label, description, extra_price_clp, is_default, diameter_cm, image_url, sort_order
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

    // Fetch base price
    const configRes = await pool.query("SELECT value FROM system_config WHERE key='cake_base_price' LIMIT 1");
    const basePrice = configRes.rowCount > 0 ? Number(configRes.rows[0].value) : 30000;

    res.json({ ok: true, categories, base_price: basePrice });
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
    customer_name: z.string().trim().min(2).max(200),
    customer_phone: z.string().trim().regex(/^\+?[0-9 ()-]{6,30}$/),
    customer_email: z.string().email().optional().nullable(),
    customer_address: z.string().trim().max(400).optional().nullable(),
    size_option_id: z.string().uuid().optional().nullable(),
    layers_option_id: z.string().uuid().optional().nullable(),
    sponge_option_id: z.string().uuid().optional().nullable(),
    filling_option_id: z.string().uuid().optional().nullable(),
    decoration_option_id: z.string().uuid().optional().nullable(),
    theme_option_id: z.string().uuid().optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
  }).strict();

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const d = parsed.data;
  const orderNumber = `CAKE-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

  try {
    const pool = getPool();
    const keyToType = {
      theme_option_id: "THEME",
      size_option_id: "SIZE",
      layers_option_id: "LAYERS",
      sponge_option_id: "SPONGE",
      filling_option_id: "FILLING",
      decoration_option_id: "DECORATION",
    };
    const selected = Object.entries(keyToType)
      .filter(([key]) => Boolean(d[key]))
      .map(([key, type]) => ({ key, type, id: d[key] }));
    const ids = selected.map((item) => item.id);
    const optionsResult = ids.length
      ? await pool.query(
          `SELECT o.id, o.extra_price_clp, c.type
           FROM cake_config_option o
           JOIN cake_config_category c ON c.id=o.category_id
           WHERE o.id=ANY($1::uuid[]) AND o.is_active=true AND c.is_active=true`,
          [ids]
        )
      : { rows: [] };
    const options = new Map(optionsResult.rows.map((option) => [option.id, option]));
    for (const item of selected) {
      const option = options.get(item.id);
      if (!option || option.type !== item.type) {
        return res.status(400).json({ ok: false, error: "Configuración de torta inválida" });
      }
    }

    const configResult = await pool.query(
      `SELECT value FROM system_config WHERE key='cake_base_price' LIMIT 1`
    );
    const basePrice = configResult.rowCount ? Number(configResult.rows[0].value) : 30000;
    const extrasPrice = optionsResult.rows.reduce(
      (sum, option) => sum + Number(option.extra_price_clp || 0),
      0
    );
    const totalPrice = basePrice + extrasPrice;
    if (!Number.isSafeInteger(totalPrice) || totalPrice <= 0 || totalPrice > 100000000) {
      return res.status(400).json({ ok: false, error: "Total del pedido inválido" });
    }
    const deposit = Math.ceil(totalPrice * 0.5);

    const r = await pool.query(
      `INSERT INTO cake_orders
         (id, order_number, customer_name, customer_phone, customer_email, customer_address,
          size_option_id, layers_option_id, sponge_option_id, filling_option_id, decoration_option_id, theme_option_id,
          base_price_clp, extras_price_clp, total_price_clp, deposit_clp, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'PENDING_PAYMENT')
       RETURNING id, order_number, total_price_clp, deposit_clp`,
      [
        crypto.randomUUID(), orderNumber, d.customer_name, d.customer_phone, d.customer_email ?? null, d.customer_address ?? null,
        d.size_option_id ?? null, d.layers_option_id ?? null, d.sponge_option_id ?? null,
        d.filling_option_id ?? null, d.decoration_option_id ?? null, d.theme_option_id ?? null,
        basePrice, extrasPrice, totalPrice, deposit, d.notes ?? null
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
