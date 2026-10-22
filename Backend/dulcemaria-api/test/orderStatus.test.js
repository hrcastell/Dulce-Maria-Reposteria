const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ORDER_STATUSES,
  TERMINAL_ORDER_STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_METHODS,
  STOCK_RESERVATION_STATUSES,
  CANCELLATION_SOURCES,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  ADMIN_ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  LEGACY_ORDER_STATUS_MAP,
  decideOrderStatusChange,
  decidePaymentStatusChange,
  validateNewOrderState,
  staffOrderRestrictions,
  buildLegacyStatusCaseSql,
  legacyOrderStatusCaseSql,
} = require("../src/lib/orderStatus");

function order(overrides = {}) {
  return {
    status: "PENDING_PAYMENT",
    payment_status: "PENDING",
    payment_method: "TRANSFER",
    stock_reservation_status: "NONE",
    cancellation_source: null,
    ...overrides,
  };
}

test("vocabularios canónicos (alineados con el diseño de pagos)", () => {
  assert.deepEqual(ORDER_STATUSES, ["PENDING_PAYMENT", "PAID", "PREPARING", "READY", "DELIVERED", "CANCELLED"]);
  assert.deepEqual(TERMINAL_ORDER_STATUSES, ["DELIVERED", "CANCELLED"]);
  assert.deepEqual(PAYMENT_STATUSES, ["PENDING", "PAID", "FAILED", "REFUNDED"]);
  assert.deepEqual(PAYMENT_METHODS, ["TRANSFER", "CASH", "ONLINE"]);
  assert.deepEqual(STOCK_RESERVATION_STATUSES, ["NONE", "RESERVED", "CONSUMED", "RELEASED"]);
  assert.deepEqual(CANCELLATION_SOURCES, ["PAYMENT_EXPIRED", "ADMIN"]);
  for (const status of ORDER_STATUSES) assert.ok(ORDER_STATUS_LABELS[status], status);
  for (const status of PAYMENT_STATUSES) assert.ok(PAYMENT_STATUS_LABELS[status], status);
});

test("la tabla de transiciones solo apunta a estados válidos y los terminales no tienen salida", () => {
  for (const [from, targets] of Object.entries(ADMIN_ORDER_TRANSITIONS)) {
    assert.ok(ORDER_STATUSES.includes(from), from);
    for (const to of targets) assert.ok(ORDER_STATUSES.includes(to), `${from}→${to}`);
  }
  for (const terminal of TERMINAL_ORDER_STATUSES) assert.deepEqual(ADMIN_ORDER_TRANSITIONS[terminal], []);
  for (const [from, targets] of Object.entries(PAYMENT_TRANSITIONS)) {
    assert.ok(PAYMENT_STATUSES.includes(from), from);
    for (const to of targets) assert.ok(PAYMENT_STATUSES.includes(to), `${from}→${to}`);
  }
});

test("confirmar un pedido manual pendiente consume stock una sola vez", () => {
  const first = decideOrderStatusChange(order(), "PREPARING");
  assert.equal(first.ok, true);
  assert.equal(first.noop, false);
  assert.equal(first.effects.stock, "CONSUME");
  const reserved = decideOrderStatusChange(order({ stock_reservation_status: "RESERVED" }), "READY");
  assert.equal(reserved.effects.stock, "CONSUME");
  const consumed = decideOrderStatusChange(order({ stock_reservation_status: "CONSUMED" }), "PREPARING");
  assert.equal(consumed.effects.stock, null);
});

test("las órdenes heredadas ya avanzadas sin reserva no toman stock en transiciones posteriores", () => {
  const decision = decideOrderStatusChange(order({ status: "PREPARING", stock_reservation_status: "NONE" }), "READY");
  assert.equal(decision.ok, true);
  assert.equal(decision.effects.stock, null);
});

test("cancelar libera stock solo si estaba reservado o consumido, y marca el origen ADMIN", () => {
  const consumed = decideOrderStatusChange(order({ status: "PREPARING", stock_reservation_status: "CONSUMED" }), "CANCELLED");
  assert.equal(consumed.effects.stock, "RELEASE");
  assert.equal(consumed.effects.cancellationSource, "ADMIN");
  const reserved = decideOrderStatusChange(order({ stock_reservation_status: "RESERVED" }), "CANCELLED");
  assert.equal(reserved.effects.stock, "RELEASE");
  const none = decideOrderStatusChange(order(), "CANCELLED");
  assert.equal(none.effects.stock, null);
  assert.equal(none.effects.cancellationSource, "ADMIN");
});

