const express = require("express");
const { z } = require("zod");

const { getPool } = require("../db");
const { requireRole } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /admin/reports/daily?date=YYYY-MM-DD
 * Devuelve: totales del día + top productos
 */
router.get("/daily", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const schema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
  const parsed = schema.safeParse({ date: String(req.query.date || "") });
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Debes enviar ?date=YYYY-MM-DD" });

  const { date } = parsed.data;

  try {
    const pool = getPool();

    const totals = await pool.query(
      `SELECT
         COUNT(*)::int AS orders_count,
         COALESCE(SUM(total_clp),0)::int AS total_clp,
         COALESCE(SUM(subtotal_clp),0)::int AS subtotal_clp
       FROM orders
       WHERE created_at >= ($1::date)::timestamptz
         AND created_at < (($1::date + 1))::timestamptz
         AND status <> 'CANCELLED'`,
      [date]
    );

    const topProducts = await pool.query(
      `SELECT
         oi.product_id,
         oi.product_name_snapshot AS name,
         SUM(oi.qty)::int AS qty,
         SUM(oi.line_total_clp)::int AS total_clp
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.created_at >= ($1::date)::timestamptz
         AND o.created_at < (($1::date + 1))::timestamptz
         AND o.status <> 'CANCELLED'
       GROUP BY oi.product_id, oi.product_name_snapshot
       ORDER BY qty DESC
       LIMIT 10`,
      [date]
    );

    return res.json({
      ok: true,
      date,
      totals: totals.rows[0],
      topProducts: topProducts.rows,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;
