const express = require("express");
const { getPool } = require("../db");

const router = express.Router();

// Catálogo público (solo activos), incluye variantes y total_stock
router.get("/products", async (req, res) => {
  try {
    const pool = getPool();

    const r = await pool.query(
      `SELECT
         p.id, p.name, p.slug, p.description, p.price_clp, p.stock_qty, p.is_active, p.created_at,
         (SELECT url_thumb
          FROM product_images
          WHERE product_id=p.id AND is_primary=true
          ORDER BY sort_order ASC
          LIMIT 1) AS thumb_url
       FROM products p
       WHERE p.is_active=true
       ORDER BY p.created_at DESC`
    );

    const products = r.rows;

    if (products.length === 0) {
      return res.json({ ok: true, items: [] });
    }

    const productIds = products.map(p => p.id);
    const vr = await pool.query(
      `SELECT id, product_id, name, price_override_clp, stock_qty, is_active, sort_order
       FROM product_variants
       WHERE product_id = ANY($1) AND is_active = true
       ORDER BY product_id ASC, sort_order ASC, created_at ASC`,
      [productIds]
    );

    const variantsByProduct = {};
    for (const v of vr.rows) {
      if (!variantsByProduct[v.product_id]) variantsByProduct[v.product_id] = [];
      variantsByProduct[v.product_id].push({
        id: v.id,
        name: v.name,
        price_clp: v.price_override_clp ?? null,
        stock_qty: v.stock_qty,
        sort_order: v.sort_order,
      });
    }

    const items = products.map(p => {
      const variants = variantsByProduct[p.id] || [];
      const total_stock = variants.length > 0
        ? variants.reduce((s, v) => s + v.stock_qty, 0)
        : p.stock_qty;
      return { ...p, variants, total_stock };
    });

    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;