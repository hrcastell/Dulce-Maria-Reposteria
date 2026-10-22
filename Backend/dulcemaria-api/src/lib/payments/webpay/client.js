/**
 * Cliente REST de Webpay Plus v1.2 (sin SDK; payments-design §2.1).
 *
 *   create  POST {host}/rswebpaytransaction/api/webpay/v1.2/transactions
 *           { buy_order ≤ 26, session_id ≤ 61, amount, return_url ≤ 255 } → { token, url }
 *   commit  PUT  …/transactions/{token}            (sin cuerpo)
 *   status  GET  …/transactions/{token}            (7 días desde la creación)
 *   refund  POST …/transactions/{token}/refunds    { amount } → REVERSED | NULLIFIED
 * Headers: Tbk-Api-Key-Id (código de comercio) y Tbk-Api-Key-Secret.
 * Verificado el 2026-10-21 en https://www.transbankdevelopers.cl/referencia/webpay
 * y contra el ambiente de integración (ver w2-changes.md §7).
 *
 * Los errores son ProviderHttpError (http.js): el llamador decide con
 * `ambiguous` si puede concluir algo o debe consultar status / conciliar.
 */

const { requestJson, ProviderHttpError } = require("../http");
const { sanitizeWebpayPayload } = require("../sanitize");
const { isAllowedRedirect } = require("../redirectAllowlist");
const { ENVIRONMENT_CODES } = require("../constants");
const { API_PATH, LIMITS, TIMEOUTS_MS } = require("./constants");

const TOKEN_PATTERN = /^[A-Za-z0-9]{16,128}$/;
const BUY_ORDER_PATTERN = /^[A-Za-z0-9|_=&%.,~:/?[+!@>-]{1,26}$/;

function assertToken(token) {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) throw new Error("Token de Webpay inválido.");
  return token;
}

function assertAmount(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Monto inválido para Webpay.");
  return amount;
}

/**
 * @param {object} cfg config.providers.WEBPAY
 * @param {{ fetchImpl?: Function }} [deps]
 */
function createWebpayClient(cfg, { fetchImpl } = {}) {
  const base = `https://${cfg.host}${API_PATH}`;
  const headers = Object.freeze({
    "Tbk-Api-Key-Id": cfg.commerceCode,
    "Tbk-Api-Key-Secret": cfg.apiKeySecret,
    "Content-Type": "application/json",
    Accept: "application/json",
  });
  const call = (method, suffix, body, timeoutMs) =>
    requestJson({ url: `${base}${suffix}`, method, headers, body, timeoutMs, fetchImpl, allowedHosts: [cfg.host] });

  return Object.freeze({
    id: "WEBPAY",
    environment: cfg.environment,
    environmentCode: ENVIRONMENT_CODES[cfg.environment],

    async createTransaction({ buyOrder, sessionId, amountClp, returnUrl }) {
      if (typeof buyOrder !== "string" || !BUY_ORDER_PATTERN.test(buyOrder)) throw new Error("buy_order inválido para Webpay.");
      if (typeof sessionId !== "string" || !sessionId || sessionId.length > LIMITS.sessionId) throw new Error("session_id inválido para Webpay.");
      if (typeof returnUrl !== "string" || !returnUrl || returnUrl.length > LIMITS.returnUrl) throw new Error("return_url inválida para Webpay.");
      assertAmount(amountClp);
      const { json } = await call("POST", "", { buy_order: buyOrder, session_id: sessionId, amount: amountClp, return_url: returnUrl }, TIMEOUTS_MS.create);
      const token = json && typeof json.token === "string" ? json.token : null;
      const url = json && typeof json.url === "string" ? json.url : null;
      if (!token || !TOKEN_PATTERN.test(token) || !isAllowedRedirect({ provider: "WEBPAY", environment: cfg.environment, url })) {
        throw new ProviderHttpError("INVALID_RESPONSE", { status: 200, ambiguous: false });
      }
      return { token, url, sanitized: sanitizeWebpayPayload({ ...json, token: undefined }) };
    },

    async commit(token) {
      return (await call("PUT", `/${assertToken(token)}`, undefined, TIMEOUTS_MS.commit)).json;
    },

    async status(token) {
      return (await call("GET", `/${assertToken(token)}`, undefined, TIMEOUTS_MS.status)).json;
    },

    async refund(token, amountClp) {
      return (await call("POST", `/${assertToken(token)}/refunds`, { amount: assertAmount(amountClp) }, TIMEOUTS_MS.refund)).json;
    },
  });
}

module.exports = { createWebpayClient };
