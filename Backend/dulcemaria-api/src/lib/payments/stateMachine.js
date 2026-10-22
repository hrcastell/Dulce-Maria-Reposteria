/**
 * Máquina de estados de un INTENTO de pago (`payments.status`) y su efecto
 * sobre la orden del catálogo o el pedido de torta. Módulo puro: el servicio
 * le pasa el intento, el destino (bloqueados) y el resultado del proveedor, y
 * aplica el plan en UNA transacción.
 *
 *   CREATED → PENDING → (COMMITTING, solo Webpay) → PAID
 *                    ↘ REJECTED | ABORTED | EXPIRED | FAILED
 *   cualquier anomalía con dinero posiblemente movido → NEEDS_REVIEW
 *   PAID → PARTIALLY_REFUNDED → REFUNDED
 *
 * Reglas (payments-design §5.1/§5.2, adaptadas a W1b y D1):
 *   1. El proveedor manda: una aprobación válida pasa a PAID aunque el intento
 *      estuviera en un fracaso local (pago tardío).
 *   2. Nunca se degrada un éxito automáticamente: una señal negativa sobre un
 *      pago (contracargo, mediación, cancelación, anomalía) → NEEDS_REVIEW;
 *      un reembolso informado por el proveedor se sincroniza.
 *   3. Cualquier diferencia (monto, moneda, referencia, sesión, cobro
 *      duplicado, orden cancelada por el panel, sin stock para revivir) →
 *      NEEDS_REVIEW: jamás PAID, jamás dinero descartado en silencio.
 *   4. NEEDS_REVIEW solo cambia por resolución del administrador.
 */

const { amountToCharge } = require("./amount");

