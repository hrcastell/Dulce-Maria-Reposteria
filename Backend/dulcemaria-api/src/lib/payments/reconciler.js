/**
 * Conciliación y vencimiento (payments-design §8.3, §8.4).
 *
 *   reconcileAttempt(id)   consulta al proveedor un intento (lease de 2 min;
 *                          nunca mantiene bloqueos de BD durante el HTTP).
 *   runReconcileBatch()    lote del cron (CLI o disparador HTTP): intentos
 *                          vencidos de revisar → órdenes/tortas vencidas.
 *   expireTargetIfDue(ref) vence una orden/torta en línea impaga y libera su
 *                          stock (origen SYSTEM), solo si TODOS sus intentos
 *                          terminaron en fracaso.
 *
 * Webpay: un intento PENDING nunca se confirma antes de su vencimiento (el
 * cliente puede seguir en el formulario). Después, el "commit de prueba"
 * (una sola vez por token) cubre al cliente que pagó y cerró la pestaña antes
 * del retorno. Mercado Pago: búsqueda por external_reference (webhook perdido).
 */

const { getPool, withTransaction } = require("../../db");
const { ProviderHttpError } = require("./http");
const { pickMpSearchOutcome } = require("./mercadopago/mapper");
const { statusErrorMeansNotFound } = require("./webpay/mapper");
const { applyOutcome } = require("./apply");
const { commitClaimed, lookupStatus, webpayClientFor } = require("./webpayFlow");
const repo = require("./repository");
const targets = require("./targets");
const runtime = require("./runtime");
const w = require("./window");
const { isOpen, isSuccess } = require("./stateMachine");
const { logPayment } = require("./log");

function mpExpected(attempt) {
  return { amountClp: Number(attempt.amount_clp), buyOrder: attempt.buy_order, liveMode: attempt.environment === "LIVE" };
}

async function reconcileWebpay(attempt, { source, force }) {
  const now = runtime.now();
  const client = webpayClientFor(attempt);
  if (!client) return { status: "PROVIDER_UNAVAILABLE" };

  if (attempt.status === "CREATED") {
    return w.isStaleCreated(attempt, now) ? applyOutcome(attempt.id, { kind: "STALE_CREATED", problems: [] }, { source }) : { status: "NOT_DUE" };
  }
  if (!attempt.provider_token) return { status: "NO_TOKEN" };

  const window = w.webpayStatusWindow(attempt, now);
  if (window === "CLOSED" && isOpen(attempt.status)) return applyOutcome(attempt.id, { kind: "STATUS_NOT_FOUND", problems: [] }, { source });
  if (window === "CLOSING" && isOpen(attempt.status)) return applyOutcome(attempt.id, { kind: "STATUS_WINDOW_CLOSING", problems: [] }, { source });

  const expiredAttempt = now.getTime() >= new Date(attempt.expires_at).getTime();
  if (attempt.status === "PENDING" && !expiredAttempt && !force) return { status: "NOT_DUE" };

  const { outcome, error } = await lookupStatus(attempt, client, source);
  if (error) {
    if (statusErrorMeansNotFound(error) && isOpen(attempt.status)) return applyOutcome(attempt.id, { kind: "STATUS_NOT_FOUND", problems: [] }, { source });
    // Credenciales, solicitud mala o caída: nada se sabe de la transacción → se reintenta.
    if (!error.ambiguous) logPayment("payment.status_rejected", { payment_id: attempt.id, provider: "WEBPAY", http_status: error.status, error: error.kind }, { level: "error" });
    return { status: "AMBIGUOUS" };
  }

  if (attempt.status === "PENDING") {
    if ((outcome.kind === "NOT_COMPLETED" || outcome.kind === "APPROVED") && expiredAttempt) {
      // Commit de prueba: el único commit que este token recibirá.
      const claimed = await repo.claimCommit(getPool(), attempt.id);
      return claimed ? commitClaimed(claimed, { source, probe: true }) : { status: "CLAIMED_ELSEWHERE" };
    }
    if (outcome.kind === "NOT_COMPLETED" || outcome.kind === "APPROVED") return applyOutcome(attempt.id, { ...outcome, kind: "UNKNOWN" }, { source });
    return applyOutcome(attempt.id, outcome, { source });
  }

  if (attempt.status === "COMMITTING") {
    if (outcome.kind === "NOT_COMPLETED") {
      return w.isCommitUnconfirmed(attempt, now)
        ? applyOutcome(attempt.id, { ...outcome, kind: "COMMIT_UNCONFIRMED" }, { source })
        : applyOutcome(attempt.id, { ...outcome, kind: "UNKNOWN" }, { source });
    }
    return applyOutcome(attempt.id, outcome, { source });
  }

  // Intento terminado (consulta forzada desde el panel): sincroniza reembolsos y
  // detecta anomalías. Una autorización sin commit registrado nunca se da por pagada.
  if (outcome.kind === "APPROVED" && Number(attempt.commit_attempts) === 0) {
    return applyOutcome(attempt.id, { ...outcome, kind: "ANOMALY", problems: ["AUTHORIZED_WITHOUT_COMMIT"] }, { source });
  }
  return applyOutcome(attempt.id, outcome, { source });
}

