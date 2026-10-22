/**
 * Stock de las órdenes: un solo modelo para todos los canales, registrado en
 * orders.stock_reservation_status (NONE | RESERVED | CONSUMED | RELEASED).
 *
 *   NONE      no se tomó stock (pedido manual web aún sin confirmar; órdenes
 *             web heredadas).
 *   RESERVED  stock descontado y provisorio (orden en línea pendiente de pago).
 *   CONSUMED  stock descontado y definitivo (venta confirmada).
 *   RELEASED  se tomó y se devolvió (orden cancelada o vencida).
 *
 * Canales (ver plan maestro):
 *   - panel: CONSUME al crear (comportamiento de siempre);
 *   - web manual: NONE al crear; CONSUME cuando el panel la confirma (sale de
 *     PENDING_PAYMENT);
 *   - web en línea (unidad de pagos): RESERVE al crear → CONSUME al pagarse →
 *     RELEASE al vencer o cancelarse; RE_RESERVE ante un pago tardío;
 *   - cancelar: RELEASE (solo si estaba RESERVED/CONSUMED; idempotente).
 *
 * Contrato de todas las funciones con `client`:
 *   - se llaman DENTRO de la transacción del llamador (mismo client);
 *   - bloquean en orden fijo: orders → products (por id) → product_variants
 *     (por id). El trigger de variantes actualiza products, ya bloqueado: no
 *     hay interbloqueos entre transacciones que sigan el mismo orden;
 *   - validan TODO el stock antes de escribir: si falta stock lanzan AppError
 *     409 OUT_OF_STOCK sin haber modificado nada (aunque el llamador capture
 *     el error, no queda un descuento parcial);
 *   - el cambio de reserva es un UPDATE condicional (`WHERE
 *     stock_reservation_status = ANY(...) RETURNING`): repetir una liberación
 *     no devuelve stock dos veces.
 *
 * Una línea cuya variante fue eliminada (variant_id NULL por ON DELETE SET
 * NULL, con variant_name guardado) no se puede ni descontar ni devolver: se
 * informa en `skipped`. Lo mismo para devolver a un producto que hoy tiene
 * variantes (su stock es la suma de ellas).
 */

const { appError } = require("./httpErrors");
const { STOCK_RESERVATION_STATUSES } = require("./orderStatus");

const RESERVATION_ACTIONS = Object.freeze(["RESERVE", "CONSUME", "RELEASE", "RE_RESERVE"]);
const HELD = Object.freeze(["RESERVED", "CONSUMED"]);

// ---------------------------------------------------------------------------
// Puras
// ---------------------------------------------------------------------------

/**
 * Siguiente estado de la reserva y operación de stock para una acción.
 * @returns {{ next: string, stock: 'TAKE'|'RETURN'|'NONE', changed: boolean }}
 */
function planReservationChange(current, action) {
  if (!STOCK_RESERVATION_STATUSES.includes(current)) throw new Error(`Estado de reserva desconocido: ${current}`);
  if (!RESERVATION_ACTIONS.includes(action)) throw new Error(`Acción de reserva desconocida: ${action}`);
  const unchanged = { next: current, stock: "NONE", changed: false };
  switch (action) {
    case "RESERVE":
    case "CONSUME":
      if (current === "RELEASED") {
        throw appError(409, "STOCK_ALREADY_RELEASED", "El stock de esta orden ya fue devuelto: no se puede volver a tomar.");
      }
      if (current === "NONE") return { next: action === "RESERVE" ? "RESERVED" : "CONSUMED", stock: "TAKE", changed: true };
      if (action === "CONSUME" && current === "RESERVED") return { next: "CONSUMED", stock: "NONE", changed: true };
      return unchanged;
    case "RELEASE":
      return HELD.includes(current) ? { next: "RELEASED", stock: "RETURN", changed: true } : unchanged;
    case "RE_RESERVE":
      if (current === "RELEASED" || current === "NONE") return { next: "CONSUMED", stock: "TAKE", changed: true };
      if (current === "RESERVED") return { next: "CONSUMED", stock: "NONE", changed: true };
      return unchanged;
    default:
      return unchanged;
  }
}

