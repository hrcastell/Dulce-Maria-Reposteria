const test = require("node:test");
const assert = require("node:assert/strict");

const {
  mapMpPayment,
  pickMpSearchOutcome,
  buildPreferenceBody,
  toMpDate,
  mapMpRefund,
} = require("../../src/lib/payments/mercadopago/mapper");

const EXPECTED = { amountClp: 25000, buyOrder: "DM3F-K9X2M4QZ", liveMode: false };

function payment(overrides = {}) {
  return {
    id: 1234567890,
    status: "approved",
    status_detail: "accredited",
    transaction_amount: 25000,
    transaction_amount_refunded: 0,
    currency_id: "CLP",
    external_reference: EXPECTED.buyOrder,
    payment_type_id: "credit_card",
    payment_method_id: "visa",
    installments: 1,
    date_created: "2026-10-21T18:00:00.000-03:00",
    date_approved: "2026-10-21T18:00:05.000-03:00",
    live_mode: false,
    authorization_code: "301299",
    card: { last_four_digits: "5678" },
    payer: { email: "x@example.com" },
    ...overrides,
  };
}

test("approved con monto, moneda y referencia exactos → APPROVED sin problemas", () => {
  const outcome = mapMpPayment(payment(), EXPECTED);
  assert.equal(outcome.kind, "APPROVED");
  assert.deepEqual(outcome.problems, []);
  assert.equal(outcome.providerPaymentId, "1234567890");
  assert.equal(outcome.amountClp, 25000);
  assert.equal(outcome.cardLast4, "5678");
  assert.equal(outcome.paymentType, "credit_card");
  assert.equal(outcome.paymentMethodId, "visa");
  assert.equal(outcome.installmentsNumber, 1);
  assert.equal(outcome.authorizationCode, "301299");
  assert.equal(outcome.transactionDate, "2026-10-21T18:00:05.000-03:00");
  assert.equal(outcome.providerStatus, "approved");
  assert.equal(outcome.providerStatusDetail, "accredited");
  assert.equal(JSON.stringify(outcome.sanitized).includes("x@example.com"), false);
});

test("monto o moneda distintos, o live_mode distinto del entorno → problemas (NEEDS_REVIEW aguas abajo)", () => {
  assert.deepEqual(mapMpPayment(payment({ transaction_amount: 24999 }), EXPECTED).problems, ["AMOUNT_MISMATCH"]);
  assert.deepEqual(mapMpPayment(payment({ transaction_amount: 25000.5 }), EXPECTED).problems, ["AMOUNT_MISMATCH"]);
  assert.deepEqual(mapMpPayment(payment({ transaction_amount: "25000" }), EXPECTED).problems, ["AMOUNT_MISMATCH"]);
  assert.deepEqual(mapMpPayment(payment({ currency_id: "USD" }), EXPECTED).problems, ["CURRENCY_MISMATCH"]);
  assert.deepEqual(mapMpPayment(payment({ live_mode: true }), EXPECTED).problems, ["LIVE_MODE_MISMATCH"]);
  assert.deepEqual(mapMpPayment(payment({ live_mode: true }), { ...EXPECTED, liveMode: undefined }).problems, []);
});

test("referencia ajena → FOREIGN_REFERENCE (nunca cambia el estado del intento)", () => {
  const outcome = mapMpPayment(payment({ external_reference: "DM9-AAAAAAAA" }), EXPECTED);
  assert.equal(outcome.kind, "FOREIGN_REFERENCE");
  assert.equal(mapMpPayment(payment({ external_reference: null, status: "rejected" }), EXPECTED).kind, "FOREIGN_REFERENCE");
});

test("estados de Mercado Pago → resultados del proveedor", () => {
  const map = (status, extra = {}) => mapMpPayment(payment({ status, ...extra }), EXPECTED).kind;
  assert.equal(map("rejected"), "REJECTED_RETRYABLE");
  assert.equal(map("pending"), "PENDING");
  assert.equal(map("in_process"), "PENDING");
  assert.equal(map("authorized"), "PENDING");
  assert.equal(map("cancelled"), "CANCELLED");
  assert.equal(map("refunded", { transaction_amount_refunded: 25000 }), "REFUNDED");
  assert.equal(map("charged_back"), "CHARGEBACK");
  assert.equal(map("in_mediation"), "DISPUTE");
  assert.equal(map("raro"), "UNKNOWN");
});

test("approved con reembolso parcial → PARTIALLY_REFUNDED con el monto reembolsado", () => {
  const outcome = mapMpPayment(payment({ status_detail: "partially_refunded", transaction_amount_refunded: 5000 }), EXPECTED);
  assert.equal(outcome.kind, "PARTIALLY_REFUNDED");
  assert.equal(outcome.refundedAmountClp, 5000);
  assert.equal(mapMpPayment(payment({ status: "refunded", transaction_amount_refunded: 25000 }), EXPECTED).refundedAmountClp, 25000);
});

test("respuesta inválida o sin id → UNKNOWN", () => {
  assert.equal(mapMpPayment(null, EXPECTED).kind, "UNKNOWN");
  assert.equal(mapMpPayment({ status: "approved" }, EXPECTED).kind, "UNKNOWN");
  assert.equal(mapMpPayment(payment({ id: "abc" }), EXPECTED).kind, "UNKNOWN");
});

