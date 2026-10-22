/**
 * Confirmación de Webpay (commit) y consulta de estado, compartidas por el
 * retorno del navegador y el conciliador.
 *
 * Reglas de dinero:
 *   - El commit se llama A LO MÁS UNA VEZ por token: solo quien gana
 *     repo.claimCommit (PENDING → COMMITTING, commit_attempts 0 → 1) llega aquí.
 *     Retornos duplicados o concurrentes leen el resultado guardado.
 *   - Commit rechazado de forma definitiva (4xx): la verdad la da `status`
 *     (p. ej. commit duplicado → AUTHORIZED → PAID; INITIALIZED → nunca autorizada).
 *   - Commit ambiguo (red, timeout, 5xx): NUNCA se asume fracaso; se consulta
 *     status y, si tampoco resuelve, el intento queda COMMITTING para el
 *     conciliador (y a los 10 min sin confirmación → NEEDS_REVIEW).
 */

const { getPool } = require("../../db");
const { ProviderHttpError } = require("./http");
const { mapWebpayTransaction } = require("./webpay/mapper");
const { applyOutcome } = require("./apply");
const repo = require("./repository");
const runtime = require("./runtime");
const { logPayment } = require("./log");
const { sanitizeErrorText } = require("./sanitize");

const RETRY_AFTER_AMBIGUOUS_MS = 20 * 1000;

function expectedFor(attempt) {
  return { amountClp: Number(attempt.amount_clp), buyOrder: attempt.buy_order, sessionId: attempt.session_id };
}

function webpayClientFor(attempt) {
  return runtime.clientFor("WEBPAY", { environmentCode: attempt.environment });
}

async function providerErrorEvent(attempt, type, error, source) {
  await repo.recordEvent(getPool(), {
    paymentId: attempt.id,
    orderId: attempt.order_id,
    cakeOrderId: attempt.cake_order_id,
    provider: "WEBPAY",
    source,
    type,
    httpStatus: error?.status ?? null,
    error: sanitizeErrorText(error?.providerMessage || error?.kind || error?.message || "error"),
    payload: { kind: error?.kind || null, ambiguous: Boolean(error?.ambiguous) },
  });
}

async function retryLater(attempt, ms = RETRY_AFTER_AMBIGUOUS_MS) {
  await repo.scheduleReconcile(getPool(), attempt.id, new Date(runtime.now().getTime() + ms));
  return { status: "PENDING_RECONCILE" };
}

/**
 * Después de un commit fallido: consulta status y decide.
 * @param {{ refused:boolean, probe:boolean, error:ProviderHttpError }} info
 */
async function statusAfterCommit(attempt, client, { source, refused, probe, error }) {
  let json;
  try {
    json = await client.status(attempt.provider_token);
  } catch (statusError) {
    if (!(statusError instanceof ProviderHttpError)) throw statusError;
    await providerErrorEvent(attempt, "STATUS_FAILED", statusError, source);
    return retryLater(attempt);
  }
  const outcome = mapWebpayTransaction(json, expectedFor(attempt));
  const lastError = refused ? { last_error: error?.providerMessage || `commit rechazado (HTTP ${error?.status})` } : {};
  if (outcome.kind === "NOT_COMPLETED") {
    // Rechazo definitivo + transacción sin autorizar = nunca se pagó.
    if (refused) return applyOutcome(attempt.id, { ...outcome, kind: probe ? "PROBE_REFUSED" : "COMMIT_REFUSED" }, { source, fields: lastError, eventType: "STATUS_AFTER_COMMIT" });
    // Ambiguo + INITIALIZED: el commit pudo no haber llegado; lo resuelve el conciliador.
    await applyOutcome(attempt.id, { ...outcome, kind: "UNKNOWN" }, { source, eventType: "STATUS_AFTER_COMMIT" });
    return retryLater(attempt);
  }
  const result = await applyOutcome(attempt.id, outcome, { source, fields: lastError, eventType: "STATUS_AFTER_COMMIT" });
  if (result.attempt.status === "COMMITTING") await retryLater(attempt);
  return result;
}

/** Commit de un intento ya reclamado (COMMITTING). Se llama una sola vez por token. */
async function commitClaimed(attempt, { source, probe = false }) {
  const client = webpayClientFor(attempt);
  if (!client) {
    logPayment("payment.provider_unavailable", { payment_id: attempt.id, provider: "WEBPAY", environment: attempt.environment, source }, { level: "error" });
    return retryLater(attempt, 60 * 1000);
  }
  let json;
  try {
    json = await client.commit(attempt.provider_token);
  } catch (error) {
    if (!(error instanceof ProviderHttpError)) throw error;
    await providerErrorEvent(attempt, "COMMIT_FAILED", error, source);
    return statusAfterCommit(attempt, client, { source, refused: !error.ambiguous, probe, error });
  }
  const outcome = mapWebpayTransaction(json, expectedFor(attempt));
  const result = await applyOutcome(attempt.id, outcome, { source, eventType: "COMMIT_RESPONSE" });
  if (result.attempt.status === "COMMITTING") await retryLater(attempt);
  return result;
}

/** Consulta status (sin commit). @returns {{ outcome?:object, error?:ProviderHttpError }} */
async function lookupStatus(attempt, client, source) {
  try {
    const json = await client.status(attempt.provider_token);
    return { outcome: mapWebpayTransaction(json, expectedFor(attempt)) };
  } catch (error) {
    if (!(error instanceof ProviderHttpError)) throw error;
    await providerErrorEvent(attempt, "STATUS_FAILED", error, source);
    return { error };
  }
}

module.exports = { expectedFor, webpayClientFor, commitClaimed, lookupStatus, retryLater };