test("entregar cobra la tarifa de plataforma", () => {
  const decision = decideOrderStatusChange(order({ status: "READY", stock_reservation_status: "CONSUMED" }), "DELIVERED");
  assert.equal(decision.effects.chargeFee, true);
  assert.equal(decideOrderStatusChange(order(), "PREPARING").effects.chargeFee, false);
});

test("los estados terminales no admiten cambios (409)", () => {
  for (const [from, to] of [["DELIVERED", "PREPARING"], ["DELIVERED", "CANCELLED"], ["CANCELLED", "PAID"], ["CANCELLED", "PENDING_PAYMENT"]]) {
    const decision = decideOrderStatusChange(order({ status: from, payment_status: "PAID" }), to);
    assert.equal(decision.ok, false, `${from}→${to}`);
    assert.equal(decision.httpStatus, 409);
    assert.equal(decision.code, "ORDER_FINALIZED");
    assert.equal(typeof decision.error, "string");
  }
});

test("transiciones no permitidas responden 409 con mensaje en español", () => {
  const decision = decideOrderStatusChange(order({ status: "PREPARING" }), "PENDING_PAYMENT");
  assert.equal(decision.ok, false);
  assert.equal(decision.httpStatus, 409);
  assert.equal(decision.code, "INVALID_STATUS_TRANSITION");
  assert.match(decision.error, /Preparando/);
  assert.ok(decideOrderStatusChange(order({ status: "READY" }), "PREPARING").ok);
});

test("marcar la orden como Pagada exige que el pago esté registrado", () => {
  const manual = decideOrderStatusChange(order(), "PAID");
  assert.equal(manual.ok, false);
  assert.equal(manual.code, "PAYMENT_NOT_RECORDED");
  const online = decideOrderStatusChange(order({ payment_method: "ONLINE", stock_reservation_status: "RESERVED" }), "PAID");
  assert.equal(online.code, "USE_PAYMENT_RECONCILE");
  const paid = decideOrderStatusChange(order({ payment_status: "PAID" }), "PAID");
  assert.equal(paid.ok, true);
  assert.equal(paid.effects.stock, "CONSUME");
});

test("repetir el mismo estado es idempotente (sin efectos)", () => {
  const decision = decideOrderStatusChange(order({ status: "DELIVERED", payment_status: "PAID" }), "DELIVERED");
  assert.deepEqual(decision, { ok: true, noop: true, effects: { stock: null, chargeFee: false, cancellationSource: null, clearCancellationSource: false } });
});

test("estados fuera del vocabulario se rechazan con 400 (incluidos los heredados)", () => {
  for (const legacy of ["CONFIRMED", "PENDING_CONFIRMATION", "pagado", ""]) {
    const decision = decideOrderStatusChange(order(), legacy);
    assert.equal(decision.ok, false);
    assert.equal(decision.httpStatus, 400);
    assert.equal(decision.code, "INVALID_STATUS");
  }
});

test("el sistema (vencimiento) solo cancela órdenes pendientes, con origen PAYMENT_EXPIRED", () => {
  const expire = decideOrderStatusChange(order({ payment_method: "ONLINE", stock_reservation_status: "RESERVED" }), "CANCELLED", { source: "SYSTEM" });
  assert.equal(expire.ok, true);
  assert.equal(expire.effects.cancellationSource, "PAYMENT_EXPIRED");
  assert.equal(expire.effects.stock, "RELEASE");
  assert.equal(decideOrderStatusChange(order({ status: "PREPARING" }), "CANCELLED", { source: "SYSTEM" }).ok, false);
  assert.equal(decideOrderStatusChange(order(), "DELIVERED", { source: "SYSTEM" }).ok, false);
});

