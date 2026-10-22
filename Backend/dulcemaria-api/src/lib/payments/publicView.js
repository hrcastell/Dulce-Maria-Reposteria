/**
 * Vista pública del estado de pago (lo que ve quien tiene el token de acceso
 * en la página /pago/#t=<token>). Módulo puro.
 *
 * El token es una capacidad: solo muestra código, ítems, montos, estados y
 * fechas — nunca nombre, teléfono, dirección, unidad, correo, notas ni tokens.
 * Los campos del comprobante siguen la recomendación de Transbank para la
 * página de resultado (orden, comercio, monto, autorización, fecha, tipo de
 * pago, cuotas y últimos 4 dígitos).
 */

const { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } = require("../orderStatus");
const { CAKE_ORDER_STATUS_LABELS } = require("../cakeOrderStatus");
const { PAYMENT_TYPE_LABELS } = require("./webpay/constants");
const { cakePaymentSummary } = require("./cakePayments");
const { isSuccess } = require("./stateMachine");

const MERCHANT_NAME = "Dulce María Repostería";

const MP_PAYMENT_TYPE_LABELS = Object.freeze({
  credit_card: "Tarjeta de crédito",
  debit_card: "Tarjeta de débito",
  prepaid_card: "Tarjeta de prepago",
  account_money: "Dinero en cuenta de Mercado Pago",
  ticket: "Efectivo",
  bank_transfer: "Transferencia bancaria",
  atm: "Cajero automático",
});

const POLL_MS = Object.freeze({ PROCESSING: 2000, PENDING: 5000 });

const iso = (value) => (value instanceof Date ? value.toISOString() : value || null);

function moneyStatusOf(target) {
  return target.kind === "ORDER" ? target.payment_status : target.deposit_status;
}

/** Estado público: primero el dinero y el estado del destino; luego el último intento. */
function toPublicState(target, latest) {
  const money = moneyStatusOf(target);
  if (money === "REFUNDED") return "REFUNDED";
  if (money === "PAID") return "PAID";
  if (target.status === "CANCELLED") return target.cancellation_source === "PAYMENT_EXPIRED" ? "ORDER_EXPIRED" : "ORDER_CANCELLED";
  if (!latest) return "NONE";
  switch (latest.status) {
    case "PENDING":
      return "PENDING";
    case "REJECTED":
      return "REJECTED";
    case "ABORTED":
      return "CANCELLED_BY_USER";
    case "EXPIRED":
      return "EXPIRED";
    case "FAILED":
      return "FAILED";
    case "REFUNDED":
      return "REFUNDED";
    // CREATED, COMMITTING, NEEDS_REVIEW ("estamos verificando tu pago") y un
    // éxito que todavía no se refleja en el destino.
    default:
      return "PROCESSING";
  }
}

function attemptState(attempt) {
  switch (attempt.status) {
    case "PAID":
    case "PARTIALLY_REFUNDED":
      return "PAID";
    case "REFUNDED":
      return "REFUNDED";
    case "PENDING":
      return "PENDING";
    case "REJECTED":
      return "REJECTED";
    case "ABORTED":
      return "CANCELLED_BY_USER";
    case "EXPIRED":
      return "EXPIRED";
    case "FAILED":
      return "FAILED";
    default:
      return "PROCESSING";
  }
}

function paymentTypeLabel(attempt) {
  if (!attempt.payment_type) return null;
  return attempt.provider === "WEBPAY" ? PAYMENT_TYPE_LABELS[attempt.payment_type] || null : MP_PAYMENT_TYPE_LABELS[attempt.payment_type] || null;
}

function publicPayment(attempt) {
  if (!attempt) return null;
  return {
    attempt_no: attempt.attempt_no,
    state: attemptState(attempt),
    provider: attempt.provider,
    amount_clp: Number(attempt.amount_clp),
    currency: "CLP",
    buy_order: attempt.buy_order,
    authorization_code: attempt.authorization_code || null,
    card_last4: attempt.card_last4 || null,
    payment_type: attempt.payment_type || null,
    payment_type_label: paymentTypeLabel(attempt),
    installments_number: attempt.installments_number ?? null,
    transaction_date: iso(attempt.transaction_date),
    merchant_name: MERCHANT_NAME,
  };
}

function publicTarget(target, items) {
  if (target.kind === "ORDER") {
    const total = Number(target.total_clp);
    const paid = target.payment_status === "PAID" || target.payment_status === "REFUNDED";
    return {
      type: "ORDER",
      code: target.order_code || null,
      number: target.order_no ?? null,
      status: target.status,
      status_label: ORDER_STATUS_LABELS[target.status] || target.status,
      payment_status: target.payment_status,
      payment_status_label: PAYMENT_STATUS_LABELS[target.payment_status] || target.payment_status,
      total_clp: total,
      amount_due_clp: paid ? 0 : total,
      currency: "CLP",
      created_at: iso(target.created_at),
      payment_expires_at: iso(target.payment_expires_at),
      delivery_date: target.delivery_date || null,
      items: (items || []).map((item) => ({
        name: item.product_name_snapshot,
        variant: item.variant_name || null,
        qty: Number(item.qty),
        unit_price_clp: Number(item.unit_price_clp),
        line_total_clp: Number(item.line_total_clp),
      })),
    };
  }
  const summary = cakePaymentSummary(target);
  return {
    type: "CAKE",
    code: target.order_number || null,
    number: null,
    status: target.status,
    status_label: CAKE_ORDER_STATUS_LABELS[target.status] || target.status,
    payment_status: summary.payment_status,
    deposit_status: summary.deposit_status,
    balance_status: summary.balance_status,
    total_clp: summary.total_clp,
    deposit_clp: summary.deposit_clp,
    balance_clp: summary.balance_clp,
    amount_due_clp: summary.amount_due_clp,
    currency: "CLP",
    created_at: iso(target.created_at),
    payment_expires_at: iso(target.payment_expires_at),
    delivery_date: target.delivery_date || null,
    items: [{ name: "Torta personalizada", options: (items || []).map((o) => ({ category: o.category, label: o.label })) }],
  };
}

/**
 * @param {{ target:object, items:object[], attempts:object[], providers:string[], payability:{ok:boolean}, now:Date }} input
 */
function buildPublicStatus({ target, items, attempts, providers, payability }) {
  const sorted = [...(attempts || [])].sort((a, b) => Number(a.attempt_no) - Number(b.attempt_no));
  const latest = sorted.length ? sorted[sorted.length - 1] : null;
  const success = [...sorted].reverse().find((a) => isSuccess(a.status)) || null;
  const state = toPublicState(target, latest);
  const finalState = ["PAID", "REFUNDED", "ORDER_EXPIRED", "ORDER_CANCELLED", "PROCESSING"].includes(state);
  const canRetry = Boolean(payability && payability.ok) && !finalState && (providers || []).length > 0;
  return {
    ok: true,
    state,
    target: publicTarget(target, items),
    payment: publicPayment(success || latest),
    can_retry: canRetry,
    retry_providers: canRetry ? [...providers] : [],
    poll_after_ms: POLL_MS[state] ?? null,
  };
}

module.exports = { MERCHANT_NAME, toPublicState, buildPublicStatus };
