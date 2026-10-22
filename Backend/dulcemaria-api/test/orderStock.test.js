const test = require("node:test");
const assert = require("node:assert/strict");

const {
  planReservationChange,
  stockKeyForLine,
  aggregateStockNeeds,
  computeStockDelta,
  reserveLines,
  reserveOrderStock,
  consumeOrderStock,
  releaseOrderStock,
  reReserveOrderStock,
  releaseOrder,
  reReserveOrder,
  assertLinesAvailable,
} = require("../src/lib/orderStock");

const P1 = "00000000-0000-4000-8000-000000000001";
const P2 = "00000000-0000-4000-8000-000000000002";
const P3 = "00000000-0000-4000-8000-000000000003";
const V1 = "00000000-0000-4000-8000-0000000000a1";
const V2 = "00000000-0000-4000-8000-0000000000a2";

// ---------------------------------------------------------------------------
// Puras
// ---------------------------------------------------------------------------

test("planReservationChange: transiciones de la reserva de stock", () => {
  assert.deepEqual(planReservationChange("NONE", "RESERVE"), { next: "RESERVED", stock: "TAKE", changed: true });
  assert.deepEqual(planReservationChange("NONE", "CONSUME"), { next: "CONSUMED", stock: "TAKE", changed: true });
  assert.deepEqual(planReservationChange("RESERVED", "CONSUME"), { next: "CONSUMED", stock: "NONE", changed: true });
  assert.deepEqual(planReservationChange("CONSUMED", "CONSUME"), { next: "CONSUMED", stock: "NONE", changed: false });
  assert.deepEqual(planReservationChange("RESERVED", "RESERVE"), { next: "RESERVED", stock: "NONE", changed: false });
  assert.deepEqual(planReservationChange("CONSUMED", "RESERVE"), { next: "CONSUMED", stock: "NONE", changed: false });
  assert.deepEqual(planReservationChange("RESERVED", "RELEASE"), { next: "RELEASED", stock: "RETURN", changed: true });
  assert.deepEqual(planReservationChange("CONSUMED", "RELEASE"), { next: "RELEASED", stock: "RETURN", changed: true });
  assert.deepEqual(planReservationChange("NONE", "RELEASE"), { next: "NONE", stock: "NONE", changed: false });
  assert.deepEqual(planReservationChange("RELEASED", "RELEASE"), { next: "RELEASED", stock: "NONE", changed: false });
  assert.deepEqual(planReservationChange("RELEASED", "RE_RESERVE"), { next: "CONSUMED", stock: "TAKE", changed: true });
  assert.deepEqual(planReservationChange("NONE", "RE_RESERVE"), { next: "CONSUMED", stock: "TAKE", changed: true });
  assert.deepEqual(planReservationChange("RESERVED", "RE_RESERVE"), { next: "CONSUMED", stock: "NONE", changed: true });
  assert.deepEqual(planReservationChange("CONSUMED", "RE_RESERVE"), { next: "CONSUMED", stock: "NONE", changed: false });
});

test("planReservationChange: no se puede volver a tomar stock de una reserva liberada sin RE_RESERVE", () => {
  for (const action of ["RESERVE", "CONSUME"]) {
    assert.throws(() => planReservationChange("RELEASED", action), (err) => err.statusCode === 409 && err.errorCode === "STOCK_ALREADY_RELEASED");
  }
  assert.throws(() => planReservationChange("RARO", "CONSUME"));
  assert.throws(() => planReservationChange("NONE", "ROBAR"));
});

test("stockKeyForLine: variante, producto o línea cuya variante ya no existe", () => {
  assert.deepEqual(stockKeyForLine({ product_id: P1, variant_id: V1, qty: 2 }), { kind: "variant", id: V1, productId: P1 });
  assert.deepEqual(stockKeyForLine({ productId: P2, variantId: null, qty: 1 }), { kind: "product", id: P2, productId: P2 });
  assert.deepEqual(stockKeyForLine({ product_id: P1, variant_id: null, variant_name: "Grande", qty: 1 }), { kind: "gone", id: null, productId: P1 });
});