async function reconcileMercadoPago(attempt, { source }) {
  const now = runtime.now();
  const client = runtime.clientFor("MERCADOPAGO", { environmentCode: attempt.environment });
  if (!client) return { status: "PROVIDER_UNAVAILABLE" };
  if (attempt.status === "CREATED" && w.isStaleCreated(attempt, now)) {
    return applyOutcome(attempt.id, { kind: "STALE_CREATED", problems: [] }, { source });
  }
  let results;
  try {
    results = await client.searchByExternalReference(attempt.buy_order);
  } catch (error) {
    if (!(error instanceof ProviderHttpError)) throw error;
    await repo.recordEvent(getPool(), {
      paymentId: attempt.id,
      orderId: attempt.order_id,
      cakeOrderId: attempt.cake_order_id,
      provider: "MERCADOPAGO",
      source,
      type: "SEARCH_FAILED",
      httpStatus: error.status,
      error: error.providerMessage || error.kind,
      payload: { kind: error.kind, ambiguous: error.ambiguous },
    });
    return { status: "AMBIGUOUS" };
  }
  const outcome = pickMpSearchOutcome(results, mpExpected(attempt));
  if (outcome.kind === "NOT_COMPLETED" && now.getTime() < new Date(attempt.expires_at).getTime()) {
    return applyOutcome(attempt.id, { ...outcome, kind: "UNKNOWN" }, { source });
  }
  return applyOutcome(attempt.id, outcome, { source });
}

async function processLeased(attempt, { source, force = false }) {
  try {
    return attempt.provider === "WEBPAY" ? await reconcileWebpay(attempt, { source, force }) : await reconcileMercadoPago(attempt, { source, force });
  } finally {
    const fresh = await repo.findAttemptById(getPool(), attempt.id);
    const next =
      fresh && isOpen(fresh.status)
        ? w.nextReconcileAt({
            provider: fresh.provider,
            status: fresh.status,
            reconcileAttempts: fresh.reconcile_attempts,
            expiresAt: fresh.expires_at,
            now: runtime.now(),
          })
        : null;
    await repo.releaseLease(getPool(), attempt.id, next);
  }
}

/**
 * Concilia un intento. Sin `force` solo si le toca (next_reconcile_at) y está
 * abierto; con `force` (panel) aunque no le toque. Nunca pisa un lease vigente.
 */
async function reconcileAttempt(attemptId, { source = "RECONCILER", force = false } = {}) {
  const leased = await repo.claimReconcileLease(getPool(), attemptId, { force });
  if (!leased) return { skipped: true };
  const before = leased.status;
  const result = await processLeased(leased, { source, force });
  const after = await repo.findAttemptById(getPool(), attemptId);
  return { skipped: false, before, after: after?.status ?? before, result: result?.status || (result?.changed ? "CHANGED" : "UNCHANGED") };
}

/** Vence una orden/torta en línea impaga cuyo plazo pasó (si todos sus intentos fracasaron). */
async function expireTargetIfDue(ref, { source = "RECONCILER" } = {}) {
  const table = ref.kind === "ORDER" ? "orders" : "cake_orders";
  const outcome = await withTransaction(async (client) => {
    const due = await client.query(
      `SELECT id FROM ${table}
       WHERE id = $1 AND payment_method = 'ONLINE' AND status = 'PENDING_PAYMENT'
         AND payment_expires_at IS NOT NULL AND payment_expires_at < NOW()
       FOR UPDATE SKIP LOCKED`,
      [ref.id]
    );
    if (!due.rowCount) return { expired: false, reason: "NOT_DUE" };
    const target = await targets.lockTarget(client, ref);
    const money = target.kind === "ORDER" ? target.payment_status : target.deposit_status;
    if (money === "PAID") return { expired: false, reason: "ALREADY_PAID" };
    const attempts = await repo.listAttemptsForTarget(client, ref, { lock: true });
    if (attempts.some((a) => a.status === "NEEDS_REVIEW")) return { expired: false, reason: "UNDER_REVIEW" };
    if (attempts.some((a) => isOpen(a.status))) return { expired: false, reason: "OPEN_ATTEMPTS" };
    if (attempts.some((a) => isSuccess(a.status))) return { expired: false, reason: "PAID_ATTEMPT" };
    await targets.expireTarget(client, target);
    await repo.recordEvent(client, {
      ...targets.attemptColumnsFor(ref),
      provider: "SYSTEM",
      source,
      type: ref.kind === "ORDER" ? "ORDER_EXPIRED" : "CAKE_ORDER_EXPIRED",
      from: "PENDING_PAYMENT",
      to: "CANCELLED",
      payload: { attempts: attempts.length },
      processed: true,
    });
    return { expired: true };
  });
  if (outcome.expired) logPayment("payment.target_expired", { [ref.kind === "ORDER" ? "order_id" : "cake_order_id"]: ref.id, source });
  if (outcome.reason === "PAID_ATTEMPT") {
    logPayment("payment.inconsistency", { [ref.kind === "ORDER" ? "order_id" : "cake_order_id"]: ref.id, reason: "PAID_ATTEMPT_ON_PENDING_TARGET" }, { level: "error" });
  }
  return outcome;
}

