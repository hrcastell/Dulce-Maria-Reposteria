/**
 * Auditoría mínima de órdenes y pedidos de torta (tabla order_events):
 * quién (usuario/rol/correo), qué (tipo), de → a, datos breves y cuándo.
 * Cada evento se escribe en la MISMA transacción que el cambio que describe.
 *
 * Tipos usados hoy: ORDER_CREATED, STATUS_CHANGED, PAYMENT_STATUS_CHANGED,
 * ORDER_EDITED, CAKE_ORDER_CREATED, CAKE_STATUS_CHANGED y, desde la
 * migración, LEGACY_STATUS_NORMALIZED. La unidad de pagos puede agregar los
 * suyos (formato MAYÚSCULAS_CON_GUIONES).
 */

const ORDER_EVENT_SOURCES = Object.freeze(["ADMIN", "PUBLIC", "SYSTEM", "PAYMENT", "MIGRATION"]);
const EVENT_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{2,59}$/;
const MAX_EVENT_DATA_CHARS = 4000;
const MAX_VALUE_CHARS = 100;

function shortText(value, max) {
  if (value === undefined || value === null) return null;
  return String(value).slice(0, max);
}

/** Fila lista para insertar (pura; lanza ante un evento mal formado). */
function buildOrderEvent({ orderId, cakeOrderId, type, from, to, actor, source, data }) {
  if (Boolean(orderId) === Boolean(cakeOrderId)) throw new Error("Un evento necesita exactamente una orden o un pedido de torta.");
  if (!EVENT_TYPE_PATTERN.test(String(type || ""))) throw new Error(`Tipo de evento inválido: ${type}`);
  if (!ORDER_EVENT_SOURCES.includes(source)) throw new Error(`Origen de evento inválido: ${source}`);

  let serialized = null;
  if (data !== undefined && data !== null) {
    serialized = JSON.stringify(data);
    if (serialized.length > MAX_EVENT_DATA_CHARS) serialized = JSON.stringify({ truncated: true });
  }
  return {
    order_id: orderId || null,
    cake_order_id: cakeOrderId || null,
    event_type: type,
    from_value: shortText(from, MAX_VALUE_CHARS),
    to_value: shortText(to, MAX_VALUE_CHARS),
    actor_user_id: actor?.sub || null,
    actor_email: shortText(actor?.email, 254),
    actor_role: shortText(actor?.role, 20),
    source,
    data: serialized,
  };
}

async function recordOrderEvent(client, event) {
  const row = buildOrderEvent(event);
  await client.query(
    `INSERT INTO order_events (
       order_id, cake_order_id, event_type, from_value, to_value,
       actor_user_id, actor_email, actor_role, source, data, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,clock_timestamp())`,
    [
      row.order_id,
      row.cake_order_id,
      row.event_type,
      row.from_value,
      row.to_value,
      row.actor_user_id,
      row.actor_email,
      row.actor_role,
      row.source,
      row.data,
    ]
  );
  return row;
}

/** Últimos eventos de una orden o pedido de torta (más antiguos primero). */
async function listOrderEvents(db, { orderId, cakeOrderId, limit = 100 }) {
  const column = orderId ? "order_id" : "cake_order_id";
  const r = await db.query(
    `SELECT id, event_type, from_value, to_value, actor_user_id, actor_email, actor_role, source, data, created_at
     FROM (
       SELECT * FROM order_events WHERE ${column} = $1 ORDER BY created_at DESC, id DESC LIMIT $2
     ) recent
     ORDER BY created_at ASC, id ASC`,
    [orderId || cakeOrderId, Math.min(Math.max(Number(limit) || 100, 1), 500)]
  );
  return r.rows;
}

module.exports = { ORDER_EVENT_SOURCES, MAX_EVENT_DATA_CHARS, buildOrderEvent, recordOrderEvent, listOrderEvents };