test("búsqueda por external_reference: un aprobado manda; dos aprobados = cobro duplicado; si no, pendiente > rechazado > cancelado > nada", () => {
  const approved = payment();
  const rejected = payment({ id: 2, status: "rejected" });
  const pending = payment({ id: 3, status: "in_process" });
  const cancelled = payment({ id: 4, status: "cancelled" });
  const foreign = payment({ id: 5, external_reference: "DMZ-AAAAAAAA" });

  assert.equal(pickMpSearchOutcome([rejected, approved, foreign], EXPECTED).kind, "APPROVED");
  const duplicated = pickMpSearchOutcome([approved, payment({ id: 6 })], EXPECTED);
  assert.equal(duplicated.kind, "APPROVED");
  assert.ok(duplicated.problems.includes("DUPLICATE_PAYMENT"));
  assert.equal(pickMpSearchOutcome([rejected, pending], EXPECTED).kind, "PENDING");
  assert.equal(pickMpSearchOutcome([rejected, cancelled], EXPECTED).kind, "REJECTED_RETRYABLE");
  assert.equal(pickMpSearchOutcome([cancelled], EXPECTED).kind, "CANCELLED");
  assert.equal(pickMpSearchOutcome([], EXPECTED).kind, "NOT_COMPLETED");
  assert.equal(pickMpSearchOutcome([foreign], EXPECTED).kind, "NOT_COMPLETED");
  assert.equal(pickMpSearchOutcome(null, EXPECTED).kind, "NOT_COMPLETED");
});

test("toMpDate: ISO 8601 con milisegundos y offset +00:00", () => {
  assert.equal(toMpDate(new Date("2026-10-21T21:00:00.000Z")), "2026-10-21T21:00:00.000+00:00");
  assert.throws(() => toMpDate(new Date("x")));
});

test("cuerpo de la preferencia: 1 ítem entero en CLP, binary_mode, back_urls con el id del intento en la ruta, sin datos del pagador", () => {
  const body = buildPreferenceBody({
    paymentId: "00000000-0000-4000-8000-000000000009",
    buyOrder: EXPECTED.buyOrder,
    amountClp: 25000,
    title: "Pedido Dulce María WEB-1",
    apiPublicUrl: "https://api.dulcemaria.hrcastell.com",
    now: new Date("2026-10-21T21:00:00.000Z"),
    expiresAt: new Date("2026-10-21T21:30:00.000Z"),
    statementDescriptor: "DULCEMARIA",
    maxInstallments: null,
  });
  const backUrl = "https://api.dulcemaria.hrcastell.com/public/payments/mercadopago/return/00000000-0000-4000-8000-000000000009";
  assert.deepEqual(body, {
    items: [{ id: EXPECTED.buyOrder, title: "Pedido Dulce María WEB-1", quantity: 1, unit_price: 25000, currency_id: "CLP" }],
    external_reference: EXPECTED.buyOrder,
    back_urls: { success: backUrl, failure: backUrl, pending: backUrl },
    auto_return: "approved",
    binary_mode: true,
    expires: true,
    expiration_date_from: "2026-10-21T21:00:00.000+00:00",
    expiration_date_to: "2026-10-21T21:30:00.000+00:00",
    statement_descriptor: "DULCEMARIA",
    metadata: { payment_id: "00000000-0000-4000-8000-000000000009" },
  });
  assert.equal("notification_url" in body, false);
  assert.equal("payer" in body, false);
  const limited = buildPreferenceBody({
    paymentId: "00000000-0000-4000-8000-000000000009",
    buyOrder: EXPECTED.buyOrder,
    amountClp: 1000,
    title: "x".repeat(300),
    apiPublicUrl: "https://api.example.cl/",
    now: new Date(),
    expiresAt: new Date(Date.now() + 60000),
    statementDescriptor: null,
    maxInstallments: 3,
  });
  assert.deepEqual(limited.payment_methods, { installments: 3 });
  assert.equal(limited.items[0].title.length, 256);
  assert.equal("statement_descriptor" in limited, false);
  assert.match(limited.back_urls.success, /^https:\/\/api\.example\.cl\/public\/payments\/mercadopago\/return\//);
  assert.throws(() => buildPreferenceBody({ paymentId: "x", buyOrder: EXPECTED.buyOrder, amountClp: 10.5, title: "t", apiPublicUrl: "https://a.cl", now: new Date(), expiresAt: new Date() }));
});

test("reembolso de Mercado Pago: approved = éxito; in_process = desconocido; rejected = fallo", () => {
  const ok = mapMpRefund({ id: 77, payment_id: 1234567890, amount: 5000, status: "approved" });
  assert.equal(ok.status, "SUCCEEDED");
  assert.equal(ok.providerRefundId, "77");
  assert.equal(ok.amountClp, 5000);
  assert.equal(mapMpRefund({ id: 78, status: "in_process" }).status, "UNKNOWN");
  assert.equal(mapMpRefund({ id: 79, status: "rejected" }).status, "FAILED");
  assert.equal(mapMpRefund(null).status, "UNKNOWN");
});
