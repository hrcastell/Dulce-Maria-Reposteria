const test = require("node:test");
const assert = require("node:assert/strict");

const { buildOrderLines, lineIdentityKey, planOrderEdit, computeOrderTotals } = require("../src/lib/orderLines");

const P1 = "00000000-0000-4000-8000-000000000001";
const P2 = "00000000-0000-4000-8000-000000000002";
const P3 = "00000000-0000-4000-8000-000000000003";
const P4 = "00000000-0000-4000-8000-000000000004";
const V1 = "00000000-0000-4000-8000-0000000000a1";
const V2 = "00000000-0000-4000-8000-0000000000a2";
const V3 = "00000000-0000-4000-8000-0000000000a3";
const T1 = "00000000-0000-4000-8000-0000000000b1";
const T2 = "00000000-0000-4000-8000-0000000000b2";
const T3 = "00000000-0000-4000-8000-0000000000b3";

const catalog = {
  products: [
    { id: P1, name: "Torta", price_clp: 1000, is_active: true },
    { id: P2, name: "Kuchen", price_clp: 2000, is_active: false },
    { id: P3, name: "Pie", price_clp: 1500, is_active: true },
    { id: P4, name: "Alfajor", price_clp: 500, is_active: true },
  ],
  variants: [
    { id: V1, product_id: P1, name: "Grande", price_override_clp: 1500, is_active: true },
    { id: V2, product_id: P1, name: "Chica", price_override_clp: null, is_active: false },
    { id: V3, product_id: P4, name: "Caja", price_override_clp: 900, is_active: false },
  ],
  toppings: [
    { id: T1, product_id: P1, name: "Crema", price_clp: 500, is_active: true },
    { id: T2, product_id: P1, name: "Fruta", price_clp: 300, is_active: false },
    { id: T3, product_id: P3, name: "Merengue", price_clp: 200, is_active: true },
  ],
};

function build(items, { allowToppings = true } = {}) {
  return buildOrderLines({ items, ...catalog, allowToppings });
}

function assertDomainError(fn, status, code) {
  assert.throws(fn, (err) => {
    assert.equal(err.statusCode, status);
    assert.equal(err.errorCode, code);
    assert.equal(typeof err.message, "string");
    return true;
  });
}

test("precio de variante + toppings activos, calculado en el servidor", () => {
  const { lines, subtotal } = build([{ productId: P1, variantId: V1, qty: 2, toppings: [T1] }]);
  assert.equal(subtotal, 4000);
  assert.deepEqual(lines[0], {
    productId: P1,
    productName: "Torta",
    variantId: V1,
    variantName: "Grande",
    selectedToppings: [{ id: T1, name: "Crema", price: 500 }],
    unitPrice: 2000,
    qty: 2,
    lineTotal: 4000,
  });
});

test("producto sin variantes usa su precio base", () => {
  const { lines, subtotal } = build([{ productId: P3, qty: 3 }]);
  assert.equal(subtotal, 4500);
  assert.equal(lines[0].variantId, null);
  assert.equal(lines[0].selectedToppings, null);
});

test("si el producto tiene variantes activas hay que elegir una", () => {
  assertDomainError(() => build([{ productId: P1, qty: 1 }]), 400, "VARIANT_REQUIRED");
});

test("un producto cuyas variantes están todas inactivas no se puede vender", () => {
  assertDomainError(() => build([{ productId: P4, qty: 1 }]), 400, "PRODUCT_UNAVAILABLE");
});

test("productos, variantes y toppings inexistentes o inactivos se rechazan", () => {
  assertDomainError(() => build([{ productId: P2, qty: 1 }]), 400, "PRODUCT_UNAVAILABLE");
  assertDomainError(() => build([{ productId: "00000000-0000-4000-8000-00000000ffff", qty: 1 }]), 400, "PRODUCT_UNAVAILABLE");
  assertDomainError(() => build([{ productId: P1, variantId: V2, qty: 1 }]), 400, "VARIANT_UNAVAILABLE");
  assertDomainError(() => build([{ productId: P3, variantId: V1, qty: 1 }]), 400, "VARIANT_UNAVAILABLE");
  assertDomainError(() => build([{ productId: P1, variantId: V1, qty: 1, toppings: [T2] }]), 400, "TOPPING_UNAVAILABLE");
  assertDomainError(() => build([{ productId: P1, variantId: V1, qty: 1, toppings: [T3] }]), 400, "TOPPING_UNAVAILABLE");
});

test("un topping repetido en la misma línea se rechaza (antes se cobraba dos veces)", () => {
  assertDomainError(() => build([{ productId: P1, variantId: V1, qty: 1, toppings: [T1, T1] }]), 400, "TOPPING_DUPLICATED");
});

