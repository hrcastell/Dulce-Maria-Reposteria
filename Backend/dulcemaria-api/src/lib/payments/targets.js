/**
 * Destinos de un pago: orden del catálogo (`orders`) o pedido de torta
 * (`cake_orders`). Bloqueo, lectura y efectos del dinero sobre el destino.
 *
 * Órdenes: SIEMPRE a través del ciclo de vida de W1b (orderLifecycle.js), con
 * origen PAYMENT (pasarela) o SYSTEM (vencimiento): stock, cancellation_source,
 * evento y Motor de Tarifa quedan en la misma transacción del llamador.
 * Tortas: máquina de estados de cakeOrderStatus.js (origen PAYMENT/SYSTEM) y
 * columnas de abono/saldo.
 *
 * Orden de bloqueo: destino → payments → products → product_variants.
 */

const { appError } = require("../httpErrors");
const { lockOrder, applyPaymentChange, applyStatusChange } = require("../orderLifecycle");
const { recordOrderEvent } = require("../orderEvents");
const { decideCakeStatusChange } = require("../cakeOrderStatus");

const CAKE_COLUMNS = `id, order_number, status, payment_method, payment_provider, public_token, payment_expires_at, payment_link_created_at,
  deposit_status, deposit_paid_at, deposit_payment_method, balance_status, balance_paid_at, balance_payment_method,
  balance_amount_clp, cancellation_source, total_price_clp, deposit_clp, created_at, residency_declared_at, delivery_date,
  size_option_id, layers_option_id, sponge_option_id, filling_option_id, decoration_option_id, theme_option_id`;

const ORDER_COLUMNS = `id, order_no, order_code, status, payment_status, payment_method, total_clp, stock_reservation_status,
  cancellation_source, paid_at, created_at, payment_provider, payment_expires_at, public_token, channel,
  residency_declared_at, delivery_date, payment_link_created_at`;

function refOf(row) {
  if (row.order_id) return { kind: "ORDER", id: row.order_id };
  if (row.cake_order_id) return { kind: "CAKE", id: row.cake_order_id };
  throw new Error("Intento de pago sin destino.");
}

function eventRef(target) {
  return target.kind === "ORDER" ? { orderId: target.id } : { cakeOrderId: target.id };
}

function attemptColumnsFor(ref) {
  return ref.kind === "ORDER" ? { orderId: ref.id } : { cakeOrderId: ref.id };
}

async function lockTarget(client, ref) {
  if (ref.kind === "ORDER") return { kind: "ORDER", ...(await lockOrder(client, ref.id)) };
  const r = await client.query(`SELECT ${CAKE_COLUMNS} FROM cake_orders WHERE id = $1 FOR UPDATE`, [ref.id]);
  if (!r.rowCount) throw appError(404, "ORDER_NOT_FOUND", "Pedido no encontrado.");
  return { kind: "CAKE", channel: "WEB", ...r.rows[0] };
}

