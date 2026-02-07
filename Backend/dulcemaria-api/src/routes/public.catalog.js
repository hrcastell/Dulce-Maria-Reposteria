const express = require("express");
const { getPool } = require("../db");

const router = express.Router();

// Catálogo público (solo activos)
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

    res.json({ ok: true, items: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;