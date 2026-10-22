/**
 * Estados de las órdenes del catálogo (`orders`): vocabulario único,
 * transiciones permitidas y sus efectos. Módulo puro: las rutas (y la unidad
 * de pagos) le preguntan qué hacer y aplican el resultado en UNA transacción.
 *
 * Dos ejes independientes:
 *   - `status` = avance del pedido (cumplimiento).
 *   - `payment_status` = ÚNICA fuente de verdad del dinero.
 * `status = 'PAID'` es una etapa de cumplimiento ("pagado, falta preparar") a
 * la que solo se entra con el pago registrado; el diseño de pagos la usa para
 * las órdenes en línea (PENDING_PAYMENT → PAID).
 *
 * Reserva de stock (`stock_reservation_status`, ver orderStock.js):
 *   - salir de PENDING_PAYMENT hacia una etapa activa CONSUME (pedido manual
 *     web sin reserva: se descuenta al confirmarlo; reserva en línea: pasa a
 *     consumida sin volver a descontar);
 *   - cancelar LIBERA lo reservado o consumido (una sola vez);
 *   - las órdenes heredadas que ya avanzaron sin reserva no se tocan.
 */

const ORDER_STATUSES = Object.freeze(["PENDING_PAYMENT", "PAID", "PREPARING", "READY", "DELIVERED", "CANCELLED"]);
const TERMINAL_ORDER_STATUSES = Object.freeze(["DELIVERED", "CANCELLED"]);
const ACTIVE_ORDER_STATUSES = Object.freeze(["PAID", "PREPARING", "READY", "DELIVERED"]);
const PAYMENT_STATUSES = Object.freeze(["PENDING", "PAID", "FAILED", "REFUNDED"]);
const PAYMENT_METHODS = Object.freeze(["TRANSFER", "CASH", "ONLINE"]);
const MANUAL_PAYMENT_METHODS = Object.freeze(["TRANSFER", "CASH"]);
const DELIVERY_METHODS = Object.freeze(["PICKUP", "DELIVERY"]);
const STOCK_RESERVATION_STATUSES = Object.freeze(["NONE", "RESERVED", "CONSUMED", "RELEASED"]);
const CANCELLATION_SOURCES = Object.freeze(["PAYMENT_EXPIRED", "ADMIN"]);
// ADMIN = panel; SYSTEM = vencimiento automático; PAYMENT = pasarela (unidad de pagos).
const ORDER_CHANGE_SOURCES = Object.freeze(["ADMIN", "SYSTEM", "PAYMENT"]);

const ORDER_STATUS_LABELS = Object.freeze({
  PENDING_PAYMENT: "Pendiente de pago",
  PAID: "Pagado",
  PREPARING: "Preparando",
  READY: "Listo",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
});

const PAYMENT_STATUS_LABELS = Object.freeze({
  PENDING: "Pendiente",
  PAID: "Pagado",
  FAILED: "Fallido",
  REFUNDED: "Reembolsado",
});

// Valores que el CHECK v2 todavía admitía (primera versión de la API, feb-2026).
const LEGACY_ORDER_STATUS_MAP = Object.freeze({ PENDING_CONFIRMATION: "PENDING_PAYMENT", CONFIRMED: "PREPARING" });

// Transiciones del panel. READY → PREPARING corrige un "Listo" marcado por error.
const ADMIN_ORDER_TRANSITIONS = Object.freeze({
  PENDING_PAYMENT: Object.freeze(["PAID", "PREPARING", "READY", "DELIVERED", "CANCELLED"]),
  PAID: Object.freeze(["PREPARING", "READY", "DELIVERED", "CANCELLED"]),
  PREPARING: Object.freeze(["READY", "DELIVERED", "CANCELLED"]),
  READY: Object.freeze(["PREPARING", "DELIVERED", "CANCELLED"]),
  DELIVERED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
});

