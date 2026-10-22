/**
 * Retornos del navegador y notificaciones de los proveedores (payments-design
 * §6.4–§6.6). Responden siempre rápido; la verdad se obtiene del proveedor.
 *
 *   Webpay      GET/POST /public/payments/webpay/return    → 303 a la página de pago
 *   MP back_url GET /public/payments/mercadopago/return/:id → 303 a la página de pago
 *   MP webhook  POST /public/payments/mercadopago/webhook  → 200 | 401 | 500 | 503
 *
 * Nunca se confía en la query de un retorno (salvo para encontrar el intento)
 * ni en el cuerpo de un webhook: siempre se consulta la API del proveedor.
 */

const crypto = require("crypto");
const { getPool } = require("../../db");
const runtime = require("./runtime");
const repo = require("./repository");
const targets = require("./targets");
const { classifyWebpayReturn } = require("./webpay/returnClassifier");
const { commitClaimed, lookupStatus, webpayClientFor } = require("./webpayFlow");
const { applyOutcome } = require("./apply");
const { mapMpPayment } = require("./mercadopago/mapper");
const { verifyWebhookSignature } = require("./mercadopago/signature");
const { sanitizeMpNotification } = require("./sanitize");
const { ProviderHttpError } = require("./http");
const { isSuccess } = require("./stateMachine");
const { logPayment } = require("./log");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MP_PAYMENT_ID = /^\d{1,20}$/;

const shortHash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32);

/** URL de la página de pago: token en el FRAGMENTO (nunca llega a logs ni a Referer). */
function paymentPageUrl(token) {
  const base = runtime.getConfig().urls.paymentPageUrl;
  if (!base) return null;
  return token ? `${base}#t=${token}` : `${base}#e=retry`;
}

async function redirectFor(attempt) {
  if (!attempt) return paymentPageUrl(null);
  const target = await targets.loadTarget(getPool(), targets.refOf(attempt));
  return paymentPageUrl(target?.public_token || null);
}

function attemptEventRef(attempt) {
  return { paymentId: attempt.id, orderId: attempt.order_id, cakeOrderId: attempt.cake_order_id };
}

// ---------------------------------------------------------------------------
// Webpay
// ---------------------------------------------------------------------------

/** ABORTED / TIMEOUT / FORM_ERROR: sin commit; se verifica con status antes de cerrar el intento. */
async function settleWithoutCommit(attempt, variant) {
  const client = webpayClientFor(attempt);
  if (!client) return null;
  const { outcome, error } = await lookupStatus(attempt, client, "RETURN");
  // Sin respuesta clara del proveedor, el intento sigue abierto: lo resuelve el
  // conciliador al vencer (commit de prueba). Nunca se asume nada.
  if (error) return null;
  if (outcome.kind === "APPROVED") {
    return applyOutcome(attempt.id, { ...outcome, kind: "ANOMALY", problems: [`AUTHORIZED_AFTER_${variant}`] }, { source: "RETURN" });
  }
  const kind = variant === "ABORTED" ? "ABORTED_BY_USER" : variant === "TIMEOUT" ? "FORM_TIMEOUT" : "FORM_ERROR";
  if (outcome.kind === "NOT_COMPLETED" || outcome.kind === "REJECTED") return applyOutcome(attempt.id, { ...outcome, kind }, { source: "RETURN" });
  return applyOutcome(attempt.id, outcome, { source: "RETURN" });
}

/**
 * @param {{ method:string, query:object, body:object, bodyError?:boolean }} input
 * @returns {Promise<{ redirectUrl:string|null }>}
 */
