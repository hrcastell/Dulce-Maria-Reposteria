/**
 * Estados de los pedidos de torta personalizada (`cake_orders`).
 *
 * Vocabulario único = el que el panel ofrece desde que existe el constructor
 * de tortas (5385c63): PENDING_PAYMENT, CONFIRMED, IN_PROGRESS, READY,
 * DELIVERED, CANCELLED. El commit 80e4d7f había cambiado la API a otra lista
 * (PAID/PREPARING) y el panel quedó roto; las notificaciones buscaban
 * 'PENDING', que nunca se escribía. Esos valores heredados se normalizan en la
 * migración (complete.js) con el mismo mapa de este módulo.
 *
 * El dinero del abono (50 %) NO vive en este estado: lo agregará la unidad de
 * pagos en columnas propias (decisión D1). Por eso 'PAID' pasa a CONFIRMED.
 */

const { buildLegacyStatusCaseSql } = require("./orderStatus");

const CAKE_ORDER_STATUSES = Object.freeze(["PENDING_PAYMENT", "CONFIRMED", "IN_PROGRESS", "READY", "DELIVERED", "CANCELLED"]);
const TERMINAL_CAKE_ORDER_STATUSES = Object.freeze(["DELIVERED", "CANCELLED"]);

const CAKE_ORDER_STATUS_LABELS = Object.freeze({
  PENDING_PAYMENT: "Pendiente de pago",
  CONFIRMED: "Confirmado",
  IN_PROGRESS: "En preparación",
  READY: "Listo",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
});

const LEGACY_CAKE_ORDER_STATUS_MAP = Object.freeze({ PENDING: "PENDING_PAYMENT", PAID: "CONFIRMED", PREPARING: "IN_PROGRESS" });

const CAKE_ORDER_TRANSITIONS = Object.freeze({
  PENDING_PAYMENT: Object.freeze(["CONFIRMED", "IN_PROGRESS", "READY", "DELIVERED", "CANCELLED"]),
  CONFIRMED: Object.freeze(["IN_PROGRESS", "READY", "DELIVERED", "CANCELLED"]),
  IN_PROGRESS: Object.freeze(["READY", "DELIVERED", "CANCELLED"]),
  READY: Object.freeze(["IN_PROGRESS", "DELIVERED", "CANCELLED"]),
  DELIVERED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
});

/** Estado heredado → canónico (mayúsculas/espacios incluidos); null si es desconocido. */
function normalizeLegacyCakeStatus(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toUpperCase();
  if (CAKE_ORDER_STATUSES.includes(value)) return value;
  return LEGACY_CAKE_ORDER_STATUS_MAP[value] || null;
}

// ADMIN = panel; SYSTEM = vencimiento del abono en línea; PAYMENT = pasarela (unidad de pagos, D1).
const CAKE_CHANGE_SOURCES = Object.freeze(["ADMIN", "SYSTEM", "PAYMENT"]);

// El sistema solo vence pedidos con el abono en línea impago; la pasarela solo
// confirma el pedido al pagarse el abono (o revive uno vencido por el sistema).
const CAKE_SOURCE_TRANSITIONS = Object.freeze({
  SYSTEM: Object.freeze({ PENDING_PAYMENT: Object.freeze(["CANCELLED"]) }),
  PAYMENT: Object.freeze({ PENDING_PAYMENT: Object.freeze(["CONFIRMED"]), CANCELLED: Object.freeze(["CONFIRMED"]) }),
});

function label(status) {
  return CAKE_ORDER_STATUS_LABELS[status] || status;
}

function changeEffects(to, source, { revive = false } = {}) {
  return {
    cancellationSource: to === "CANCELLED" ? (source === "SYSTEM" ? "PAYMENT_EXPIRED" : "ADMIN") : null,
    clearCancellationSource: revive,
  };
}

/**
 * ¿Se puede pasar el pedido de torta a `to`? `source` (por defecto ADMIN)
 * decide la tabla de transiciones; `effects` indica cómo dejar
 * `cancellation_source` (como en las órdenes del catálogo).
 */
function decideCakeStatusChange(cakeOrder, to, { source = "ADMIN" } = {}) {
  if (!CAKE_CHANGE_SOURCES.includes(source)) throw new Error(`Origen de cambio desconocido: ${source}`);
  if (!CAKE_ORDER_STATUSES.includes(to)) {
    return {
      ok: false,
      httpStatus: 400,
      code: "INVALID_STATUS",
      error: `Estado inválido. Opciones: ${CAKE_ORDER_STATUSES.join(", ")}.`,
    };
  }
  const from = cakeOrder.status;
  if (from === to) return { ok: true, noop: true };
  // Un estado heredado que la migración no reconoció puede repararse (solo desde el panel) a cualquier estado canónico.
  if (!CAKE_ORDER_STATUSES.includes(from) && source === "ADMIN") return { ok: true, noop: false, effects: changeEffects(to, source) };

  const reviving = source === "PAYMENT" && from === "CANCELLED";
  const table = source === "ADMIN" ? CAKE_ORDER_TRANSITIONS : CAKE_SOURCE_TRANSITIONS[source];
  const allowed = (table[from] || []).includes(to) && (!reviving || cakeOrder.cancellation_source === "PAYMENT_EXPIRED");
  if (allowed) return { ok: true, noop: false, effects: changeEffects(to, source, { revive: reviving }) };
  if (TERMINAL_CAKE_ORDER_STATUSES.includes(from)) {
    const done = from === "DELIVERED" ? "ya fue entregado" : "está cancelado";
    return { ok: false, httpStatus: 409, code: "ORDER_FINALIZED", error: `El pedido de torta ${done}: su estado ya no se puede cambiar.` };
  }
  return {
    ok: false,
    httpStatus: 409,
    code: "INVALID_STATUS_TRANSITION",
    error: `No se puede cambiar un pedido de torta de "${label(from)}" a "${label(to)}".`,
  };
}

function legacyCakeStatusCaseSql(column) {
  return buildLegacyStatusCaseSql(column, CAKE_ORDER_STATUSES, LEGACY_CAKE_ORDER_STATUS_MAP);
}

function describeCakeOrderVocabulary() {
  return {
    order_statuses: CAKE_ORDER_STATUSES.map((value) => ({
      value,
      label: CAKE_ORDER_STATUS_LABELS[value],
      terminal: TERMINAL_CAKE_ORDER_STATUSES.includes(value),
    })),
    order_status_transitions: CAKE_ORDER_TRANSITIONS,
  };
}

module.exports = {
  CAKE_CHANGE_SOURCES,
  CAKE_ORDER_STATUSES,
  TERMINAL_CAKE_ORDER_STATUSES,
  CAKE_ORDER_STATUS_LABELS,
  CAKE_ORDER_TRANSITIONS,
  LEGACY_CAKE_ORDER_STATUS_MAP,
  normalizeLegacyCakeStatus,
  decideCakeStatusChange,
  legacyCakeStatusCaseSql,
  describeCakeOrderVocabulary,
};
