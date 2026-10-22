/**
 * Log de pagos: una línea JSON por evento (fácil de buscar en los logs de
 * Passenger). Nunca recibe tokens, secretos ni datos personales: solo ids
 * internos, proveedor, estados y motivos.
 */

const ALLOWED = new Set([
  "payment_id",
  "order_id",
  "cake_order_id",
  "provider",
  "environment",
  "from",
  "to",
  "source",
  "reason",
  "review_reason",
  "kind",
  "variant",
  "error",
  "http_status",
  "count",
  "duration_ms",
  "refund_id",
  "attempt_no",
]);

function logPayment(evt, fields = {}, { level = "log" } = {}) {
  const line = { evt, at: new Date().toISOString() };
  for (const [key, value] of Object.entries(fields)) {
    if (ALLOWED.has(key) && value !== undefined && value !== null) line[key] = typeof value === "string" ? value.slice(0, 200) : value;
  }
  // eslint-disable-next-line no-console
  console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](JSON.stringify(line));
}

module.exports = { logPayment };
