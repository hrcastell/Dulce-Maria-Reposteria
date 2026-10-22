/**
 * Reembolsos (solo SUPERADMIN; lo exige la ruta). payments-design §6.8.
 *
 *   1. Transacción corta: valida el intento (PAID/PARTIALLY_REFUNDED), el monto
 *      (≤ saldo reembolsable) y que no haya otro reembolso abierto; inserta
 *      payment_refunds(REQUESTED). client_request_id UNIQUE = doble clic seguro.
 *   2. Fuera de transacción: llama al proveedor.
 *        Webpay: POST …/transactions/{token}/refunds { amount } (sin clave de
 *        idempotencia → un resultado ambiguo queda UNKNOWN y bloquea otro
 *        reembolso hasta verificarlo con status/balance).
 *        Mercado Pago: POST /v1/payments/{id}/refunds + X-Idempotency-Key =
 *        payment_refunds.id (verificar = reenviar con la misma clave).
 *   3. Transacción corta: estado del reembolso + transición del intento
 *      (PARTIALLY_REFUNDED / REFUNDED) y, si es total, payment_status de la
 *      orden (o deposit_status de la torta) → REFUNDED. El stock no se toca.
 */

const crypto = require("crypto");
const { getPool, withTransaction } = require("../../db");
const { appError, unavailableError, isUniqueViolation } = require("../httpErrors");
const runtime = require("./runtime");
const repo = require("./repository");
const targets = require("./targets");
const { applyOutcomeInTx, logTransition } = require("./apply");
const { mapWebpayRefund, mapWebpayTransaction } = require("./webpay/mapper");
const { mapMpRefund } = require("./mercadopago/mapper");
const { ProviderHttpError } = require("./http");
const { sanitizeErrorText } = require("./sanitize");
const { logPayment } = require("./log");

const STALE_REQUEST_MS = 2 * 60 * 1000;

function remainingOf(attempt) {
  return Number(attempt.amount_clp) - Number(attempt.refunded_amount_clp || 0);
}

async function callProviderRefund(attempt, refund) {
  const client = runtime.clientFor(attempt.provider, { environmentCode: attempt.environment });
  if (!client) return { status: "UNKNOWN", error: "PROVIDER_UNAVAILABLE", sanitized: {} };
  try {
    if (attempt.provider === "WEBPAY") return mapWebpayRefund(await client.refund(attempt.provider_token, Number(refund.amount_clp)));
    return mapMpRefund(await client.refund(attempt.provider_payment_id, Number(refund.amount_clp), refund.id));
  } catch (error) {
    if (!(error instanceof ProviderHttpError)) throw error;
    return {
      status: error.ambiguous ? "UNKNOWN" : "FAILED",
      error: error.providerMessage || `${error.kind}${error.status ? ` (HTTP ${error.status})` : ""}`,
      sanitized: { kind: error.kind, http_status: error.status },
    };
  }
}

