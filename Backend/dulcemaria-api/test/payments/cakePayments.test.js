const test = require("node:test");
const assert = require("node:assert/strict");

const { cakePaymentSummary, decideManualCakePayment } = require("../../src/lib/payments/cakePayments");

function cake(overrides = {}) {
  return {
    status: "PENDING_PAYMENT",
    total_price_clp: 45001,
    deposit_clp: 22501,
    deposit_status: "PENDING",
    balance_status: "PENDING",
    ...overrides,
  };
}

test("resumen de pago de una torta: pendiente → abono pagado → pagada; reembolso del abono", () => {
  assert.deepEqual(cakePaymentSummary(cake()), {
    payment_status: "PENDING",
    deposit_status: "PENDING",
    balance_status: "PENDING",
    total_clp: 45001,
    deposit_clp: 22501,
    balance_clp: 22500,
    amount_due_clp: 22501,
  });
  assert.equal(cakePaymentSummary(cake({ deposit_status: "PAID" })).payment_status, "DEPOSIT_PAID");
  assert.equal(cakePaymentSummary(cake({ deposit_status: "PAID" })).amount_due_clp, 22500);
  const paid = cakePaymentSummary(cake({ deposit_status: "PAID", balance_status: "PAID" }));
  assert.equal(paid.payment_status, "PAID");
  assert.equal(paid.amount_due_clp, 0);
  assert.equal(cakePaymentSummary(cake({ deposit_status: "REFUNDED" })).payment_status, "REFUNDED");
  assert.equal(cakePaymentSummary(cake({ deposit_status: "FAILED" })).payment_status, "PENDING");
  // Saldo 0 (abono = total): pagar el abono deja la torta pagada.
  assert.equal(cakePaymentSummary(cake({ total_price_clp: 1, deposit_clp: 1, deposit_status: "PAID" })).payment_status, "PAID");
});

test("abono manual (transferencia/efectivo): se registra si está pendiente y no hay un pago en línea gestionado", () => {
  const ok = decideManualCakePayment(cake(), { part: "DEPOSIT", hasManagedOnlineAttempt: false });
  assert.deepEqual(ok, { ok: true, noop: false, part: "DEPOSIT", amountClp: 22501, advanceTo: "CONFIRMED" });
  assert.equal(decideManualCakePayment(cake({ status: "IN_PROGRESS" }), { part: "DEPOSIT" }).advanceTo, null);
  assert.equal(decideManualCakePayment(cake({ deposit_status: "FAILED" }), { part: "DEPOSIT" }).ok, true);
  assert.deepEqual(decideManualCakePayment(cake({ deposit_status: "PAID" }), { part: "DEPOSIT" }), { ok: true, noop: true, part: "DEPOSIT", amountClp: 22501, advanceTo: null });
  const managed = decideManualCakePayment(cake(), { part: "DEPOSIT", hasManagedOnlineAttempt: true });
  assert.equal(managed.ok, false);
  assert.equal(managed.code, "ONLINE_PAYMENT_MANAGED");
  assert.equal(managed.httpStatus, 409);
  assert.equal(decideManualCakePayment(cake({ deposit_status: "REFUNDED" }), { part: "DEPOSIT" }).code, "PAYMENT_FINALIZED");
});

test("saldo (total − abono): solo con el abono pagado; también sobre una torta ya entregada", () => {
  const ok = decideManualCakePayment(cake({ deposit_status: "PAID", status: "DELIVERED" }), { part: "BALANCE" });
  assert.deepEqual(ok, { ok: true, noop: false, part: "BALANCE", amountClp: 22500, advanceTo: null });
  assert.equal(decideManualCakePayment(cake(), { part: "BALANCE" }).code, "DEPOSIT_NOT_PAID");
  assert.equal(decideManualCakePayment(cake({ deposit_status: "PAID", balance_status: "PAID" }), { part: "BALANCE" }).noop, true);
  assert.equal(decideManualCakePayment(cake({ deposit_status: "REFUNDED" }), { part: "BALANCE" }).code, "DEPOSIT_NOT_PAID");
});

test("una torta cancelada no recibe pagos manuales; parte desconocida = error de programación", () => {
  const cancelled = decideManualCakePayment(cake({ status: "CANCELLED" }), { part: "DEPOSIT" });
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.code, "ORDER_CANCELLED");
  assert.throws(() => decideManualCakePayment(cake(), { part: "TODO" }));
});
