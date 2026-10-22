const test = require("node:test");
const assert = require("node:assert/strict");

const { lockOrder, applyPaymentChange, applyStatusChange } = require("../src/lib/orderLifecycle");

const ORDER = "00000000-0000-4000-8000-00000000c001";
const P1 = "00000000-0000-4000-8000-000000000001";

// Base simulada mínima: una orden en línea con una línea de un producto sin variantes.
function createFakeDb(orderOverrides) {
  const state = {
    order: {
      id: ORDER,
      order_no: 7,
      order_code: "WEB-1",
      customer_id: "c1",
      status: "PENDING_PAYMENT",
      payment_status: "PENDING",
      payment_method: "ONLINE",
      delivery_method: "DELIVERY",
      total_clp: 2000,
      stock_reservation_status: "RESERVED",
      cancellation_source: null,
      paid_at: null,
      ...orderOverrides,
    },
    stock: 5,
    events: [],
  };
  const client = {
    async query(sql, params = []) {
      const tag = /\/\* (\w+):(\w+) \*\//.exec(sql);
      const key = tag ? `${tag[1]}:${tag[2]}` : /INSERT INTO order_events/.test(sql) ? "event" : sql.slice(0, 40);
      const o = state.order;
      switch (key) {
        case "orderLifecycle:lockOrder":
        case "orderStock:lockOrder":
          return { rowCount: 1, rows: [{ ...o }] };
        case "orderStock:orderLines":
          return { rowCount: 1, rows: [{ product_id: P1, variant_id: null, variant_name: null, qty: 2 }] };
        case "orderStock:lockProducts":
          return { rowCount: 1, rows: [{ id: P1, name: "Pie", stock_qty: state.stock, has_variants: false }] };
        case "orderStock:takeProduct":
          if (state.stock < params[0]) return { rowCount: 0, rows: [] };
          state.stock -= params[0];
          return { rowCount: 1, rows: [{ stock_qty: state.stock }] };
        case "orderStock:returnProduct":
          state.stock += params[0];
          return { rowCount: 1, rows: [{ stock_qty: state.stock }] };
        case "orderStock:setReservation":
          if (!params[2].includes(o.stock_reservation_status)) return { rowCount: 0, rows: [] };
          o.stock_reservation_status = params[1];
          return { rowCount: 1, rows: [{ id: ORDER }] };
        case "orderLifecycle:setPayment":
          if (o.payment_status !== params[2]) return { rowCount: 0, rows: [] };
          o.payment_status = params[1];
          if (/paid_at = NOW\(\)/.test(sql)) o.paid_at = new Date();
          return { rowCount: 1, rows: [{ ...o }] };
        case "orderLifecycle:setStatus":
          if (o.status !== params[2]) return { rowCount: 0, rows: [] };
          o.status = params[1];
          o.cancellation_source = params[4] ? null : params[3] ?? o.cancellation_source;
          return { rowCount: 1, rows: [{ ...o }] };
        case "event":
          state.events.push({ type: params[2], from: params[3], to: params[4], source: params[8] });
          return { rowCount: 1, rows: [] };
        default:
          throw new Error(`SQL no esperado: ${sql.slice(0, 80)}`);
      }
    },
  };
  return { client, state };
}

test("vencimiento (SYSTEM): cancela con origen PAYMENT_EXPIRED y libera la reserva una vez", async () => {
  const { client, state } = createFakeDb();
  const order = await lockOrder(client, ORDER);
  const result = await applyStatusChange(client, order, "CANCELLED", { source: "SYSTEM" });
  assert.equal(result.changed, true);
  assert.equal(state.order.status, "CANCELLED");
  assert.equal(state.order.cancellation_source, "PAYMENT_EXPIRED");
  assert.equal(state.order.stock_reservation_status, "RELEASED");
  assert.equal(state.stock, 7);
  assert.deepEqual(state.events.at(-1), { type: "STATUS_CHANGED", from: "PENDING_PAYMENT", to: "CANCELLED", source: "SYSTEM" });
});

test("pago tardío (PAYMENT): registra el pago, revive la orden, vuelve a tomar stock y limpia el origen", async () => {
  const { client, state } = createFakeDb({
    status: "CANCELLED",
    payment_status: "FAILED",
    stock_reservation_status: "RELEASED",
    cancellation_source: "PAYMENT_EXPIRED",
  });
  let order = await lockOrder(client, ORDER);
  order = (await applyPaymentChange(client, order, "PAID", { source: "PAYMENT" })).order;
  const result = await applyStatusChange(client, order, "PAID", { source: "PAYMENT" });
  assert.equal(result.changed, true);
  assert.equal(state.order.status, "PAID");
  assert.equal(state.order.payment_status, "PAID");
  assert.ok(state.order.paid_at instanceof Date);
  assert.equal(state.order.cancellation_source, null);
  assert.equal(state.order.stock_reservation_status, "CONSUMED");
  assert.equal(state.stock, 3);
  assert.deepEqual(state.events.map((e) => `${e.type}:${e.source}`), ["PAYMENT_STATUS_CHANGED:PAYMENT", "STATUS_CHANGED:PAYMENT"]);
});

test("el panel no puede revivir una orden vencida ni pagarla", async () => {
  const { client } = createFakeDb({ status: "CANCELLED", payment_status: "FAILED", stock_reservation_status: "RELEASED", cancellation_source: "PAYMENT_EXPIRED" });
  const order = await lockOrder(client, ORDER);
  await assert.rejects(applyPaymentChange(client, order, "PAID", { source: "ADMIN" }), (err) => err.statusCode === 409);
  await assert.rejects(applyStatusChange(client, { ...order, payment_status: "PAID" }, "PAID", { source: "ADMIN" }), (err) => err.errorCode === "ORDER_FINALIZED");
});

test("pago confirmado por la pasarela sobre una reserva: la consume sin descontar dos veces", async () => {
  const { client, state } = createFakeDb();
  let order = await lockOrder(client, ORDER);
  order = (await applyPaymentChange(client, order, "PAID", { source: "PAYMENT" })).order;
  await applyStatusChange(client, order, "PAID", { source: "PAYMENT" });
  assert.equal(state.order.stock_reservation_status, "CONSUMED");
  assert.equal(state.stock, 5);
});

test("repetir el mismo cambio no escribe nada", async () => {
  const { client, state } = createFakeDb({ status: "PREPARING", payment_status: "PAID", payment_method: "CASH", stock_reservation_status: "CONSUMED" });
  const order = await lockOrder(client, ORDER);
  assert.equal((await applyPaymentChange(client, order, "PAID", { source: "ADMIN" })).changed, false);
  assert.equal((await applyStatusChange(client, order, "PREPARING", { source: "ADMIN" })).changed, false);
  assert.equal(state.events.length, 0);
});
