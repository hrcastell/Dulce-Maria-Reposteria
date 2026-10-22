/**
 * Mercado Pago Checkout Pro (preferencias) → resultados del proveedor. Puro.
 *
 * Verificado el 2026-10-21 en la documentación oficial (Checkout Pro con
 * preferencias; GET /v1/payments/{id}; GET /v1/payments/search; reembolsos):
 *   - aprobación = status "approved"; aquí además se exige monto entero exacto
 *     en CLP y external_reference = nuestro buy_order (si no → problemas →
 *     NEEDS_REVIEW). Nunca se confía en el cuerpo del webhook ni en la query
 *     de las back_urls: siempre se consulta el pago en la API.
 *   - `rejected` no es final para la preferencia (el comprador puede reintentar
 *     en el mismo checkout); `pending`/`in_process`/`authorized` siguen abiertos.
 *   - preferencia: `binary_mode` (solo aprobado/rechazado), vigencia con
 *     `expires` + `expiration_date_from/to` (ISO 8601 con offset), `back_urls`
 *     https + `auto_return: approved`, sin `notification_url` (webhooks del panel).
 */

const { sanitizeMpPayment, sanitizeMpRefund } = require("../sanitize");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY_MOVED = Object.freeze(["APPROVED", "PARTIALLY_REFUNDED", "REFUNDED", "CHARGEBACK", "DISPUTE"]);
const MAX_TITLE = 256;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function paymentIdText(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^\d{1,20}$/.test(value)) return value;
  return null;
}

function textOrNull(value, max = 100) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function intOrNull(value) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function isoOrNull(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

/**
 * @param {object} p pago de GET /v1/payments/{id}
 * @param {{ amountClp:number, buyOrder:string, liveMode?:boolean }} expected
 */
function mapMpPayment(p, expected) {
  const base = {
    kind: "UNKNOWN",
    problems: [],
    providerPaymentId: null,
    providerStatus: null,
    providerStatusDetail: null,
    responseCode: null,
    amountClp: null,
    currency: null,
    authorizationCode: null,
    cardLast4: null,
    paymentType: null,
    paymentTypeLabel: null,
    paymentMethodId: null,
    installmentsNumber: null,
    installmentsAmountClp: null,
    accountingDate: null,
    transactionDate: null,
    balanceClp: null,
    refundedAmountClp: 0,
    sanitized: sanitizeMpPayment(p),
  };
  const id = isObject(p) ? paymentIdText(p.id) : null;
  if (!id) return { ...base, problems: ["INVALID_RESPONSE"] };

  const outcome = {
    ...base,
    providerPaymentId: id,
    providerStatus: textOrNull(p.status, 40),
    providerStatusDetail: textOrNull(p.status_detail, 80),
    amountClp: intOrNull(p.transaction_amount),
    currency: textOrNull(p.currency_id, 8),
    authorizationCode: textOrNull(p.authorization_code, 40),
    cardLast4: isObject(p.card) && /^\d{4}$/.test(String(p.card.last_four_digits ?? "")) ? String(p.card.last_four_digits) : null,
    paymentType: textOrNull(p.payment_type_id, 40),
    paymentMethodId: textOrNull(p.payment_method_id, 40),
    installmentsNumber: intOrNull(p.installments),
    transactionDate: isoOrNull(p.date_approved) || isoOrNull(p.date_created),
    refundedAmountClp: intOrNull(p.transaction_amount_refunded) || 0,
  };

  if (p.external_reference !== expected.buyOrder) return { ...outcome, kind: "FOREIGN_REFERENCE", problems: ["REFERENCE_MISMATCH"] };

  const problems = [];
  if (p.currency_id !== "CLP") problems.push("CURRENCY_MISMATCH");
  if (!(typeof p.transaction_amount === "number" && p.transaction_amount === expected.amountClp)) problems.push("AMOUNT_MISMATCH");
  if (typeof expected.liveMode === "boolean" && typeof p.live_mode === "boolean" && p.live_mode !== expected.liveMode) {
    problems.push("LIVE_MODE_MISMATCH");
  }

  switch (p.status) {
    case "approved":
      return outcome.refundedAmountClp > 0
        ? { ...outcome, kind: "PARTIALLY_REFUNDED", problems }
        : { ...outcome, kind: "APPROVED", problems };
    case "authorized":
    case "pending":
    case "in_process":
      return { ...outcome, kind: "PENDING" };
    case "rejected":
      return { ...outcome, kind: "REJECTED_RETRYABLE" };
    case "cancelled":
      return { ...outcome, kind: "CANCELLED" };
    case "refunded":
      return { ...outcome, kind: "REFUNDED", problems, refundedAmountClp: outcome.refundedAmountClp || expected.amountClp };
    case "charged_back":
      return { ...outcome, kind: "CHARGEBACK", problems };
    case "in_mediation":
      return { ...outcome, kind: "DISPUTE", problems };
    default:
      return { ...outcome, kind: "UNKNOWN" };
  }
}

/**
 * Resultado de una búsqueda por external_reference (conciliación de un webhook
 * perdido): un pago con dinero movido manda (dos = cobro duplicado); si no,
 * pendiente > rechazado (reintentable) > cancelado > sin pagos.
 */
function pickMpSearchOutcome(results, expected) {
  const outcomes = (Array.isArray(results) ? results : [])
    .map((p) => mapMpPayment(p, expected))
    .filter((o) => o.kind !== "FOREIGN_REFERENCE" && o.providerPaymentId);
  const moved = outcomes.filter((o) => MONEY_MOVED.includes(o.kind));
  if (moved.length) {
    const primary = moved.find((o) => o.kind === "APPROVED") || moved[0];
    const distinct = new Set(moved.map((o) => o.providerPaymentId));
    const problems = distinct.size > 1 ? [...primary.problems, "DUPLICATE_PAYMENT"] : primary.problems;
    return { ...primary, problems, candidates: moved.map((o) => o.providerPaymentId) };
  }
  for (const kind of ["PENDING", "REJECTED_RETRYABLE", "CANCELLED"]) {
    const found = outcomes.find((o) => o.kind === kind);
    if (found) return found;
  }
  return { ...mapMpPayment(null, expected), kind: "NOT_COMPLETED", problems: [] };
}

/** Fecha para la preferencia: ISO 8601 con milisegundos y offset explícito +00:00. */
function toMpDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error("Fecha inválida para Mercado Pago.");
  return date.toISOString().replace(/Z$/, "+00:00");
}

