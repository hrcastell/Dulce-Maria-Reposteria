/**
 * Operaciones del panel sobre pagos (backend de A01..A06). Los roles los
 * controla la ruta (src/routes/admin.payments.js).
 *
 * Nunca se devuelven tokens: ni el token de Webpay (solo un prefijo) ni el
 * token de acceso del cliente (salvo dentro del enlace de pago, a pedido).
 */

const { getPool, withTransaction } = require("../../db");
const { appError, unavailableError } = require("../httpErrors");
const { recordOrderEvent } = require("../orderEvents");
const { decideCakeStatusChange } = require("../cakeOrderStatus");
const { resolveDateRangeFilter, buildTimestampRangeClauses } = require("../santiagoTime");
const runtime = require("./runtime");
const repo = require("./repository");
const targets = require("./targets");
const { applyOutcome } = require("./apply");
const { reconcileAttempt } = require("./reconciler");
const { describePaymentsConfig } = require("./config");
const { newAccessToken, tokenHint } = require("./references");
const { isSuccess } = require("./stateMachine");
const { cakePaymentSummary, decideManualCakePayment } = require("./cakePayments");
const { getPaymentSettings, setManualEnabled, effectiveManualEnabled } = require("./settings");
const { paymentPageUrl } = require("./returns");
const { logPayment } = require("./log");

const LIST_COLUMNS = `p.id, p.order_id, p.cake_order_id, p.attempt_no, p.provider, p.environment, p.status, p.amount_clp,
  p.refunded_amount_clp, p.buy_order, p.authorization_code, p.card_last4, p.payment_type, p.installments_number,
  p.review_reason, p.provider_status, p.transaction_date, p.expires_at, p.created_at, p.finalized_at,
  o.order_no, o.order_code, co.order_number AS cake_order_number,
  COALESCE(c.full_name, co.customer_name) AS customer_name`;