test("el canal público no admite toppings", () => {
  assertDomainError(() => build([{ productId: P1, variantId: V1, qty: 1, toppings: [T1] }], { allowToppings: false }), 400, "TOPPINGS_NOT_ALLOWED");
  assert.equal(build([{ productId: P1, variantId: V1, qty: 1, toppings: [] }], { allowToppings: false }).subtotal, 1500);
});

test("lineIdentityKey no depende del orden de los toppings", () => {
  const a = lineIdentityKey({ productId: P1, variantId: V1, toppings: [T2, T1] });
  const b = lineIdentityKey({ productId: P1, variantId: V1, toppings: [T1, T2] });
  assert.equal(a, b);
  assert.notEqual(lineIdentityKey({ productId: P1, variantId: null, toppings: [] }), lineIdentityKey({ productId: P1, variantId: V1, toppings: [] }));
});

const storedLine = (overrides) => ({
  product_id: P1,
  product_name_snapshot: "Torta (nombre antiguo)",
  variant_id: V1,
  variant_name: "Grande",
  selected_toppings: [{ id: T1, name: "Crema", price: 400 }],
  unit_price_clp: 1800,
  qty: 2,
  line_total_clp: 3600,
  ...overrides,
});

test("planOrderEdit conserva el precio guardado de las líneas que no cambian de identidad", () => {
  const plan = planOrderEdit([storedLine()], [
    { productId: P1, variantId: V1, toppings: [T1], qty: 3 },
    { productId: P3, variantId: null, toppings: [], qty: 1 },
  ]);
  assert.equal(plan.slots.length, 2);
  assert.equal(plan.slots[0].kind, "kept");
  assert.deepEqual(plan.slots[0].line, {
    productId: P1,
    productName: "Torta (nombre antiguo)",
    variantId: V1,
    variantName: "Grande",
    selectedToppings: [{ id: T1, name: "Crema", price: 400 }],
    unitPrice: 1800,
    qty: 3,
    lineTotal: 5400,
  });
  assert.equal(plan.slots[1].kind, "new");
  assert.equal(plan.slots[1].item.productId, P3);
});

test("planOrderEdit empareja duplicados uno a uno, en orden", () => {
  const plan = planOrderEdit([storedLine(), storedLine({ unit_price_clp: 1700 })], [
    { productId: P1, variantId: V1, toppings: [T1], qty: 1 },
    { productId: P1, variantId: V1, toppings: [T1], qty: 1 },
    { productId: P1, variantId: V1, toppings: [T1], qty: 1 },
  ]);
  assert.deepEqual(plan.slots.map((s) => s.kind), ["kept", "kept", "new"]);
  assert.equal(plan.slots[0].line.unitPrice, 1800);
  assert.equal(plan.slots[1].line.unitPrice, 1700);
});

test("una línea cuya variante fue eliminada nunca se empareja con una línea nueva", () => {
  const plan = planOrderEdit([storedLine({ variant_id: null })], [{ productId: P1, variantId: null, toppings: [T1], qty: 1 }]);
  assert.equal(plan.slots[0].kind, "new");
});

test("computeOrderTotals: subtotal + despacho − descuento, nunca negativo; el precio final manual manda", () => {
  assert.deepEqual(computeOrderTotals({ subtotal: 10000, deliveryFeeClp: 2000, discountAmountClp: 500 }), {
    subtotal: 10000,
    deliveryFee: 2000,
    discount: 500,
    finalPriceOverride: null,
    total: 11500,
  });
  assert.equal(computeOrderTotals({ subtotal: 1000, deliveryFeeClp: 0, discountAmountClp: 5000 }).total, 0);
  assert.equal(computeOrderTotals({ subtotal: 1000, finalPriceOverrideClp: 700 }).total, 700);
  assert.equal(computeOrderTotals({ subtotal: 1000, finalPriceOverrideClp: 0 }).total, 0);
  assert.equal(computeOrderTotals({ subtotal: 1000, finalPriceOverrideClp: null }).total, 1000);
});

test("computeOrderTotals rechaza totales fuera de rango (400)", () => {
  assertDomainError(() => computeOrderTotals({ subtotal: 100000001 }), 400, "ORDER_TOTAL_INVALID");
  assertDomainError(() => computeOrderTotals({ subtotal: 1.5 }), 400, "ORDER_TOTAL_INVALID");
});

test("los toppings guardados como texto JSON también se reconocen", () => {
  const plan = planOrderEdit([storedLine({ selected_toppings: JSON.stringify([{ id: T1, name: "Crema", price: 400 }]) })], [
    { productId: P1, variantId: V1, toppings: [T1], qty: 2 },
  ]);
  assert.equal(plan.slots[0].kind, "kept");
});
