const test = require("node:test");
const assert = require("node:assert/strict");

const { checkTargetPayable } = require("../../src/lib/payments/payability");
const { toPublicState, buildPublicStatus } = require("../../src/lib/payments/publicView");

const NOW = new Date("2026-10-21T21:00:00.000Z");
const at = (minutes) => new Date(NOW.getTime() + minutes * 60000);

function order(overrides = {}) {
  return {
    kind: "ORDER",
    id: "00000000-0000-4000-8000-0000000000a1",
    order_no: 42,
    order_code: "WEB-1792626264000-ABC123",
    status: "PENDING_PAYMENT",
    payment_status: "PENDING",
    payment_method: "ONLINE",
    channel: "WEB",
    cancellation_source: null,
    total_clp: 25000,
    created_at: at(-5),
    payment_expires_at: at(25),
    residency_declared_at: at(-5),
    delivery_date: "2026-10-23",
    // datos personales que NUNCA deben salir en la vista pública
    customer_name: "María Pérez",
    customer_phone: "+56 9 1234 5678",
    contact_email: "maria@example.com",
    delivery_address: "Vicuña Mackenna 2585, Torre B 1203",
    residency_unit: "Torre B 1203",
    notes: "sin nueces",
    public_token: "T".repeat(43),
    ...overrides,
  };
}

function cake(overrides = {}) {
  return {
    kind: "CAKE",
    id: "00000000-0000-4000-8000-0000000000c1",
    order_number: "CAKE-1792626264000-ABC123",
    status: "PENDING_PAYMENT",
    payment_method: "ONLINE",
    channel: "WEB",
    deposit_status: "PENDING",
    balance_status: "PENDING",
    cancellation_source: null,
    total_price_clp: 45001,
    deposit_clp: 22501,
    created_at: at(-5),
    payment_expires_at: at(25),
    residency_declared_at: at(-5),
    delivery_date: "2026-10-30",
    customer_name: "María Pérez",
    customer_phone: "+56 9 1234 5678",
    customer_email: "maria@example.com",
    customer_address: "Vicuña Mackenna 2585",
    notes: "feliz cumpleaños Juan",
    ...overrides,
  };
}

function attemptRow(status, overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-0000000000f1",
    attempt_no: 1,
    status,
    provider: "WEBPAY",
    amount_clp: 25000,
    buy_order: "DM16-K9X2M4QZ",
    authorization_code: "1213",
    card_last4: "6623",
    payment_type: "VN",
    installments_number: 0,
    transaction_date: "2026-10-21T21:05:00.000Z",
    provider_token: "x".repeat(64),
    ...overrides,
  };
}

const PAYABLE = { now: NOW, maxAttempts: 5, salesMode: "RESIDENTS_ONLY" };

test("payability: una orden en línea pendiente y dentro de plazo se puede pagar", () => {
  assert.deepEqual(checkTargetPayable({ target: order(), attempts: [], ...PAYABLE }), { ok: true });
  assert.deepEqual(checkTargetPayable({ target: cake(), attempts: [], ...PAYABLE }), { ok: true });
});

test("payability: rechazos con código estable", () => {
  const code = (target, attempts = [], extra = {}) => checkTargetPayable({ target, attempts, ...PAYABLE, ...extra });
  assert.equal(code(order({ payment_method: "TRANSFER" })).code, "ORDER_NOT_PAYABLE");
  assert.equal(code(order({ payment_status: "PAID", status: "PAID" })).code, "ORDER_ALREADY_PAID");
  assert.equal(code(order({ payment_status: "PAID", status: "PAID" })).httpStatus, 409);
  assert.equal(code(cake({ deposit_status: "PAID", status: "CONFIRMED" })).code, "ORDER_ALREADY_PAID");
  assert.equal(code(order({ payment_status: "REFUNDED", status: "PREPARING" })).code, "ORDER_NOT_PAYABLE");
  const expired = code(order({ status: "CANCELLED", cancellation_source: "PAYMENT_EXPIRED", payment_status: "FAILED" }));
  assert.equal(expired.code, "PAYMENT_WINDOW_EXPIRED");
  assert.equal(expired.httpStatus, 410);
  assert.equal(code(order({ status: "CANCELLED", cancellation_source: "ADMIN" })).code, "ORDER_CANCELLED");
  const late = code(order({ payment_expires_at: at(-1) }));
  assert.equal(late.code, "PAYMENT_WINDOW_EXPIRED");
  assert.equal(late.httpStatus, 410);
  assert.equal(code(order(), [attemptRow("COMMITTING")]).code, "PAYMENT_IN_PROGRESS");
  assert.equal(code(order(), [attemptRow("NEEDS_REVIEW")]).code, "PAYMENT_UNDER_REVIEW");
  const many = code(order(), Array.from({ length: 5 }, (_, i) => attemptRow("REJECTED", { attempt_no: i + 1 })));
  assert.equal(many.code, "TOO_MANY_ATTEMPTS");
  assert.equal(many.httpStatus, 429);
  assert.equal(code(order(), [attemptRow("PENDING"), attemptRow("REJECTED", { attempt_no: 2 })]).ok, true);
});

