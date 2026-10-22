/**
 * Único escritor de los cambios de estado y de pago de una orden.
 *
 * Aplica las decisiones puras de orderStatus.js dentro de la transacción del
 * llamador: stock (orderStock.js), origen de la cancelación, evento de
 * auditoría (orderEvents.js) y Motor de Tarifa al quedar DELIVERED, todo con el
 * mismo `client`. Lo usan las rutas del panel (source ADMIN) y lo usará la
 * unidad de pagos (source PAYMENT para la pasarela, SYSTEM para el vencimiento).
 *
 * Orden de bloqueo: lockOrder (orders) primero; orderStock bloquea después
 * products y product_variants.
 */

const { SANTIAGO_TZ } = require("./santiagoTime");
const { appError } = require("./httpErrors");
const { decideOrderStatusChange, decidePaymentStatusChange } = require("./orderStatus");
const { consumeOrderStock, releaseOrderStock, reReserveOrderStock } = require("./orderStock");
const { recordOrderEvent } = require("./orderEvents");
const { evaluateAndChargeFee } = require("./platformFeeEngine");

// Columnas que devuelven los cambios de estado/pago.
const ORDER_STATE_COLUMNS = `id, order_no, order_code, status, payment_status, payment_method, total_clp,
  stock_reservation_status, cancellation_source, paid_at, updated_at`;

const PAID_AT_SQL = Object.freeze({ SET: "NOW()", CLEAR: "NULL", KEEP: "paid_at" });

function rejectDecision(decision) {
  return appError(decision.httpStatus, decision.code, decision.error);
}

/**
 * Bloquea la orden (FOR UPDATE) con todo lo que necesitan las reglas de estado
 * y la unidad de pagos (plazo, canal, residencia, token). 404 si no existe.
 */
async function lockOrder(client, orderId) {
  const r = await client.query(
    `/* orderLifecycle:lockOrder */ SELECT id, order_no, order_code, customer_id, status, payment_status, payment_method, delivery_method,
            subtotal_clp, delivery_fee_clp, discount_amount_clp, final_price_override_clp, total_clp,
            stock_reservation_status, cancellation_source, paid_at, created_at, updated_at,
            payment_provider, payment_expires_at, public_token, channel, residency_declared_at, delivery_date, payment_link_created_at,
            to_char(created_at AT TIME ZONE '${SANTIAGO_TZ}', 'YYYY-MM-DD') AS local_date
     FROM orders WHERE id = $1 FOR UPDATE`,
    [orderId]
  );
  if (r.rowCount === 0) throw appError(404, "ORDER_NOT_FOUND", "Orden no encontrada");
  return r.rows[0];
}

/**
 * Cambia payment_status según decidePaymentStatusChange (paid_at incluido) y
 * registra el evento. `order` debe venir de lockOrder. El control de QUIÉN
 * puede (STAFF nunca) lo hace la ruta.
 * @returns {Promise<{ order: object, changed: boolean }>}
 */
async function applyPaymentChange(client, order, to, { actor = null, source = "ADMIN", note, data } = {}) {
  const decision = decidePaymentStatusChange(order, to, { source });
  if (!decision.ok) throw rejectDecision(decision);
  if (decision.noop) return { order, changed: false };
  const r = await client.query(
    `/* orderLifecycle:setPayment */ UPDATE orders SET payment_status = $2, paid_at = ${PAID_AT_SQL[decision.effects.paidAt]}
     WHERE id = $1 AND payment_status = $3
     RETURNING ${ORDER_STATE_COLUMNS}`,
    [order.id, to, order.payment_status]
  );
  if (r.rowCount === 0) throw appError(409, "CONCURRENT_UPDATE", "La orden cambió mientras se guardaba; recarga e intenta de nuevo.");
  await recordOrderEvent(client, {
    orderId: order.id,
    type: "PAYMENT_STATUS_CHANGED",
    from: order.payment_status,
    to,
    actor,
    source,
    data: { ...(data || {}), ...(note ? { note } : {}) },
  });
  return { order: { ...order, ...r.rows[0] }, changed: true };
}

/**
 * Cambia status según decideOrderStatusChange: consume/libera/vuelve a
 * reservar stock, fija o limpia cancellation_source, registra el evento y, si
 * queda DELIVERED, cobra la tarifa de plataforma en la MISMA transacción.
 * Si el mismo cambio incluye el pago, llamar antes a applyPaymentChange.
 * @returns {Promise<{ order: object, changed: boolean, stock: object|null }>}
 */
async function applyStatusChange(client, order, to, { actor = null, source = "ADMIN", note, data } = {}) {
  const decision = decideOrderStatusChange(order, to, { source });
  if (!decision.ok) throw rejectDecision(decision);
  if (decision.noop) return { order, changed: false, stock: null };

  let stock = null;
  if (decision.effects.stock === "CONSUME") stock = await consumeOrderStock(client, order.id);
  else if (decision.effects.stock === "RELEASE") stock = await releaseOrderStock(client, order.id);
  else if (decision.effects.stock === "RE_RESERVE") stock = await reReserveOrderStock(client, order.id);

  const r = await client.query(
    `/* orderLifecycle:setStatus */ UPDATE orders
     SET status = $2,
         cancellation_source = CASE WHEN $5::boolean THEN NULL ELSE COALESCE($4::text, cancellation_source) END
     WHERE id = $1 AND status = $3
     RETURNING ${ORDER_STATE_COLUMNS}`,
    [order.id, to, order.status, decision.effects.cancellationSource, decision.effects.clearCancellationSource]
  );
  if (r.rowCount === 0) throw appError(409, "CONCURRENT_UPDATE", "La orden cambió mientras se guardaba; recarga e intenta de nuevo.");
  const updated = r.rows[0];

  await recordOrderEvent(client, {
    orderId: order.id,
    type: "STATUS_CHANGED",
    from: order.status,
    to,
    actor,
    source,
    data: {
      ...(data || {}),
      ...(note ? { note } : {}),
      ...(stock && stock.changed ? { stock: { from: stock.from, to: stock.to, skipped: stock.skipped } } : {}),
    },
  });

  // Motor de Tarifa: en la MISMA transacción que el cambio a DELIVERED
  // (idempotente por UNIQUE(order_id)). DELIVERED es terminal: repetirlo es
  // un no-op y no vuelve a pasar por aquí.
  if (decision.effects.chargeFee) await evaluateAndChargeFee(client, updated);
  return { order: { ...order, ...updated }, changed: true, stock };
}

module.exports = { ORDER_STATE_COLUMNS, lockOrder, applyPaymentChange, applyStatusChange };
