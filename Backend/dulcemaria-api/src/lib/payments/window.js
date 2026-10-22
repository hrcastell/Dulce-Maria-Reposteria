/**
 * Plazos de pago y calendario de conciliación (payments-design §8.2, §8.4). Puro.
 *
 *   - Orden/torta en línea web: plazo = creación + TTL (30 min); cada intento lo
 *     extiende hasta (vencimiento del intento + 2 min), nunca más allá del tope
 *     creación + max(TTL, máximo) (60 min).
 *   - Orden creada en el panel con enlace de pago: sin plazo ni tope (se puede
 *     pagar siempre, hasta que el panel la cancele).
 *   - Intento Webpay: vida del token (5 min) + formulario (4 producción / 10
 *     integración) + 2 de margen; Transbank fija esa ventana.
 *   - Intento Mercado Pago: min(ahora + 30 min, tope) = vigencia de la preferencia.
 */

const { TOKEN_LIFETIME_MINUTES, FORM_WINDOW_MINUTES, ATTEMPT_MARGIN_MINUTES, STATUS_WINDOW_DAYS } = require("./webpay/constants");

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const MP_ATTEMPT_MINUTES = 30;
const MP_MIN_REMAINING_MINUTES = 3;
const DEADLINE_MARGIN_MINUTES = 2;
const MIN_RECONCILE_GAP_MS = 30 * 1000;
const STALE_CREATED_MS = 2 * MINUTE;
const COMMIT_UNCONFIRMED_MS = 10 * MINUTE;
const WEBPAY_STATUS_REVIEW_DAYS = STATUS_WINDOW_DAYS - 1;

const toDate = (value) => (value instanceof Date ? value : value ? new Date(value) : null);
const plus = (date, ms) => new Date(date.getTime() + ms);

function initialPaymentDeadline(createdAt, window) {
  return plus(toDate(createdAt), window.ttlMinutes * MINUTE);
}

/** Tope absoluto para reintentar; null si el destino no tiene plazo (enlace del panel). */
function paymentCap(target, window) {
  if (!target.payment_expires_at) return null;
  return plus(toDate(target.created_at), Math.max(window.ttlMinutes, window.maxMinutes) * MINUTE);
}

function attemptExpiresAt({ provider, environment, now, cap }) {
  if (provider === "WEBPAY") {
    const form = FORM_WINDOW_MINUTES[environment] ?? FORM_WINDOW_MINUTES.production;
    return plus(now, (TOKEN_LIFETIME_MINUTES + form + ATTEMPT_MARGIN_MINUTES) * MINUTE);
  }
  if (provider === "MERCADOPAGO") {
    const preferred = plus(now, MP_ATTEMPT_MINUTES * MINUTE);
    const capDate = toDate(cap);
    return capDate && capDate.getTime() < preferred.getTime() ? capDate : preferred;
  }
  throw new Error(`Proveedor desconocido: ${provider}`);
}

/** ¿Se puede iniciar un intento ahora? (plazo vigente; MP necesita al menos 3 min de vigencia). */
function checkCanStart({ deadline, cap, provider, now }) {
  const deadlineDate = toDate(deadline);
  if (deadlineDate && now.getTime() >= deadlineDate.getTime()) return { ok: false, code: "PAYMENT_WINDOW_EXPIRED" };
  const capDate = toDate(cap);
  if (provider === "MERCADOPAGO" && capDate && capDate.getTime() - now.getTime() < MP_MIN_REMAINING_MINUTES * MINUTE) {
    return { ok: false, code: "PAYMENT_WINDOW_EXPIRED" };
  }
  return { ok: true };
}

/** Nuevo plazo de la orden tras crear un intento; null si no tiene plazo. */
function extendDeadline({ deadline, attemptExpiresAt: attemptEnd, cap }) {
  const current = toDate(deadline);
  if (!current) return null;
  const wanted = plus(toDate(attemptEnd), DEADLINE_MARGIN_MINUTES * MINUTE);
  let next = wanted.getTime() > current.getTime() ? wanted : current;
  const capDate = toDate(cap);
  if (capDate && next.getTime() > capDate.getTime()) next = capDate.getTime() > current.getTime() ? capDate : current;
  return next;
}

/** Primera conciliación: Webpay nunca antes de que venza el intento; MP a los 2 min (webhook perdido). */
function initialReconcileAt({ provider, expiresAt, now }) {
  if (provider === "WEBPAY") return toDate(expiresAt);
  return plus(now, 2 * MINUTE);
}

function nextReconcileAt({ provider, status, reconcileAttempts, expiresAt, now }) {
  const n = Math.max(0, Number(reconcileAttempts) || 0);
  const backoff = (baseMs, capMs) => plus(now, Math.max(MIN_RECONCILE_GAP_MS, Math.min(baseMs * 2 ** Math.min(n, 30), capMs)));
  if (status === "CREATED") return plus(now, 2 * MINUTE);
  if (status === "COMMITTING") return backoff(20 * 1000, 10 * MINUTE);
  if (provider === "WEBPAY") {
    const end = toDate(expiresAt);
    if (end && end.getTime() > now.getTime()) return end;
    return backoff(MINUTE, 60 * MINUTE);
  }
  return backoff(MINUTE, 60 * MINUTE);
}

function isStaleCreated(attempt, now) {
  const created = toDate(attempt.created_at);
  return Boolean(created) && now.getTime() - created.getTime() > STALE_CREATED_MS;
}

function isCommitUnconfirmed(attempt, now) {
  const started = toDate(attempt.commit_started_at);
  return Boolean(started) && now.getTime() - started.getTime() > COMMIT_UNCONFIRMED_MS;
}

/** Ventana de consulta de status de Webpay (7 días desde la creación). */
function webpayStatusWindow(attempt, now) {
  const age = now.getTime() - toDate(attempt.created_at).getTime();
  if (age > STATUS_WINDOW_DAYS * DAY) return "CLOSED";
  if (age > WEBPAY_STATUS_REVIEW_DAYS * DAY) return "CLOSING";
  return "OPEN";
}

module.exports = {
  MIN_RECONCILE_GAP_MS,
  initialPaymentDeadline,
  paymentCap,
  attemptExpiresAt,
  checkCanStart,
  extendDeadline,
  initialReconcileAt,
  nextReconcileAt,
  isStaleCreated,
  isCommitUnconfirmed,
  webpayStatusWindow,
};
