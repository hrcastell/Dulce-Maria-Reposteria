const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");

const { getPool, withTransaction } = require("../db");
const { requireRole, requirePermission } = require("../middleware/auth");
const { validateUuidParam } = require("../middleware/validate-uuid");
const { evaluateAndChargeFee } = require("../lib/platformFeeEngine");
const { validationError, sendError, appError } = require("../lib/httpErrors");
const { clpAmount, isoDateOrDateTime, optionalQuery, searchTerm } = require("../lib/schemas");
const {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_METHODS,
  MANUAL_PAYMENT_METHODS,
  DELIVERY_METHODS,
  decidePaymentStatusChange,
  validateNewOrderState,
  staffOrderRestrictions,
  describeOrderVocabulary,
} = require("../lib/orderStatus");
const { resolveOrderLines, loadOrderLines, insertOrderLines, planOrderEdit, computeOrderTotals } = require("../lib/orderLines");
const { reserveOrderStock, adjustOrderStockForEdit } = require("../lib/orderStock");
const { recordOrderEvent, listOrderEvents } = require("../lib/orderEvents");
const { lockOrder, applyPaymentChange, applyStatusChange } = require("../lib/orderLifecycle");
const { listTargetPayments } = require("../lib/payments/adminOps");
const {
  SANTIAGO_TZ,
  santiagoToday,
  validateOrderDate,
  resolveDateRangeFilter,
  buildTimestampRangeClauses,
} = require("../lib/santiagoTime");

const router = express.Router();

// Límites de validación de la frontera HTTP.
const MAX_ORDER_LINES = 100;
const MAX_TOPPINGS_PER_LINE = 20;
const MAX_LINE_QTY = 10000;
const MAX_NOTE_CHARS = 300;

const ALL_ROLES = ["SUPERADMIN", "ADMIN", "STAFF"];
const ADMIN_ROLES = ["SUPERADMIN", "ADMIN"];
const ISO_DATE_INPUT = /^\d{4}-\d{2}-\d{2}$/;