test("payability D2: con solo residentes, una orden WEB sin declaración no puede pagar; las del panel sí", () => {
  const undeclared = order({ residency_declared_at: null, residency_unit: null });
  const blocked = checkTargetPayable({ target: undeclared, attempts: [], ...PAYABLE });
  assert.equal(blocked.code, "RESIDENTS_ONLY");
  assert.equal(blocked.httpStatus, 403);
  assert.deepEqual(checkTargetPayable({ target: undeclared, attempts: [], ...PAYABLE, salesMode: "OPEN" }), { ok: true });
  const adminOrder = order({ channel: "ADMIN", residency_declared_at: null, payment_expires_at: null, order_code: "ORD-1-AAAAAA" });
  assert.deepEqual(checkTargetPayable({ target: adminOrder, attempts: [], ...PAYABLE }), { ok: true });
  assert.equal(checkTargetPayable({ target: cake({ residency_declared_at: null }), attempts: [], ...PAYABLE }).code, "RESIDENTS_ONLY");
  // El enlace de pago creado por el panel es la autorización de la dueña (D2).
  assert.deepEqual(checkTargetPayable({ target: undeclared, attempts: [], ...PAYABLE, salesMode: "RESIDENTS_ONLY" }).ok, false);
  assert.deepEqual(checkTargetPayable({ target: { ...undeclared, payment_link_created_at: at(-1) }, attempts: [], ...PAYABLE }), { ok: true });
  assert.deepEqual(checkTargetPayable({ target: cake({ residency_declared_at: null, payment_link_created_at: at(-1) }), attempts: [], ...PAYABLE }), { ok: true });
});

test("payability: sin plazo (enlace del panel) siempre se puede pagar mientras esté pendiente", () => {
  assert.deepEqual(checkTargetPayable({ target: order({ channel: "ADMIN", payment_expires_at: null, created_at: at(-60 * 24 * 3) }), attempts: [], ...PAYABLE }), { ok: true });
});

test("estado público: del destino primero, luego del último intento", () => {
  assert.equal(toPublicState(order(), null), "NONE");
  assert.equal(toPublicState(order(), attemptRow("CREATED")), "PROCESSING");
  assert.equal(toPublicState(order(), attemptRow("COMMITTING")), "PROCESSING");
  assert.equal(toPublicState(order(), attemptRow("NEEDS_REVIEW")), "PROCESSING");
  assert.equal(toPublicState(order(), attemptRow("PENDING")), "PENDING");
  assert.equal(toPublicState(order(), attemptRow("REJECTED")), "REJECTED");
  assert.equal(toPublicState(order(), attemptRow("ABORTED")), "CANCELLED_BY_USER");
  assert.equal(toPublicState(order(), attemptRow("EXPIRED")), "EXPIRED");
  assert.equal(toPublicState(order(), attemptRow("FAILED")), "FAILED");
  assert.equal(toPublicState(order({ payment_status: "PAID", status: "PAID" }), attemptRow("PAID")), "PAID");
  assert.equal(toPublicState(order({ payment_status: "REFUNDED", status: "PAID" }), attemptRow("REFUNDED")), "REFUNDED");
  assert.equal(toPublicState(order({ status: "CANCELLED", cancellation_source: "PAYMENT_EXPIRED" }), attemptRow("EXPIRED")), "ORDER_EXPIRED");
  assert.equal(toPublicState(order({ status: "CANCELLED", cancellation_source: "ADMIN" }), null), "ORDER_CANCELLED");
  // Pago manual registrado en el panel: pagado aunque no haya intentos.
  assert.equal(toPublicState(order({ payment_status: "PAID", status: "PREPARING" }), null), "PAID");
  assert.equal(toPublicState(cake({ deposit_status: "PAID", status: "CONFIRMED" }), null), "PAID");
});