/**
 * Cuerpo de POST /checkout/preferences. Sin datos del pagador (minimización)
 * y sin notification_url (los webhooks se configuran en el panel de MP).
 */
function buildPreferenceBody({ paymentId, buyOrder, amountClp, title, apiPublicUrl, now, expiresAt, statementDescriptor, maxInstallments }) {
  if (!Number.isSafeInteger(amountClp) || amountClp <= 0) throw new Error("Monto inválido para la preferencia.");
  if (!UUID.test(String(paymentId))) throw new Error("Id de intento inválido para la preferencia.");
  const base = String(apiPublicUrl || "").replace(/\/+$/, "");
  const backUrl = `${base}/public/payments/mercadopago/return/${paymentId}`;
  const body = {
    items: [{ id: buyOrder, title: String(title || "Pedido Dulce María").slice(0, MAX_TITLE), quantity: 1, unit_price: amountClp, currency_id: "CLP" }],
    external_reference: buyOrder,
    back_urls: { success: backUrl, failure: backUrl, pending: backUrl },
    auto_return: "approved",
    binary_mode: true,
    expires: true,
    expiration_date_from: toMpDate(now),
    expiration_date_to: toMpDate(expiresAt),
    metadata: { payment_id: paymentId },
  };
  if (statementDescriptor) body.statement_descriptor = statementDescriptor;
  if (Number.isSafeInteger(maxInstallments) && maxInstallments > 0) body.payment_methods = { installments: maxInstallments };
  return body;
}

/** Respuesta de POST /v1/payments/{id}/refunds → resultado del reembolso. */
function mapMpRefund(resp) {
  const sanitized = sanitizeMpRefund(resp);
  const base = { providerRefundId: null, amountClp: null, providerType: "REFUND", sanitized };
  if (!isObject(resp)) return { ...base, status: "UNKNOWN" };
  const out = { ...base, providerRefundId: paymentIdText(resp.id), amountClp: intOrNull(resp.amount) };
  if (resp.status === "approved") return { ...out, status: "SUCCEEDED" };
  if (resp.status === "rejected" || resp.status === "cancelled") return { ...out, status: "FAILED" };
  return { ...out, status: "UNKNOWN" };
}

module.exports = { mapMpPayment, pickMpSearchOutcome, buildPreferenceBody, toMpDate, mapMpRefund, MONEY_MOVED };