/** Código visible de una orden del panel (24 caracteres; aleatorio para no chocar en el mismo milisegundo). */
function newAdminOrderCode() {
  return `ORD-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

const lineSchema = z.object({
  productId: z.string().uuid(),
  qty: z.number().int().positive().max(MAX_LINE_QTY),
  variantId: z.string().uuid().optional().nullable(),
  toppings: z.array(z.string().uuid()).max(MAX_TOPPINGS_PER_LINE).optional().default([]), // IDs de toppings
});

function toLineItems(items) {
  return items.map((item) => ({
    productId: item.productId,
    variantId: item.variantId || null,
    qty: item.qty,
    toppings: item.toppings || [],
  }));
}

function actorOf(req) {
  return { sub: req.user?.sub, email: req.user?.email, role: req.user?.role };
}

function rejectDecision(decision) {
  return appError(decision.httpStatus, decision.code, decision.error);
}

// --- Guardas de pagos en línea (unidad de pagos, payments-design §5.5) -------
// Se bloquean los intentos DESPUÉS de la orden (orden de bloqueo fijo:
// orders → payments → products → variants).
const MANAGED_ATTEMPT_STATUSES = ["COMMITTING", "PAID", "PARTIALLY_REFUNDED", "REFUNDED"];

async function lockOrderAttempts(client, orderId) {
  const r = await client.query(`SELECT id, status FROM payments WHERE order_id = $1 ORDER BY attempt_no FOR UPDATE`, [orderId]);
  return r.rows;
}

/** Cancelar con un commit de Webpay en curso dejaría dinero sin orden: 409. */
function assertNoPaymentInProgress(attempts) {
  if (attempts.some((a) => a.status === "COMMITTING")) {
    throw appError(409, "PAYMENT_IN_PROGRESS", "Hay un pago en línea confirmándose en este momento; espera unos segundos y vuelve a intentar.");
  }
}

/** Un pago manual sobre una orden en línea ya gestionada por la pasarela: 409. */
function assertNotManagedOnline(order, attempts) {
  if (order.payment_method === "ONLINE" && attempts.some((a) => MANAGED_ATTEMPT_STATUSES.includes(a.status))) {
    throw appError(
      409,
      "ONLINE_PAYMENT_MANAGED",
      "El pago en línea de esta orden ya fue procesado (o se está confirmando) por la pasarela: concilia o reembolsa desde Pagos."
    );
  }
}

function manualPaymentData(to) {
  return to === "PAID" ? { tag: "ADMIN_MANUAL_PAYMENT" } : undefined;
}

function stateResponse(order, { noop = false } = {}) {
  return {
    ok: true,
    noop,
    order: {
      id: order.id,
      order_no: order.order_no,
      order_code: order.order_code,
      status: order.status,
      payment_status: order.payment_status,
      payment_method: order.payment_method,
      total_clp: order.total_clp,
      stock_reservation_status: order.stock_reservation_status,
      cancellation_source: order.cancellation_source,
      paid_at: order.paid_at,
      updated_at: order.updated_at,
    },
  };
}

const listQuerySchema = z.object({
  from: optionalQuery(isoDateOrDateTime),
  to: optionalQuery(isoDateOrDateTime),
  status: optionalQuery(z.enum(ORDER_STATUSES)),
  q: optionalQuery(searchTerm),
});

/**
 * GET /admin/orders?from&to&status&q
 * from/to: fecha AAAA-MM-DD (día de Santiago; `to` incluye ese día) o
 * instante ISO (fin exclusivo). q: código de orden, número, cliente o unidad.
 */
router.get("/", requireRole(...ALL_ROLES), requirePermission("orders", "canView"), async (req, res) => {
  const query = listQuerySchema.safeParse(req.query);
  if (!query.success) return validationError(res, query.error);
  const { status, q } = query.data;

  try {
    const range = resolveDateRangeFilter({ from: query.data.from, to: query.data.to });
    const { clauses, values } = buildTimestampRangeClauses("o.created_at", range, 1);
    const where = [...clauses];
    const vals = [...values];
    let n = vals.length + 1;
    if (status) { where.push(`o.status = $${n++}`); vals.push(status); }
    if (q) {
      const like = `%${q}%`;
      const conditions = [
        `o.order_code ILIKE $${n}`,
        `c.full_name ILIKE $${n}`,
        `c.phone ILIKE $${n}`,
        `c.email ILIKE $${n}`,
        `o.residency_unit ILIKE $${n}`,
      ];
      vals.push(like);
      n++;
      if (/^#?\d{1,15}$/.test(q)) {
        conditions.push(`o.order_no = $${n++}::bigint`);
        vals.push(q.replace("#", ""));
      }
      where.push(`(${conditions.join(" OR ")})`);
    }

    const r = await getPool().query(
      `SELECT
         o.id, o.order_no, o.order_code, o.status, o.payment_status, o.payment_method, o.delivery_method,
         o.subtotal_clp, o.delivery_fee_clp, o.total_clp, o.created_at,
         o.stock_reservation_status, o.residency_unit, o.residency_declared_at, o.delivery_date, o.paid_at,
         o.payment_provider, o.payment_expires_at, o.channel,
         c.id AS customer_id, c.full_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
         c.source AS customer_source
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY o.created_at DESC
       LIMIT 1000000000`,
      vals
    );
    return res.json({ ok: true, items: r.rows });
  } catch (e) {
    return sendError(res, e);
  }
});

/**
 * GET /admin/orders/statuses
 * Vocabularios (con etiquetas en español) y transiciones permitidas: la
 * única definición que deben usar las pantallas.
 */
router.get("/statuses", requireRole(...ALL_ROLES), (req, res) => {
  return res.json({ ok: true, ...describeOrderVocabulary() });
});

/**
 * GET /admin/orders/pending-notifications
 * Pedidos pendientes de las últimas 24 h (órdenes y tortas) para el aviso en
 * tiempo real del panel.
 *
 * Registrada ANTES de /:id a propósito: Express matchea rutas en orden de
 * registro, así que si esta fuera declarada después, /:id la capturaría
 * primero (tratando "pending-notifications" como el :id) y validateUuidParam
 * la rechazaría con 400 en cada poll.
 */
router.get("/pending-notifications", requireRole(...ALL_ROLES), requirePermission("orders", "canView"), async (req, res) => {
  try {
    const pool = getPool();
    // Pedidos que requieren atención: los manuales pendientes y los pagados en
    // línea en las últimas 24 h. Un pedido en línea impago (carrito en espera
    // del pago) NO avisa: vence solo si no se paga.
    const r = await pool.query(
      `SELECT o.id, o.order_no, o.order_code, o.status, o.payment_status, o.payment_method, o.payment_provider,
              o.total_clp, o.created_at, o.paid_at, o.residency_unit,
              c.full_name AS customer_name, c.phone AS customer_phone
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       WHERE (o.status = 'PENDING_PAYMENT' AND o.payment_method <> 'ONLINE' AND o.created_at >= NOW() - INTERVAL '24 hours')
          OR (o.payment_method = 'ONLINE' AND o.status = 'PAID' AND o.payment_status = 'PAID' AND o.paid_at >= NOW() - INTERVAL '24 hours')
       ORDER BY COALESCE(o.paid_at, o.created_at) DESC
       LIMIT 50`
    );

    // Tortas: se crean en PENDING_PAYMENT (antes se buscaba 'PENDING', que
    // nunca se escribía, y las tortas web no avisaban — B-20). Las de abono en
    // línea avisan cuando el abono queda pagado (pasan a CONFIRMED).
    const cakeR = await pool.query(
      `SELECT co.id, co.order_number, co.status, co.total_price_clp, co.deposit_clp, co.payment_method, co.deposit_status,
              co.created_at, co.deposit_paid_at, co.customer_name, co.customer_phone, co.residency_unit
       FROM cake_orders co
       WHERE (co.status = 'PENDING_PAYMENT' AND co.payment_method <> 'ONLINE' AND co.created_at >= NOW() - INTERVAL '24 hours')
          OR (co.payment_method = 'ONLINE' AND co.deposit_status = 'PAID' AND co.status = 'CONFIRMED'
              AND co.deposit_paid_at >= NOW() - INTERVAL '24 hours')
       ORDER BY COALESCE(co.deposit_paid_at, co.created_at) DESC
       LIMIT 50`
    );

    const review = await pool.query(`SELECT COUNT(*)::int AS n FROM payments WHERE status = 'NEEDS_REVIEW'`);

    return res.json({
      ok: true,
      orders: r.rows,
      cake_orders: cakeR.rows,
      total: r.rowCount + cakeR.rowCount,
      payments_needing_review: review.rows[0].n,
    });
  } catch (e) {
    return sendError(res, e);
  }
});

/**
 * GET /admin/orders/:id
 * Detalle de una venta (cabecera + items + historial de cambios)
 */
router.get("/:id", requireRole(...ALL_ROLES), validateUuidParam("id"), requirePermission("orders", "canView"), async (req, res) => {
  const { id } = req.params;

  try {
    const pool = getPool();

    const o = await pool.query(
      `SELECT o.*, c.full_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
              c.address AS customer_address, c.source AS customer_source
       FROM orders o
       JOIN customers c ON c.id=o.customer_id
       WHERE o.id=$1`,
      [id]
    );

    if (o.rowCount === 0) return res.status(404).json({ ok: false, error: "Orden no encontrada" });
    // El token de acceso del cliente no viaja en el detalle (el enlace se pide en POST /admin/payments/links).
    const { public_token: publicToken, ...order } = o.rows[0];

    const items = await pool.query(
      `SELECT id, product_id, product_name_snapshot, unit_price_clp, qty, line_total_clp, created_at,
              variant_id, variant_name, selected_toppings
       FROM order_items
       WHERE order_id=$1
       ORDER BY created_at ASC, id ASC`,
      [id]
    );

    const events = await listOrderEvents(pool, { orderId: id, limit: 100 });
    const payments = await listTargetPayments({ kind: "ORDER", id });

    return res.json({ ok: true, order: { ...order, has_payment_link: Boolean(publicToken) }, items: items.rows, events, payments });
  } catch (e) {
    return sendError(res, e);
  }
});

const createSchema = z.object({
  customerId: z.string().uuid(),
  items: z.array(lineSchema).min(1).max(MAX_ORDER_LINES),

  deliveryMethod: z.enum(DELIVERY_METHODS).default("PICKUP"),
  deliveryFeeClp: clpAmount().default(0),

  paymentMethod: z.enum(PAYMENT_METHODS).default("CASH"),
  paymentStatus: z.enum(PAYMENT_STATUSES).default("PAID"),

  status: z.enum(ORDER_STATUSES).default("DELIVERED"),

  discountAmountClp: clpAmount().default(0),
  finalPriceOverrideClp: clpAmount().optional().nullable(),

  // Fecha real de la venta (para registrar ventas de días anteriores sin
  // tocar la BD a mano). Opcional: si no viene, created_at usa NOW().
  orderDate: z.string().regex(ISO_DATE_INPUT, "Fecha inválida: usa AAAA-MM-DD.").optional(),
});

/**
 * POST /admin/orders
 * Venta del panel (modelo POS): valida y cotiza en el servidor, descuenta el
 * stock (reserva CONSUMED) e inserta orden + items + evento en una sola
 * transacción. Si nace DELIVERED (el valor por defecto) cobra la tarifa de
 * plataforma en esa misma transacción.
 * STAFF no puede fijar precio final, descuentos ni otra fecha (B-10).
 */
router.post("/", requireRole(...ALL_ROLES), requirePermission("orders", "canCreate"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const d = parsed.data;

  const today = santiagoToday();
  if (req.user.role === "STAFF") {
    const problems = staffOrderRestrictions({
      finalPriceOverrideClp: d.finalPriceOverrideClp,
      discountAmountClp: d.discountAmountClp,
      orderDate: d.orderDate,
      today,
    });
    if (problems.length) return res.status(403).json({ ok: false, error: problems.join(" "), code: "PERMISSION_DENIED" });
  }
  if (d.orderDate) {
    const dateCheck = validateOrderDate(d.orderDate, { today });
    if (!dateCheck.ok) return res.status(400).json({ ok: false, error: dateCheck.error, code: "VALIDATION_ERROR" });
  }
  const initialState = validateNewOrderState({ status: d.status, payment_status: d.paymentStatus, payment_method: d.paymentMethod });
  if (!initialState.ok) return res.status(400).json({ ok: false, error: initialState.error, code: "INVALID_ORDER_STATE" });

  try {
    const created = await withTransaction(async (client) => {
      const c = await client.query("SELECT id FROM customers WHERE id=$1 LIMIT 1", [d.customerId]);
      if (c.rowCount === 0) throw appError(400, "CUSTOMER_NOT_FOUND", "Cliente no existe");

      const { lines, subtotal } = await resolveOrderLines(client, toLineItems(d.items), { allowToppings: true });
      const totals = computeOrderTotals({
        subtotal,
        deliveryFeeClp: d.deliveryFeeClp,
        discountAmountClp: d.discountAmountClp,
        finalPriceOverrideClp: d.finalPriceOverrideClp,
      });

      // Fecha: la del día elegido (calendario de Chile) con la hora actual de
      // Chile; nunca depende de la zona horaria de la sesión de PostgreSQL.
      const ts = await client.query(
        `SELECT COALESCE(($1::date + (NOW() AT TIME ZONE '${SANTIAGO_TZ}')::time) AT TIME ZONE '${SANTIAGO_TZ}', NOW()) AS created_at`,
        [d.orderDate ?? null]
      );
      const createdAt = ts.rows[0].created_at;

      const orderId = crypto.randomUUID();
      const o = await client.query(
        `INSERT INTO orders (
            id, order_code, customer_id, status, payment_status, payment_method, delivery_method,
            subtotal_clp, delivery_fee_clp, discount_amount_clp, final_price_override_clp, total_clp,
            paid_at, created_at, updated_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
         RETURNING id, order_no, order_code, status, payment_status, total_clp`,
        [
          orderId, newAdminOrderCode(), d.customerId, d.status, d.paymentStatus, d.paymentMethod, d.deliveryMethod,
          totals.subtotal, totals.deliveryFee, totals.discount, totals.finalPriceOverride, totals.total,
          d.paymentStatus === "PAID" ? createdAt : null, createdAt,
        ]
      );
      await insertOrderLines(client, orderId, lines);

      // Venta del panel: el stock se descuenta al crearla (CONSUMED).
      const stock = await reserveOrderStock(client, orderId, { target: "CONSUMED" });

      await recordOrderEvent(client, {
        orderId,
        type: "ORDER_CREATED",
        to: d.status,
        actor: actorOf(req),
        source: "ADMIN",
        data: {
          channel: "ADMIN",
          payment_status: d.paymentStatus,
          payment_method: d.paymentMethod,
          total_clp: totals.total,
          stock: stock.to,
          ...(d.orderDate ? { order_date: d.orderDate } : {}),
          ...(totals.finalPriceOverride !== null ? { final_price_override_clp: totals.finalPriceOverride } : {}),
          ...(totals.discount ? { discount_amount_clp: totals.discount } : {}),
        },
      });

      // Motor de Tarifa: si la orden nace cerrada (DELIVERED, modelo POS) se
      // cobra en la MISMA transacción: nunca queda DELIVERED sin su cobro.
      const order = o.rows[0];
      if (order.status === "DELIVERED") await evaluateAndChargeFee(client, order);
      return { ...order, stock_reservation_status: stock.to };
    });

    return res.json({
      ok: true,
      order: {
        id: created.id,
        orderNo: created.order_no,
        orderCode: created.order_code,
        status: created.status,
        paymentStatus: created.payment_status,
        totalClp: created.total_clp,
        stockReservationStatus: created.stock_reservation_status,
      },
    });
  } catch (e) {
    return sendError(res, e, { defaultStatus: 400 });
  }
});

const editSchema = z.object({
  customerId: z.string().uuid(),
  items: z.array(lineSchema).min(1).max(MAX_ORDER_LINES),

  // Sin valores por defecto: lo que no viene conserva el valor guardado.
  deliveryMethod: z.enum(DELIVERY_METHODS).optional(),
  deliveryFeeClp: clpAmount().optional(),

  // ONLINE no se asigna editando (lo define el flujo de pago en línea): ver la ruta.
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),

  discountAmountClp: clpAmount().optional(),
  finalPriceOverrideClp: clpAmount().optional().nullable(),

  orderDate: z.string().regex(ISO_DATE_INPUT, "Fecha inválida: usa AAAA-MM-DD.").optional(),
});

/**
 * PUT /admin/orders/:id
 * Edición completa (solo ADMIN/SUPERADMIN): cliente, items, entrega, pago,
 * fecha. El status NO se toca acá (solo PATCH /:id/status).
 *
 * - Prohibida en órdenes DELIVERED o CANCELLED y en órdenes con pago en línea (409).
 * - Las líneas que no cambian de identidad (producto + variante + toppings)
 *   conservan su precio y nombre guardados; solo las nuevas se cotizan hoy.
 * - Stock: si la orden tiene stock tomado (RESERVED/CONSUMED) se aplica solo
 *   la diferencia; si no tomó stock (pedido web manual sin confirmar), nada.
 * - Campos omitidos conservan su valor (sin valores por defecto).
 * - created_at solo cambia si cambia la fecha de calendario (Chile), y
 *   conserva la hora original.
 * - No dispara el Motor de Tarifa (una orden DELIVERED no se edita).
 */
router.put("/:id", requireRole(...ADMIN_ROLES), validateUuidParam("id"), requirePermission("orders", "canEdit"), async (req, res) => {
  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const { id } = req.params;
  const d = parsed.data;
  const actor = actorOf(req);

  try {
    const edited = await withTransaction(async (client) => {
      const order = await lockOrder(client, id);
      if (order.status === "DELIVERED" || order.status === "CANCELLED") {
        throw appError(
          409,
          "ORDER_NOT_EDITABLE",
          order.status === "DELIVERED" ? "Una orden entregada no se puede editar." : "Una orden cancelada no se puede editar."
        );
      }
      if (order.payment_method === "ONLINE") {
        throw appError(
          409,
          "ONLINE_ORDER_NOT_EDITABLE",
          "Una orden con pago en línea no se puede editar: el monto cobrado depende de sus líneas originales."
        );
      }
      if (d.paymentMethod !== undefined && !MANUAL_PAYMENT_METHODS.includes(d.paymentMethod)) {
        throw appError(400, "VALIDATION_ERROR", "El pago en línea no se asigna editando la orden: usa Transferencia o Efectivo.");
      }

      if (d.orderDate && d.orderDate !== order.local_date) {
        const dateCheck = validateOrderDate(d.orderDate, { today: santiagoToday() });
        if (!dateCheck.ok) throw appError(400, "VALIDATION_ERROR", dateCheck.error);
      }

      const c = await client.query("SELECT id FROM customers WHERE id=$1 LIMIT 1", [d.customerId]);
      if (c.rowCount === 0) throw appError(400, "CUSTOMER_NOT_FOUND", "Cliente no existe");

      const previousLines = await loadOrderLines(client, id);
      const items = toLineItems(d.items);
      // Orden de bloqueo fijo (orders → products → variants): se bloquean primero
      // TODOS los productos involucrados (líneas anteriores y nuevas).
      const productIds = [...new Set([...previousLines.map((l) => l.product_id), ...items.map((i) => i.productId)])].sort();
      await client.query(`SELECT id FROM products WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [productIds]);

      const plan = planOrderEdit(previousLines, items);
      const newItems = plan.slots.filter((slot) => slot.kind === "new").map((slot) => slot.item);
      const resolved = newItems.length ? await resolveOrderLines(client, newItems, { allowToppings: true }) : { lines: [] };
      let next = 0;
      const lines = plan.slots.map((slot) => (slot.kind === "kept" ? slot.line : resolved.lines[next++]));
      const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);

      const totals = computeOrderTotals({
        subtotal,
        deliveryFeeClp: d.deliveryFeeClp ?? order.delivery_fee_clp,
        discountAmountClp: d.discountAmountClp ?? order.discount_amount_clp,
        finalPriceOverrideClp: d.finalPriceOverrideClp !== undefined ? d.finalPriceOverrideClp : order.final_price_override_clp,
      });

      let paymentDecision = null;
      if (d.paymentStatus !== undefined && d.paymentStatus !== order.payment_status) {
        paymentDecision = decidePaymentStatusChange(order, d.paymentStatus, { source: "ADMIN" });
        if (!paymentDecision.ok) throw rejectDecision(paymentDecision);
      }

      const stock = await adjustOrderStockForEdit(client, { orderId: id, previousLines, nextLines: lines });

      const paidAtSql = paymentDecision ? { SET: "NOW()", CLEAR: "NULL", KEEP: "paid_at" }[paymentDecision.effects.paidAt] : "paid_at";
      const updated = await client.query(
        `UPDATE orders SET
           customer_id = $2,
           delivery_method = $3,
           payment_method = $4,
           payment_status = $5,
           paid_at = ${paidAtSql},
           subtotal_clp = $6, delivery_fee_clp = $7, discount_amount_clp = $8,
           final_price_override_clp = $9, total_clp = $10,
           created_at = CASE
             WHEN $11::date IS NULL OR $11::date = (created_at AT TIME ZONE '${SANTIAGO_TZ}')::date THEN created_at
             ELSE ($11::date + (created_at AT TIME ZONE '${SANTIAGO_TZ}')::time) AT TIME ZONE '${SANTIAGO_TZ}'
           END
         WHERE id = $1
         RETURNING id, order_no, order_code, status, payment_status, payment_method, total_clp,
                   stock_reservation_status, created_at`,
        [
          id,
          d.customerId,
          d.deliveryMethod ?? order.delivery_method,
          d.paymentMethod ?? order.payment_method,
          d.paymentStatus ?? order.payment_status,
          totals.subtotal,
          totals.deliveryFee,
          totals.discount,
          totals.finalPriceOverride,
          totals.total,
          d.orderDate ?? null,
        ]
      );

      await client.query(`DELETE FROM order_items WHERE order_id = $1`, [id]);
      await insertOrderLines(client, id, lines);

      const keptCount = plan.slots.filter((slot) => slot.kind === "kept").length;
      await recordOrderEvent(client, {
        orderId: id,
        type: "ORDER_EDITED",
        from: String(order.total_clp),
        to: String(totals.total),
        actor,
        source: "ADMIN",
        data: {
          lines: { before: previousLines.length, after: lines.length, kept_prices: keptCount, repriced: lines.length - keptCount },
          ...(order.customer_id !== d.customerId ? { customer_changed: true } : {}),
          ...(d.paymentMethod && d.paymentMethod !== order.payment_method ? { payment_method: { from: order.payment_method, to: d.paymentMethod } } : {}),
          ...(d.orderDate && d.orderDate !== order.local_date ? { order_date: { from: order.local_date, to: d.orderDate } } : {}),
          stock: stock.applied ? { changes: stock.changes, skipped: stock.skipped } : { reservation: stock.reservation, applied: false },
        },
      });
      if (paymentDecision && !paymentDecision.noop) {
        await recordOrderEvent(client, {
          orderId: id,
          type: "PAYMENT_STATUS_CHANGED",
          from: order.payment_status,
          to: d.paymentStatus,
          actor,
          source: "ADMIN",
          data: { via: "ORDER_EDIT" },
        });
      }
      return updated.rows[0];
    });

    return res.json({
      ok: true,
      order: {
        id: edited.id,
        orderNo: edited.order_no,
        orderCode: edited.order_code,
        status: edited.status,
        paymentStatus: edited.payment_status,
        totalClp: edited.total_clp,
        stockReservationStatus: edited.stock_reservation_status,
      },
    });
  } catch (e) {
    return sendError(res, e, { defaultStatus: 400 });
  }
});

const statusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  // Opcional: registrar el pago en la misma operación (atómico; solo ADMIN/SUPERADMIN).
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  note: z.string().trim().max(MAX_NOTE_CHARS).optional(),
});

/**
 * PATCH /admin/orders/:id/status  { status, paymentStatus?, note? }
 * Cambia el estado según la tabla de transiciones (lib/orderStatus.js): 409
 * con mensaje en español si no está permitido; repetir el estado actual es un
 * no-op. Con `paymentStatus` el pago se aplica primero, en la misma
 * transacción (p. ej. marcar "Pagado" + pago "Pagado" de una vez).
 */
router.patch("/:id/status", requireRole(...ALL_ROLES), validateUuidParam("id"), requirePermission("orders", "canUpdateStatus"), async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const { id } = req.params;
  const d = parsed.data;
  const actor = actorOf(req);

  try {
    const result = await withTransaction(async (client) => {
      let order = await lockOrder(client, id);
      const attempts = await lockOrderAttempts(client, id);
      if (d.status === "CANCELLED" && d.status !== order.status) assertNoPaymentInProgress(attempts);
      let changed = false;
      if (d.paymentStatus !== undefined && d.paymentStatus !== order.payment_status) {
        if (!ADMIN_ROLES.includes(req.user.role)) {
          throw appError(403, "PERMISSION_DENIED", "Solo un administrador puede cambiar el estado de pago.");
        }
        assertNotManagedOnline(order, attempts);
        order = (
          await applyPaymentChange(client, order, d.paymentStatus, { actor, source: "ADMIN", note: d.note, data: manualPaymentData(d.paymentStatus) })
        ).order;
        changed = true;
      }
      const statusResult = await applyStatusChange(client, order, d.status, { actor, source: "ADMIN", note: d.note });
      return { order: statusResult.order, changed: changed || statusResult.changed };
    });
    return res.json(stateResponse(result.order, { noop: !result.changed }));
  } catch (e) {
    return sendError(res, e);
  }
});

