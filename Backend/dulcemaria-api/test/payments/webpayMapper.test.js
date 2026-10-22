const test = require("node:test");
const assert = require("node:assert/strict");

const { mapWebpayTransaction, mapWebpayRefund, statusErrorMeansNotFound } = require("../../src/lib/payments/webpay/mapper");
const constants = require("../../src/lib/payments/webpay/constants");

const EXPECTED = { amountClp: 25000, buyOrder: "DM3F-K9X2M4QZ", sessionId: "00000000-0000-4000-8000-000000000001" };

function commitResponse(overrides = {}) {
  return {
    vci: "TSY",
    amount: 25000,
    status: "AUTHORIZED",
    buy_order: EXPECTED.buyOrder,
    session_id: EXPECTED.sessionId,
    card_detail: { card_number: "6623" },
    accounting_date: "1021",
    transaction_date: "2026-10-21T21:05:00.000Z",
    authorization_code: "1213",
    payment_type_code: "VN",
    response_code: 0,
    installments_number: 0,
    ...overrides,
  };
}

test("constantes verificadas contra la referencia v1.2 (hosts, ruta y credenciales públicas de integración)", () => {
  assert.equal(constants.API_PATH, "/rswebpaytransaction/api/webpay/v1.2/transactions");
  assert.deepEqual(constants.HOSTS, { integration: "webpay3gint.transbank.cl", production: "webpay3g.transbank.cl" });
  assert.equal(constants.INTEGRATION_COMMERCE_CODE, "597055555532");
  assert.equal(constants.INTEGRATION_API_KEY_SECRET.length, 64);
  assert.equal(constants.LIMITS.buyOrder, 26);
  assert.equal(constants.LIMITS.sessionId, 61);
  assert.equal(constants.FORM_WINDOW_MINUTES.production, 4);
  assert.equal(constants.FORM_WINDOW_MINUTES.integration, 10);
  assert.equal(constants.TOKEN_LIFETIME_MINUTES, 5);
  assert.equal(constants.STATUS_WINDOW_DAYS, 7);
});

test("AUTHORIZED con response_code 0 exacto y datos que calzan → APPROVED sin problemas", () => {
  const outcome = mapWebpayTransaction(commitResponse(), EXPECTED);
  assert.equal(outcome.kind, "APPROVED");
  assert.deepEqual(outcome.problems, []);
  assert.equal(outcome.amountClp, 25000);
  assert.equal(outcome.authorizationCode, "1213");
  assert.equal(outcome.cardLast4, "6623");
  assert.equal(outcome.paymentType, "VN");
  assert.equal(outcome.paymentTypeLabel, "Crédito sin cuotas");
  assert.equal(outcome.installmentsNumber, 0);
  assert.equal(outcome.accountingDate, "1021");
  assert.equal(outcome.transactionDate, "2026-10-21T21:05:00.000Z");
  assert.equal(outcome.responseCode, 0);
  assert.equal(outcome.providerStatus, "AUTHORIZED");
  assert.equal(outcome.sanitized.card_last4, "6623");
  assert.equal(outcome.sanitized.card_detail, undefined);
});

test("rechazo: status FAILED (response_code negativo) → REJECTED", () => {
  const outcome = mapWebpayTransaction(commitResponse({ status: "FAILED", response_code: -1, authorization_code: "000000" }), EXPECTED);
  assert.equal(outcome.kind, "REJECTED");
  assert.equal(outcome.responseCode, -1);
});

test("comparación estricta: response_code '0' (texto) o AUTHORIZED con código ≠ 0 → ANOMALY, nunca APPROVED", () => {
  assert.equal(mapWebpayTransaction(commitResponse({ response_code: "0" }), EXPECTED).kind, "ANOMALY");
  assert.equal(mapWebpayTransaction(commitResponse({ response_code: -3 }), EXPECTED).kind, "ANOMALY");
  assert.equal(mapWebpayTransaction(commitResponse({ status: "authorized" }), EXPECTED).kind, "UNKNOWN");
});

test("diferencias de monto, buy_order o session_id → APPROVED con problemas (NEEDS_REVIEW aguas abajo)", () => {
  assert.deepEqual(mapWebpayTransaction(commitResponse({ amount: 24999 }), EXPECTED).problems, ["AMOUNT_MISMATCH"]);
  assert.deepEqual(mapWebpayTransaction(commitResponse({ amount: "25000" }), EXPECTED).problems, ["AMOUNT_MISMATCH"]);
  assert.deepEqual(mapWebpayTransaction(commitResponse({ buy_order: "DM3F-OTRO0000" }), EXPECTED).problems, ["BUY_ORDER_MISMATCH"]);
  assert.deepEqual(mapWebpayTransaction(commitResponse({ session_id: "otra" }), EXPECTED).problems, ["SESSION_MISMATCH"]);
  const many = mapWebpayTransaction(commitResponse({ amount: 1, buy_order: "x", session_id: "y" }), EXPECTED);
  assert.equal(many.kind, "APPROVED");
  assert.deepEqual(many.problems, ["AMOUNT_MISMATCH", "BUY_ORDER_MISMATCH", "SESSION_MISMATCH"]);
});

test("INITIALIZED (respuesta real de integración de un token sin pagar) → NOT_COMPLETED", () => {
  const real = {
    amount: 25000,
    status: "INITIALIZED",
    buy_order: EXPECTED.buyOrder,
    session_id: EXPECTED.sessionId,
    accounting_date: "1021",
    transaction_date: "2026-10-21T23:44:25.628Z",
    installments_number: 0,
  };
  const outcome = mapWebpayTransaction(real, EXPECTED);
  assert.equal(outcome.kind, "NOT_COMPLETED");
  assert.equal(outcome.responseCode, null);
  assert.equal(outcome.cardLast4, null);
});