async function expireDueTargets({ limit = 25 } = {}) {
  const pool = getPool();
  const orders = await pool.query(
    `SELECT id FROM orders WHERE payment_method = 'ONLINE' AND status = 'PENDING_PAYMENT'
       AND payment_expires_at IS NOT NULL AND payment_expires_at < NOW()
     ORDER BY payment_expires_at LIMIT $1`,
    [limit]
  );
  const cakes = await pool.query(
    `SELECT id FROM cake_orders WHERE payment_method = 'ONLINE' AND status = 'PENDING_PAYMENT'
       AND payment_expires_at IS NOT NULL AND payment_expires_at < NOW()
     ORDER BY payment_expires_at LIMIT $1`,
    [limit]
  );
  let expired = 0;
  let postponed = 0;
  let errors = 0;
  for (const ref of [...orders.rows.map((r) => ({ kind: "ORDER", id: r.id })), ...cakes.rows.map((r) => ({ kind: "CAKE", id: r.id }))]) {
    try {
      const outcome = await expireTargetIfDue(ref);
      if (outcome.expired) expired++;
      else postponed++;
    } catch (error) {
      errors++;
      logPayment("payment.expire_failed", { [ref.kind === "ORDER" ? "order_id" : "cake_order_id"]: ref.id, error: error?.code || error?.errorCode || "error" }, { level: "error" });
    }
  }
  return { expired, postponed, errors };
}

/** Lote completo (lo llama el CLI y el disparador HTTP, bajo el advisory lock). */
async function runReconcileBatch({ limit = 25 } = {}) {
  const startedAt = Date.now();
  const claimed = await repo.claimDueAttempts(getPool(), limit);
  let changed = 0;
  let errors = 0;
  for (const attempt of claimed) {
    try {
      const result = await processLeased(attempt, { source: "RECONCILER" });
      if (result?.changed) changed++;
    } catch (error) {
      errors++;
      logPayment("payment.reconcile_failed", { payment_id: attempt.id, provider: attempt.provider, error: error?.code || error?.errorCode || error?.kind || "error" }, { level: "error" });
    }
  }
  const expiry = await expireDueTargets({ limit });
  const summary = {
    reconciled: claimed.length,
    changed,
    reconcile_errors: errors,
    expired: expiry.expired,
    postponed: expiry.postponed,
    expire_errors: expiry.errors,
    duration_ms: Date.now() - startedAt,
  };
  logPayment("payment.reconcile_batch", { count: claimed.length, duration_ms: summary.duration_ms });
  return summary;
}

const RECONCILE_LOCK_NAME = "dm_payments_reconcile";

/** Ejecuta el lote bajo pg_try_advisory_lock en una conexión dedicada; si otro lo tiene, no hace nada. */
async function runReconcileBatchExclusive(options) {
  const client = await getPool().connect();
  let locked = false;
  try {
    const r = await client.query(`SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS ok`, [RECONCILE_LOCK_NAME]);
    locked = Boolean(r.rows[0]?.ok);
    if (!locked) return { ok: true, skipped: true, reason: "ALREADY_RUNNING" };
    return { ok: true, skipped: false, ...(await runReconcileBatch(options)) };
  } finally {
    let broken;
    if (locked) {
      try {
        await client.query(`SELECT pg_advisory_unlock(hashtext($1)::bigint)`, [RECONCILE_LOCK_NAME]);
      } catch (unlockError) {
        // Se descarta la conexión: el lock de sesión se libera con ella (nunca vuelve al pool tomada).
        broken = unlockError;
      }
    }
    client.release(broken);
  }
}

module.exports = {
  reconcileAttempt,
  processLeased,
  expireTargetIfDue,
  expireDueTargets,
  runReconcileBatch,
  runReconcileBatchExclusive,
  RECONCILE_LOCK_NAME,
};
