const test = require("node:test");
const assert = require("node:assert/strict");

const { countsAsSale, salesOrderFilterSql } = require("../src/lib/salesMetrics");

test("una orden cancelada nunca cuenta como venta", () => {
  assert.equal(countsAsSale({ status: "CANCELLED", payment_status: "PAID" }), false);
  assert.equal(countsAsSale({ status: "CANCELLED", payment_status: "PENDING" }), false);
});

test("una orden pendiente de pago solo cuenta si el pago ya está registrado", () => {
  assert.equal(countsAsSale({ status: "PENDING_PAYMENT", payment_status: "PENDING" }), false);
  assert.equal(countsAsSale({ status: "PENDING_PAYMENT", payment_status: "FAILED" }), false);
  assert.equal(countsAsSale({ status: "PENDING_PAYMENT", payment_status: "PAID" }), true);
});

test("las órdenes confirmadas cuentan aunque se paguen contra entrega; las reembolsadas no", () => {
  assert.equal(countsAsSale({ status: "PREPARING", payment_status: "PENDING" }), true);
  assert.equal(countsAsSale({ status: "DELIVERED", payment_status: "PAID" }), true);
  assert.equal(countsAsSale({ status: "PAID", payment_status: "PAID" }), true);
  assert.equal(countsAsSale({ status: "DELIVERED", payment_status: "REFUNDED" }), false);
});

test("salesOrderFilterSql expresa la misma regla en SQL con el alias dado", () => {
  const sql = salesOrderFilterSql("o");
  assert.match(sql, /o\.status <> 'CANCELLED'/);
  assert.match(sql, /o\.payment_status <> 'REFUNDED'/);
  assert.match(sql, /NOT \(o\.status = 'PENDING_PAYMENT' AND o\.payment_status <> 'PAID'\)/);
  assert.match(salesOrderFilterSql(), /^\(status <> 'CANCELLED'/);
  assert.throws(() => salesOrderFilterSql("o; DROP"));
});
