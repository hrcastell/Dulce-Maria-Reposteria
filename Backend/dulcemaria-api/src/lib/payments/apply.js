/**
 * applyOutcome: ÚNICO escritor de las transiciones de un intento de pago
 * (payments-design §7.2). Idempotente y seguro con varios procesos:
 *
 *   BEGIN
 *     destino (orden o torta) FOR UPDATE      ← siempre primero
 *     intento FOR UPDATE
 *     plan = stateMachine.planAttemptChange(...)   (puro)
 *     efecto sobre el destino (ciclo de vida W1b / tortas), en la MISMA transacción
 *     UPDATE condicional del intento + evento saneado (+ evento en la orden si va a revisión)
 *   COMMIT
 *
 * Nunca hace llamadas HTTP: el resultado del proveedor llega ya consultado.
 */

const { withTransaction } = require("../../db");
const { appError, isUniqueViolation } = require("../httpErrors");
const { recordOrderEvent } = require("../orderEvents");
const { planAttemptChange, isOpen } = require("./stateMachine");
const repo = require("./repository");
const targets = require("./targets");
const runtime = require("./runtime");
const { logPayment } = require("./log");
const { sanitizeErrorText } = require("./sanitize");

const PROVIDER_FIELDS = Object.freeze([
  ["provider_status", "providerStatus"],
  ["provider_status_detail", "providerStatusDetail"],
  ["response_code", "responseCode"],
  ["authorization_code", "authorizationCode"],
  ["card_last4", "cardLast4"],
  ["payment_type", "paymentType"],
  ["payment_method_id", "paymentMethodId"],
  ["installments_number", "installmentsNumber"],
  ["installments_amount_clp", "installmentsAmountClp"],
  ["accounting_date", "accountingDate"],
  ["transaction_date", "transactionDate"],
]);
const MONEY_KINDS = Object.freeze(["APPROVED", "PARTIALLY_REFUNDED", "REFUNDED", "CHARGEBACK", "DISPUTE"]);

/** Datos del proveedor que se copian al intento (nunca los de OTRO pago de MP). */
function providerFieldsFrom(attempt, outcome) {
  if (!outcome || !outcome.sanitized) return {};
  const otherMpPayment =
    attempt.provider === "MERCADOPAGO" &&
    attempt.provider_payment_id &&
    outcome.providerPaymentId &&
    String(outcome.providerPaymentId) !== String(attempt.provider_payment_id);
  if (otherMpPayment) return {};
  const fields = { provider_payload: outcome.sanitized };
  for (const [column, key] of PROVIDER_FIELDS) {
    if (outcome[key] !== null && outcome[key] !== undefined) fields[column] = outcome[key];
  }
  if (attempt.provider === "MERCADOPAGO" && outcome.providerPaymentId && !attempt.provider_payment_id && MONEY_KINDS.includes(outcome.kind)) {
    fields.provider_payment_id = String(outcome.providerPaymentId);
  }
  return fields;
}

/**
 * @param {string} attemptId
 * @param {object} outcome resultado del proveedor o interno (kind, problems, ...)
 * @param {{ source:string, actor?:object, fields?:object, eventType?:string, eventPayload?:object, dedupeKey?:string }} options
 * @returns {Promise<{ attempt:object, changed:boolean, from:string, to:string, plan:object }>}
 */
async function applyOutcome(attemptId, outcome, options = {}) {
  let result;
  try {
    result = await withTransaction((client) => applyOutcomeInTx(client, attemptId, outcome, options));
  } catch (error) {
    if (isUniqueViolation(error, "uq_payments_one_success_per_order") || isUniqueViolation(error, "uq_payments_one_success_per_cake_order")) {
      // Dos aprobaciones simultáneas para el mismo destino: el bloqueo del
      // destino lo impide; si igual ocurre, se reintenta después (el destino ya
      // pagado deriva el segundo intento a NEEDS_REVIEW).
      throw appError(409, "DUPLICATE_SUCCESS", "Otro pago de este pedido se confirmó al mismo tiempo; se volverá a conciliar.");
    }
    throw error;
  }
  logTransition(attemptId, result, options.source);
  return result;
}