/** Cierra un reembolso con el resultado del proveedor y sincroniza el intento y el destino (una transacción). */
async function settleRefund(refundId, mapped, { actor, source = "ADMIN" }) {
  let transition = null;
  const refund = await withTransaction(async (client) => {
    const head = await client.query(
      `SELECT r.payment_id, p.order_id, p.cake_order_id FROM payment_refunds r JOIN payments p ON p.id = r.payment_id WHERE r.id = $1`,
      [refundId]
    );
    if (!head.rowCount) throw appError(404, "REFUND_NOT_FOUND", "Reembolso no encontrado.");
    const ref = targets.refOf(head.rows[0]);
    await targets.lockTarget(client, ref);
    const attempt = await repo.lockAttemptById(client, head.rows[0].payment_id);
    const current = await repo.lockRefund(client, refundId);
    if (current.status === "SUCCEEDED" || current.status === "FAILED") return current;

    const updated = await repo.updateRefund(client, refundId, {
      status: mapped.status,
      providerRefundId: mapped.providerRefundId || null,
      providerType: mapped.providerType || null,
      payload: mapped.sanitized || null,
      error: mapped.error ? sanitizeErrorText(mapped.error) : null,
    });
    await repo.recordEvent(client, {
      paymentId: attempt.id,
      orderId: attempt.order_id,
      cakeOrderId: attempt.cake_order_id,
      provider: attempt.provider,
      source,
      type: `REFUND_${mapped.status}`,
      payload: { refund_id: refundId, amount_clp: Number(current.amount_clp), provider_type: mapped.providerType || null },
      error: mapped.error ? sanitizeErrorText(mapped.error) : null,
      actorUserId: actor?.sub || null,
      processed: true,
    });
    if (mapped.status === "SUCCEEDED") {
      const refunded = Number(attempt.refunded_amount_clp || 0) + Number(current.amount_clp);
      const kind = refunded >= Number(attempt.amount_clp) ? "REFUNDED" : "PARTIALLY_REFUNDED";
      transition = await applyOutcomeInTx(client, attempt.id, { kind, problems: [], refundedAmountClp: refunded }, {
        source,
        actor,
        eventType: "REFUND_APPLIED",
        eventPayload: { refund_id: refundId },
      });
      if (attempt.provider === "WEBPAY" && mapped.balanceClp !== null && mapped.balanceClp !== undefined) {
        const expectedBalance = Number(attempt.amount_clp) - refunded;
        if (mapped.balanceClp !== expectedBalance) {
          logPayment("payment.refund_balance_mismatch", { payment_id: attempt.id, refund_id: refundId }, { level: "warn" });
        }
      }
    }
    return updated;
  });
  if (transition) logTransition(transition.attempt.id, transition, source);
  return refund;
}

/**
 * @param {{ attemptId:string, amountClp?:number, reason:string, clientRequestId:string, actor:object }} input
 */
async function requestRefund({ attemptId, amountClp, reason, clientRequestId, actor }) {
  const pool = getPool();
  const existing = await repo.findRefundByClientRequestId(pool, clientRequestId);
  if (existing) {
    if (existing.payment_id !== attemptId) throw appError(409, "IDEMPOTENCY_CONFLICT", "Ese identificador de solicitud ya se usó para otro reembolso.");
    return { refund: existing, replay: true };
  }

  let prepared;
  try {
    prepared = await withTransaction(async (client) => {
      const head = await client.query(`SELECT order_id, cake_order_id FROM payments WHERE id = $1`, [attemptId]);
      if (!head.rowCount) throw appError(404, "PAYMENT_NOT_FOUND", "Intento de pago no encontrado.");
      await targets.lockTarget(client, targets.refOf(head.rows[0]));
      const attempt = await repo.lockAttemptById(client, attemptId);
      if (attempt.status !== "PAID" && attempt.status !== "PARTIALLY_REFUNDED") {
        throw appError(409, "PAYMENT_NOT_REFUNDABLE", "Solo se puede reembolsar un pago confirmado.");
      }
      if ((await repo.listOpenRefunds(client, attempt.id)).length) {
        throw appError(409, "REFUND_IN_PROGRESS", "Hay un reembolso de este pago pendiente de confirmar: verifícalo antes de pedir otro.");
      }
      const remaining = remainingOf(attempt);
      const amount = amountClp === undefined || amountClp === null ? remaining : amountClp;
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > remaining) {
        throw appError(400, "REFUND_AMOUNT_INVALID", `El monto a reembolsar debe ser un entero entre 1 y ${remaining} CLP.`);
      }
      if (attempt.provider === "MERCADOPAGO" && !attempt.provider_payment_id) {
        throw appError(409, "PAYMENT_NOT_REFUNDABLE", "Este pago de Mercado Pago no tiene un id de pago registrado.");
      }
      if (!runtime.clientFor(attempt.provider, { environmentCode: attempt.environment })) {
        throw unavailableError("PROVIDER_UNAVAILABLE", "El medio de pago no está configurado en este servidor.");
      }
      const refund = await repo.insertRefund(client, {
        id: crypto.randomUUID(),
        paymentId: attempt.id,
        amountClp: amount,
        reason,
        requestedBy: actor?.sub,
        clientRequestId,
      });
      await repo.recordEvent(client, {
        paymentId: attempt.id,
        orderId: attempt.order_id,
        cakeOrderId: attempt.cake_order_id,
        provider: attempt.provider,
        source: "ADMIN",
        type: "REFUND_REQUESTED",
        payload: { refund_id: refund.id, amount_clp: amount, partial: amount < remaining },
        actorUserId: actor?.sub || null,
        processed: true,
      });
      return { attempt, refund };
    });
  } catch (error) {
    if (isUniqueViolation(error, "payment_refunds_client_request_id_key")) {
      const again = await repo.findRefundByClientRequestId(pool, clientRequestId);
      if (again) return { refund: again, replay: true };
    }
    if (isUniqueViolation(error, "uq_payment_refunds_one_open")) {
      throw appError(409, "REFUND_IN_PROGRESS", "Hay un reembolso de este pago pendiente de confirmar: verifícalo antes de pedir otro.");
    }
    throw error;
  }

  const mapped = await callProviderRefund(prepared.attempt, prepared.refund);
  const refund = await settleRefund(prepared.refund.id, mapped, { actor });
  logPayment("payment.refund", { payment_id: attemptId, refund_id: refund.id, provider: prepared.attempt.provider, to: refund.status });
  return { refund, replay: false };
}

