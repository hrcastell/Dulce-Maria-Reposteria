/**
 * Pagos en línea — rutas públicas (montadas en /public/payments y
 * /dulcemaria/public/payments):
 *
 *   GET  /methods                       medios disponibles (sin secretos)
 *   POST /                              iniciar o reintentar el pago (token de acceso)
 *   POST /status                        estado sin datos personales (token de acceso)
 *   GET|POST /webpay/return             retorno de Webpay → 303 a la página de pago
 *   GET  /mercadopago/return/:attemptId back_url de Mercado Pago → 303
 *   POST /mercadopago/webhook           notificación firmada de Mercado Pago
 *
 * El token de acceso viaja en el CUERPO (nunca en la URL): no queda en los
 * logs de acceso del hosting. Los retornos son navegaciones de nivel superior
 * desde dominios ajenos: no se rechazan por Origin/CORS y la API nunca
 * renderiza HTML, solo redirige (303, no-store, sin Referer).
 */

const express = require("express");
const { z } = require("zod");
const { validationError, sendError, logServerError } = require("../lib/httpErrors");
const { paymentStartLimiter, paymentStatusLimiter, paymentReturnLimiter, webhookLimiter, publicApiLimiter } = require("../middleware/rate-limit");
const { listMethods, startPayment, getPublicStatus } = require("../lib/payments/checkout");
const { handleWebpayReturn, handleMercadoPagoReturn, handleMercadoPagoWebhook, paymentPageUrl } = require("../lib/payments/returns");
const { PAYMENT_PROVIDERS } = require("../lib/payments/constants");

const router = express.Router();

// El token no se valida aquí por formato: uno mal formado y uno inexistente
// responden lo mismo (404) desde el servicio.
const accessToken = z.string().min(1).max(100);

const startSchema = z
  .object({
    access_token: accessToken,
    provider: z.enum(PAYMENT_PROVIDERS),
    client_request_id: z.string().uuid().optional(),
  })
  .strict();

const statusSchema = z.object({ access_token: accessToken }).strict();

router.get("/methods", publicApiLimiter, async (req, res) => {
  try {
    return res.json({ ok: true, ...(await listMethods()) });
  } catch (error) {
    return sendError(res, error, { context: "GET /public/payments/methods" });
  }
});

router.post("/", paymentStartLimiter, async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const result = await startPayment({
      accessToken: parsed.data.access_token,
      provider: parsed.data.provider,
      clientRequestId: parsed.data.client_request_id,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, { context: "POST /public/payments" });
  }
});

router.post("/status", paymentStatusLimiter, async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    return res.json(await getPublicStatus({ accessToken: parsed.data.access_token }));
  } catch (error) {
    return sendError(res, error, { context: "POST /public/payments/status" });
  }
});

// ---------------------------------------------------------------------------
// Retornos y webhook
// ---------------------------------------------------------------------------

const urlencodedParser = express.urlencoded({ extended: false, limit: "2kb", parameterLimit: 20 });

/** urlencoded SOLO en el retorno de Webpay; un cuerpo ilegible no corta el flujo (se clasifica INVALID). */
function webpayBodyParser(req, res, next) {
  urlencodedParser(req, res, (error) => {
    if (error) {
      req.body = {};
      req.webpayBodyError = true;
    }
    next();
  });
}

function sendPaymentRedirect(res, url) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (url) return res.redirect(303, url);
  return res.status(503).json({ ok: false, error: "La página de pago no está configurada (PUBLIC_SITE_URL)." });
}

router.all("/webpay/return", paymentReturnLimiter, webpayBodyParser, async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Método no permitido." });
  }
  try {
    const { redirectUrl } = await handleWebpayReturn({
      method: req.method,
      query: req.query,
      body: req.method === "POST" ? req.body : {},
      bodyError: Boolean(req.webpayBodyError),
    });
    return sendPaymentRedirect(res, redirectUrl);
  } catch (error) {
    // Nunca se muestra un error al cliente en medio del pago: va a la página
    // de pago, que consulta el estado real (y el conciliador resuelve el resto).
    logServerError("GET|POST /public/payments/webpay/return", error);
    return sendPaymentRedirect(res, paymentPageUrl(null));
  }
});

router.get("/mercadopago/return/:attemptId", paymentReturnLimiter, async (req, res) => {
  try {
    const { redirectUrl } = await handleMercadoPagoReturn({ attemptId: req.params.attemptId, query: req.query });
    return sendPaymentRedirect(res, redirectUrl);
  } catch (error) {
    logServerError("GET /public/payments/mercadopago/return", error);
    return sendPaymentRedirect(res, paymentPageUrl(null));
  }
});

router.post("/mercadopago/webhook", webhookLimiter, async (req, res) => {
  try {
    const result = await handleMercadoPagoWebhook({ headers: req.headers, originalUrl: req.originalUrl, body: req.body });
    return res.status(result.httpStatus).json(result.body);
  } catch (error) {
    // 500 → Mercado Pago reintenta (el evento no quedó procesado).
    logServerError("POST /public/payments/mercadopago/webhook", error);
    return res.status(500).json({ ok: false, error: "Error interno; reintentar." });
  }
});

module.exports = router;