test("vista pública de una orden pagada: comprobante sin datos personales ni tokens", () => {
  const view = buildPublicStatus({
    target: order({ status: "PAID", payment_status: "PAID" }),
    items: [{ product_name_snapshot: "Torta de manjar", variant_name: "Grande", qty: 1, unit_price_clp: 25000, line_total_clp: 25000 }],
    attempts: [attemptRow("REJECTED", { attempt_no: 1, authorization_code: null }), attemptRow("PAID", { attempt_no: 2 })],
    providers: ["WEBPAY", "MERCADOPAGO"],
    payability: { ok: false, code: "ORDER_ALREADY_PAID" },
    now: NOW,
  });
  assert.equal(view.state, "PAID");
  assert.equal(view.can_retry, false);
  assert.deepEqual(view.retry_providers, []);
  assert.equal(view.poll_after_ms, null);
  assert.equal(view.target.type, "ORDER");
  assert.equal(view.target.code, "WEB-1792626264000-ABC123");
  assert.equal(view.target.number, 42);
  assert.equal(view.target.status_label, "Pagado");
  assert.equal(view.target.amount_due_clp, 0);
  assert.deepEqual(view.target.items, [{ name: "Torta de manjar", variant: "Grande", qty: 1, unit_price_clp: 25000, line_total_clp: 25000 }]);
  assert.equal(view.payment.attempt_no, 2);
  assert.equal(view.payment.state, "PAID");
  assert.equal(view.payment.authorization_code, "1213");
  assert.equal(view.payment.card_last4, "6623");
  assert.equal(view.payment.payment_type_label, "Crédito sin cuotas");
  assert.equal(view.payment.currency, "CLP");
  assert.equal(view.payment.merchant_name, "Dulce María Repostería");
  const text = JSON.stringify(view);
  for (const pii of ["María Pérez", "1234 5678", "maria@example.com", "Torre B", "Vicuña", "sin nueces", "T".repeat(43), "x".repeat(64)]) {
    assert.equal(text.includes(pii), false, pii);
  }
});

test("vista pública mientras se puede reintentar o se está procesando", () => {
  const retry = buildPublicStatus({ target: order(), items: [], attempts: [attemptRow("REJECTED")], providers: ["WEBPAY"], payability: { ok: true }, now: NOW });
  assert.equal(retry.state, "REJECTED");
  assert.equal(retry.can_retry, true);
  assert.deepEqual(retry.retry_providers, ["WEBPAY"]);
  assert.equal(retry.target.amount_due_clp, 25000);
  const processing = buildPublicStatus({ target: order(), items: [], attempts: [attemptRow("COMMITTING")], providers: ["WEBPAY"], payability: { ok: false, code: "PAYMENT_IN_PROGRESS" }, now: NOW });
  assert.equal(processing.state, "PROCESSING");
  assert.equal(processing.poll_after_ms, 2000);
  assert.equal(processing.can_retry, false);
  const pending = buildPublicStatus({ target: order(), items: [], attempts: [attemptRow("PENDING")], providers: ["WEBPAY"], payability: { ok: true }, now: NOW });
  assert.equal(pending.poll_after_ms, 5000);
  assert.equal(pending.can_retry, true);
  const noProviders = buildPublicStatus({ target: order(), items: [], attempts: [], providers: [], payability: { ok: true }, now: NOW });
  assert.equal(noProviders.can_retry, false);
});

test("vista pública de una torta: abono, saldo, monto a pagar y opciones elegidas", () => {
  const view = buildPublicStatus({
    target: cake(),
    items: [{ category: "Tamaño", label: "16 pulgadas" }, { category: "Relleno", label: "Manjar" }],
    attempts: [],
    providers: ["WEBPAY"],
    payability: { ok: true },
    now: NOW,
  });
  assert.equal(view.target.type, "CAKE");
  assert.equal(view.target.code, "CAKE-1792626264000-ABC123");
  assert.equal(view.target.number, null);
  assert.equal(view.target.status_label, "Pendiente de pago");
  assert.equal(view.target.payment_status, "PENDING");
  assert.equal(view.target.total_clp, 45001);
  assert.equal(view.target.deposit_clp, 22501);
  assert.equal(view.target.balance_clp, 22500);
  assert.equal(view.target.amount_due_clp, 22501);
  assert.deepEqual(view.target.items, [{ name: "Torta personalizada", options: [{ category: "Tamaño", label: "16 pulgadas" }, { category: "Relleno", label: "Manjar" }] }]);
  assert.equal(view.state, "NONE");
  assert.equal(view.can_retry, true);
  const text = JSON.stringify(view);
  for (const pii of ["María Pérez", "maria@example.com", "Vicuña", "feliz cumpleaños"]) assert.equal(text.includes(pii), false, pii);
});
