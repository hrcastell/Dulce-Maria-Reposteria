const test = require("node:test");
const assert = require("node:assert/strict");

const { amountToCharge, assertClpAmount, cakeBalanceClp, MAX_ONLINE_AMOUNT_CLP } = require("../../src/lib/payments/amount");

test("orden del catálogo: se cobra el total, en CLP enteros", () => {
  assert.deepEqual(amountToCharge({ kind: "ORDER", total_clp: 25000 }), {
    amountClp: 25000,
    currency: "CLP",
    basis: "ORDER_TOTAL",
  });
  // Los BIGINT/INT pueden llegar como texto desde pg: se aceptan si son enteros exactos.
  assert.equal(amountToCharge({ kind: "ORDER", total_clp: "1990" }).amountClp, 1990);
});

test("pedido de torta: se cobra solo el abono (deposit_clp), nunca el total (D1)", () => {
  assert.deepEqual(amountToCharge({ kind: "CAKE", total_price_clp: 45000, deposit_clp: 22500 }), {
    amountClp: 22500,
    currency: "CLP",
    basis: "CAKE_DEPOSIT",
  });
});

test("montos inválidos se rechazan con AMOUNT_INVALID", () => {
  const invalid = [
    { kind: "ORDER", total_clp: 0 },
    { kind: "ORDER", total_clp: -10 },
    { kind: "ORDER", total_clp: 10.5 },
    { kind: "ORDER", total_clp: "10.5" },
    { kind: "ORDER", total_clp: Number.NaN },
    { kind: "ORDER", total_clp: null },
    { kind: "ORDER", total_clp: MAX_ONLINE_AMOUNT_CLP + 1 },
    { kind: "CAKE", total_price_clp: 1000, deposit_clp: 0 },
    { kind: "CAKE", total_price_clp: 1000, deposit_clp: 1001 },
  ];
  for (const target of invalid) {
    assert.throws(() => amountToCharge(target), (err) => err.errorCode === "AMOUNT_INVALID" && err.statusCode === 409, JSON.stringify(target));
  }
});

test("un tipo de destino desconocido es un error de programación", () => {
  assert.throws(() => amountToCharge({ kind: "OTRO", total_clp: 100 }), /destino/i);
});

test("assertClpAmount acepta enteros seguros positivos dentro del tope", () => {
  assert.equal(assertClpAmount(1), 1);
  assert.equal(assertClpAmount(MAX_ONLINE_AMOUNT_CLP), MAX_ONLINE_AMOUNT_CLP);
  assert.throws(() => assertClpAmount(0));
  assert.throws(() => assertClpAmount(1.2));
  assert.throws(() => assertClpAmount("5"));
});

test("saldo de la torta = total − abono (nunca negativo)", () => {
  assert.equal(cakeBalanceClp({ total_price_clp: 45001, deposit_clp: 22501 }), 22500);
  assert.equal(cakeBalanceClp({ total_price_clp: 1, deposit_clp: 1 }), 0);
  assert.throws(() => cakeBalanceClp({ total_price_clp: 10, deposit_clp: 11 }), (err) => err.errorCode === "AMOUNT_INVALID");
});