/** Resuelve un reembolso UNKNOWN (o REQUESTED que quedó a medias) consultando al proveedor. */
async function verifyRefund({ refundId, actor }) {
  const pool = getPool();
  const refund = await repo.findRefund(pool, refundId);
  if (!refund) throw appError(404, "REFUND_NOT_FOUND", "Reembolso no encontrado.");
  if (refund.status === "SUCCEEDED" || refund.status === "FAILED") return { refund, changed: false };
  if (refund.status === "REQUESTED" && runtime.now().getTime() - new Date(refund.created_at).getTime() < STALE_REQUEST_MS) {
    throw appError(409, "REFUND_IN_PROGRESS", "El reembolso se está procesando; verifícalo en unos minutos.");
  }
  const attempt = await repo.findAttemptById(pool, refund.payment_id);
  const client = runtime.clientFor(attempt.provider, { environmentCode: attempt.environment });
  if (!client) throw unavailableError("PROVIDER_UNAVAILABLE", "El medio de pago no está configurado en este servidor.");

  let mapped;
  if (attempt.provider === "MERCADOPAGO") {
    // Reenviar con la misma X-Idempotency-Key: MP devuelve el reembolso ya hecho o lo ejecuta una sola vez.
    mapped = await callProviderRefund(attempt, refund);
  } else {
    try {
      const status = await client.status(attempt.provider_token);
      const outcome = mapWebpayTransaction(status, { amountClp: Number(attempt.amount_clp), buyOrder: attempt.buy_order, sessionId: attempt.session_id });
      const before = remainingOf(attempt);
      const after = before - Number(refund.amount_clp);
      const fullyRefunded = outcome.kind === "REFUNDED" && (outcome.balanceClp === null || outcome.balanceClp === 0);
      if ((fullyRefunded && after === 0) || (outcome.kind === "PARTIALLY_REFUNDED" && outcome.balanceClp === after)) {
        mapped = { status: "SUCCEEDED", providerType: outcome.providerStatus, sanitized: outcome.sanitized };
      } else if (
        (outcome.kind === "APPROVED" && Number(attempt.refunded_amount_clp || 0) === 0) ||
        (outcome.kind === "PARTIALLY_REFUNDED" && outcome.balanceClp === before)
      ) {
        mapped = { status: "FAILED", error: "El proveedor no registra el reembolso.", sanitized: outcome.sanitized };
      } else {
        mapped = { status: "UNKNOWN", error: "Saldo no concluyente; revisa el portal de Transbank.", sanitized: outcome.sanitized };
      }
    } catch (error) {
      if (!(error instanceof ProviderHttpError)) throw error;
      throw unavailableError("PROVIDER_UNAVAILABLE", "No se pudo consultar a Transbank; intenta más tarde.");
    }
  }
  const settled = await settleRefund(refundId, mapped, { actor });
  return { refund: settled, changed: settled.status !== refund.status };
}

module.exports = { requestRefund, verifyRefund, settleRefund };
