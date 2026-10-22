const express = require("express");
const { z } = require("zod");

const { getPool } = require("../db");
const { requireRole } = require("../middleware/auth");
const { sendError } = require("../lib/httpErrors");
const { salesOrderFilterSql } = require("../lib/salesMetrics");
const { isIsoDate, dayRange, monthRange, yearRange, santiagoMidnightSql, santiagoDateSql, SANTIAGO_TZ } = require("../lib/santiagoTime");

const router = express.Router();

// Días, meses y años se cortan en America/Santiago (B-25/C-12), nunca en la
// zona horaria de la sesión de PostgreSQL. Ventas = lib/salesMetrics.js: se
// excluyen las canceladas, las reembolsadas y las pendientes de pago sin pago
// registrado (carritos web sin confirmar).
const SALE = salesOrderFilterSql("o");
const IN_RANGE = `o.created_at >= ${santiagoMidnightSql("$1")} AND o.created_at < ${santiagoMidnightSql("$2")}`;
const LOCAL_DAY = santiagoDateSql("o.created_at");
const LOCAL_MONTH = `EXTRACT(MONTH FROM o.created_at AT TIME ZONE '${SANTIAGO_TZ}')::int`;

// `order_number` = el código que recibe el cliente (WEB-…/ORD-…) o, en
// órdenes antiguas sin código, el número correlativo (lo que muestra la UI).
const ORDER_ROW_COLUMNS = `o.id, o.order_code, o.order_no, COALESCE(o.order_code, o.order_no::text) AS order_number,
  o.status, o.payment_status, o.total_clp, o.created_at, ${SALE} AS counts_as_sale,
  c.full_name AS customer_name, c.phone AS customer_phone`;