test("la pasarela puede pagar una orden pendiente y revivir una vencida por el sistema", () => {
  const pay = decideOrderStatusChange(order({ payment_status: "PAID", payment_method: "ONLINE", stock_reservation_status: "RESERVED" }), "PAID", { source: "PAYMENT" });
  assert.equal(pay.ok, true);
  assert.equal(pay.effects.stock, "CONSUME");
  const revive = decideOrderStatusChange(
    order({ status: "CANCELLED", payment_status: "PAID", payment_method: "ONLINE", stock_reservation_status: "RELEASED", cancellation_source: "PAYMENT_EXPIRED" }),
    "PAID",
    { source: "PAYMENT" }
  );
  assert.equal(revive.ok, true);
  assert.equal(revive.effects.stock, "RE_RESERVE");
  assert.equal(revive.effects.clearCancellationSource, true);
  const adminCancelled = decideOrderStatusChange(
    order({ status: "CANCELLED", payment_status: "PAID", cancellation_source: "ADMIN" }),
    "PAID",
    { source: "PAYMENT" }
  );
  assert.equal(adminCancelled.ok, false);
  assert.equal(adminCancelled.code, "ORDER_FINALIZED");
});

test("un origen desconocido se rechaza", () => {
  assert.throws(() => decideOrderStatusChange(order(), "PAID", { source: "HACKER" }));
});

test("pagos: transiciones manuales permitidas y su efecto en paid_at", () => {
  assert.deepEqual(decidePaymentStatusChange(order(), "PAID"), { ok: true, noop: false, effects: { paidAt: "SET" } });
  assert.deepEqual(decidePaymentStatusChange(order({ payment_status: "PAID", status: "DELIVERED" }), "REFUNDED"), {
    ok: true,
    noop: false,
    effects: { paidAt: "KEEP" },
  });
  assert.deepEqual(decidePaymentStatusChange(order({ payment_status: "PAID", status: "PREPARING" }), "PENDING"), {
    ok: true,
    noop: false,
    effects: { paidAt: "CLEAR" },
  });
  assert.equal(decidePaymentStatusChange(order({ payment_status: "FAILED" }), "PAID").ok, true);
  assert.equal(decidePaymentStatusChange(order(), "FAILED").ok, true);
  assert.equal(decidePaymentStatusChange(order(), "PENDING").noop, true);
});

test("pagos: un reembolso es definitivo y no se paga una orden cancelada", () => {
  const refunded = decidePaymentStatusChange(order({ payment_status: "REFUNDED", status: "DELIVERED" }), "PAID");
  assert.equal(refunded.ok, false);
  assert.equal(refunded.code, "PAYMENT_FINALIZED");
  const cancelled = decidePaymentStatusChange(order({ status: "CANCELLED" }), "PAID");
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.code, "ORDER_CANCELLED");
  assert.equal(decidePaymentStatusChange(order({ status: "CANCELLED", payment_status: "PAID" }), "REFUNDED").ok, true);
  assert.equal(decidePaymentStatusChange(order({ payment_status: "PENDING" }), "REFUNDED").ok, false);
});

test("pagos: la pasarela puede registrar un pago tardío solo en una orden vencida por el sistema", () => {
  const expired = order({ status: "CANCELLED", payment_status: "FAILED", payment_method: "ONLINE", cancellation_source: "PAYMENT_EXPIRED" });
  assert.equal(decidePaymentStatusChange(expired, "PAID", { source: "PAYMENT" }).ok, true);
  assert.equal(decidePaymentStatusChange(expired, "PAID", { source: "ADMIN" }).ok, false);
  const adminCancelled = { ...expired, cancellation_source: "ADMIN" };
  assert.equal(decidePaymentStatusChange(adminCancelled, "PAID", { source: "PAYMENT" }).code, "ORDER_CANCELLED");
});

test("pagos: una orden en estado Pagado no puede volver a pago pendiente", () => {
  const decision = decidePaymentStatusChange(order({ status: "PAID", payment_status: "PAID" }), "PENDING");
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "ORDER_MARKED_PAID");
  assert.equal(decidePaymentStatusChange(order({ status: "PAID", payment_status: "PAID" }), "REFUNDED").ok, true);
});