test("aggregateStockNeeds suma por clave y ordena productos antes que variantes (orden de bloqueo)", () => {
  const { needs, skipped } = aggregateStockNeeds([
    { productId: P2, variantId: null, qty: 1 },
    { productId: P1, variantId: V2, qty: 2 },
    { productId: P1, variantId: V2, qty: 1 },
    { productId: P1, variantId: V1, qty: 1 },
    { productId: P3, variantId: null, qty: 4 },
    { product_id: P1, variant_id: null, variant_name: "Borrada", qty: 9 },
  ]);
  assert.deepEqual(needs, [
    { kind: "product", id: P2, productId: P2, qty: 1 },
    { kind: "product", id: P3, productId: P3, qty: 4 },
    { kind: "variant", id: V1, productId: P1, qty: 1 },
    { kind: "variant", id: V2, productId: P1, qty: 3 },
  ]);
  assert.deepEqual(skipped, [{ productId: P1, variantName: "Borrada", qty: 9 }]);
});

test("computeStockDelta devuelve solo diferencias distintas de cero (nuevo − anterior)", () => {
  const before = [
    { product_id: P1, variant_id: V1, qty: 2 },
    { product_id: P2, variant_id: null, qty: 1 },
    { product_id: P1, variant_id: null, variant_name: "Borrada", qty: 3 },
  ];
  const after = [
    { productId: P1, variantId: V1, qty: 1 },
    { productId: P2, variantId: null, qty: 1 },
    { productId: P3, variantId: null, qty: 2 },
  ];
  const { changes, skipped } = computeStockDelta(before, after);
  assert.deepEqual(changes, [
    { kind: "product", id: P3, productId: P3, delta: 2 },
    { kind: "variant", id: V1, productId: P1, delta: -1 },
  ]);
  assert.deepEqual(skipped, [{ productId: P1, variantName: "Borrada", qty: 3 }]);
  assert.deepEqual(computeStockDelta(after, after).changes, []);
});

test("los alias que usa la unidad de pagos apuntan a las mismas funciones", () => {
  assert.equal(releaseOrder, releaseOrderStock);
  assert.equal(reReserveOrder, reReserveOrderStock);
});

// ---------------------------------------------------------------------------
// Con un cliente de base de datos simulado (enrutado por la etiqueta SQL)
// ---------------------------------------------------------------------------

function createFakeDb({ orders = {}, items = {}, products = {}, variants = {} } = {}) {
  const state = {
    orders: structuredClone(orders),
    items: structuredClone(items),
    products: structuredClone(products),
    variants: structuredClone(variants),
  };
  const log = [];
  const client = {
    async query(sql, params = []) {
      const tag = /\/\* orderStock:(\w+) \*\//.exec(sql)?.[1];
      log.push({ tag, params });
      switch (tag) {
        case "lockOrder": {
          const order = state.orders[params[0]];
          return order ? { rowCount: 1, rows: [{ id: params[0], stock_reservation_status: order.stock_reservation_status }] } : { rowCount: 0, rows: [] };
        }
        case "orderLines":
          return { rowCount: (state.items[params[0]] || []).length, rows: state.items[params[0]] || [] };
        case "lockProducts": {
          const rows = [...params[0]].sort().filter((id) => state.products[id]).map((id) => ({
            id,
            name: state.products[id].name,
            stock_qty: state.products[id].stock_qty,
            has_variants: Object.values(state.variants).some((v) => v.product_id === id),
          }));
          return { rowCount: rows.length, rows };
        }
        case "lockVariants": {
          const rows = [...params[0]].sort().filter((id) => state.variants[id]).map((id) => ({ id, ...state.variants[id] }));
          return { rowCount: rows.length, rows };
        }
        case "takeVariant":
        case "takeProduct": {
          const table = tag === "takeVariant" ? state.variants : state.products;
          const row = table[params[1]];
          if (!row || row.stock_qty < params[0]) return { rowCount: 0, rows: [] };
          row.stock_qty -= params[0];
          return { rowCount: 1, rows: [{ stock_qty: row.stock_qty }] };
        }
        case "returnVariant":
        case "returnProduct": {
          const table = tag === "returnVariant" ? state.variants : state.products;
          const row = table[params[1]];
          if (!row) return { rowCount: 0, rows: [] };
          row.stock_qty += params[0];
          return { rowCount: 1, rows: [{ stock_qty: row.stock_qty }] };
        }
        case "setReservation": {
          const order = state.orders[params[0]];
          if (!order || !params[2].includes(order.stock_reservation_status)) return { rowCount: 0, rows: [] };
          order.stock_reservation_status = params[1];
          return { rowCount: 1, rows: [{ id: params[0] }] };
        }
        default:
          throw new Error(`SQL no esperado en la prueba: ${sql}`);
      }
    },
  };
  return { client, state, log };
}

