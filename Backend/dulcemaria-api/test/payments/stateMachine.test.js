const test = require("node:test");
const assert = require("node:assert/strict");

const sm = require("../../src/lib/payments/stateMachine");

const NOW = new Date("2026-10-21T21:00:00.000Z");
const BEFORE = new Date(NOW.getTime() - 60000);
const AFTER = new Date(NOW.getTime() + 60000);

function attempt(status, overrides = {}) {
  return {
    status,
    provider: "WEBPAY",
    expires_at: AFTER,
    amount_clp: 25000,
    refunded_amount_clp: 0,
    provider_payment_id: null,
    target_applied: false,
    ...overrides,
  };
}

function decide(status, kind, { attemptOverrides, outcome } = {}) {
  return sm.decideAttemptTransition(attempt(status, attemptOverrides), { kind, problems: [], ...outcome }, { now: NOW });
}

test("vocabulario: abiertos, fracasos, éxitos y revisión", () => {
  assert.deepEqual(sm.ATTEMPT_STATUSES, [
    "CREATED", "PENDING", "COMMITTING", "PAID", "REJECTED", "ABORTED", "EXPIRED", "FAILED", "NEEDS_REVIEW", "PARTIALLY_REFUNDED", "REFUNDED",
  ]);
  assert.deepEqual(sm.OPEN_STATUSES, ["CREATED", "PENDING", "COMMITTING"]);
  assert.deepEqual(sm.FAILURE_STATUSES, ["REJECTED", "ABORTED", "EXPIRED", "FAILED"]);
  assert.deepEqual(sm.SUCCESS_STATUSES, ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"]);
  assert.equal(sm.isOpen("COMMITTING"), true);
  assert.equal(sm.isOpen("PAID"), false);
});

test("creación del recurso en el proveedor: CREATED → PENDING / FAILED; CREATED viejo → FAILED", () => {
  assert.equal(decide("CREATED", "CREATE_SUCCEEDED").next, "PENDING");
  assert.equal(decide("CREATED", "CREATE_FAILED").next, "FAILED");
  assert.equal(decide("CREATED", "STALE_CREATED").next, "FAILED");
  assert.equal(decide("PENDING", "CREATE_SUCCEEDED").changed, false);
});

test("aprobación válida: abiertos → PAID", () => {
  for (const status of ["CREATED", "PENDING", "COMMITTING"]) {
    const d = decide(status, "APPROVED");
    assert.equal(d.next, "PAID", status);
    assert.equal(d.changed, true);
    assert.equal(d.reviewReason, null);
  }
});

test("el proveedor manda: aprobación tardía sobre cualquier fracaso local → PAID", () => {
  for (const status of ["REJECTED", "ABORTED", "EXPIRED", "FAILED"]) {
    const d = decide(status, "APPROVED");
    assert.equal(d.next, "PAID", status);
    assert.equal(d.reason, "LATE_APPROVAL");
  }
});

test("aprobación con problemas (monto, buy_order, sesión, moneda...) → NEEDS_REVIEW, nunca PAID", () => {
  const d = decide("COMMITTING", "APPROVED", { outcome: { problems: ["AMOUNT_MISMATCH", "SESSION_MISMATCH"] } });
  assert.equal(d.next, "NEEDS_REVIEW");
  assert.equal(d.reviewReason, "AMOUNT_MISMATCH,SESSION_MISMATCH");
  assert.equal(decide("EXPIRED", "APPROVED", { outcome: { problems: ["AMOUNT_MISMATCH"] } }).next, "NEEDS_REVIEW");
});

test("un éxito nunca se degrada solo; una aprobación repetida no cambia nada", () => {
  assert.equal(decide("PAID", "APPROVED").changed, false);
  for (const kind of ["REJECTED", "REJECTED_RETRYABLE", "PENDING", "NOT_COMPLETED", "ABORTED_BY_USER", "FORM_TIMEOUT", "FORM_ERROR", "UNKNOWN", "FOREIGN_REFERENCE"]) {
    const d = decide("PAID", kind);
    assert.equal(d.changed, false, kind);
    assert.equal(d.next, "PAID", kind);
  }
});

test("Mercado Pago: un segundo pago aprobado distinto sobre un intento PAID → NEEDS_REVIEW (DUPLICATE_PAYMENT)", () => {
  const d = sm.decideAttemptTransition(
    attempt("PAID", { provider: "MERCADOPAGO", provider_payment_id: "111" }),
    { kind: "APPROVED", problems: [], providerPaymentId: "222" },
    { now: NOW }
  );
  assert.equal(d.next, "NEEDS_REVIEW");
  assert.equal(d.reviewReason, "DUPLICATE_PAYMENT");
  const same = sm.decideAttemptTransition(
    attempt("PAID", { provider: "MERCADOPAGO", provider_payment_id: "111" }),
    { kind: "APPROVED", problems: [], providerPaymentId: "111" },
    { now: NOW }
  );
  assert.equal(same.changed, false);
  // Un rechazo de OTRO pago de la misma preferencia no toca un intento pagado.
  const otherRejected = sm.decideAttemptTransition(
    attempt("PAID", { provider: "MERCADOPAGO", provider_payment_id: "111" }),
    { kind: "CANCELLED", problems: [], providerPaymentId: "333" },
    { now: NOW }
  );
  assert.equal(otherRejected.changed, false);
});

test("Webpay: rechazo definitivo (abiertos) → REJECTED; retornos del formulario → ABORTED / EXPIRED / FAILED", () => {
  assert.equal(decide("COMMITTING", "REJECTED").next, "REJECTED");
  assert.equal(decide("PENDING", "REJECTED").next, "REJECTED");
  assert.equal(decide("PENDING", "ABORTED_BY_USER").next, "ABORTED");
  assert.equal(decide("PENDING", "FORM_TIMEOUT").next, "EXPIRED");
  assert.equal(decide("PENDING", "FORM_ERROR").next, "FAILED");
  // Un retorno de anulación no pisa un commit en curso ni un resultado.
  assert.equal(decide("COMMITTING", "ABORTED_BY_USER").changed, false);
  assert.equal(decide("REJECTED", "FORM_TIMEOUT").changed, false);
});

test("Webpay: commit rechazado con la transacción sin autorizar → FAILED; commit de prueba rechazado → EXPIRED; commit sin confirmar → NEEDS_REVIEW", () => {
  assert.equal(decide("COMMITTING", "COMMIT_REFUSED").next, "FAILED");
  assert.equal(decide("COMMITTING", "PROBE_REFUSED").next, "EXPIRED");
  const unconfirmed = decide("COMMITTING", "COMMIT_UNCONFIRMED");
  assert.equal(unconfirmed.next, "NEEDS_REVIEW");
  assert.equal(unconfirmed.reviewReason, "COMMIT_UNCONFIRMED");
  assert.equal(decide("PENDING", "COMMIT_REFUSED").changed, false);
});

test("sin completar (INITIALIZED / sin pagos): solo vence después de expires_at", () => {
  assert.equal(decide("PENDING", "NOT_COMPLETED").changed, false);
  assert.equal(decide("PENDING", "NOT_COMPLETED", { attemptOverrides: { expires_at: BEFORE } }).next, "EXPIRED");
  assert.equal(decide("COMMITTING", "NOT_COMPLETED", { attemptOverrides: { expires_at: BEFORE } }).changed, false);
});

test("Mercado Pago: rechazado reintentable y pendiente dejan el intento abierto", () => {
  assert.equal(decide("PENDING", "REJECTED_RETRYABLE").changed, false);
  assert.equal(decide("CREATED", "REJECTED_RETRYABLE").next, "PENDING");
  assert.equal(decide("CREATED", "PENDING").next, "PENDING");
  assert.equal(decide("PENDING", "PENDING").changed, false);
  assert.equal(decide("PENDING", "CANCELLED").next, "EXPIRED");
});

test("ventana de status de Webpay: abiertos viejos → NEEDS_REVIEW; token desconocido: PENDING → EXPIRED, COMMITTING → NEEDS_REVIEW", () => {
  assert.equal(decide("COMMITTING", "STATUS_WINDOW_CLOSING").next, "NEEDS_REVIEW");
  assert.equal(decide("PENDING", "STATUS_WINDOW_CLOSING").reviewReason, "STATUS_WINDOW_CLOSING");
  assert.equal(decide("PENDING", "STATUS_NOT_FOUND").next, "EXPIRED");
  assert.equal(decide("COMMITTING", "STATUS_NOT_FOUND").next, "NEEDS_REVIEW");
});

test("reembolsos informados por el proveedor", () => {
  const full = decide("PAID", "REFUNDED", { outcome: { refundedAmountClp: 25000 } });
  assert.equal(full.next, "REFUNDED");
  assert.equal(full.refundedAmountClp, 25000);
  const partial = decide("PAID", "PARTIALLY_REFUNDED", { outcome: { refundedAmountClp: 5000 } });
  assert.equal(partial.next, "PARTIALLY_REFUNDED");
  assert.equal(partial.refundedAmountClp, 5000);
  const more = decide("PARTIALLY_REFUNDED", "PARTIALLY_REFUNDED", { attemptOverrides: { refunded_amount_clp: 5000 }, outcome: { refundedAmountClp: 8000 } });
  assert.equal(more.changed, true);
  assert.equal(more.next, "PARTIALLY_REFUNDED");
  assert.equal(more.refundedAmountClp, 8000);
  assert.equal(decide("PARTIALLY_REFUNDED", "REFUNDED", { attemptOverrides: { refunded_amount_clp: 5000 }, outcome: { refundedAmountClp: 25000 } }).next, "REFUNDED");
  assert.equal(decide("REFUNDED", "REFUNDED", { outcome: { refundedAmountClp: 25000 } }).changed, false);
  // Reembolso de algo que nunca vimos pagado → revisión.
  assert.equal(decide("PENDING", "REFUNDED", { outcome: { refundedAmountClp: 25000 } }).next, "NEEDS_REVIEW");
  assert.equal(decide("EXPIRED", "PARTIALLY_REFUNDED", { outcome: { refundedAmountClp: 1 } }).next, "NEEDS_REVIEW");
});

test("contracargo, mediación, cancelación sobre un pago y anomalías → NEEDS_REVIEW (alerta)", () => {
  assert.equal(decide("PAID", "CHARGEBACK").reviewReason, "CHARGEBACK");
  assert.equal(decide("PAID", "DISPUTE").reviewReason, "DISPUTE");
  assert.equal(
    sm.decideAttemptTransition(attempt("PAID", { provider: "MERCADOPAGO", provider_payment_id: "1" }), { kind: "CANCELLED", problems: [], providerPaymentId: "1" }, { now: NOW }).reviewReason,
    "PROVIDER_CANCELLED_AFTER_PAYMENT"
  );
  assert.equal(decide("COMMITTING", "ANOMALY", { outcome: { problems: ["INCONSISTENT_APPROVAL"] } }).reviewReason, "INCONSISTENT_APPROVAL");
  assert.equal(decide("PAID", "ANOMALY", { outcome: { problems: ["UNEXPECTED_CAPTURE"] } }).next, "NEEDS_REVIEW");
  assert.equal(decide("NEEDS_REVIEW", "CHARGEBACK").changed, false);
});

test("NEEDS_REVIEW solo cambia por resolución del administrador", () => {
  for (const kind of ["APPROVED", "REJECTED", "NOT_COMPLETED", "ANOMALY", "REFUNDED"]) {
    assert.equal(decide("NEEDS_REVIEW", kind, { outcome: { refundedAmountClp: 1 } }).changed, false, kind);
  }
  for (const resolution of ["PAID", "REJECTED", "EXPIRED", "REFUNDED"]) {
    const d = decide("NEEDS_REVIEW", "RESOLVE", { outcome: { resolution } });
    assert.equal(d.next, resolution);
    assert.equal(d.changed, true);
  }
  assert.equal(decide("PAID", "RESOLVE", { outcome: { resolution: "REJECTED" } }).changed, false);
  assert.throws(() => decide("NEEDS_REVIEW", "RESOLVE", { outcome: { resolution: "PENDING" } }));
});

test("UNKNOWN y referencias ajenas nunca cambian el estado; kind desconocido = error de programación", () => {
  for (const status of sm.ATTEMPT_STATUSES) {
    assert.equal(decide(status, "UNKNOWN").changed, false, status);
    assert.equal(decide(status, "FOREIGN_REFERENCE").changed, false, status);
  }
  assert.throws(() => decide("PENDING", "INVENTADO"));
});

// ---------------------------------------------------------------------------
// Efecto sobre la orden o el pedido de torta (deriveTargetEffect)
// ---------------------------------------------------------------------------

function order(overrides = {}) {
  return { kind: "ORDER", status: "PENDING_PAYMENT", payment_status: "PENDING", cancellation_source: null, total_clp: 25000, ...overrides };
}

function cake(overrides = {}) {
  return { kind: "CAKE", status: "PENDING_PAYMENT", deposit_status: "PENDING", cancellation_source: null, total_price_clp: 50000, deposit_clp: 25000, ...overrides };
}

function plan(target, { from = "COMMITTING", kind = "APPROVED", problems = [], attemptOverrides = {} } = {}) {
  return sm.planAttemptChange({ attempt: attempt(from, attemptOverrides), target, outcome: { kind, problems }, now: NOW });
}

test("orden pendiente pagada → PAY_AND_ADVANCE (pago PAID + estado PAID; la reserva pasa a CONSUMED)", () => {
  const p = plan(order());
  assert.equal(p.next, "PAID");
  assert.equal(p.targetEffect, "PAY_AND_ADVANCE");
});

test("orden avanzada a mano (PREPARING/READY/DELIVERED) con pago pendiente → solo el pago", () => {
  for (const status of ["PREPARING", "READY", "DELIVERED"]) {
    assert.equal(plan(order({ status })).targetEffect, "PAY_ONLY", status);
  }
});

test("orden vencida por el sistema → REVIVE; cancelada por el panel → NEEDS_REVIEW (PAID_AFTER_ADMIN_CANCEL)", () => {
  const revive = plan(order({ status: "CANCELLED", payment_status: "FAILED", cancellation_source: "PAYMENT_EXPIRED" }), { from: "EXPIRED" });
  assert.equal(revive.next, "PAID");
  assert.equal(revive.targetEffect, "REVIVE");
  const admin = plan(order({ status: "CANCELLED", cancellation_source: "ADMIN" }));
  assert.equal(admin.next, "NEEDS_REVIEW");
  assert.equal(admin.reviewReason, "PAID_AFTER_ADMIN_CANCEL");
  assert.equal(admin.targetEffect, "NONE");
});

test("orden ya pagada (otro intento o pago manual) o reembolsada → NEEDS_REVIEW, sin tocar la orden", () => {
  const dup = plan(order({ status: "PAID", payment_status: "PAID" }));
  assert.equal(dup.next, "NEEDS_REVIEW");
  assert.equal(dup.reviewReason, "DUPLICATE_PAYMENT");
  assert.equal(dup.targetEffect, "NONE");
  assert.equal(plan(order({ status: "PREPARING", payment_status: "REFUNDED" })).reviewReason, "PAID_AFTER_REFUND");
});

test("el monto del intento debe seguir siendo el monto vigente de la orden → si no, NEEDS_REVIEW (AMOUNT_CHANGED)", () => {
  const p = plan(order({ total_clp: 26000 }));
  assert.equal(p.next, "NEEDS_REVIEW");
  assert.equal(p.reviewReason, "AMOUNT_CHANGED");
});

test("aprobación con problemas del proveedor: NEEDS_REVIEW antes de mirar la orden", () => {
  const p = plan(order(), { problems: ["AMOUNT_MISMATCH"] });
  assert.equal(p.next, "NEEDS_REVIEW");
  assert.equal(p.reviewReason, "AMOUNT_MISMATCH");
  assert.equal(p.targetEffect, "NONE");
});

test("torta: abono pagado → PAY_AND_ADVANCE (abono PAID + CONFIRMED); avanzada → solo el abono; vencida → REVIVE", () => {
  assert.equal(plan(cake()).targetEffect, "PAY_AND_ADVANCE");
  for (const status of ["CONFIRMED", "IN_PROGRESS", "READY", "DELIVERED"]) {
    assert.equal(plan(cake({ status })).targetEffect, "PAY_ONLY", status);
  }
  assert.equal(plan(cake({ status: "CANCELLED", deposit_status: "FAILED", cancellation_source: "PAYMENT_EXPIRED" }), { from: "EXPIRED" }).targetEffect, "REVIVE");
  assert.equal(plan(cake({ status: "CANCELLED", cancellation_source: "ADMIN" })).reviewReason, "PAID_AFTER_ADMIN_CANCEL");
  assert.equal(plan(cake({ deposit_status: "PAID", status: "CONFIRMED" })).reviewReason, "DUPLICATE_PAYMENT");
  assert.equal(plan(cake({ deposit_status: "REFUNDED", status: "CANCELLED", cancellation_source: "ADMIN" })).reviewReason, "PAID_AFTER_REFUND");
  // El intento de una torta cobra el abono (deposit_clp), no el total.
  assert.equal(plan(cake({ deposit_clp: 30000 })).reviewReason, "AMOUNT_CHANGED");
});

test("reembolso total de un intento que pagó la orden/torta → REFUND_TARGET; si no la pagó, nada", () => {
  const full = sm.planAttemptChange({
    attempt: attempt("PAID", { target_applied: true }),
    target: order({ status: "PAID", payment_status: "PAID" }),
    outcome: { kind: "REFUNDED", problems: [], refundedAmountClp: 25000 },
    now: NOW,
  });
  assert.equal(full.next, "REFUNDED");
  assert.equal(full.targetEffect, "REFUND_TARGET");
  const notApplied = sm.planAttemptChange({
    attempt: attempt("PAID", { target_applied: false }),
    target: order({ status: "PAID", payment_status: "PAID" }),
    outcome: { kind: "REFUNDED", problems: [], refundedAmountClp: 25000 },
    now: NOW,
  });
  assert.equal(notApplied.targetEffect, "NONE");
  const partial = sm.planAttemptChange({
    attempt: attempt("PAID", { target_applied: true }),
    target: cake({ status: "CONFIRMED", deposit_status: "PAID" }),
    outcome: { kind: "PARTIALLY_REFUNDED", problems: [], refundedAmountClp: 1000 },
    now: NOW,
  });
  assert.equal(partial.targetEffect, "NONE");
});

test("resolución admin a PAID pasa por las mismas reglas de la orden", () => {
  const p = sm.planAttemptChange({ attempt: attempt("NEEDS_REVIEW"), target: order(), outcome: { kind: "RESOLVE", resolution: "PAID", problems: [] }, now: NOW });
  assert.equal(p.next, "PAID");
  assert.equal(p.targetEffect, "PAY_AND_ADVANCE");
  const blocked = sm.planAttemptChange({
    attempt: attempt("NEEDS_REVIEW"),
    target: order({ status: "PAID", payment_status: "PAID" }),
    outcome: { kind: "RESOLVE", resolution: "PAID", problems: [] },
    now: NOW,
  });
  assert.equal(blocked.next, "NEEDS_REVIEW");
  assert.equal(blocked.changed, false);
  assert.equal(blocked.blockedReason, "DUPLICATE_PAYMENT");
});

test("revisión de un intento que YA pagó el destino (contracargo/mediación ganados): PAID vuelve sin tocar la orden", () => {
  const won = sm.planAttemptChange({
    attempt: attempt("NEEDS_REVIEW", { target_applied: true }),
    target: order({ status: "PAID", payment_status: "PAID" }),
    outcome: { kind: "RESOLVE", resolution: "PAID", problems: [] },
    now: NOW,
  });
  assert.equal(won.next, "PAID");
  assert.equal(won.changed, true);
  assert.equal(won.targetEffect, "NONE");
  assert.equal(won.blockedReason, undefined);
  // Sus reembolsos parciales siguen en pie: vuelve a PARTIALLY_REFUNDED (o REFUNDED si ya era total).
  const partial = sm.planAttemptChange({
    attempt: attempt("NEEDS_REVIEW", { target_applied: true, refunded_amount_clp: 1000 }),
    target: order({ status: "PAID", payment_status: "PAID" }),
    outcome: { kind: "RESOLVE", resolution: "PAID", problems: [] },
    now: NOW,
  });
  assert.equal(partial.next, "PARTIALLY_REFUNDED");
  assert.equal(partial.targetEffect, "NONE");
  const full = sm.planAttemptChange({
    attempt: attempt("NEEDS_REVIEW", { target_applied: true, refunded_amount_clp: 25000 }),
    target: order({ status: "PAID", payment_status: "REFUNDED" }),
    outcome: { kind: "RESOLVE", resolution: "PAID", problems: [] },
    now: NOW,
  });
  assert.equal(full.next, "REFUNDED");
  assert.equal(full.targetEffect, "NONE");
  // Una aprobación del proveedor sobre un intento ya aplicado (tras una resolución) tampoco re-aplica nada.
  const late = sm.planAttemptChange({
    attempt: attempt("REJECTED", { target_applied: true }),
    target: order({ status: "PAID", payment_status: "PAID" }),
    outcome: { kind: "APPROVED", problems: [] },
    now: NOW,
  });
  assert.equal(late.next, "PAID");
  assert.equal(late.targetEffect, "NONE");
});