test("reversas y anulaciones se informan como reembolsos (totales o parciales)", () => {
  assert.equal(mapWebpayTransaction(commitResponse({ status: "REVERSED" }), EXPECTED).kind, "REFUNDED");
  const nullified = mapWebpayTransaction(commitResponse({ status: "NULLIFIED", balance: 0 }), EXPECTED);
  assert.equal(nullified.kind, "REFUNDED");
  assert.equal(nullified.refundedAmountClp, 25000);
  const partial = mapWebpayTransaction(commitResponse({ status: "PARTIALLY_NULLIFIED", balance: 20000 }), EXPECTED);
  assert.equal(partial.kind, "PARTIALLY_REFUNDED");
  assert.equal(partial.refundedAmountClp, 5000);
  assert.equal(partial.balanceClp, 20000);
  assert.equal(mapWebpayTransaction(commitResponse({ status: "NULLIFIED", balance: 1000 }), EXPECTED).kind, "PARTIALLY_REFUNDED");
});

test("CAPTURED (captura diferida, no contratada) → ANOMALY; estados desconocidos o respuesta inválida → UNKNOWN", () => {
  assert.equal(mapWebpayTransaction(commitResponse({ status: "CAPTURED" }), EXPECTED).kind, "ANOMALY");
  assert.equal(mapWebpayTransaction(commitResponse({ status: "NUEVO" }), EXPECTED).kind, "UNKNOWN");
  assert.equal(mapWebpayTransaction(null, EXPECTED).kind, "UNKNOWN");
  assert.equal(mapWebpayTransaction("x", EXPECTED).kind, "UNKNOWN");
});

test("una respuesta que no es de este intento (buy_order/sesión distintos) en un estado sin aprobación → ANOMALY", () => {
  const outcome = mapWebpayTransaction(commitResponse({ status: "FAILED", response_code: -1, buy_order: "DMX-AAAAAAAA" }), EXPECTED);
  assert.equal(outcome.kind, "ANOMALY");
  assert.deepEqual(outcome.problems, ["BUY_ORDER_MISMATCH"]);
});

test("fechas inválidas no se propagan; etiquetas de tipo de pago de la referencia", () => {
  assert.equal(mapWebpayTransaction(commitResponse({ transaction_date: "ayer" }), EXPECTED).transactionDate, null);
  const labels = { VD: "Débito", VN: "Crédito sin cuotas", VC: "Crédito en cuotas", SI: "3 cuotas sin interés", S2: "2 cuotas sin interés", NC: "N cuotas sin interés", VP: "Prepago" };
  for (const [code, label] of Object.entries(labels)) {
    assert.equal(mapWebpayTransaction(commitResponse({ payment_type_code: code }), EXPECTED).paymentTypeLabel, label);
  }
  assert.equal(mapWebpayTransaction(commitResponse({ payment_type_code: "ZZ" }), EXPECTED).paymentTypeLabel, null);
});

test("reembolso: REVERSED y NULLIFIED (código 0) = éxito; NULLIFIED con código ≠ 0 = fallo; sin tipo = desconocido", () => {
  assert.deepEqual(mapWebpayRefund({ type: "REVERSED" }), { status: "SUCCEEDED", providerType: "REVERSED", balanceClp: null, sanitized: { type: "REVERSED" } });
  const nullified = mapWebpayRefund({ type: "NULLIFIED", authorization_code: "123456", authorization_date: "2026-10-21T22:00:00.000Z", nullified_amount: 5000, balance: 20000, response_code: 0 });
  assert.equal(nullified.status, "SUCCEEDED");
  assert.equal(nullified.providerType, "NULLIFIED");
  assert.equal(nullified.balanceClp, 20000);
  assert.equal(mapWebpayRefund({ type: "NULLIFIED", response_code: -1 }).status, "FAILED");
  assert.equal(mapWebpayRefund({}).status, "UNKNOWN");
  assert.equal(mapWebpayRefund(null).status, "UNKNOWN");
});

test("error de status: solo 404/422 definitivos son 'la transacción no existe'; credenciales o solicitud mala nunca vencen un intento", () => {
  // Sonda real en integración: token desconocido → 422 "Invalid value for parameter: token"; API Key mala → 401.
  assert.equal(statusErrorMeansNotFound({ kind: "HTTP_4XX", status: 422, ambiguous: false }), true);
  assert.equal(statusErrorMeansNotFound({ kind: "HTTP_4XX", status: 404, ambiguous: false }), true);
  for (const status of [400, 401, 403, 405, 406, 415]) {
    assert.equal(statusErrorMeansNotFound({ kind: "HTTP_4XX", status, ambiguous: false }), false, String(status));
  }
  assert.equal(statusErrorMeansNotFound({ kind: "HTTP_4XX", status: 429, ambiguous: true }), false);
  assert.equal(statusErrorMeansNotFound({ kind: "HTTP_5XX", status: 500, ambiguous: true }), false);
  assert.equal(statusErrorMeansNotFound({ kind: "TIMEOUT", ambiguous: true }), false);
  assert.equal(statusErrorMeansNotFound({ kind: "HOST_NOT_ALLOWED", ambiguous: false }), false);
  assert.equal(statusErrorMeansNotFound(null), false);
});