async function salesTotals(pool, range) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS orders_count,
            COALESCE(SUM(o.total_clp),0)::int AS total_clp,
            COALESCE(SUM(o.subtotal_clp),0)::int AS subtotal_clp
     FROM orders o
     WHERE ${IN_RANGE} AND ${SALE}`,
    [range.start, range.end]
  );
  return r.rows[0];
}

async function topProducts(pool, range) {
  const r = await pool.query(
    `SELECT oi.product_id, oi.product_name_snapshot AS name,
            SUM(oi.qty)::int AS qty, SUM(oi.line_total_clp)::int AS total_clp
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE ${IN_RANGE} AND ${SALE}
     GROUP BY oi.product_id, oi.product_name_snapshot
     ORDER BY qty DESC
     LIMIT 10`,
    [range.start, range.end]
  );
  return r.rows;
}

async function ordersInRange(pool, range) {
  const r = await pool.query(
    `SELECT ${ORDER_ROW_COLUMNS}
     FROM orders o
     LEFT JOIN customers c ON c.id = o.customer_id
     WHERE ${IN_RANGE}
     ORDER BY o.created_at DESC`,
    [range.start, range.end]
  );
  return r.rows;
}

async function salesByCustomer(pool, range) {
  const r = await pool.query(
    `SELECT c.id AS customer_id, c.full_name,
            COUNT(*)::int AS orders_count, COALESCE(SUM(o.total_clp),0)::int AS total_clp
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     WHERE ${IN_RANGE} AND ${SALE}
     GROUP BY c.id, c.full_name`,
    [range.start, range.end]
  );
  return r.rows;
}

async function salesByPaymentMethod(pool, range) {
  const r = await pool.query(
    `SELECT o.payment_method, COUNT(*)::int AS count
     FROM orders o
     WHERE ${IN_RANGE} AND ${SALE}
     GROUP BY o.payment_method`,
    [range.start, range.end]
  );
  return r.rows;
}

function pickTopCustomers(rows) {
  let topCustomerByOrders = null;
  let topCustomerBySpend = null;
  for (const row of rows) {
    if (!topCustomerByOrders || row.orders_count > topCustomerByOrders.orders_count) topCustomerByOrders = row;
    if (!topCustomerBySpend || row.total_clp > topCustomerBySpend.total_clp) topCustomerBySpend = row;
  }
  const topCustomers = [...rows].sort((a, b) => b.total_clp - a.total_clp).slice(0, 10);
  return { topCustomerByOrders, topCustomerBySpend, topCustomers };
}

/**
 * GET /admin/reports/daily?date=YYYY-MM-DD
 * Devuelve: totales del día + top productos
 */
router.get("/daily", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const schema = z.object({ date: z.string().refine(isIsoDate) });
  const parsed = schema.safeParse({ date: String(req.query.date || "") });
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Debes enviar ?date=YYYY-MM-DD", code: "VALIDATION_ERROR" });

  const { date } = parsed.data;
  const range = dayRange(date);

  try {
    const pool = getPool();
    const [totals, orders, products] = [await salesTotals(pool, range), await ordersInRange(pool, range), await topProducts(pool, range)];
    return res.json({ ok: true, date, totals, orders, topProducts: products });
  } catch (e) {
    return sendError(res, e);
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
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Debes enviar ?year=YYYY&month=MM", code: "VALIDATION_ERROR" });

  const { year, month } = parsed.data;
  const range = monthRange(Number(year), Number(month));

  try {
    const pool = getPool();

    const totals = await salesTotals(pool, range);
    const orders = await ordersInRange(pool, range);
    const products = await topProducts(pool, range);

    const salesByDay = await pool.query(
      `SELECT TO_CHAR(${LOCAL_DAY}, 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS orders_count,
              COALESCE(SUM(o.total_clp),0)::int AS sales_clp
       FROM orders o
       WHERE ${IN_RANGE} AND ${SALE}
       GROUP BY ${LOCAL_DAY}`,
      [range.start, range.end]
    );

    const customers = await salesByCustomer(pool, range);

    const expenses = await pool.query(
      `SELECT COALESCE(SUM(amount_clp),0)::int AS expenses_clp
       FROM expense_records
       WHERE expense_date >= $1::date AND expense_date < $2::date`,
      [range.start, range.end]
    );

    const byPaymentMethod = await salesByPaymentMethod(pool, range);

    // Días sin órdenes reales no entran en el GROUP BY, así que no ensucian el "peor día".
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

    return res.json({
      ok: true,
      year,
      month,
      totals: { orders_count: totals.orders_count, total_clp: totals.total_clp, expenses_clp: expenses.rows[0].expenses_clp },
      orders,
      topProducts: products,
      bestSalesDay,
      worstSalesDay,
      mostOrdersDay,
      ...pickTopCustomers(customers),
      salesByPaymentMethod: byPaymentMethod,
    });
  } catch (e) {
    return sendError(res, e);
  }
});

/**
 * GET /admin/reports/yearly?year=YYYY
 */
router.get("/yearly", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const schema = z.object({ year: z.string().regex(/^\d{4}$/) });
  const parsed = schema.safeParse({ year: String(req.query.year || "") });
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Debes enviar ?year=YYYY", code: "VALIDATION_ERROR" });

  const { year } = parsed.data;
  const range = yearRange(Number(year));

  try {
    const pool = getPool();

    const totals = await salesTotals(pool, range);

    const salesByMonth = await pool.query(
      `SELECT ${LOCAL_MONTH} AS month,
              COUNT(*)::int AS orders_count,
              COALESCE(SUM(o.total_clp),0)::int AS sales_clp
       FROM orders o
       WHERE ${IN_RANGE} AND ${SALE}
       GROUP BY ${LOCAL_MONTH}`,
      [range.start, range.end]
    );

    const expensesByMonth = await pool.query(
      `SELECT EXTRACT(MONTH FROM e.expense_date)::int AS month,
              COALESCE(SUM(e.amount_clp),0)::int AS expenses_clp
       FROM expense_records e
       WHERE e.expense_date >= $1::date AND e.expense_date < $2::date
       GROUP BY EXTRACT(MONTH FROM e.expense_date)`,
      [range.start, range.end]
    );

    const customers = await salesByCustomer(pool, range);
    const products = await topProducts(pool, range);
    const byPaymentMethod = await salesByPaymentMethod(pool, range);

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

    return res.json({
      ok: true,
      year,
      totals: { orders_count: totals.orders_count, total_clp: totals.total_clp },
      monthlyBreakdown,
      bestSalesMonth,
      worstSalesMonth,
      mostOrdersMonth,
      ...pickTopCustomers(customers),
      topProducts: products,
      salesByPaymentMethod: byPaymentMethod,
    });
  } catch (e) {
    return sendError(res, e);
  }
});

module.exports = router;
