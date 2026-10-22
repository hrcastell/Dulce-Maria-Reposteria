/**
 * Saneamiento de datos de pago (payments-design §9.5). Módulo puro.
 *
 * - Payloads de proveedores: LISTA BLANCA de campos. Nunca se guardan datos
 *   del pagador (nombre, RUT, correo), del titular de la tarjeta ni números de
 *   tarjeta: solo sus últimos 4 dígitos si el proveedor los entrega.
 * - Textos de error: una línea, ≤ 200 caracteres y sin secuencias con forma
 *   de token (un proveedor podría devolver el token en su mensaje).
 * - URLs para el log de acceso (morgan): los valores de la query se ocultan
 *   (tokens de Webpay, ids de Mercado Pago, búsquedas con datos personales) y
 *   los segmentos de ruta con forma de token también.
 */

const MAX_TEXT = 100;
const MAX_ERROR = 200;
const TOKEN_LIKE = /[A-Za-z0-9_-]{32,}/g;
const TOKEN_SEGMENT = /^[A-Za-z0-9_-]{40,}$/;
const SAFE_QUERY_KEY = /^[A-Za-z0-9_.[\]-]{1,40}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Primitivo seguro: textos recortados, números finitos, booleanos y null. */
function primitive(value) {
  if (value === null) return null;
  if (typeof value === "string") return value.slice(0, MAX_TEXT);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  return undefined;
}

function pick(source, keys) {
  const out = {};
  if (!isPlainObject(source)) return out;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = primitive(source[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Últimos 4 dígitos de un número de tarjeta enmascarado o truncado; undefined si no hay. */
function last4(value) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const m = /(\d{4})$/.exec(String(value).trim());
  return m ? m[1] : undefined;
}

function idText(value) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value)) return value;
  return undefined;
}

const WEBPAY_FIELDS = Object.freeze([
  "vci",
  "amount",
  "status",
  "buy_order",
  "session_id",
  "accounting_date",
  "transaction_date",
  "authorization_code",
  "payment_type_code",
  "response_code",
  "installments_number",
  "installments_amount",
  "balance",
  // reembolsos (anulación / reversa)
  "type",
  "nullified_amount",
  "authorization_date",
]);

/** Respuesta de Webpay (create/commit/status/refund) → objeto seguro para guardar. */
function sanitizeWebpayPayload(payload) {
  if (!isPlainObject(payload)) return {};
  const out = pick(payload, WEBPAY_FIELDS);
  const card = isPlainObject(payload.card_detail) ? last4(payload.card_detail.card_number) : undefined;
  if (card) out.card_last4 = card;
  if (payload.error_message !== undefined) out.error_message = sanitizeErrorText(payload.error_message);
  return out;
}

const MP_PAYMENT_FIELDS = Object.freeze([
  "status",
  "status_detail",
  "transaction_amount",
  "transaction_amount_refunded",
  "currency_id",
  "external_reference",
  "payment_type_id",
  "payment_method_id",
  "installments",
  "date_created",
  "date_approved",
  "date_last_updated",
  "live_mode",
  "captured",
  "binary_mode",
]);

/** Pago de Mercado Pago (GET /v1/payments/{id}) → objeto seguro (sin payer ni cardholder). */
function sanitizeMpPayment(payment) {
  if (!isPlainObject(payment)) return {};
  const out = {};
  const id = idText(payment.id);
  if (id) out.id = id;
  Object.assign(out, pick(payment, MP_PAYMENT_FIELDS));
  const card = isPlainObject(payment.card) ? last4(payment.card.last_four_digits) : undefined;
  if (card && /^\d{4}$/.test(String(payment.card.last_four_digits))) out.card_last4 = card;
  return out;
}

function sanitizeMpRefund(refund) {
  if (!isPlainObject(refund)) return {};
  const out = {};
  const id = idText(refund.id);
  if (id) out.id = id;
  const paymentId = idText(refund.payment_id);
  if (paymentId) out.payment_id = paymentId;
  Object.assign(out, pick(refund, ["amount", "status", "date_created"]));
  return out;
}

function sanitizeMpPreference(preference) {
  if (!isPlainObject(preference)) return {};
  const out = {};
  const id = typeof preference.id === "string" && /^[A-Za-z0-9-]{1,100}$/.test(preference.id) ? preference.id : undefined;
  if (id) out.id = id;
  Object.assign(out, pick(preference, ["date_created", "expires", "expiration_date_from", "expiration_date_to"]));
  return out;
}

/** Cuerpo de un webhook de Mercado Pago (solo una señal: nunca se confía en él). */
function sanitizeMpNotification(body) {
  if (!isPlainObject(body)) return {};
  const out = {};
  const id = idText(body.id);
  if (id) out.id = id;
  Object.assign(out, pick(body, ["live_mode", "type", "action", "api_version", "date_created"]));
  const dataId = isPlainObject(body.data) ? idText(body.data.id) : undefined;
  if (dataId) out.data_id = dataId;
  return out;
}

/** Texto de error de una línea, ≤ 200 caracteres y sin secuencias con forma de token. */
function sanitizeErrorText(value) {
  if (value === undefined || value === null) return null;
  const raw = value instanceof Error ? value.message : String(value);
  return raw.replace(/[\r\n]+/g, " ").replace(TOKEN_LIKE, "[redactado]").slice(0, MAX_ERROR);
}

function redactQuery(query) {
  if (!query) return "";
  const parts = query.split("&").filter(Boolean).map((part) => {
    const eq = part.indexOf("=");
    const key = eq === -1 ? part : part.slice(0, eq);
    const safeKey = SAFE_QUERY_KEY.test(key) ? key : "***";
    return eq === -1 ? safeKey : `${safeKey}=***`;
  });
  return parts.length ? `?${parts.join("&")}` : "";
}

function redactPath(pathname) {
  return pathname
    .split("/")
    .map((segment) => (TOKEN_SEGMENT.test(segment) ? "[redactado]" : segment))
    .join("/");
}

/** URL apta para el log de acceso: sin valores de query, sin fragmento y sin tokens en la ruta. */
function redactUrlForLog(url) {
  if (url === undefined || url === null) return "-";
  const text = String(url);
  if (!text) return "";
  const withoutFragment = text.split("#")[0];
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.exec(withoutFragment);
  let prefix = "";
  let rest = withoutFragment;
  if (absolute) {
    const afterScheme = withoutFragment.indexOf("/", absolute[0].length);
    prefix = afterScheme === -1 ? withoutFragment : withoutFragment.slice(0, afterScheme);
    rest = afterScheme === -1 ? "" : withoutFragment.slice(afterScheme);
  }
  const q = rest.indexOf("?");
  const pathname = q === -1 ? rest : rest.slice(0, q);
  const query = q === -1 ? "" : rest.slice(q + 1);
  return `${prefix}${redactPath(pathname)}${redactQuery(query)}`;
}

module.exports = {
  sanitizeWebpayPayload,
  sanitizeMpPayment,
  sanitizeMpRefund,
  sanitizeMpPreference,
  sanitizeMpNotification,
  sanitizeErrorText,
  redactUrlForLog,
  last4,
};