function logTransition(attemptId, result, source) {
  if (!result.changed) return;
  logPayment("payment.transition", {
    payment_id: attemptId,
    [result.ref.kind === "ORDER" ? "order_id" : "cake_order_id"]: result.ref.id,
    provider: result.attempt.provider,
    from: result.from,
    to: result.to,
    source,
    reason: result.plan.reason,
    review_reason: result.attempt.review_reason,
  });
}

/** Igual que applyOutcome, dentro de una transacción ya abierta por el llamador (p. ej. reembolsos). */
async function applyOutcomeInTx(client, attemptId, outcome, { source, actor = null, fields = {}, eventType, eventPayload = {}, dedupeKey } = {}) {
  const now = runtime.now();
  const head = await client.query(`SELECT order_id, cake_order_id FROM payments WHERE id = $1`, [attemptId]);
  if (!head.rowCount) throw appError(404, "PAYMENT_NOT_FOUND", "Intento de pago no encontrado.");
  const ref = targets.refOf(head.rows[0]);
  const target = await targets.lockTarget(client, ref);
  const attempt = await repo.lockAttemptById(client, attemptId);

  const plan = planAttemptChange({ attempt, target, outcome, now });
  let next = plan.next;
  let reviewReason = plan.reviewReason;
  let targetApplied = Boolean(attempt.target_applied);
  if (plan.changed && plan.targetEffect !== "NONE") {
    const effect = await targets.applyTargetEffect(client, target, plan.targetEffect, { attempt });
    if (effect.review) {
      next = "NEEDS_REVIEW";
      reviewReason = effect.review;
    } else if (plan.targetEffect !== "REFUND_TARGET") {
      targetApplied = true;
    }
  }

  const statusChanged = next !== attempt.status;
  const update = { ...providerFieldsFrom(attempt, outcome), ...fields };
  if (plan.changed) {
    update.status = next;
    if (reviewReason) update.review_reason = String(reviewReason).slice(0, 200);
    if (plan.refundedAmountClp !== undefined) update.refunded_amount_clp = Math.min(Number(attempt.amount_clp), plan.refundedAmountClp);
    if (targetApplied !== Boolean(attempt.target_applied)) update.target_applied = targetApplied;
    if (!isOpen(next)) {
      update.next_reconcile_at = null;
      if (!attempt.finalized_at) update.finalized_at = now;
    }
  }
  if (update.last_error !== undefined) update.last_error = sanitizeErrorText(update.last_error);
  const saved = Object.keys(update).length ? await repo.updateAttempt(client, attempt.id, attempt.status, update) : attempt;
  if (!saved) throw appError(409, "CONCURRENT_UPDATE", "El intento de pago cambió mientras se procesaba.");

  const eventTarget = ref.kind === "ORDER" ? { orderId: ref.id } : { cakeOrderId: ref.id };
  await repo.recordEvent(client, {
    paymentId: attempt.id,
    ...eventTarget,
    provider: attempt.provider,
    source,
    type: eventType || (statusChanged ? "TRANSITION" : "PROVIDER_SIGNAL"),
    dedupeKey,
    from: attempt.status,
    to: saved.status,
    payload: {
      kind: outcome.kind,
      reason: plan.reason,
      ...(reviewReason ? { review_reason: reviewReason } : {}),
      ...(plan.blockedReason ? { blocked_reason: plan.blockedReason } : {}),
      ...(outcome.problems && outcome.problems.length ? { problems: outcome.problems } : {}),
      ...(plan.targetEffect !== "NONE" ? { target_effect: plan.targetEffect } : {}),
      ...(outcome.sanitized ? { provider: outcome.sanitized } : {}),
      ...eventPayload,
    },
    actorUserId: actor?.sub || null,
    processed: true,
  });
  if (statusChanged && next === "NEEDS_REVIEW") {
    await recordOrderEvent(client, {
      ...eventTarget,
      type: "PAYMENT_NEEDS_REVIEW",
      from: attempt.status,
      to: "NEEDS_REVIEW",
      source: "PAYMENT",
      data: { payment_id: attempt.id, provider: attempt.provider, review_reason: reviewReason },
    });
  }
  return { attempt: saved, changed: statusChanged, from: attempt.status, to: saved.status, plan, ref };
}

module.exports = { applyOutcome, applyOutcomeInTx, logTransition, providerFieldsFrom };
