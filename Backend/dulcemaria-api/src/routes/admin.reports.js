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

    const orders = await pool.query(
      `SELECT o.id, o.order_code, o.order_no, o.status, o.total_clp, o.created_at,
              c.full_name AS customer_name, c.phone AS customer_phone
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.created_at >= ($1::date)::timestamptz
         AND o.created_at < (($1::date + 1))::timestamptz
       ORDER BY o.created_at DESC`,
      [date]
    );

    return res.json({
      ok: true,
      date,
      totals: totals.rows[0],
      orders: orders.rows,
      topProducts: topProducts.rows,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * GET /admin/reports/monthly?year=YYYY&month=MM
 */
router.get("/monthly", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const schema = z.object({
    year: z.string().regex(/^\d{4}$/),
    month: z.string().regex(/^(0[1-9]|1[0-2])$/)
  });
  const parsed = schema.safeParse({ year: String(req.query.year || ""), month: String(req.query.month || "") });
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Debes enviar ?year=YYYY&month=MM" });

  const { year, month } = parsed.data;
  const startDate = `${year}-${month}-01`;

  try {
    const pool = getPool();

    const totals = await pool.query(
      `SELECT
         COUNT(*)::int AS orders_count,
         COALESCE(SUM(total_clp),0)::int AS total_clp
       FROM orders
       WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', $1::date)
         AND status <> 'CANCELLED'`,
      [startDate]
    );

    const orders = await pool.query(
      `SELECT o.id, o.order_code, o.order_no, o.status, o.total_clp, o.created_at,
              c.full_name AS customer_name, c.phone AS customer_phone
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE DATE_TRUNC('month', o.created_at) = DATE_TRUNC('month', $1::date)
       ORDER BY o.created_at DESC`,
      [startDate]
    );

    const topProducts = await pool.query(
      `SELECT
         oi.product_id,
         oi.product_name_snapshot AS name,
         SUM(oi.qty)::int AS qty,
         SUM(oi.line_total_clp)::int AS total_clp
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE DATE_TRUNC('month', o.created_at) = DATE_TRUNC('month', $1::date)
         AND o.status <> 'CANCELLED'
       GROUP BY oi.product_id, oi.product_name_snapshot
       ORDER BY qty DESC
       LIMIT 10`,
      [startDate]
    );

    const salesByDay = await pool.query(
      `SELECT
         TO_CHAR(o.created_at::date, 'YYYY-MM-DD') AS day,
         COUNT(*)::int AS orders_count,
         COALESCE(SUM(o.total_clp),0)::int AS sales_clp
       FROM orders o
       WHERE DATE_TRUNC('month', o.created_at) = DATE_TRUNC('month', $1::date)
         AND o.status <> 'CANCELLED'
       GROUP BY o.created_at::date`,
      [startDate]
    );

    const salesByCustomer = await pool.query(
      `SELECT
         c.id AS customer_id,
         c.full_name,
         COUNT(*)::int AS orders_count,
         COALESCE(SUM(o.total_clp),0)::int AS total_clp
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       WHERE DATE_TRUNC('month', o.created_at) = DATE_TRUNC('month', $1::date)
         AND o.status <> 'CANCELLED'
       GROUP BY c.id, c.full_name`,
      [startDate]
    );

    const expenses = await pool.query(
      `SELECT COALESCE(SUM(amount_clp),0)::int AS expenses_clp
       FROM expense_records
       WHERE DATE_TRUNC('month', expense_date) = DATE_TRUNC('month', $1::date)`,
      [startDate]
    );

    const salesByPaymentMethod = await pool.query(
      `SELECT payment_method, COUNT(*)::int AS count
       FROM orders
       WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', $1::date)
         AND status <> 'CANCELLED'
       GROUP BY payment_method`,
      [startDate]
    );

    // Días/meses sin órdenes reales no entran en el GROUP BY, así que no ensucian el "peor día".
    let bestSalesDay = null;
    let worstSalesDay = null;
    let mostOrdersDay = null;
    for (const row of salesByDay.rows) {
      if (!bestSalesDay || row.sales_clp > bestSalesDay.sales_clp) {
        bestSalesDay = { day: row.day, sales_clp: row.sales_clp };
      }
      if (!worstSalesDay || row.sales_clp < worstSalesDay.sales_clp) {
        worstSalesDay = { day: row.day, sales_clp: row.sales_clp };
      }
      if (!mostOrdersDay || row.orders_count > mostOrdersDay.orders_count) {
        mostOrdersDay = { day: row.day, orders_count: row.orders_count };
      }
    }

    let topCustomerByOrders = null;
    let topCustomerBySpend = null;
    for (const row of salesByCustomer.rows) {
      if (!topCustomerByOrders || row.orders_count > topCustomerByOrders.orders_count) {
        topCustomerByOrders = row;
      }
      if (!topCustomerBySpend || row.total_clp > topCustomerBySpend.total_clp) {
        topCustomerBySpend = row;
      }
    }

    const topCustomers = [...salesByCustomer.rows]
      .sort((a, b) => b.total_clp - a.total_clp)
      .slice(0, 10);

    return res.json({
      ok: true,
      year,
      month,
      totals: { ...totals.rows[0], expenses_clp: expenses.rows[0].expenses_clp },
      orders: orders.rows,
      topProducts: topProducts.rows,
      bestSalesDay,
      worstSalesDay,
      mostOrdersDay,
      topCustomerByOrders,
      topCustomerBySpend,
      topCustomers,
      salesByPaymentMethod: salesByPaymentMethod.rows,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * GET /admin/reports/yearly?year=YYYY
 */
router.get("/yearly", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const schema = z.object({ year: z.string().regex(/^\d{4}$/) });
  const parsed = schema.safeParse({ year: String(req.query.year || "") });
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Debes enviar ?year=YYYY" });

  const { year } = parsed.data;

  try {
    const pool = getPool();

    const totals = await pool.query(
      `SELECT
         COUNT(*)::int AS orders_count,
         COALESCE(SUM(total_clp),0)::int AS total_clp
       FROM orders
       WHERE EXTRACT(YEAR FROM created_at) = $1::int
         AND status <> 'CANCELLED'`,
      [year]
    );

    const salesByMonth = await pool.query(
      `SELECT
         EXTRACT(MONTH FROM o.created_at)::int AS month,
         COUNT(*)::int AS orders_count,
         COALESCE(SUM(o.total_clp),0)::int AS sales_clp
       FROM orders o
       WHERE EXTRACT(YEAR FROM o.created_at) = $1::int
         AND o.status <> 'CANCELLED'
       GROUP BY EXTRACT(MONTH FROM o.created_at)`,
      [year]
    );

    const expensesByMonth = await pool.query(
      `SELECT
         EXTRACT(MONTH FROM e.expense_date)::int AS month,
         COALESCE(SUM(e.amount_clp),0)::int AS expenses_clp
       FROM expense_records e
       WHERE EXTRACT(YEAR FROM e.expense_date) = $1::int
       GROUP BY EXTRACT(MONTH FROM e.expense_date)`,
      [year]
    );

    const salesByCustomer = await pool.query(
      `SELECT
         c.id AS customer_id,
         c.full_name,
         COUNT(*)::int AS orders_count,
         COALESCE(SUM(o.total_clp),0)::int AS total_clp
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       WHERE EXTRACT(YEAR FROM o.created_at) = $1::int
         AND o.status <> 'CANCELLED'
       GROUP BY c.id, c.full_name`,
      [year]
    );

    const topProducts = await pool.query(
      `SELECT
         oi.product_id,
         oi.product_name_snapshot AS name,
         SUM(oi.qty)::int AS qty,
         SUM(oi.line_total_clp)::int AS total_clp
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE EXTRACT(YEAR FROM o.created_at) = $1::int
         AND o.status <> 'CANCELLED'
       GROUP BY oi.product_id, oi.product_name_snapshot
       ORDER BY qty DESC
       LIMIT 10`,
      [year]
    );

    const salesByPaymentMethod = await pool.query(
      `SELECT payment_method, COUNT(*)::int AS count
       FROM orders
       WHERE EXTRACT(YEAR FROM created_at) = $1::int
         AND status <> 'CANCELLED'
       GROUP BY payment_method`,
      [year]
    );

    const salesByMonthMap = new Map(salesByMonth.rows.map((row) => [row.month, row]));
    const expensesByMonthMap = new Map(expensesByMonth.rows.map((row) => [row.month, row]));

    const monthlyBreakdown = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const salesRow = salesByMonthMap.get(month);
      const expensesRow = expensesByMonthMap.get(month);
      return {
        month,
        orders_count: salesRow ? salesRow.orders_count : 0,
        sales_clp: salesRow ? salesRow.sales_clp : 0,
        expenses_clp: expensesRow ? expensesRow.expenses_clp : 0,
      };
    });

    // Meses sin órdenes quedan afuera del cómputo de mejor/peor/más-órdenes: son ausencia de operación, no una señal de "peor mes".
    let bestSalesMonth = null;
    let worstSalesMonth = null;
    let mostOrdersMonth = null;
    for (const m of monthlyBreakdown) {
      if (m.orders_count === 0) continue;
      if (!bestSalesMonth || m.sales_clp > bestSalesMonth.sales_clp) {
        bestSalesMonth = { month: m.month, sales_clp: m.sales_clp };
      }
      if (!worstSalesMonth || m.sales_clp < worstSalesMonth.sales_clp) {
        worstSalesMonth = { month: m.month, sales_clp: m.sales_clp };
      }
      if (!mostOrdersMonth || m.orders_count > mostOrdersMonth.orders_count) {
        mostOrdersMonth = { month: m.month, orders_count: m.orders_count };
      }
    }

    let topCustomerByOrders = null;
    let topCustomerBySpend = null;
    for (const row of salesByCustomer.rows) {
      if (!topCustomerByOrders || row.orders_count > topCustomerByOrders.orders_count) {
        topCustomerByOrders = row;
      }
      if (!topCustomerBySpend || row.total_clp > topCustomerBySpend.total_clp) {
        topCustomerBySpend = row;
      }
    }

    const topCustomers = [...salesByCustomer.rows]
      .sort((a, b) => b.total_clp - a.total_clp)
      .slice(0, 10);

    return res.json({
      ok: true,
      year,
      totals: totals.rows[0],
      monthlyBreakdown,
      bestSalesMonth,
      worstSalesMonth,
      mostOrdersMonth,
      topCustomerByOrders,
      topCustomerBySpend,
      topCustomers,
      topProducts: topProducts.rows,
      salesByPaymentMethod: salesByPaymentMethod.rows,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;