/** GET /admin/payments */
async function listPayments(filters) {
  const where = [];
  const values = [];
  const add = (sql, value) => {
    values.push(value);
    where.push(sql.replace("?", `$${values.length}`));
  };
  if (filters.status) add("p.status = ?", filters.status);
  if (filters.needs_review) where.push("p.status = 'NEEDS_REVIEW'");
  if (filters.provider) add("p.provider = ?", filters.provider);
  if (filters.environment) add("p.environment = ?", filters.environment);
  if (filters.target === "ORDER") where.push("p.order_id IS NOT NULL");
  if (filters.target === "CAKE") where.push("p.cake_order_id IS NOT NULL");
  if (filters.order_id) add("p.order_id = ?", filters.order_id);
  if (filters.cake_order_id) add("p.cake_order_id = ?", filters.cake_order_id);
  if (filters.q) {
    values.push(`%${filters.q}%`);
    const n = `$${values.length}`;
    where.push(`(p.buy_order ILIKE ${n} OR o.order_code ILIKE ${n} OR co.order_number ILIKE ${n} OR p.authorization_code ILIKE ${n})`);
  }
  const range = resolveDateRangeFilter({ from: filters.from, to: filters.to });
  const { clauses, values: rangeValues } = buildTimestampRangeClauses("p.created_at", range, values.length + 1);
  where.push(...clauses);
  values.push(...rangeValues);
  values.push(filters.limit, filters.offset);
  const r = await getPool().query(
    `SELECT ${LIST_COLUMNS}, COUNT(*) OVER() AS total_count
     FROM payments p
     LEFT JOIN orders o ON o.id = p.order_id
     LEFT JOIN customers c ON c.id = o.customer_id
     LEFT JOIN cake_orders co ON co.id = p.cake_order_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY p.created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  const total = r.rowCount ? Number(r.rows[0].total_count) : 0;
  return {
    items: r.rows.map(({ total_count, ...row }) => ({ ...row, target: row.order_id ? "ORDER" : "CAKE" })),
    total,
  };
}

/** GET /admin/payments/:id — intento + eventos saneados + reembolsos. */
async function getPaymentDetail(id) {
  const pool = getPool();
  const r = await pool.query(
    `SELECT ${repo.ATTEMPT_COLUMNS.replace(/\s+/g, " ").split(",").map((c) => `p.${c.trim()}`).join(", ")}, p.provider_payload,
            o.order_no, o.order_code, o.status AS order_status, o.payment_status AS order_payment_status,
            co.order_number AS cake_order_number, co.status AS cake_status, co.deposit_status, co.balance_status
     FROM payments p
     LEFT JOIN orders o ON o.id = p.order_id
     LEFT JOIN cake_orders co ON co.id = p.cake_order_id
     WHERE p.id = $1`,
    [id]
  );
  if (!r.rowCount) throw appError(404, "PAYMENT_NOT_FOUND", "Intento de pago no encontrado.");
  const { provider_token: providerToken, client_request_id: _clientRequestId, ...payment } = r.rows[0];
  const events = await pool.query(
    `SELECT id, provider, source, event_type, from_status, to_status, signature_valid, http_status, payload, error,
            received_count, processed_at, actor_user_id, created_at, last_received_at
     FROM payment_events WHERE payment_id = $1 ORDER BY created_at ASC LIMIT 500`,
    [id]
  );
  const refunds = await pool.query(
    `SELECT id, amount_clp, status, provider_refund_id, provider_type, reason, requested_by, error, created_at, updated_at, resolved_at
     FROM payment_refunds WHERE payment_id = $1 ORDER BY created_at ASC`,
    [id]
  );
  return {
    payment: { ...payment, token_hint: tokenHint(providerToken), target: payment.order_id ? "ORDER" : "CAKE" },
    events: events.rows,
    refunds: refunds.rows,
  };
}

/** Intentos de una orden o torta para su detalle en el panel (sin tokens). */
async function listTargetPayments(ref) {
  const rows = await repo.listAttemptsForTarget(getPool(), ref);
  return rows.map(({ provider_token: providerToken, client_request_id: _c, redirect_url: _r, ...row }) => ({ ...row, token_hint: tokenHint(providerToken) }));
}

/** POST /admin/payments/:id/reconcile — conciliar ahora (lease forzado; el mismo camino que el cron). */
async function reconcileNow(attemptId) {
  const attempt = await repo.findAttemptById(getPool(), attemptId);
  if (!attempt) throw appError(404, "PAYMENT_NOT_FOUND", "Intento de pago no encontrado.");
  const result = await reconcileAttempt(attemptId, { source: "ADMIN", force: true });
  if (result.skipped) {
    throw appError(409, "RECONCILE_IN_PROGRESS", "Este pago se está conciliando en este momento; intenta en unos segundos.");
  }
  return { before: result.before, after: result.after, result: result.result };
}

/** POST /admin/payments/:id/resolve — solo SUPERADMIN; solo desde NEEDS_REVIEW. */
async function resolveReview({ attemptId, resolution, note, actor }) {
  const attempt = await repo.findAttemptById(getPool(), attemptId);
  if (!attempt) throw appError(404, "PAYMENT_NOT_FOUND", "Intento de pago no encontrado.");
  if (attempt.status !== "NEEDS_REVIEW") throw appError(409, "NOT_UNDER_REVIEW", "Este pago no está en revisión.");
  const result = await applyOutcome(attemptId, { kind: "RESOLVE", resolution, problems: [] }, {
    source: "ADMIN",
    actor,
    eventType: "REVIEW_RESOLVED",
    eventPayload: { note, resolution },
  });
  if (!result.changed) {
    if (result.plan.blockedReason) {
      throw appError(
        409,
        "RESOLUTION_NOT_APPLICABLE",
        `No se puede marcar como pagado: ${result.plan.blockedReason === "DUPLICATE_PAYMENT" ? "el pedido ya está pagado" : result.plan.blockedReason}. ` +
          "Si el dinero se cobró, reembólsalo en el portal del medio de pago y resuelve como REFUNDED; si no, elige otra resolución.",
        { blocked_reason: result.plan.blockedReason }
      );
    }
    throw appError(409, "NOT_UNDER_REVIEW", "Este pago ya no está en revisión.");
  }
  return { payment: result.attempt };
}

/**
 * POST /admin/payments/links — enlace de pago (/pago/#t=<token>) de una orden
 * EN LÍNEA o de una torta (una torta manual pasa a pago en línea del abono).
 * Sirve para las órdenes que el panel crea para no residentes autorizados.
 */
async function createPaymentLink({ orderId, cakeOrderId, actor }) {
  const ref = orderId ? { kind: "ORDER", id: orderId } : { kind: "CAKE", id: cakeOrderId };
  const result = await withTransaction(async (client) => {
    const target = await targets.lockTarget(client, ref);
    const money = target.kind === "ORDER" ? target.payment_status : target.deposit_status;
    if (target.status === "CANCELLED") throw appError(409, "ORDER_CANCELLED", "El pedido está cancelado.");
    if (money === "PAID") throw appError(409, "ORDER_ALREADY_PAID", target.kind === "ORDER" ? "La orden ya está pagada." : "El abono de la torta ya está pagado.");
    if (money === "REFUNDED") throw appError(409, "ORDER_NOT_PAYABLE", "El pago de este pedido fue reembolsado.");
    if (target.kind === "ORDER" && target.payment_method !== "ONLINE") {
      throw appError(409, "ORDER_NOT_ONLINE", 'Esta orden no es de pago en línea: créala con el método "En línea" para enviar un enlace de pago.');
    }
    const table = target.kind === "ORDER" ? "orders" : "cake_orders";
    // El enlace del panel es la autorización de la dueña para pagar en línea (también sin residencia declarada, D2).
    const updated = await client.query(
      `UPDATE ${table}
       SET public_token = COALESCE(public_token, $2), payment_link_created_at = COALESCE(payment_link_created_at, NOW())
           ${target.kind === "CAKE" ? ", payment_method = 'ONLINE'" : ""}
       WHERE id = $1 RETURNING public_token, payment_expires_at`,
      [target.id, newAccessToken()]
    );
    const created = !target.public_token;
    const switched = target.kind === "CAKE" && target.payment_method !== "ONLINE";
    await recordOrderEvent(client, {
      ...targets.eventRef(target),
      type: "PAYMENT_LINK_CREATED",
      actor,
      source: "ADMIN",
      data: { token_created: created, ...(switched ? { payment_method: { from: target.payment_method, to: "ONLINE" } } : {}) },
    });
    return { token: updated.rows[0].public_token, expiresAt: updated.rows[0].payment_expires_at, target };
  });
  const url = paymentPageUrl(result.token);
  if (!url) throw unavailableError("PAYMENTS_NOT_CONFIGURED", "Falta PUBLIC_SITE_URL: no se puede armar el enlace de pago.");
  return {
    payment_url: url,
    payment_expires_at: result.expiresAt,
    target: { type: ref.kind, id: ref.id, code: ref.kind === "ORDER" ? result.target.order_code : result.target.order_number },
  };
}

/**
 * POST /admin/payments/cake-orders/:id/manual-payment — abono (flujo manual)
 * o saldo (total − abono, al entregar). Solo ADMIN/SUPERADMIN.
 */
async function registerManualCakePayment({ cakeOrderId, part, method, note, actor }) {
  const ref = { kind: "CAKE", id: cakeOrderId };
  const outcome = await withTransaction(async (client) => {
    const cake = await targets.lockTarget(client, ref);
    const attempts = await repo.listAttemptsForTarget(client, ref, { lock: true });
    const hasManagedOnlineAttempt = attempts.some((a) => isSuccess(a.status) || a.status === "COMMITTING");
    const decision = decideManualCakePayment(cake, { part, hasManagedOnlineAttempt: part === "DEPOSIT" && hasManagedOnlineAttempt });
    if (!decision.ok) throw appError(decision.httpStatus, decision.code, decision.error);
    if (decision.noop) return { noop: true };
    const data = { tag: "ADMIN_MANUAL_PAYMENT", method, amount_clp: decision.amountClp, ...(note ? { note } : {}) };
    if (part === "DEPOSIT") {
      let nextStatus = cake.status;
      if (decision.advanceTo) {
        const statusDecision = decideCakeStatusChange(cake, decision.advanceTo, { source: "ADMIN" });
        if (statusDecision.ok && !statusDecision.noop) nextStatus = decision.advanceTo;
      }
      const r = await client.query(
        `UPDATE cake_orders SET deposit_status = 'PAID', deposit_paid_at = NOW(), deposit_payment_method = $2, status = $3
         WHERE id = $1 AND deposit_status IN ('PENDING','FAILED') AND status = $4 RETURNING id`,
        [cake.id, method, nextStatus, cake.status]
      );
      if (!r.rowCount) throw appError(409, "CONCURRENT_UPDATE", "El pedido cambió mientras se guardaba; recarga e intenta de nuevo.");
      await recordOrderEvent(client, { cakeOrderId: cake.id, type: "CAKE_DEPOSIT_PAID", from: cake.deposit_status, to: "PAID", actor, source: "ADMIN", data });
      if (nextStatus !== cake.status) {
        await recordOrderEvent(client, { cakeOrderId: cake.id, type: "CAKE_STATUS_CHANGED", from: cake.status, to: nextStatus, actor, source: "ADMIN", data: { via: "MANUAL_DEPOSIT" } });
      }
    } else {
      const r = await client.query(
        `UPDATE cake_orders SET balance_status = 'PAID', balance_paid_at = NOW(), balance_payment_method = $2, balance_amount_clp = $3
         WHERE id = $1 AND balance_status = 'PENDING' AND deposit_status = 'PAID' RETURNING id`,
        [cake.id, method, decision.amountClp]
      );
      if (!r.rowCount) throw appError(409, "CONCURRENT_UPDATE", "El pedido cambió mientras se guardaba; recarga e intenta de nuevo.");
      await recordOrderEvent(client, { cakeOrderId: cake.id, type: "CAKE_BALANCE_PAID", from: "PENDING", to: "PAID", actor, source: "ADMIN", data });
    }
    return { noop: false };
  });
  const cake = await targets.loadTarget(getPool(), ref);
  logPayment("payment.cake_manual_payment", { cake_order_id: cakeOrderId, kind: part, reason: outcome.noop ? "NOOP" : "REGISTERED" });
  return {
    noop: outcome.noop,
    cake_order: {
      id: cake.id,
      order_number: cake.order_number,
      status: cake.status,
      payment_method: cake.payment_method,
      deposit_paid_at: cake.deposit_paid_at,
      deposit_payment_method: cake.deposit_payment_method,
      balance_paid_at: cake.balance_paid_at,
      balance_payment_method: cake.balance_payment_method,
      ...cakePaymentSummary(cake),
    },
  };
}

/** GET /admin/payments/config-status — sin secretos. */
async function getConfigStatus() {
  const config = runtime.getConfig();
  const described = describePaymentsConfig(config, { schemaOk: runtime.schemaOk() });
  const settings = await getPaymentSettings(getPool());
  const report = runtime.schemaReport();
  return {
    ...described,
    schema: { ok: report.ok, missing: report.missing, warnings: report.warnings },
    manual: { enabled: settings.manual_enabled, effective: effectiveManualEnabled(settings, runtime.enabledProviders()) },
  };
}

/** PUT /admin/payments/settings — flujo manual de respaldo (SUPERADMIN/ADMIN). */
async function updatePaymentSettings({ manualEnabled, actor }) {
  await setManualEnabled(getPool(), manualEnabled);
  logPayment("payment.settings_changed", { kind: "MANUAL_ENABLED", reason: String(manualEnabled), source: actor?.role || "ADMIN" });
  return getConfigStatus();
}

module.exports = {
  listPayments,
  getPaymentDetail,
  listTargetPayments,
  reconcileNow,
  resolveReview,
  createPaymentLink,
  registerManualCakePayment,
  getConfigStatus,
  updatePaymentSettings,
};