// El sistema solo vence órdenes pendientes; la pasarela solo las paga (o revive una vencida).
const SOURCE_TRANSITIONS = Object.freeze({
  ADMIN: ADMIN_ORDER_TRANSITIONS,
  SYSTEM: Object.freeze({ PENDING_PAYMENT: Object.freeze(["CANCELLED"]) }),
  PAYMENT: Object.freeze({ PENDING_PAYMENT: Object.freeze(["PAID"]), CANCELLED: Object.freeze(["PAID"]) }),
});

// Cambios manuales de payment_status. PAID → PENDING corrige un "Pagado"
// marcado por error; un reembolso es definitivo.
const PAYMENT_TRANSITIONS = Object.freeze({
  PENDING: Object.freeze(["PAID", "FAILED"]),
  FAILED: Object.freeze(["PENDING", "PAID"]),
  PAID: Object.freeze(["REFUNDED", "PENDING"]),
  REFUNDED: Object.freeze([]),
});

function label(status) {
  return ORDER_STATUS_LABELS[status] || status;
}

function reject(httpStatus, code, error) {
  return { ok: false, httpStatus, code, error };
}

function canonicalStatus(status) {
  if (ORDER_STATUSES.includes(status)) return status;
  return LEGACY_ORDER_STATUS_MAP[status] || null;
}

const NO_EFFECTS = Object.freeze({ stock: null, chargeFee: false, cancellationSource: null, clearCancellationSource: false });

/**
 * ¿Se puede pasar `order` a `to`? `order` necesita status, payment_status,
 * payment_method, stock_reservation_status y cancellation_source, con el
 * payment_status YA actualizado si el mismo pedido cambia ambos.
 * @returns {{ok:true, noop:boolean, effects:{stock:'CONSUME'|'RELEASE'|'RE_RESERVE'|null, chargeFee:boolean, cancellationSource:string|null, clearCancellationSource:boolean}} | {ok:false, httpStatus:number, code:string, error:string}}
 */
function decideOrderStatusChange(order, to, { source = "ADMIN" } = {}) {
  if (!ORDER_CHANGE_SOURCES.includes(source)) throw new Error(`Origen de cambio desconocido: ${source}`);
  if (!ORDER_STATUSES.includes(to)) {
    return reject(400, "INVALID_STATUS", `Estado inválido. Opciones: ${ORDER_STATUSES.join(", ")}.`);
  }
  const from = canonicalStatus(order.status) || order.status;
  if (from === to) return { ok: true, noop: true, effects: { ...NO_EFFECTS } };

  const allowed = (SOURCE_TRANSITIONS[source][from] || []).includes(to);
  const reviving = source === "PAYMENT" && from === "CANCELLED";
  if (!allowed || (reviving && order.cancellation_source !== "PAYMENT_EXPIRED")) {
    if (TERMINAL_ORDER_STATUSES.includes(from)) {
      const done = from === "DELIVERED" ? "ya fue entregada" : "está cancelada";
      return reject(409, "ORDER_FINALIZED", `La orden ${done}: su estado ya no se puede cambiar.`);
    }
    return reject(409, "INVALID_STATUS_TRANSITION", `No se puede cambiar una orden de "${label(from)}" a "${label(to)}".`);
  }

  if (to === "PAID" && order.payment_status !== "PAID") {
    return order.payment_method === "ONLINE"
      ? reject(409, "USE_PAYMENT_RECONCILE", "El pago en línea aún no está confirmado: concilia el pago o registra un pago manual.")
      : reject(409, "PAYMENT_NOT_RECORDED", 'Registra el pago antes de marcar la orden como "Pagado".');
  }

  const reservation = order.stock_reservation_status || "NONE";
  const effects = { ...NO_EFFECTS, chargeFee: to === "DELIVERED" };
  if (to === "CANCELLED") {
    effects.stock = reservation === "RESERVED" || reservation === "CONSUMED" ? "RELEASE" : null;
    effects.cancellationSource = source === "SYSTEM" ? "PAYMENT_EXPIRED" : "ADMIN";
  } else if (reviving) {
    effects.stock = "RE_RESERVE";
    effects.clearCancellationSource = true;
  } else if (from === "PENDING_PAYMENT" && ACTIVE_ORDER_STATUSES.includes(to)) {
    effects.stock = reservation === "NONE" || reservation === "RESERVED" ? "CONSUME" : null;
  }
  return { ok: true, noop: false, effects };
}