async function loadTarget(db, ref) {
  if (ref.kind === "ORDER") {
    const r = await db.query(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1`, [ref.id]);
    return r.rowCount ? { kind: "ORDER", ...r.rows[0] } : null;
  }
  const r = await db.query(`SELECT ${CAKE_COLUMNS} FROM cake_orders WHERE id = $1`, [ref.id]);
  return r.rowCount ? { kind: "CAKE", channel: "WEB", ...r.rows[0] } : null;
}

/** Destino de un token de acceso (los tokens son aleatorios de 256 bits: nunca chocan entre tablas). */
async function findRefByToken(db, token) {
  const order = await db.query(`SELECT id FROM orders WHERE public_token = $1`, [token]);
  if (order.rowCount) return { kind: "ORDER", id: order.rows[0].id };
  const cake = await db.query(`SELECT id FROM cake_orders WHERE public_token = $1`, [token]);
  if (cake.rowCount) return { kind: "CAKE", id: cake.rows[0].id };
  return null;
}

/** Ítems para la vista pública: líneas de la orden o etiquetas de las opciones de la torta. */
async function loadTargetItems(db, target) {
  if (target.kind === "ORDER") {
    const r = await db.query(
      `SELECT product_name_snapshot, variant_name, qty, unit_price_clp, line_total_clp
       FROM order_items WHERE order_id = $1 ORDER BY created_at ASC, id ASC`,
      [target.id]
    );
    return r.rows;
  }
  const ids = [target.theme_option_id, target.size_option_id, target.layers_option_id, target.sponge_option_id, target.filling_option_id, target.decoration_option_id].filter(Boolean);
  if (!ids.length) return [];
  const r = await db.query(
    `SELECT c.label AS category, o.label, c.sort_order
     FROM cake_config_option o JOIN cake_config_category c ON c.id = o.category_id
     WHERE o.id = ANY($1::uuid[]) ORDER BY c.sort_order`,
    [ids]
  );
  return r.rows.map((row) => ({ category: row.category, label: row.label }));
}

async function setOrderProvider(client, orderId, provider) {
  await client.query(`UPDATE orders SET payment_provider = $2 WHERE id = $1`, [orderId, provider]);
}

function paymentEventData(attempt) {
  return { payment_id: attempt.id, provider: attempt.provider, attempt_no: attempt.attempt_no, amount_clp: Number(attempt.amount_clp) };
}

async function applyOrderEffect(client, order, effect, attempt) {
  const options = { source: "PAYMENT", data: paymentEventData(attempt) };
  if (effect === "REFUND_TARGET") {
    await applyPaymentChange(client, order, "REFUNDED", options);
    return { applied: true };
  }
  if (effect === "PAY_ONLY") {
    await applyPaymentChange(client, order, "PAID", options);
    await setOrderProvider(client, order.id, attempt.provider);
    return { applied: true };
  }
  if (effect === "PAY_AND_ADVANCE") {
    const paid = (await applyPaymentChange(client, order, "PAID", options)).order;
    await applyStatusChange(client, paid, "PAID", options);
    await setOrderProvider(client, order.id, attempt.provider);
    return { applied: true };
  }
  if (effect === "REVIVE") {
    // Pago tardío sobre una orden vencida: revive solo si se puede volver a
    // tomar el stock; si no, nada de esto queda escrito y el intento pasa a
    // NEEDS_REVIEW (el dinero nunca se descarta en silencio).
    await client.query("SAVEPOINT sp_revive_order");
    try {
      const paid = (await applyPaymentChange(client, order, "PAID", options)).order;
      await applyStatusChange(client, paid, "PAID", { ...options, data: { ...options.data, revived: true } });
      await setOrderProvider(client, order.id, attempt.provider);
      await recordOrderEvent(client, { orderId: order.id, type: "ORDER_REVIVED", from: "CANCELLED", to: "PAID", source: "PAYMENT", data: options.data });
      await client.query("RELEASE SAVEPOINT sp_revive_order");
      return { applied: true };
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT sp_revive_order");
      if (error && ["OUT_OF_STOCK", "VARIANT_UNAVAILABLE", "PRODUCT_UNAVAILABLE", "VARIANT_REQUIRED", "STOCK_ALREADY_RELEASED"].includes(error.errorCode)) {
        return { applied: false, review: "LATE_PAYMENT_NO_STOCK" };
      }
      throw error;
    }
  }
  throw new Error(`Efecto desconocido: ${effect}`);
}

async function updateCake(client, sql, params) {
  const r = await client.query(sql, params);
  if (!r.rowCount) throw appError(409, "CONCURRENT_UPDATE", "El pedido de torta cambió mientras se guardaba; intenta de nuevo.");
  return r.rows[0];
}

async function applyCakeEffect(client, cake, effect, attempt) {
  const data = paymentEventData(attempt);
  if (effect === "REFUND_TARGET") {
    await updateCake(client, `UPDATE cake_orders SET deposit_status = 'REFUNDED' WHERE id = $1 AND deposit_status = 'PAID' RETURNING id`, [cake.id]);
    await recordOrderEvent(client, { cakeOrderId: cake.id, type: "CAKE_DEPOSIT_REFUNDED", from: "PAID", to: "REFUNDED", source: "PAYMENT", data });
    return { applied: true };
  }
  let nextStatus = cake.status;
  let clearSource = false;
  if (effect === "PAY_AND_ADVANCE" || effect === "REVIVE") {
    const decision = decideCakeStatusChange(cake, "CONFIRMED", { source: "PAYMENT" });
    if (!decision.ok) throw appError(decision.httpStatus, decision.code, decision.error);
    nextStatus = "CONFIRMED";
    clearSource = decision.effects.clearCancellationSource;
  } else if (effect !== "PAY_ONLY") {
    throw new Error(`Efecto desconocido: ${effect}`);
  }
  await updateCake(
    client,
    `UPDATE cake_orders
     SET deposit_status = 'PAID', deposit_paid_at = NOW(), deposit_payment_method = 'ONLINE', payment_provider = $3,
         status = $4, cancellation_source = CASE WHEN $5::boolean THEN NULL ELSE cancellation_source END
     WHERE id = $1 AND status = $2 AND deposit_status IN ('PENDING','FAILED')
     RETURNING id`,
    [cake.id, cake.status, attempt.provider, nextStatus, clearSource]
  );
  await recordOrderEvent(client, { cakeOrderId: cake.id, type: "CAKE_DEPOSIT_PAID", from: cake.deposit_status, to: "PAID", source: "PAYMENT", data });
  if (nextStatus !== cake.status) {
    await recordOrderEvent(client, {
      cakeOrderId: cake.id,
      type: "CAKE_STATUS_CHANGED",
      from: cake.status,
      to: nextStatus,
      source: "PAYMENT",
      data: { ...data, ...(clearSource ? { revived: true } : {}) },
    });
  }
  return { applied: true };
}

/**
 * Aplica el efecto del plan (stateMachine.planAttemptChange) sobre el destino
 * bloqueado. @returns {{ applied: boolean, review?: string }}
 */
function applyTargetEffect(client, target, effect, { attempt }) {
  return target.kind === "ORDER" ? applyOrderEffect(client, target, effect, attempt) : applyCakeEffect(client, target, effect, attempt);
}

/** Vence un destino impago (origen SYSTEM): orden → CANCELLED + FAILED (libera el stock); torta → CANCELLED + abono FAILED. */
async function expireTarget(client, target) {
  if (target.kind === "ORDER") {
    const cancelled = (await applyStatusChange(client, target, "CANCELLED", { source: "SYSTEM", data: { reason: "PAYMENT_EXPIRED" } })).order;
    if (cancelled.payment_status === "PENDING") {
      await applyPaymentChange(client, cancelled, "FAILED", { source: "SYSTEM", data: { reason: "PAYMENT_EXPIRED" } });
    }
    return;
  }
  const decision = decideCakeStatusChange(target, "CANCELLED", { source: "SYSTEM" });
  if (!decision.ok) throw appError(decision.httpStatus, decision.code, decision.error);
  await updateCake(
    client,
    `UPDATE cake_orders
     SET status = 'CANCELLED', cancellation_source = 'PAYMENT_EXPIRED',
         deposit_status = CASE WHEN deposit_status = 'PENDING' THEN 'FAILED' ELSE deposit_status END
     WHERE id = $1 AND status = 'PENDING_PAYMENT' RETURNING id`,
    [target.id]
  );
  await recordOrderEvent(client, {
    cakeOrderId: target.id,
    type: "CAKE_STATUS_CHANGED",
    from: target.status,
    to: "CANCELLED",
    source: "SYSTEM",
    data: { reason: "PAYMENT_EXPIRED" },
  });
}

async function setTargetDeadline(client, target, deadline) {
  const table = target.kind === "ORDER" ? "orders" : "cake_orders";
  await client.query(`UPDATE ${table} SET payment_expires_at = $2 WHERE id = $1`, [target.id, deadline]);
}

module.exports = {
  refOf,
  eventRef,
  attemptColumnsFor,
  lockTarget,
  loadTarget,
  findRefByToken,
  loadTargetItems,
  applyTargetEffect,
  expireTarget,
  setTargetDeadline,
};
