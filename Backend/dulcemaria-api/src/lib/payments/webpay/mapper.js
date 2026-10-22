/**
 * Respuestas de Webpay (commit y status comparten forma) → resultado del
 * proveedor (ProviderOutcome). Módulo puro.
 *
 * Aprobación (documentación oficial): status EXACTAMENTE "AUTHORIZED" y
 * response_code EXACTAMENTE 0 (número). Además, para declarar PAID el monto,
 * el buy_order y el session_id deben coincidir con lo guardado; si no, el
 * resultado lleva `problems` y el intento queda NEEDS_REVIEW. No se valida
 * `vci` (la referencia lo desaconseja).
 */

const { sanitizeWebpayPayload, last4 } = require("../sanitize");
const { PAYMENT_TYPE_LABELS } = require("./constants");

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function intOrNull(value) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function textOrNull(value, max = 100) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function isoDateOrNull(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return value;
}

function identityProblems(resp, expected) {
  const problems = [];
  if (resp.amount !== undefined && !(typeof resp.amount === "number" && resp.amount === expected.amountClp)) {
    problems.push("AMOUNT_MISMATCH");
  }
  if (resp.buy_order !== undefined && resp.buy_order !== expected.buyOrder) problems.push("BUY_ORDER_MISMATCH");
  if (resp.session_id !== undefined && resp.session_id !== expected.sessionId) problems.push("SESSION_MISMATCH");
  return problems;
}

/**
 * @param {object} resp respuesta JSON de PUT/GET /transactions/{token}
 * @param {{ amountClp:number, buyOrder:string, sessionId:string }} expected
 */
function mapWebpayTransaction(resp, expected) {
  const base = {
    kind: "UNKNOWN",
    problems: [],
    providerStatus: null,
    responseCode: null,
    amountClp: null,
    authorizationCode: null,
    cardLast4: null,
    paymentType: null,
    paymentTypeLabel: null,
    installmentsNumber: null,
    installmentsAmountClp: null,
    accountingDate: null,
    transactionDate: null,
    balanceClp: null,
    refundedAmountClp: 0,
    providerPaymentId: null,
    sanitized: sanitizeWebpayPayload(resp),
  };
  if (!isObject(resp)) return { ...base, problems: ["INVALID_RESPONSE"] };

  const paymentType = textOrNull(resp.payment_type_code, 4);
  const outcome = {
    ...base,
    providerStatus: textOrNull(resp.status, 40),
    responseCode: intOrNull(resp.response_code),
    amountClp: intOrNull(resp.amount),
    authorizationCode: textOrNull(resp.authorization_code, 20),
    cardLast4: isObject(resp.card_detail) ? last4(resp.card_detail.card_number) || null : null,
    paymentType,
    paymentTypeLabel: paymentType ? PAYMENT_TYPE_LABELS[paymentType] || null : null,
    installmentsNumber: intOrNull(resp.installments_number),
    installmentsAmountClp: intOrNull(resp.installments_amount),
    accountingDate: textOrNull(resp.accounting_date, 8),
    transactionDate: isoDateOrNull(resp.transaction_date),
    balanceClp: intOrNull(resp.balance),
  };
  const problems = identityProblems(resp, expected);

  switch (resp.status) {
    case "AUTHORIZED":
      if (resp.response_code === 0) return { ...outcome, kind: "APPROVED", problems };
      return { ...outcome, kind: "ANOMALY", problems: [...problems, "INCONSISTENT_APPROVAL"] };
    case "FAILED":
      return { ...outcome, kind: problems.length ? "ANOMALY" : "REJECTED", problems };
    case "INITIALIZED":
      return { ...outcome, kind: problems.length ? "ANOMALY" : "NOT_COMPLETED", problems };
    case "REVERSED":
      return { ...outcome, kind: problems.length ? "ANOMALY" : "REFUNDED", problems, refundedAmountClp: expected.amountClp };
    case "NULLIFIED":
    case "PARTIALLY_NULLIFIED": {
      if (problems.length) return { ...outcome, kind: "ANOMALY", problems };
      const balance = outcome.balanceClp;
      const partial = resp.status === "PARTIALLY_NULLIFIED" || (balance !== null && balance > 0);
      const refunded = balance !== null ? Math.max(0, expected.amountClp - balance) : partial ? 0 : expected.amountClp;
      return { ...outcome, kind: partial ? "PARTIALLY_REFUNDED" : "REFUNDED", problems, refundedAmountClp: refunded };
    }
    case "CAPTURED":
      return { ...outcome, kind: "ANOMALY", problems: [...problems, "UNEXPECTED_CAPTURE"] };
    default:
      return { ...outcome, kind: "UNKNOWN", problems };
  }
}

/** Respuesta de POST /transactions/{token}/refunds → resultado del reembolso. */
function mapWebpayRefund(resp) {
  const sanitized = sanitizeWebpayPayload(resp);
  if (!isObject(resp) || (resp.type !== "REVERSED" && resp.type !== "NULLIFIED")) {
    return { status: "UNKNOWN", providerType: null, balanceClp: null, sanitized };
  }
  if (resp.type === "NULLIFIED" && resp.response_code !== undefined && resp.response_code !== 0) {
    return { status: "FAILED", providerType: "NULLIFIED", balanceClp: intOrNull(resp.balance), sanitized };
  }
  return { status: "SUCCEEDED", providerType: resp.type, balanceClp: intOrNull(resp.balance), sanitized };
}

/**
 * ¿Un error de `status` significa que la transacción no existe para Transbank?
 * Solo 404/422 definitivos (token desconocido o fuera de plazo: la sonda real
 * devolvió 422 "Invalid value for parameter: token"). 400/401/403/405/406/415
 * hablan de la solicitud o de las credenciales, no de la transacción: nunca
 * deben vencer un intento (se reintenta y, al cerrarse la ventana de 7 días,
 * pasa a revisión).
 */
function statusErrorMeansNotFound(error) {
  return Boolean(error) && error.kind === "HTTP_4XX" && !error.ambiguous && (error.status === 404 || error.status === 422);
}

module.exports = { mapWebpayTransaction, mapWebpayRefund, statusErrorMeansNotFound };