const ORDER = "00000000-0000-4000-8000-00000000c001";

function baseDb(reservation) {
  return createFakeDb({
    orders: { [ORDER]: { stock_reservation_status: reservation } },
    items: {
      [ORDER]: [
        { product_id: P1, variant_id: V1, variant_name: "Grande", qty: 2 },
        { product_id: P2, variant_id: null, variant_name: null, qty: 1 },
        { product_id: P1, variant_id: null, variant_name: "Borrada", qty: 5 },
      ],
    },
    products: { [P1]: { name: "Torta", stock_qty: 10 }, [P2]: { name: "Pie", stock_qty: 3 } },
    variants: { [V1]: { product_id: P1, name: "Grande", stock_qty: 10 } },
  });
}

test("releaseOrderStock devuelve el stock exactamente una vez (idempotente)", async () => {
  const { client, state } = baseDb("CONSUMED");
  const first = await releaseOrderStock(client, ORDER);
  assert.equal(first.released, true);
  assert.equal(first.from, "CONSUMED");
  assert.equal(state.variants[V1].stock_qty, 12);
  assert.equal(state.products[P2].stock_qty, 4);
  assert.equal(state.orders[ORDER].stock_reservation_status, "RELEASED");
  assert.deepEqual(first.skipped, [{ productId: P1, variantName: "Borrada", qty: 5 }]);

  const second = await releaseOrderStock(client, ORDER);
  assert.equal(second.released, false);
  assert.equal(state.variants[V1].stock_qty, 12);
  assert.equal(state.products[P2].stock_qty, 4);
});

test("releaseOrderStock no toca el stock si nunca se tomó (NONE)", async () => {
  const { client, state, log } = baseDb("NONE");
  const result = await releaseOrderStock(client, ORDER);
  assert.equal(result.released, false);
  assert.equal(state.variants[V1].stock_qty, 10);
  assert.equal(log.some((entry) => entry.tag && entry.tag.startsWith("return")), false);
});

test("consumeOrderStock toma stock al confirmar un pedido manual y bloquea productos antes que variantes", async () => {
  const { client, state, log } = createFakeDb({
    orders: { [ORDER]: { stock_reservation_status: "NONE" } },
    items: { [ORDER]: [{ product_id: P1, variant_id: V1, qty: 2 }, { product_id: P2, variant_id: null, qty: 1 }] },
    products: { [P1]: { name: "Torta", stock_qty: 10 }, [P2]: { name: "Pie", stock_qty: 3 } },
    variants: { [V1]: { product_id: P1, name: "Grande", stock_qty: 10 } },
  });
  const result = await consumeOrderStock(client, ORDER);
  assert.equal(result.changed, true);
  assert.equal(result.to, "CONSUMED");
  assert.equal(state.variants[V1].stock_qty, 8);
  assert.equal(state.products[P2].stock_qty, 2);
  const tags = log.map((entry) => entry.tag);
  assert.ok(tags.indexOf("lockProducts") < tags.indexOf("lockVariants"));
  const lockedProducts = log.find((entry) => entry.tag === "lockProducts").params[0];
  assert.deepEqual(lockedProducts, [P1, P2]);

  const again = await consumeOrderStock(client, ORDER);
  assert.equal(again.changed, false);
  assert.equal(state.variants[V1].stock_qty, 8);
});

