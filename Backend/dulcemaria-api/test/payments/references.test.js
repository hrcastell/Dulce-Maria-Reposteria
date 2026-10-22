const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BUY_ORDER_PATTERN,
  newBuyOrder,
  isOurBuyOrder,
  crockfordBase32,
  newAccessToken,
  isAccessToken,
  tokenHint,
} = require("../../src/lib/payments/references");

// Webpay: buy_order ≤ 26 y caracteres de |_=&%.,~:/?[+!@>- más alfanuméricos.
const WEBPAY_BUY_ORDER = /^[A-Za-z0-9|_=&%.,~:/?[+!@>-]{1,26}$/;
// Mercado Pago: external_reference ≤ 64, letras, números, - y _.
const MP_EXTERNAL_REFERENCE = /^[A-Za-z0-9_-]{1,64}$/;

function fixedBytes(...values) {
  return (n) => Buffer.from(values.slice(0, n));
}

test("crockfordBase32: 5 bytes → 8 caracteres sin I, L, O ni U", () => {
  assert.equal(crockfordBase32(Buffer.from([0, 0, 0, 0, 0])), "00000000");
  assert.equal(crockfordBase32(Buffer.from([255, 255, 255, 255, 255])), "ZZZZZZZZ");
  assert.equal(crockfordBase32(Buffer.from([0x08, 0x42, 0x10, 0x84, 0x21])), "11111111");
  assert.throws(() => crockfordBase32(Buffer.from([1, 2, 3])));
});

test("buy_order de una orden: DM + número en base 36 + '-' + 8 caracteres aleatorios", () => {
  const value = newBuyOrder({ kind: "ORDER", orderNo: 123 }, fixedBytes(255, 255, 255, 255, 255));
  assert.equal(value, "DM3F-ZZZZZZZZ");
  assert.ok(BUY_ORDER_PATTERN.test(value));
  assert.ok(isOurBuyOrder(value));
});

test("buy_order de un pedido de torta: DT-<8 aleatorios>", () => {
  const value = newBuyOrder({ kind: "CAKE" }, fixedBytes(0, 0, 0, 0, 0));
  assert.equal(value, "DT-00000000");
  assert.ok(isOurBuyOrder(value));
});

test("el buy_order cumple a la vez los juegos de caracteres de Webpay y de Mercado Pago", () => {
  for (const orderNo of [1, 35, 36, 999999, Number.MAX_SAFE_INTEGER]) {
    const value = newBuyOrder({ kind: "ORDER", orderNo });
    assert.ok(value.length <= 26, value);
    assert.ok(WEBPAY_BUY_ORDER.test(value), value);
    assert.ok(MP_EXTERNAL_REFERENCE.test(value), value);
    assert.ok(BUY_ORDER_PATTERN.test(value), value);
  }
});

test("10.000 buy_order seguidos no se repiten", () => {
  const seen = new Set();
  for (let i = 0; i < 10000; i++) seen.add(newBuyOrder({ kind: "ORDER", orderNo: 7 }));
  assert.equal(seen.size, 10000);
});

test("número de orden inválido = error de programación", () => {
  assert.throws(() => newBuyOrder({ kind: "ORDER", orderNo: 0 }));
  assert.throws(() => newBuyOrder({ kind: "ORDER", orderNo: 1.5 }));
  assert.throws(() => newBuyOrder({ kind: "OTRO" }));
});

test("isOurBuyOrder rechaza valores ajenos", () => {
  for (const value of ["", "ordenCompra12345678", "DM3F-ZZZZZZZI", "dm3f-zzzzzzzz", "DM3F-ZZZZZZZ", null, 7]) {
    assert.equal(isOurBuyOrder(value), false, String(value));
  }
});

test("token de acceso: 32 bytes en base64url (43 caracteres, sin relleno)", () => {
  const token = newAccessToken(() => Buffer.alloc(32, 0xff));
  assert.equal(token, "_".repeat(42) + "8");
  assert.equal(newAccessToken().length, 43);
  assert.ok(isAccessToken(newAccessToken()));
  for (const bad of ["", "abc", "a".repeat(44), "a".repeat(42) + "=", "a".repeat(42) + "+", null, 12]) {
    assert.equal(isAccessToken(bad), false, String(bad));
  }
});

test("tokenHint muestra solo un prefijo corto", () => {
  assert.equal(tokenHint("abcdefghijklmnop"), "abcdef…");
  assert.equal(tokenHint(null), null);
  assert.equal(tokenHint("abc"), "…");
});