async function handleWebpayReturn({ method, query, body, bodyError }) {
  const pool = getPool();
  const c = classifyWebpayReturn({ method, query, body, bodyError });
  if (c.variant === "INVALID") {
    await repo.recordEvent(pool, { provider: "WEBPAY", source: "RETURN", type: "RETURN_INVALID", payload: { reason: c.reason, method }, processed: true });
    return { redirectUrl: paymentPageUrl(null) };
  }

  let attempt = null;
  if (c.token) attempt = await repo.findAttemptByProviderToken(pool, c.token);
  else if (c.buyOrder) attempt = await repo.findAttemptByBuyOrder(pool, c.buyOrder, "WEBPAY");
  if (!attempt) {
    await repo.recordEvent(pool, {
      provider: "WEBPAY",
      source: "RETURN",
      type: "RETURN_UNKNOWN",
      dedupeKey: `webpay:unknown:${c.variant}:${shortHash(c.token || c.buyOrder)}`,
      payload: { variant: c.variant, method },
      processed: true,
    });
    return { redirectUrl: paymentPageUrl(null) };
  }

  const mismatch = (c.buyOrder && c.buyOrder !== attempt.buy_order) || (c.sessionId && c.sessionId !== attempt.session_id);
  if (mismatch) {
    await repo.recordEvent(pool, { ...attemptEventRef(attempt), provider: "WEBPAY", source: "RETURN", type: "RETURN_MISMATCH", payload: { variant: c.variant, method }, processed: true });
    return { redirectUrl: await redirectFor(attempt) };
  }

  const event = await repo.recordEvent(pool, {
    ...attemptEventRef(attempt),
    provider: "WEBPAY",
    source: "RETURN",
    type: `RETURN_${c.variant}`,
    dedupeKey: `webpay:return:${c.variant}:${attempt.id}`,
    from: attempt.status,
    payload: { method },
  });

  if (attempt.status === "PENDING") {
    if (c.variant === "NORMAL") {
      // Commit exactamente una vez: solo quien gana el reclamo lo llama; un
      // retorno duplicado o concurrente lee el resultado guardado (página de pago).
      const claimed = await repo.claimCommit(pool, attempt.id);
      if (claimed) await commitClaimed(claimed, { source: "RETURN" });
    } else {
      await settleWithoutCommit(attempt, c.variant);
    }
  }
  await repo.markEventProcessed(pool, event.id, {});
  logPayment("payment.return", { payment_id: attempt.id, provider: "WEBPAY", variant: c.variant, count: event.receivedCount });
  return { redirectUrl: await redirectFor(attempt) };
}

// ---------------------------------------------------------------------------
// Mercado Pago
// ---------------------------------------------------------------------------

function mpExpected(attempt) {
  return { amountClp: Number(attempt.amount_clp), buyOrder: attempt.buy_order, liveMode: attempt.environment === "LIVE" };
}

function singleQueryValue(value) {
  return typeof value === "string" ? value.trim() : null;
}

/** Back URL de Checkout Pro: el id del intento va en la ruta; la query solo sirve para consultar el pago en la API. */
async function handleMercadoPagoReturn({ attemptId, query }) {
  const pool = getPool();
  const attempt = UUID.test(String(attemptId)) ? await repo.findAttemptById(pool, attemptId) : null;
  if (!attempt || attempt.provider !== "MERCADOPAGO") {
    await repo.recordEvent(pool, { provider: "MERCADOPAGO", source: "BACK_URL", type: "BACK_URL_UNKNOWN", payload: {}, processed: true });
    return { redirectUrl: paymentPageUrl(null) };
  }
  const q = query && typeof query === "object" ? query : {};
  const paymentIdRaw = singleQueryValue(q.payment_id) ?? singleQueryValue(q.collection_id);
  const paymentId = paymentIdRaw && MP_PAYMENT_ID.test(paymentIdRaw) ? paymentIdRaw : null;
  const preferenceId = singleQueryValue(q.preference_id);
  const externalReference = singleQueryValue(q.external_reference);
  if ((preferenceId && preferenceId !== attempt.provider_preference_id) || (externalReference && externalReference !== attempt.buy_order)) {
    await repo.recordEvent(pool, { ...attemptEventRef(attempt), provider: "MERCADOPAGO", source: "BACK_URL", type: "BACK_URL_MISMATCH", payload: {}, processed: true });
    return { redirectUrl: await redirectFor(attempt) };
  }
  await repo.recordEvent(pool, {
    ...attemptEventRef(attempt),
    provider: "MERCADOPAGO",
    source: "BACK_URL",
    type: "BACK_URL",
    dedupeKey: `mp:back:${attempt.id}:${paymentId || "sin-pago"}`,
    payload: { has_payment_id: Boolean(paymentId) },
    processed: true,
  });
  if (paymentId && !isSuccess(attempt.status)) {
    const client = runtime.clientFor("MERCADOPAGO", { environmentCode: attempt.environment });
    if (client) {
      try {
        const payment = await client.getPayment(paymentId);
        await applyOutcome(attempt.id, mapMpPayment(payment, mpExpected(attempt)), { source: "BACK_URL" });
      } catch (error) {
        // El webhook o el conciliador lo resolverán; el navegador va igual a la página (que consulta el estado).
        logPayment("payment.back_url_lookup_failed", { payment_id: attempt.id, provider: "MERCADOPAGO", error: error?.kind || error?.errorCode || "error" }, { level: "warn" });
      }
    }
  }
  return { redirectUrl: await redirectFor(attempt) };
}

function header(headers, name) {
  const value = headers ? headers[name] : undefined;
  return Array.isArray(value) ? value : typeof value === "string" ? value : undefined;
}

/**
 * Webhook de Mercado Pago (configurado en Tus integraciones). Responde dentro
 * de los 22 s: 200 si se procesó o se ignora, 401 si la firma no es válida,
 * 500 si la API de MP no respondió (MP reintenta), 503 si MP no está configurado.
 */