test("consumeOrderStock sobre una reserva solo la marca consumida (no descuenta dos veces)", async () => {
  const { client, state } = baseDb("RESERVED");
  const result = await consumeOrderStock(client, ORDER);
  assert.equal(result.changed, true);
  assert.equal(result.stockTaken, false);
  assert.equal(state.variants[V1].stock_qty, 10);
  assert.equal(state.orders[ORDER].stock_reservation_status, "CONSUMED");
});

test("sin stock suficiente se lanza OUT_OF_STOCK antes de escribir nada", async () => {
  const { client, state, log } = createFakeDb({
    orders: { [ORDER]: { stock_reservation_status: "NONE" } },
    items: { [ORDER]: [{ product_id: P1, variant_id: V1, qty: 2 }, { product_id: P2, variant_id: null, qty: 7 }] },
    products: { [P1]: { name: "Torta", stock_qty: 10 }, [P2]: { name: "Pie", stock_qty: 3 } },
    variants: { [V1]: { product_id: P1, name: "Grande", stock_qty: 10 } },
  });
  await assert.rejects(reserveOrderStock(client, ORDER, { target: "CONSUMED" }), (err) => {
    assert.equal(err.statusCode, 409);
    assert.equal(err.errorCode, "OUT_OF_STOCK");
    assert.match(err.message, /Pie/);
    return true;
  });
  assert.equal(state.variants[V1].stock_qty, 10);
  assert.equal(state.products[P2].stock_qty, 3);
  assert.equal(log.some((entry) => entry.tag && entry.tag.startsWith("take")), false);
});

test("reserveLines agrega cantidades repetidas antes de validar el stock", async () => {
  const { client, state } = createFakeDb({
    products: { [P2]: { name: "Pie", stock_qty: 3 } },
  });
  await assert.rejects(
    reserveLines(client, [{ productId: P2, variantId: null, qty: 2 }, { productId: P2, variantId: null, qty: 2 }]),
    (err) => err.errorCode === "OUT_OF_STOCK"
  );
  assert.equal(state.products[P2].stock_qty, 3);
  const taken = await reserveLines(client, [{ productId: P2, variantId: null, qty: 1 }, { productId: P2, variantId: null, qty: 2 }]);
  assert.deepEqual(taken.taken, [{ kind: "product", id: P2, productId: P2, qty: 3 }]);
  assert.equal(state.products[P2].stock_qty, 0);
});

test("una línea sin variante de un producto que hoy tiene variantes no puede tomar stock del producto", async () => {
  const { client } = createFakeDb({
    products: { [P1]: { name: "Torta", stock_qty: 10 } },
    variants: { [V1]: { product_id: P1, name: "Grande", stock_qty: 10 } },
  });
  await assert.rejects(reserveLines(client, [{ productId: P1, variantId: null, qty: 1 }]), (err) => err.errorCode === "VARIANT_REQUIRED");
});

test("assertLinesAvailable verifica disponibilidad sin descontar (pedido manual web)", async () => {
  const { client, state, log } = createFakeDb({
    products: { [P2]: { name: "Pie", stock_qty: 3 } },
  });
  await assertLinesAvailable(client, [{ productId: P2, variantId: null, qty: 3 }]);
  await assert.rejects(assertLinesAvailable(client, [{ productId: P2, variantId: null, qty: 4 }]), (err) => err.errorCode === "OUT_OF_STOCK");
  assert.equal(state.products[P2].stock_qty, 3);
  assert.equal(log.some((entry) => entry.tag && entry.tag.startsWith("take")), false);
});

test("reReserveOrderStock vuelve a tomar el stock de una orden liberada (pago tardío)", async () => {
  const { client, state } = baseDb("RELEASED");
  const result = await reReserveOrderStock(client, ORDER);
  assert.equal(result.changed, true);
  assert.equal(result.to, "CONSUMED");
  assert.equal(state.variants[V1].stock_qty, 8);
  assert.equal(state.products[P2].stock_qty, 2);
});