/**
 * ¿Se puede pasar el pago de `order` a `to`? Origen ADMIN = acción manual
 * del panel (solo ADMIN/SUPERADMIN; lo verifica la ruta).
 * @returns {{ok:true, noop:boolean, effects:{paidAt:'SET'|'CLEAR'|'KEEP'}} | {ok:false, httpStatus:number, code:string, error:string}}
 */
function decidePaymentStatusChange(order, to, { source = "ADMIN" } = {}) {
  if (!ORDER_CHANGE_SOURCES.includes(source)) throw new Error(`Origen de cambio desconocido: ${source}`);
  if (!PAYMENT_STATUSES.includes(to)) {
    return reject(400, "INVALID_PAYMENT_STATUS", `Estado de pago inválido. Opciones: ${PAYMENT_STATUSES.join(", ")}.`);
  }
  const from = order.payment_status;
  if (from === to) return { ok: true, noop: true, effects: { paidAt: "KEEP" } };

  if (from === "REFUNDED") {
    return reject(409, "PAYMENT_FINALIZED", "El pago ya fue reembolsado: su estado no se puede cambiar.");
  }
  // Excepción: un pago tardío confirmado por la pasarela sobre una orden que
  // venció el sistema (la unidad de pagos la "revive", payments-design §5.4).
  const lateGatewayPayment = source === "PAYMENT" && order.cancellation_source === "PAYMENT_EXPIRED";
  if (to === "PAID" && order.status === "CANCELLED" && !lateGatewayPayment) {
    return reject(409, "ORDER_CANCELLED", "No se puede registrar un pago en una orden cancelada.");
  }
  if (source === "ADMIN" && order.payment_method === "ONLINE" && !(to === "PAID" && (from === "PENDING" || from === "FAILED"))) {
    return reject(
      409,
      "ONLINE_PAYMENT_MANAGED",
      "El pago en línea de esta orden lo gestiona la pasarela; desde el panel solo se puede registrar un pago por otro medio."
    );
  }
  if (!(PAYMENT_TRANSITIONS[from] || []).includes(to)) {
    return reject(
      409,
      "INVALID_PAYMENT_TRANSITION",
      `No se puede cambiar el pago de "${PAYMENT_STATUS_LABELS[from] || from}" a "${PAYMENT_STATUS_LABELS[to]}".`
    );
  }
  if (from === "PAID" && to !== "REFUNDED" && order.status === "PAID") {
    return reject(409, "ORDER_MARKED_PAID", 'La orden está en estado "Pagado": cambia primero su estado.');
  }
  const paidAt = to === "PAID" ? "SET" : from === "PAID" && to !== "REFUNDED" ? "CLEAR" : "KEEP";
  return { ok: true, noop: false, effects: { paidAt } };
}

/** Combinación inicial válida al crear una orden desde el panel. */
function validateNewOrderState({ status, payment_status, payment_method }) {
  if (status === "CANCELLED") return { ok: false, error: "No se puede crear una orden ya cancelada." };
  if (payment_status === "REFUNDED") return { ok: false, error: "No se puede crear una orden ya reembolsada." };
  if (status === "PAID" && payment_status !== "PAID") {
    return { ok: false, error: 'Una orden en estado "Pagado" requiere el pago registrado como "Pagado".' };
  }
  if (status === "PENDING_PAYMENT" && payment_status === "PAID") {
    return { ok: false, error: 'Una orden pagada no puede quedar "Pendiente de pago": usa el estado "Pagado".' };
  }
  if (payment_method === "ONLINE" && (payment_status !== "PENDING" || status !== "PENDING_PAYMENT")) {
    return {
      ok: false,
      error: "Una orden con pago en línea se crea pendiente de pago: la confirma la pasarela, no el panel.",
    };
  }
  return { ok: true };
}

