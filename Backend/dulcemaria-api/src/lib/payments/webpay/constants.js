/**
 * Constantes de Webpay Plus (API REST v1.2), verificadas el 2026-10-21 en:
 *   - https://www.transbankdevelopers.cl/referencia/webpay?l=http
 *     (hosts, ruta v1.2, headers Tbk-Api-Key-Id/Tbk-Api-Key-Secret, largos de
 *     buy_order ≤ 26 / session_id ≤ 61 / return_url ≤ 256, estados, códigos HTTP,
 *     payment_type_code y credenciales públicas de integración del ejemplo HTTP);
 *   - https://www.transbankdevelopers.cl/documentacion/webpay-plus
 *     (token de 5 min, formulario de 4 min en producción y 10 en integración,
 *     status consultable 7 días desde la creación, aprobación = AUTHORIZED +
 *     response_code exactamente 0).
 * Las credenciales de integración son PÚBLICAS (comercio de pruebas compartido
 * por todos los integradores): nunca sirven en producción.
 */

const HOSTS = Object.freeze({
  integration: "webpay3gint.transbank.cl",
  production: "webpay3g.transbank.cl",
});

const API_PATH = "/rswebpaytransaction/api/webpay/v1.2/transactions";

const INTEGRATION_COMMERCE_CODE = "597055555532";
const INTEGRATION_API_KEY_SECRET = "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C";

// return_url: la referencia dice 256; el SDK oficial valida 255 → se usa 255.
const LIMITS = Object.freeze({ buyOrder: 26, sessionId: 61, returnUrl: 255 });

const TOKEN_LIFETIME_MINUTES = 5;
const FORM_WINDOW_MINUTES = Object.freeze({ integration: 10, production: 4 });
const STATUS_WINDOW_DAYS = 7;
// Margen sobre la vida del token + el formulario antes de dar el intento por vencido.
const ATTEMPT_MARGIN_MINUTES = 2;

// Timeouts por operación (payments-design §3.7).
const TIMEOUTS_MS = Object.freeze({ create: 15000, commit: 25000, status: 10000, refund: 25000 });

const PAYMENT_TYPE_LABELS = Object.freeze({
  VD: "Débito",
  VN: "Crédito sin cuotas",
  VC: "Crédito en cuotas",
  SI: "3 cuotas sin interés",
  S2: "2 cuotas sin interés",
  NC: "N cuotas sin interés",
  VP: "Prepago",
});

module.exports = {
  HOSTS,
  API_PATH,
  INTEGRATION_COMMERCE_CODE,
  INTEGRATION_API_KEY_SECRET,
  LIMITS,
  TOKEN_LIFETIME_MINUTES,
  FORM_WINDOW_MINUTES,
  STATUS_WINDOW_DAYS,
  ATTEMPT_MARGIN_MINUTES,
  TIMEOUTS_MS,
  PAYMENT_TYPE_LABELS,
};