test("pagos: en órdenes en línea el panel solo puede registrar un pago por otro medio", () => {
  const online = (o) => order({ payment_method: "ONLINE", ...o });
  assert.equal(decidePaymentStatusChange(online({}), "PAID").ok, true);
  assert.equal(decidePaymentStatusChange(online({ payment_status: "FAILED", status: "CANCELLED" }), "PAID").ok, false);
  for (const [from, to] of [["PAID", "REFUNDED"], ["PENDING", "FAILED"], ["PAID", "PENDING"]]) {
    const decision = decidePaymentStatusChange(online({ payment_status: from, status: "PREPARING" }), to);
    assert.equal(decision.ok, false, `${from}→${to}`);
    assert.equal(decision.code, "ONLINE_PAYMENT_MANAGED");
  }
  assert.equal(decidePaymentStatusChange(online({}), "FAILED", { source: "PAYMENT" }).ok, true);
});

test("pagos: valores desconocidos se rechazan con 400", () => {
  const decision = decidePaymentStatusChange(order(), "PAGADO");
  assert.equal(decision.ok, false);
  assert.equal(decision.httpStatus, 400);
});

test("validateNewOrderState rechaza combinaciones contradictorias al crear", () => {
  assert.deepEqual(validateNewOrderState({ status: "DELIVERED", payment_status: "PAID", payment_method: "CASH" }), { ok: true });
  assert.deepEqual(validateNewOrderState({ status: "PREPARING", payment_status: "PENDING", payment_method: "TRANSFER" }), { ok: true });
  for (const state of [
    { status: "CANCELLED", payment_status: "PENDING", payment_method: "CASH" },
    { status: "PAID", payment_status: "PENDING", payment_method: "CASH" },
    { status: "PENDING_PAYMENT", payment_status: "PAID", payment_method: "CASH" },
    { status: "DELIVERED", payment_status: "REFUNDED", payment_method: "CASH" },
    { status: "PENDING_PAYMENT", payment_status: "PAID", payment_method: "ONLINE" },
    { status: "DELIVERED", payment_status: "PAID", payment_method: "ONLINE" },
  ]) {
    const result = validateNewOrderState(state);
    assert.equal(result.ok, false, JSON.stringify(state));
    assert.equal(typeof result.error, "string");
  }
  assert.deepEqual(validateNewOrderState({ status: "PENDING_PAYMENT", payment_status: "PENDING", payment_method: "ONLINE" }), { ok: true });
});

test("STAFF no puede fijar precios arbitrarios ni registrar ventas con otra fecha", () => {
  const today = "2026-10-21";
  assert.deepEqual(staffOrderRestrictions({ finalPriceOverrideClp: null, discountAmountClp: 0, orderDate: undefined, today }), []);
  assert.deepEqual(staffOrderRestrictions({ finalPriceOverrideClp: undefined, discountAmountClp: undefined, orderDate: today, today }), []);
  assert.equal(staffOrderRestrictions({ finalPriceOverrideClp: 1000, discountAmountClp: 0, today }).length, 1);
  assert.equal(staffOrderRestrictions({ finalPriceOverrideClp: 0, today }).length, 1);
  assert.equal(staffOrderRestrictions({ discountAmountClp: 500, today }).length, 1);
  assert.equal(staffOrderRestrictions({ orderDate: "2026-10-01", today }).length, 1);
  assert.equal(staffOrderRestrictions({ finalPriceOverrideClp: 1, discountAmountClp: 1, orderDate: "2026-10-01", today }).length, 3);
});

test("migración de estados heredados: el CASE mapea legados y descarta desconocidos", () => {
  assert.deepEqual(LEGACY_ORDER_STATUS_MAP, { PENDING_CONFIRMATION: "PENDING_PAYMENT", CONFIRMED: "PREPARING" });
  const sql = legacyOrderStatusCaseSql("status");
  assert.match(sql, /^CASE UPPER\(BTRIM\(status\)\)/);
  assert.match(sql, /WHEN 'PENDING_CONFIRMATION' THEN 'PENDING_PAYMENT'/);
  assert.match(sql, /WHEN 'CONFIRMED' THEN 'PREPARING'/);
  assert.match(sql, /WHEN 'DELIVERED' THEN 'DELIVERED'/);
  assert.match(sql, /ELSE NULL END$/);
  assert.throws(() => buildLegacyStatusCaseSql("status; --", ["A"], {}));
  assert.throws(() => buildLegacyStatusCaseSql("status", ["A'B"], {}));
});