/**
 * Restricciones de STAFF al crear órdenes (B-10): sin precio final manual,
 * sin descuentos y sin registrar ventas con una fecha distinta de hoy.
 * @returns {string[]} mensajes (vacío = permitido)
 */
function staffOrderRestrictions({ finalPriceOverrideClp, discountAmountClp, orderDate, today }) {
  const problems = [];
  if (finalPriceOverrideClp !== undefined && finalPriceOverrideClp !== null) {
    problems.push("Solo un administrador puede fijar el precio final de una orden.");
  }
  if (Number(discountAmountClp || 0) > 0) problems.push("Solo un administrador puede aplicar descuentos.");
  if (orderDate !== undefined && orderDate !== null && orderDate !== today) {
    problems.push("Solo un administrador puede registrar ventas con una fecha distinta de hoy.");
  }
  return problems;
}

const SQL_IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;
const SQL_STATUS_VALUE = /^[A-Z][A-Z0-9_]*$/;

/**
 * CASE SQL que normaliza un estado heredado: los canónicos se conservan, los
 * heredados se mapean y lo desconocido queda NULL (no se toca; el CHECK lo
 * reporta al validarse). Construido desde las constantes: única fuente.
 */
function buildLegacyStatusCaseSql(column, canonical, legacyMap) {
  if (!SQL_IDENTIFIER.test(column)) throw new Error(`Columna SQL inválida: ${column}`);
  const pairs = [...canonical.map((s) => [s, s]), ...Object.entries(legacyMap)];
  for (const [from, to] of pairs) {
    if (!SQL_STATUS_VALUE.test(from) || !SQL_STATUS_VALUE.test(to)) throw new Error(`Estado SQL inválido: ${from}→${to}`);
  }
  const whens = pairs.map(([from, to]) => `WHEN '${from}' THEN '${to}'`).join(" ");
  return `CASE UPPER(BTRIM(${column})) ${whens} ELSE NULL END`;
}

function legacyOrderStatusCaseSql(column) {
  return buildLegacyStatusCaseSql(column, ORDER_STATUSES, LEGACY_ORDER_STATUS_MAP);
}

/** Lista SQL ('A','B',...) de un vocabulario. */
function sqlStatusList(values) {
  for (const value of values) {
    if (!SQL_STATUS_VALUE.test(value)) throw new Error(`Estado SQL inválido: ${value}`);
  }
  return values.map((value) => `'${value}'`).join(",");
}

/** Vocabularios + transiciones para el panel (GET /admin/orders/statuses). */
function describeOrderVocabulary() {
  return {
    order_statuses: ORDER_STATUSES.map((value) => ({
      value,
      label: ORDER_STATUS_LABELS[value],
      terminal: TERMINAL_ORDER_STATUSES.includes(value),
    })),
    payment_statuses: PAYMENT_STATUSES.map((value) => ({ value, label: PAYMENT_STATUS_LABELS[value] })),
    payment_methods: PAYMENT_METHODS,
    delivery_methods: DELIVERY_METHODS,
    stock_reservation_statuses: STOCK_RESERVATION_STATUSES,
    status_transitions: ADMIN_ORDER_TRANSITIONS,
    payment_transitions: PAYMENT_TRANSITIONS,
  };
}

module.exports = {
  ORDER_STATUSES,
  TERMINAL_ORDER_STATUSES,
  ACTIVE_ORDER_STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_METHODS,
  MANUAL_PAYMENT_METHODS,
  DELIVERY_METHODS,
  STOCK_RESERVATION_STATUSES,
  CANCELLATION_SOURCES,
  ORDER_CHANGE_SOURCES,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  LEGACY_ORDER_STATUS_MAP,
  ADMIN_ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  decideOrderStatusChange,
  decidePaymentStatusChange,
  validateNewOrderState,
  staffOrderRestrictions,
  buildLegacyStatusCaseSql,
  legacyOrderStatusCaseSql,
  sqlStatusList,
  describeOrderVocabulary,
};