const paymentSchema = z.object({
  paymentStatus: z.enum(PAYMENT_STATUSES),
  note: z.string().trim().max(MAX_NOTE_CHARS).optional(),
});

/**
 * PATCH /admin/orders/:id/payment  { paymentStatus, note? }
 * payment_status es la única fuente de verdad del dinero: solo ADMIN o
 * SUPERADMIN pueden cambiarlo (STAFF recibe 403), con las transiciones de
 * lib/orderStatus.js. Reenviar el valor actual es un no-op para cualquier rol
 * (el modal del panel siempre manda ambos campos).
 */
router.patch("/:id/payment", requireRole(...ALL_ROLES), validateUuidParam("id"), requirePermission("orders", "canUpdateStatus"), async (req, res) => {
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const { id } = req.params;
  const d = parsed.data;

  try {
    const result = await withTransaction(async (client) => {
      const order = await lockOrder(client, id);
      if (d.paymentStatus === order.payment_status) return { order, changed: false };
      if (!ADMIN_ROLES.includes(req.user.role)) {
        throw appError(403, "PERMISSION_DENIED", "Solo un administrador puede cambiar el estado de pago.");
      }
      assertNotManagedOnline(order, await lockOrderAttempts(client, id));
      return applyPaymentChange(client, order, d.paymentStatus, {
        actor: actorOf(req),
        source: "ADMIN",
        note: d.note,
        data: manualPaymentData(d.paymentStatus),
      });
    });
    return res.json(stateResponse(result.order, { noop: !result.changed }));
  } catch (e) {
    return sendError(res, e);
  }
});

module.exports = router;
