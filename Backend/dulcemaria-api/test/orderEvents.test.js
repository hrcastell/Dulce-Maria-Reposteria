const test = require("node:test");
const assert = require("node:assert/strict");

const { ORDER_EVENT_SOURCES, MAX_EVENT_DATA_CHARS, buildOrderEvent, recordOrderEvent } = require("../src/lib/orderEvents");

const ORDER = "00000000-0000-4000-8000-00000000c001";
const CAKE = "00000000-0000-4000-8000-00000000d001";
const USER = "00000000-0000-4000-8000-00000000e001";

test("buildOrderEvent arma la fila de auditoría (quién, qué, de→a, datos, cuándo)", () => {
  const row = buildOrderEvent({
    orderId: ORDER,
    type: "STATUS_CHANGED",
    from: "PENDING_PAYMENT",
    to: "PREPARING",
    actor: { sub: USER, email: "staff@dulcemaria.cl", role: "STAFF" },
    source: "ADMIN",
    data: { stock: "CONSUMED" },
  });
  assert.deepEqual(row, {
    order_id: ORDER,
    cake_order_id: null,
    event_type: "STATUS_CHANGED",
    from_value: "PENDING_PAYMENT",
    to_value: "PREPARING",
    actor_user_id: USER,
    actor_email: "staff@dulcemaria.cl",
    actor_role: "STAFF",
    source: "ADMIN",
    data: '{"stock":"CONSUMED"}',
  });
});

test("buildOrderEvent exige exactamente un destino (orden o torta)", () => {
  assert.throws(() => buildOrderEvent({ type: "STATUS_CHANGED", source: "ADMIN" }));
  assert.throws(() => buildOrderEvent({ orderId: ORDER, cakeOrderId: CAKE, type: "STATUS_CHANGED", source: "ADMIN" }));
  assert.equal(buildOrderEvent({ cakeOrderId: CAKE, type: "CAKE_ORDER_CREATED", source: "PUBLIC" }).cake_order_id, CAKE);
});

test("buildOrderEvent valida tipo y origen, y acepta un evento sin actor", () => {
  assert.deepEqual(ORDER_EVENT_SOURCES, ["ADMIN", "PUBLIC", "SYSTEM", "PAYMENT", "MIGRATION"]);
  assert.throws(() => buildOrderEvent({ orderId: ORDER, type: "status changed", source: "ADMIN" }));
  assert.throws(() => buildOrderEvent({ orderId: ORDER, type: "STATUS_CHANGED", source: "HACKER" }));
  const row = buildOrderEvent({ orderId: ORDER, type: "ORDER_CREATED", source: "PUBLIC" });
  assert.equal(row.actor_user_id, null);
  assert.equal(row.data, null);
  assert.equal(row.from_value, null);
});

test("los datos demasiado grandes se truncan en vez de fallar", () => {
  const row = buildOrderEvent({ orderId: ORDER, type: "ORDER_EDITED", source: "ADMIN", data: { blob: "x".repeat(MAX_EVENT_DATA_CHARS + 10) } });
  assert.deepEqual(JSON.parse(row.data), { truncated: true });
});

test("recordOrderEvent inserta con parámetros (sin interpolar valores)", async () => {
  const calls = [];
  const client = { query: async (sql, params) => (calls.push({ sql, params }), { rowCount: 1, rows: [{ id: 1 }] }) };
  await recordOrderEvent(client, { orderId: ORDER, type: "PAYMENT_STATUS_CHANGED", from: "PENDING", to: "PAID", source: "ADMIN" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO order_events/);
  assert.equal(calls[0].sql.includes("PAID"), false);
  assert.equal(calls[0].params.includes("PAID"), true);
});