function lineFields(line) {
  return {
    productId: line.productId ?? line.product_id,
    variantId: line.variantId ?? line.variant_id ?? null,
    variantName: line.variantName ?? line.variant_name ?? null,
    qty: Number(line.qty),
  };
}

/** Clave de stock de una línea: su variante, su producto o "gone" (variante eliminada). */
function stockKeyForLine(line) {
  const { productId, variantId, variantName } = lineFields(line);
  if (variantId) return { kind: "variant", id: variantId, productId };
  if (variantName) return { kind: "gone", id: null, productId };
  return { kind: "product", id: productId, productId };
}

function compareNeeds(a, b) {
  if (a.kind !== b.kind) return a.kind === "product" ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Cantidades sumadas por clave, productos antes que variantes, cada grupo por id. */
function aggregateStockNeeds(lines) {
  const byKey = new Map();
  const skipped = [];
  for (const line of lines || []) {
    const key = stockKeyForLine(line);
    const { variantName, qty } = lineFields(line);
    if (key.kind === "gone") {
      skipped.push({ productId: key.productId, variantName, qty });
      continue;
    }
    const mapKey = `${key.kind}:${key.id}`;
    if (!byKey.has(mapKey)) byKey.set(mapKey, { ...key, qty: 0 });
    byKey.get(mapKey).qty += qty;
  }
  const needs = [...byKey.values()].filter((need) => need.qty > 0).sort(compareNeeds);
  return { needs, skipped };
}

/** Diferencia de stock por clave al editar (nuevo − anterior), sin ceros. */
function computeStockDelta(previousLines, nextLines) {
  const before = aggregateStockNeeds(previousLines);
  const after = aggregateStockNeeds(nextLines);
  const deltas = new Map();
  for (const need of before.needs) deltas.set(`${need.kind}:${need.id}`, { kind: need.kind, id: need.id, productId: need.productId, delta: -need.qty });
  for (const need of after.needs) {
    const key = `${need.kind}:${need.id}`;
    if (!deltas.has(key)) deltas.set(key, { kind: need.kind, id: need.id, productId: need.productId, delta: 0 });
    deltas.get(key).delta += need.qty;
  }
  const changes = [...deltas.values()].filter((change) => change.delta !== 0).sort(compareNeeds);
  return { changes, skipped: [...before.skipped, ...after.skipped] };
}

// ---------------------------------------------------------------------------
// Con base de datos (dentro de la transacción del llamador)
// ---------------------------------------------------------------------------

async function lockOrderRow(client, orderId) {
  const r = await client.query(
    `/* orderStock:lockOrder */ SELECT id, stock_reservation_status FROM orders WHERE id = $1 FOR UPDATE`,
    [orderId]
  );
  if (r.rowCount === 0) throw appError(404, "ORDER_NOT_FOUND", "Orden no encontrada.");
  return r.rows[0];
}

async function loadStockLines(client, orderId) {
  const r = await client.query(
    `/* orderStock:orderLines */ SELECT product_id, variant_id, variant_name, qty FROM order_items WHERE order_id = $1`,
    [orderId]
  );
  return r.rows;
}

/** Bloquea, en orden de id, los productos (incluidos los padres de variantes) y luego las variantes. */
async function lockStockRows(client, needs) {
  const productIds = [...new Set(needs.map((need) => need.productId))].sort();
  const variantIds = [...new Set(needs.filter((need) => need.kind === "variant").map((need) => need.id))].sort();
  const products = new Map();
  const variants = new Map();
  if (productIds.length) {
    const r = await client.query(
      `/* orderStock:lockProducts */ SELECT p.id, p.name, p.stock_qty,
              EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id) AS has_variants
       FROM products p WHERE p.id = ANY($1::uuid[]) ORDER BY p.id FOR UPDATE`,
      [productIds]
    );
    for (const row of r.rows) products.set(row.id, row);
  }
  if (variantIds.length) {
    const r = await client.query(
      `/* orderStock:lockVariants */ SELECT id, product_id, name, stock_qty
       FROM product_variants WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [variantIds]
    );
    for (const row of r.rows) variants.set(row.id, row);
  }
  return { products, variants };
}

function outOfStock(labelText, available) {
  return appError(409, "OUT_OF_STOCK", `Stock insuficiente para "${labelText}". Disponible: ${Number(available) || 0}.`);
}

/** Valida contra las filas ya bloqueadas; lanza antes de cualquier escritura. */
function assertCanTake(locked, takes) {
  for (const need of takes) {
    if (need.kind === "variant") {
      const variant = locked.variants.get(need.id);
      if (!variant) throw appError(409, "VARIANT_UNAVAILABLE", "Una de las variantes de la orden ya no existe.");
      if (Number(variant.stock_qty) < need.qty) {
        const productName = locked.products.get(need.productId)?.name;
        throw outOfStock(productName ? `${productName} - ${variant.name}` : variant.name, variant.stock_qty);
      }
    } else {
      const product = locked.products.get(need.id);
      if (!product) throw appError(409, "PRODUCT_UNAVAILABLE", "Uno de los productos de la orden ya no existe.");
      if (product.has_variants) {
        throw appError(409, "VARIANT_REQUIRED", `Debes seleccionar una variante para "${product.name}".`);
      }
      if (Number(product.stock_qty) < need.qty) throw outOfStock(product.name, product.stock_qty);
    }
  }
}

/** Descuento condicional (ya validado; la condición es una defensa adicional). */
async function applyTakes(client, takes) {
  for (const need of takes) {
    const tag = need.kind === "variant" ? "takeVariant" : "takeProduct";
    const table = need.kind === "variant" ? "product_variants" : "products";
    const r = await client.query(
      `/* orderStock:${tag} */ UPDATE ${table} SET stock_qty = stock_qty - $1 WHERE id = $2 AND stock_qty >= $1 RETURNING stock_qty`,
      [need.qty, need.id]
    );
    if (r.rowCount === 0) throw outOfStock(need.id, 0);
  }
}

/** Devuelve stock a las filas bloqueadas; informa lo que no se pudo devolver. */
async function applyReturns(client, locked, returns) {
  const returned = [];
  const skipped = [];
  for (const need of returns) {
    const isVariant = need.kind === "variant";
    const target = isVariant ? locked.variants.get(need.id) : locked.products.get(need.id);
    if (!target || (!isVariant && target.has_variants)) {
      skipped.push({ productId: need.productId, variantName: null, qty: need.qty });
      continue;
    }
    await client.query(
      `/* orderStock:${isVariant ? "returnVariant" : "returnProduct"} */ UPDATE ${isVariant ? "product_variants" : "products"}
       SET stock_qty = stock_qty + $1 WHERE id = $2 RETURNING stock_qty`,
      [need.qty, need.id]
    );
    returned.push(need);
  }
  return { returned, skipped };
}

async function setReservation(client, orderId, next, fromStatuses) {
  const r = await client.query(
    `/* orderStock:setReservation */ UPDATE orders SET stock_reservation_status = $2
     WHERE id = $1 AND stock_reservation_status = ANY($3::text[]) RETURNING id`,
    [orderId, next, fromStatuses]
  );
  return r.rowCount > 0;
}

/**
 * Descuenta las cantidades de unas líneas (sin tocar ninguna orden). Para crear
 * una orden con la reserva ya tomada: el llamador inserta la orden con
 * stock_reservation_status = 'RESERVED' o 'CONSUMED'.
 */
async function reserveLines(client, lines) {
  const { needs, skipped } = aggregateStockNeeds(lines);
  if (skipped.length) throw appError(409, "VARIANT_UNAVAILABLE", "Una de las variantes de la orden ya no existe.");
  const locked = await lockStockRows(client, needs);
  assertCanTake(locked, needs);
  await applyTakes(client, needs);
  return { taken: needs };
}

/**
 * Verifica (con las filas bloqueadas) que haya stock para unas líneas, SIN
 * descontar. Lo usa el pedido manual web, que no reserva al crearse.
 */
async function assertLinesAvailable(client, lines) {
  const { needs } = aggregateStockNeeds(lines);
  const locked = await lockStockRows(client, needs);
  assertCanTake(locked, needs);
}

/** Aplica una acción de reserva a una orden existente (bloquea la orden primero). */
async function applyReservationAction(client, orderId, action) {
  const order = await lockOrderRow(client, orderId);
  const from = order.stock_reservation_status;
  const plan = planReservationChange(from, action);
  const result = { changed: false, from, to: from, stockTaken: false, stockReturned: false, taken: [], returned: [], skipped: [] };
  if (!plan.changed) return { ...result, to: plan.next };

  if (plan.stock === "TAKE") {
    const { needs, skipped } = aggregateStockNeeds(await loadStockLines(client, orderId));
    const locked = await lockStockRows(client, needs);
    assertCanTake(locked, needs);
    if (!(await setReservation(client, orderId, plan.next, [from]))) return result;
    await applyTakes(client, needs);
    return { ...result, changed: true, to: plan.next, stockTaken: true, taken: needs, skipped };
  }

  if (!(await setReservation(client, orderId, plan.next, plan.stock === "RETURN" ? [...HELD] : [from]))) return result;
  if (plan.stock === "RETURN") {
    const { needs, skipped } = aggregateStockNeeds(await loadStockLines(client, orderId));
    const locked = await lockStockRows(client, needs);
    const { returned, skipped: notReturned } = await applyReturns(client, locked, needs);
    return { ...result, changed: true, to: plan.next, stockReturned: true, returned, skipped: [...skipped, ...notReturned] };
  }
  return { ...result, changed: true, to: plan.next };
}

/** NONE → RESERVED (o → CONSUMED con { target: 'CONSUMED' }), descontando el stock de la orden. */
function reserveOrderStock(client, orderId, { target = "RESERVED" } = {}) {
  if (target !== "RESERVED" && target !== "CONSUMED") throw new Error(`Destino de reserva inválido: ${target}`);
  return applyReservationAction(client, orderId, target === "CONSUMED" ? "CONSUME" : "RESERVE");
}

/** NONE → CONSUMED (descuenta) | RESERVED → CONSUMED (sin descontar de nuevo) | CONSUMED: sin cambios. */
function consumeOrderStock(client, orderId) {
  return applyReservationAction(client, orderId, "CONSUME");
}

/** RESERVED|CONSUMED → RELEASED devolviendo el stock; en cualquier otro estado no hace nada. */
async function releaseOrderStock(client, orderId) {
  const result = await applyReservationAction(client, orderId, "RELEASE");
  return { ...result, released: result.changed };
}

/** RELEASED → CONSUMED volviendo a descontar (pago tardío sobre una orden vencida). */
function reReserveOrderStock(client, orderId) {
  return applyReservationAction(client, orderId, "RE_RESERVE");
}

/**
 * Edición de las líneas: si la orden tiene stock tomado (RESERVED/CONSUMED),
 * aplica solo la diferencia (nuevo − anterior). Si no tomó stock, no hace nada.
 */
async function adjustOrderStockForEdit(client, { orderId, previousLines, nextLines }) {
  const order = await lockOrderRow(client, orderId);
  if (!HELD.includes(order.stock_reservation_status)) {
    return { applied: false, reservation: order.stock_reservation_status, changes: [], skipped: [] };
  }
  const { changes, skipped } = computeStockDelta(previousLines, nextLines);
  if (!changes.length) return { applied: true, reservation: order.stock_reservation_status, changes, skipped };
  const takes = changes.filter((c) => c.delta > 0).map((c) => ({ kind: c.kind, id: c.id, productId: c.productId, qty: c.delta }));
  const returns = changes.filter((c) => c.delta < 0).map((c) => ({ kind: c.kind, id: c.id, productId: c.productId, qty: -c.delta }));
  const locked = await lockStockRows(client, [...takes, ...returns]);
  assertCanTake(locked, takes);
  await applyTakes(client, takes);
  const { skipped: notReturned } = await applyReturns(client, locked, returns);
  return { applied: true, reservation: order.stock_reservation_status, changes, skipped: [...skipped, ...notReturned] };
}

module.exports = {
  RESERVATION_ACTIONS,
  planReservationChange,
  stockKeyForLine,
  aggregateStockNeeds,
  computeStockDelta,
  assertLinesAvailable,
  reserveLines,
  reserveOrderStock,
  consumeOrderStock,
  releaseOrderStock,
  reReserveOrderStock,
  adjustOrderStockForEdit,
  // Nombres que usa el diseño de pagos (payments-design.md, tarea B16).
  releaseOrder: releaseOrderStock,
  reReserveOrder: reReserveOrderStock,
};
