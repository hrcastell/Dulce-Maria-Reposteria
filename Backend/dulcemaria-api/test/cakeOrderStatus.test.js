const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CAKE_ORDER_STATUSES,
  CAKE_ORDER_STATUS_LABELS,
  CAKE_ORDER_TRANSITIONS,
  LEGACY_CAKE_ORDER_STATUS_MAP,
  normalizeLegacyCakeStatus,
  decideCakeStatusChange,
  legacyCakeStatusCaseSql,
} = require("../src/lib/cakeOrderStatus");

test("vocabulario canónico de tortas = el que ofrece el panel desde el inicio", () => {
  assert.deepEqual(CAKE_ORDER_STATUSES, ["PENDING_PAYMENT", "CONFIRMED", "IN_PROGRESS", "READY", "DELIVERED", "CANCELLED"]);
  for (const status of CAKE_ORDER_STATUSES) assert.ok(CAKE_ORDER_STATUS_LABELS[status], status);
  for (const [from, targets] of Object.entries(CAKE_ORDER_TRANSITIONS)) {
    assert.ok(CAKE_ORDER_STATUSES.includes(from));
    for (const to of targets) assert.ok(CAKE_ORDER_STATUSES.includes(to), `${from}→${to}`);
  }
  assert.deepEqual(CAKE_ORDER_TRANSITIONS.DELIVERED, []);
  assert.deepEqual(CAKE_ORDER_TRANSITIONS.CANCELLED, []);
});

test("los valores heredados (API de 80e4d7f y notificaciones) se normalizan", () => {
  assert.deepEqual(LEGACY_CAKE_ORDER_STATUS_MAP, { PENDING: "PENDING_PAYMENT", PAID: "CONFIRMED", PREPARING: "IN_PROGRESS" });
  assert.equal(normalizeLegacyCakeStatus("PENDING"), "PENDING_PAYMENT");
  assert.equal(normalizeLegacyCakeStatus("PAID"), "CONFIRMED");
  assert.equal(normalizeLegacyCakeStatus(" preparing "), "IN_PROGRESS");
  assert.equal(normalizeLegacyCakeStatus("in_progress"), "IN_PROGRESS");
  assert.equal(normalizeLegacyCakeStatus("READY"), "READY");
  assert.equal(normalizeLegacyCakeStatus("COMPLETADO"), null);
  assert.equal(normalizeLegacyCakeStatus(null), null);
});

test("transiciones de tortas: avanzar, retroceder de Listo a En preparación, terminales fijos", () => {
  assert.equal(decideCakeStatusChange({ status: "PENDING_PAYMENT" }, "CONFIRMED").ok, true);
  assert.equal(decideCakeStatusChange({ status: "CONFIRMED" }, "IN_PROGRESS").ok, true);
  assert.equal(decideCakeStatusChange({ status: "READY" }, "IN_PROGRESS").ok, true);
  assert.equal(decideCakeStatusChange({ status: "PENDING_PAYMENT" }, "CANCELLED").ok, true);
  const back = decideCakeStatusChange({ status: "IN_PROGRESS" }, "PENDING_PAYMENT");
  assert.equal(back.ok, false);
  assert.equal(back.httpStatus, 409);
  assert.equal(back.code, "INVALID_STATUS_TRANSITION");
  const terminal = decideCakeStatusChange({ status: "DELIVERED" }, "READY");
  assert.equal(terminal.ok, false);
  assert.equal(terminal.code, "ORDER_FINALIZED");
});

test("mismo estado = sin cambios; estados desconocidos = 400", () => {
  assert.deepEqual(decideCakeStatusChange({ status: "READY" }, "READY"), { ok: true, noop: true });
  const invalid = decideCakeStatusChange({ status: "READY" }, "PAID");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.httpStatus, 400);
  assert.equal(invalid.code, "INVALID_STATUS");
});

test("una torta con estado heredado no canónico puede pasar a cualquier estado canónico", () => {
  assert.equal(decideCakeStatusChange({ status: "PENDING" }, "CONFIRMED").ok, true);
});

test("panel (ADMIN): cancelar deja origen ADMIN; los demás cambios no tocan el origen", () => {
  assert.deepEqual(decideCakeStatusChange({ status: "PENDING_PAYMENT" }, "CANCELLED").effects, {
    cancellationSource: "ADMIN",
    clearCancellationSource: false,
  });
  assert.deepEqual(decideCakeStatusChange({ status: "CONFIRMED" }, "IN_PROGRESS", { source: "ADMIN" }).effects, {
    cancellationSource: null,
    clearCancellationSource: false,
  });
});

test("sistema (SYSTEM): solo vence pedidos pendientes de pago, con origen PAYMENT_EXPIRED", () => {
  const expiry = decideCakeStatusChange({ status: "PENDING_PAYMENT" }, "CANCELLED", { source: "SYSTEM" });
  assert.equal(expiry.ok, true);
  assert.equal(expiry.effects.cancellationSource, "PAYMENT_EXPIRED");
  const notPending = decideCakeStatusChange({ status: "CONFIRMED" }, "CANCELLED", { source: "SYSTEM" });
  assert.equal(notPending.ok, false);
  assert.equal(notPending.code, "INVALID_STATUS_TRANSITION");
});

test("pasarela (PAYMENT): el abono pagado confirma el pedido y revive uno vencido por el sistema", () => {
  const paid = decideCakeStatusChange({ status: "PENDING_PAYMENT" }, "CONFIRMED", { source: "PAYMENT" });
  assert.equal(paid.ok, true);
  assert.equal(paid.effects.clearCancellationSource, false);
  const revived = decideCakeStatusChange({ status: "CANCELLED", cancellation_source: "PAYMENT_EXPIRED" }, "CONFIRMED", { source: "PAYMENT" });
  assert.equal(revived.ok, true);
  assert.equal(revived.effects.clearCancellationSource, true);
  const adminCancelled = decideCakeStatusChange({ status: "CANCELLED", cancellation_source: "ADMIN" }, "CONFIRMED", { source: "PAYMENT" });
  assert.equal(adminCancelled.ok, false);
  assert.equal(adminCancelled.code, "ORDER_FINALIZED");
  assert.equal(decideCakeStatusChange({ status: "PENDING_PAYMENT" }, "READY", { source: "PAYMENT" }).ok, false);
  // El panel no revive pedidos vencidos.
  assert.equal(decideCakeStatusChange({ status: "CANCELLED", cancellation_source: "PAYMENT_EXPIRED" }, "CONFIRMED").ok, false);
});

test("origen de cambio desconocido = error de programación", () => {
  assert.throws(() => decideCakeStatusChange({ status: "PENDING_PAYMENT" }, "CONFIRMED", { source: "OTRO" }));
});

test("el CASE de migración de tortas incluye los legados", () => {
  const sql = legacyCakeStatusCaseSql("status");
  assert.match(sql, /WHEN 'PAID' THEN 'CONFIRMED'/);
  assert.match(sql, /WHEN 'PREPARING' THEN 'IN_PROGRESS'/);
  assert.match(sql, /WHEN 'PENDING' THEN 'PENDING_PAYMENT'/);
  assert.match(sql, /WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'/);
});