const ATTEMPT_STATUSES = Object.freeze([
  "CREATED",
  "PENDING",
  "COMMITTING",
  "PAID",
  "REJECTED",
  "ABORTED",
  "EXPIRED",
  "FAILED",
  "NEEDS_REVIEW",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);
const OPEN_STATUSES = Object.freeze(["CREATED", "PENDING", "COMMITTING"]);
const FAILURE_STATUSES = Object.freeze(["REJECTED", "ABORTED", "EXPIRED", "FAILED"]);
const SUCCESS_STATUSES = Object.freeze(["PAID", "PARTIALLY_REFUNDED", "REFUNDED"]);
const RESOLUTIONS = Object.freeze(["PAID", "REJECTED", "EXPIRED", "REFUNDED"]);
const TARGET_EFFECTS = Object.freeze(["NONE", "PAY_AND_ADVANCE", "PAY_ONLY", "REVIVE", "REFUND_TARGET"]);

const OUTCOME_KINDS = Object.freeze([
  // del proveedor
  "APPROVED",
  "REJECTED",
  "REJECTED_RETRYABLE",
  "PENDING",
  "NOT_COMPLETED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "CHARGEBACK",
  "DISPUTE",
  "ANOMALY",
  "UNKNOWN",
  "FOREIGN_REFERENCE",
  // retornos de Webpay
  "ABORTED_BY_USER",
  "FORM_TIMEOUT",
  "FORM_ERROR",
  // internos
  "CREATE_SUCCEEDED",
  "CREATE_FAILED",
  "STALE_CREATED",
  "COMMIT_REFUSED",
  "PROBE_REFUSED",
  "COMMIT_UNCONFIRMED",
  "STATUS_WINDOW_CLOSING",
  "STATUS_NOT_FOUND",
  "RESOLVE",
]);

const isOpen = (status) => OPEN_STATUSES.includes(status);
const isFailure = (status) => FAILURE_STATUSES.includes(status);
const isSuccess = (status) => SUCCESS_STATUSES.includes(status);

function keep(attempt, reason = "NO_CHANGE") {
  return { next: attempt.status, changed: false, reviewReason: null, reason };
}

function move(next, reason, reviewReason = null, extra = {}) {
  return { next, changed: true, reviewReason, reason, ...extra };
}

function review(attempt, reviewReason, reason = reviewReason) {
  return attempt.status === "NEEDS_REVIEW" ? keep(attempt) : move("NEEDS_REVIEW", reason, reviewReason);
}

function expired(attempt, now) {
  const at = attempt.expires_at instanceof Date ? attempt.expires_at : new Date(attempt.expires_at);
  return !Number.isNaN(at.getTime()) && now.getTime() >= at.getTime();
}

/** Otro pago de Mercado Pago (distinto del que definió el intento). */
function isOtherMpPayment(attempt, outcome) {
  return (
    attempt.provider === "MERCADOPAGO" &&
    Boolean(attempt.provider_payment_id) &&
    Boolean(outcome.providerPaymentId) &&
    String(outcome.providerPaymentId) !== String(attempt.provider_payment_id)
  );
}

/**
 * Transición del intento ante un resultado (sin mirar la orden).
 * @returns {{ next:string, changed:boolean, reviewReason:string|null, reason:string, refundedAmountClp?:number }}
 */
function decideAttemptTransition(attempt, outcome, { now = new Date() } = {}) {
  const status = attempt.status;
  if (!ATTEMPT_STATUSES.includes(status)) throw new Error(`Estado de intento desconocido: ${status}`);
  const kind = outcome?.kind;
  if (!OUTCOME_KINDS.includes(kind)) throw new Error(`Resultado de proveedor desconocido: ${kind}`);
  const problems = Array.isArray(outcome.problems) ? outcome.problems : [];

  switch (kind) {
    case "APPROVED":
      if (status === "NEEDS_REVIEW") return keep(attempt);
      if (isSuccess(status)) return isOtherMpPayment(attempt, outcome) ? move("NEEDS_REVIEW", "DUPLICATE_PAYMENT", "DUPLICATE_PAYMENT") : keep(attempt, "ALREADY_PAID");
      if (problems.length) return move("NEEDS_REVIEW", "APPROVAL_WITH_PROBLEMS", problems.join(","));
      return move("PAID", isFailure(status) ? "LATE_APPROVAL" : "APPROVED");

    case "REJECTED":
      return isOpen(status) ? move("REJECTED", "REJECTED") : keep(attempt);

    case "REJECTED_RETRYABLE":
    case "PENDING":
      return status === "CREATED" ? move("PENDING", "PROVIDER_PENDING") : keep(attempt);

    case "NOT_COMPLETED":
      return status === "PENDING" && expired(attempt, now) ? move("EXPIRED", "NOT_COMPLETED") : keep(attempt);

    case "CANCELLED":
      if (status === "CREATED" || status === "PENDING") return move("EXPIRED", "PROVIDER_CANCELLED");
      if (isSuccess(status) && attempt.provider === "MERCADOPAGO" && !isOtherMpPayment(attempt, outcome) && outcome.providerPaymentId) {
        return move("NEEDS_REVIEW", "PROVIDER_CANCELLED_AFTER_PAYMENT", "PROVIDER_CANCELLED_AFTER_PAYMENT");
      }
      return keep(attempt);

    case "ABORTED_BY_USER":
      return status === "PENDING" ? move("ABORTED", "ABORTED_BY_USER") : keep(attempt);
    case "FORM_TIMEOUT":
      return status === "PENDING" ? move("EXPIRED", "FORM_TIMEOUT") : keep(attempt);
    case "FORM_ERROR":
      return status === "PENDING" ? move("FAILED", "FORM_ERROR") : keep(attempt);

    case "COMMIT_REFUSED":
      return status === "COMMITTING" ? move("FAILED", "COMMIT_REFUSED") : keep(attempt);
    case "PROBE_REFUSED":
      return status === "COMMITTING" ? move("EXPIRED", "PROBE_REFUSED") : keep(attempt);
    case "COMMIT_UNCONFIRMED":
      return status === "COMMITTING" ? move("NEEDS_REVIEW", "COMMIT_UNCONFIRMED", "COMMIT_UNCONFIRMED") : keep(attempt);

    case "STATUS_WINDOW_CLOSING":
      return status === "PENDING" || status === "COMMITTING" ? move("NEEDS_REVIEW", "STATUS_WINDOW_CLOSING", "STATUS_WINDOW_CLOSING") : keep(attempt);
    case "STATUS_NOT_FOUND":
      if (status === "PENDING") return move("EXPIRED", "STATUS_NOT_FOUND");
      if (status === "COMMITTING") return move("NEEDS_REVIEW", "STATUS_NOT_FOUND", "STATUS_NOT_FOUND");
      return keep(attempt);

    case "CREATE_SUCCEEDED":
      return status === "CREATED" ? move("PENDING", "CREATE_SUCCEEDED") : keep(attempt);
    case "CREATE_FAILED":
    case "STALE_CREATED":
      return status === "CREATED" ? move("FAILED", kind) : keep(attempt);

    case "REFUNDED": {
      if (status === "NEEDS_REVIEW" || status === "REFUNDED") return keep(attempt);
      if (status === "PAID" || status === "PARTIALLY_REFUNDED") {
        const refunded = Math.max(Number(outcome.refundedAmountClp) || Number(attempt.amount_clp), Number(attempt.refunded_amount_clp) || 0);
        return move("REFUNDED", "PROVIDER_REFUNDED", null, { refundedAmountClp: refunded });
      }
      return move("NEEDS_REVIEW", "REFUND_WITHOUT_PAYMENT", "REFUND_WITHOUT_PAYMENT");
    }
    case "PARTIALLY_REFUNDED": {
      if (status === "NEEDS_REVIEW" || status === "REFUNDED") return keep(attempt);
      const refunded = Number(outcome.refundedAmountClp) || 0;
      if (status === "PAID") return move("PARTIALLY_REFUNDED", "PROVIDER_PARTIALLY_REFUNDED", null, { refundedAmountClp: refunded });
      if (status === "PARTIALLY_REFUNDED") {
        return refunded > (Number(attempt.refunded_amount_clp) || 0)
          ? move("PARTIALLY_REFUNDED", "PROVIDER_PARTIALLY_REFUNDED", null, { refundedAmountClp: refunded })
          : keep(attempt);
      }
      return move("NEEDS_REVIEW", "REFUND_WITHOUT_PAYMENT", "REFUND_WITHOUT_PAYMENT");
    }

    case "CHARGEBACK":
    case "DISPUTE":
      return review(attempt, kind);
    case "ANOMALY":
      return review(attempt, problems.length ? problems.join(",") : "ANOMALY", "ANOMALY");

    case "UNKNOWN":
    case "FOREIGN_REFERENCE":
      return keep(attempt, kind);

    case "RESOLVE": {
      if (!RESOLUTIONS.includes(outcome.resolution)) throw new Error(`Resolución inválida: ${outcome.resolution}`);
      if (status !== "NEEDS_REVIEW") return keep(attempt);
      // Reembolsado fuera del sistema (portal del proveedor): se registra el total.
      if (outcome.resolution === "REFUNDED") return move("REFUNDED", "ADMIN_RESOLUTION", null, { refundedAmountClp: Number(attempt.amount_clp) });
      if (outcome.resolution === "PAID") {
        // El pago se mantiene CON los reembolsos que ya tenía (p. ej. contracargo ganado tras un reembolso parcial).
        const refunded = Number(attempt.refunded_amount_clp) || 0;
        if (refunded >= Number(attempt.amount_clp)) return move("REFUNDED", "ADMIN_RESOLUTION");
        if (refunded > 0) return move("PARTIALLY_REFUNDED", "ADMIN_RESOLUTION");
      }
      return move(outcome.resolution, "ADMIN_RESOLUTION");
    }

    default:
      throw new Error(`Resultado sin regla: ${kind}`);
  }
}

/**
 * ¿Qué pasa con el destino si este intento queda PAID? (payments-design §5.4)
 * @returns {{ effect: 'PAY_AND_ADVANCE'|'PAY_ONLY'|'REVIVE' } | { review: string }}
 */
function paymentEffectFor(target, attempt) {
  let expected;
  try {
    expected = amountToCharge(target);
  } catch (err) {
    if (err && err.errorCode === "AMOUNT_INVALID") return { review: "AMOUNT_INVALID" };
    throw err;
  }
  if (Number(attempt.amount_clp) !== expected.amountClp) return { review: "AMOUNT_CHANGED" };

  const moneyStatus = target.kind === "ORDER" ? target.payment_status : target.deposit_status;
  if (moneyStatus === "PAID") return { review: "DUPLICATE_PAYMENT" };
  if (moneyStatus === "REFUNDED") return { review: "PAID_AFTER_REFUND" };
  if (target.status === "CANCELLED") {
    return target.cancellation_source === "PAYMENT_EXPIRED" ? { effect: "REVIVE" } : { review: "PAID_AFTER_ADMIN_CANCEL" };
  }
  if (target.status === "PENDING_PAYMENT") return { effect: "PAY_AND_ADVANCE" };
  return { effect: "PAY_ONLY" };
}

/**
 * Plan completo: transición del intento + efecto sobre la orden/torta.
 * @param {{ attempt:object, target:{kind:'ORDER'|'CAKE'}, outcome:object, now?:Date }} input
 * @returns {{ next:string, changed:boolean, reviewReason:string|null, reason:string,
 *             targetEffect:string, refundedAmountClp?:number, blockedReason?:string }}
 */
function planAttemptChange({ attempt, target, outcome, now = new Date() }) {
  const decision = decideAttemptTransition(attempt, outcome, { now });
  if (!decision.changed) return { ...decision, targetEffect: "NONE" };

  if (decision.next === "PAID") {
    // Este intento ya se reflejó en el destino (p. ej. revisión por contracargo
    // resuelta a favor): no hay nada que aplicar ni un "cobro duplicado".
    if (attempt.target_applied) return { ...decision, targetEffect: "NONE" };
    const effect = paymentEffectFor(target, attempt);
    if (effect.review) {
      if (outcome.kind === "RESOLVE") {
        return { ...keep(attempt, "RESOLUTION_BLOCKED"), blockedReason: effect.review, targetEffect: "NONE" };
      }
      return { ...review(attempt, effect.review, "TARGET_REVIEW"), targetEffect: "NONE" };
    }
    return { ...decision, targetEffect: effect.effect };
  }

  if (decision.next === "REFUNDED" && attempt.target_applied) {
    const moneyStatus = target.kind === "ORDER" ? target.payment_status : target.deposit_status;
    if (moneyStatus === "PAID") return { ...decision, targetEffect: "REFUND_TARGET" };
  }
  return { ...decision, targetEffect: "NONE" };
}

module.exports = {
  ATTEMPT_STATUSES,
  OPEN_STATUSES,
  FAILURE_STATUSES,
  SUCCESS_STATUSES,
  RESOLUTIONS,
  TARGET_EFFECTS,
  OUTCOME_KINDS,
  isOpen,
  isFailure,
  isSuccess,
  decideAttemptTransition,
  paymentEffectFor,
  planAttemptChange,
};