async function handleMercadoPagoWebhook({ headers, originalUrl, body }) {
  const pool = getPool();
  const config = runtime.getConfig().providers.MERCADOPAGO;
  const url = new URL(originalUrl || "/", "http://local");
  const dataIdRaw = url.searchParams.get("data.id");
  const type = url.searchParams.get("type") || (body && typeof body.type === "string" ? body.type : null);
  const notification = sanitizeMpNotification(body);

  const signature = verifyWebhookSignature({
    xSignature: header(headers, "x-signature"),
    xRequestId: header(headers, "x-request-id"),
    dataId: dataIdRaw ?? undefined,
    secret: config.webhookSecret,
    nowMs: runtime.now().getTime(),
  });
  if (!signature.ok) {
    await repo.recordEvent(pool, {
      provider: "MERCADOPAGO",
      source: "WEBHOOK",
      type: "WEBHOOK_REJECTED",
      signatureValid: false,
      httpStatus: 401,
      payload: { reason: signature.reason, notification },
      processed: true,
    });
    logPayment("payment.webhook_rejected", { provider: "MERCADOPAGO", reason: signature.reason }, { level: "warn" });
    return { httpStatus: 401, body: { ok: false, error: "Firma inválida." } };
  }

  const requestId = typeof header(headers, "x-request-id") === "string" ? header(headers, "x-request-id").slice(0, 100) : null;
  const notificationId = notification.id || requestId || `${dataIdRaw}:${signature.ts}`;
  if (type !== "payment" || !dataIdRaw || !MP_PAYMENT_ID.test(dataIdRaw)) {
    await repo.recordEvent(pool, {
      provider: "MERCADOPAGO",
      source: "WEBHOOK",
      type: "WEBHOOK_IGNORED",
      dedupeKey: `mp:wh:${shortHash(notificationId)}`,
      signatureValid: true,
      httpStatus: 200,
      payload: { notification, type },
      processed: true,
    });
    return { httpStatus: 200, body: { ok: true, ignored: true } };
  }

  const event = await repo.recordEvent(pool, {
    provider: "MERCADOPAGO",
    source: "WEBHOOK",
    type: "WEBHOOK_RECEIVED",
    dedupeKey: `mp:wh:${shortHash(notificationId)}`,
    signatureValid: true,
    payload: { notification },
  });
  if (event.duplicate && event.processedAt) return { httpStatus: 200, body: { ok: true, duplicate: true } };

  const client = runtime.clientFor("MERCADOPAGO");
  if (!client) {
    await repo.markEventProcessed(pool, event.id, { httpStatus: 503, error: "PROVIDER_NOT_CONFIGURED" });
    return { httpStatus: 503, body: { ok: false, error: "Mercado Pago no está configurado." } };
  }

  let payment;
  try {
    payment = await client.getPayment(dataIdRaw);
  } catch (error) {
    if (error instanceof ProviderHttpError && !error.ambiguous && error.status === 404) {
      await repo.markEventProcessed(pool, event.id, { httpStatus: 200, error: "UNKNOWN_PAYMENT" });
      return { httpStatus: 200, body: { ok: true, unknown: true } };
    }
    // Sin marcar como procesado: el reintento de MP lo volverá a intentar.
    logPayment("payment.webhook_lookup_failed", { provider: "MERCADOPAGO", error: error?.kind || "error", http_status: error?.status }, { level: "warn" });
    return { httpStatus: 500, body: { ok: false, error: "No se pudo consultar el pago; reintentar." } };
  }

  const reference = payment && typeof payment.external_reference === "string" ? payment.external_reference : null;
  const attempt = reference ? await repo.findAttemptByBuyOrder(pool, reference, "MERCADOPAGO") : null;
  if (!attempt) {
    await repo.markEventProcessed(pool, event.id, { httpStatus: 200, error: "FOREIGN_REFERENCE" });
    return { httpStatus: 200, body: { ok: true, foreign: true } };
  }
  if (attempt.environment !== client.environmentCode) {
    await repo.markEventProcessed(pool, event.id, { httpStatus: 200, error: "ENVIRONMENT_MISMATCH", paymentId: attempt.id });
    logPayment("payment.environment_mismatch", { payment_id: attempt.id, provider: "MERCADOPAGO" }, { level: "error" });
    return { httpStatus: 200, body: { ok: true } };
  }
  await applyOutcome(attempt.id, mapMpPayment(payment, mpExpected(attempt)), { source: "WEBHOOK" });
  await repo.markEventProcessed(pool, event.id, { httpStatus: 200, paymentId: attempt.id, orderId: attempt.order_id, cakeOrderId: attempt.cake_order_id });
  return { httpStatus: 200, body: { ok: true } };
}

module.exports = { paymentPageUrl, handleWebpayReturn, handleMercadoPagoReturn, handleMercadoPagoWebhook };
