const express = require("express");
const { getPool } = require("../db");

const router = express.Router();

// GET /public/hero - List active slides for website
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, title, subtitle, button_text, button_link, image_url
       FROM hero_slides
       WHERE is_active = true
       ORDER BY sort_order ASC, created_at DESC`
    );
    res.json({ ok: true, items: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;
