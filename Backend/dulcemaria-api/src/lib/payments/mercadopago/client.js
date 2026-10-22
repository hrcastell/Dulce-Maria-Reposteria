/**
 * Cliente REST de Mercado Pago Checkout Pro con preferencias (sin SDK;
 * payments-design §2.2), verificado el 2026-10-21 en la documentación oficial:
 *
 *   createPreference  POST /checkout/preferences                → { id, init_point }
 *   getPayment        GET  /v1/payments/{id}
 *   search            GET  /v1/payments/search?external_reference=…&sort=date_created&criteria=desc
 *   refund            POST /v1/payments/{id}/refunds { amount }  + X-Idempotency-Key (obligatorio)
 * Autenticación: Authorization: Bearer <MERCADOPAGO_ACCESS_TOKEN>.
 *
 * Timeouts cortos (el webhook debe responder en < 22 s) y sin reintentos
 * ocultos: el servicio decide con la taxonomía de http.js.
 */

const { requestJson, ProviderHttpError } = require("../http");
const { sanitizeMpPreference } = require("../sanitize");
const { isAllowedRedirect } = require("../redirectAllowlist");
const { ENVIRONMENT_CODES } = require("../constants");

const TIMEOUTS_MS = Object.freeze({ preference: 10000, payment: 8000, search: 10000, refund: 20000 });
const PAYMENT_ID = /^\d{1,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTERNAL_REFERENCE = /^[A-Za-z0-9_-]{1,64}$/;

function assertPaymentId(id) {
  const text = String(id ?? "");
  if (!PAYMENT_ID.test(text)) throw new Error("Id de pago de Mercado Pago inválido.");
  return text;
}

/**
 * @param {object} cfg config.providers.MERCADOPAGO
 * @param {{ fetchImpl?: Function }} [deps]
 */
function createMercadoPagoClient(cfg, { fetchImpl } = {}) {
  const base = String(cfg.apiBaseUrl).replace(/\/+$/, "");
  const host = new URL(base).host;
  const insecureHosts = base.startsWith("http://") && cfg.devMock ? [host] : [];
  const extraRedirectHosts = cfg.devMock ? [host] : [];
  const headers = Object.freeze({
    Authorization: `Bearer ${cfg.accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  });
  const call = (method, path, { body, timeoutMs, extraHeaders } = {}) =>
    requestJson({
      url: `${base}${path}`,
      method,
      headers: extraHeaders ? { ...headers, ...extraHeaders } : headers,
      body,
      timeoutMs,
      fetchImpl,
      allowedHosts: [host],
      insecureHosts,
    });

  return Object.freeze({
    id: "MERCADOPAGO",
    environment: cfg.environment,
    environmentCode: ENVIRONMENT_CODES[cfg.environment],

    async createPreference(body) {
      const { json } = await call("POST", "/checkout/preferences", { body, timeoutMs: TIMEOUTS_MS.preference });
      const preferenceId = json && typeof json.id === "string" && /^[A-Za-z0-9-]{1,100}$/.test(json.id) ? json.id : null;
      const initPoint = json && typeof json.init_point === "string" ? json.init_point : null;
      if (!preferenceId || !isAllowedRedirect({ provider: "MERCADOPAGO", environment: cfg.environment, url: initPoint, extraHosts: extraRedirectHosts })) {
        throw new ProviderHttpError("INVALID_RESPONSE", { status: 200, ambiguous: false });
      }
      return { preferenceId, initPoint, sanitized: sanitizeMpPreference(json) };
    },

    async getPayment(paymentId) {
      return (await call("GET", `/v1/payments/${assertPaymentId(paymentId)}`, { timeoutMs: TIMEOUTS_MS.payment })).json;
    },

    async searchByExternalReference(externalReference) {
      if (typeof externalReference !== "string" || !EXTERNAL_REFERENCE.test(externalReference)) throw new Error("external_reference inválida.");
      const query = new URLSearchParams({ external_reference: externalReference, sort: "date_created", criteria: "desc", limit: "50" });
      const { json } = await call("GET", `/v1/payments/search?${query.toString()}`, { timeoutMs: TIMEOUTS_MS.search });
      return Array.isArray(json?.results) ? json.results : [];
    },

    async refund(paymentId, amountClp, idempotencyKey) {
      if (!Number.isSafeInteger(amountClp) || amountClp <= 0) throw new Error("Monto de reembolso inválido.");
      if (!UUID.test(String(idempotencyKey))) throw new Error("Clave de idempotencia inválida.");
      const { json } = await call("POST", `/v1/payments/${assertPaymentId(paymentId)}/refunds`, {
        body: { amount: amountClp },
        timeoutMs: TIMEOUTS_MS.refund,
        extraHeaders: { "X-Idempotency-Key": idempotencyKey },
      });
      return json;
    },
  });
}

module.exports = { createMercadoPagoClient, TIMEOUTS_MS };
