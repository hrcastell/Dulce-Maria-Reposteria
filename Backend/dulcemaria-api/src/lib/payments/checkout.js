/**
 * Casos de uso públicos: medios de pago, iniciar/reintentar un pago y estado
 * del pago por token de acceso (payments-design §6.1, §6.3, §6.7).
 *
 * Patrón (pool de 5 conexiones): transacción corta → HTTP al proveedor →
 * transacción corta. Nunca hay una llamada HTTP dentro de una transacción.
 */

const crypto = require("crypto");
const { getPool, withTransaction } = require("../../db");
const { appError, unavailableError, isUniqueViolation } = require("../httpErrors");
const { getSalesSettings, residentsOnlyErrorBody } = require("../salesSettings");
const runtime = require("./runtime");
const repo = require("./repository");
const targets = require("./targets");
const w = require("./window");
const { amountToCharge } = require("./amount");
const { newBuyOrder, isAccessToken } = require("./references");
const { checkTargetPayable } = require("./payability");
const { buildPublicStatus } = require("./publicView");
const { buildPreferenceBody } = require("./mercadopago/mapper");
const { ProviderHttpError } = require("./http");
const { applyOutcome } = require("./apply");
const { reconcileAttempt, expireTargetIfDue } = require("./reconciler");
const { isOpen } = require("./stateMachine");
const { getPaymentSettings, effectiveManualEnabled } = require("./settings");
const { PROVIDER_LABELS, MANUAL_METHOD_LABEL, PAYMENT_PROVIDERS } = require("./constants");
const { logPayment } = require("./log");

const MP_REUSE_MIN_REMAINING_MS = 2 * 60 * 1000;
const STALE_CHECK_MS = 2 * 60 * 1000;
const MAX_LAZY_RECONCILES = 2;

function notFound() {
  return appError(404, "ORDER_NOT_FOUND", "No encontramos el pedido. Revisa el enlace o escríbenos por WhatsApp.");
}

function publicEnvironment(id) {
  return runtime.getConfig().providers[id].environment;
}

/** GET /public/payments/methods */
async function listMethods() {
  const config = runtime.getConfig();
  const online = runtime.enabledProviders();
  const settings = await getPaymentSettings(getPool());
  return {
    online: online.map((id) => ({
      id,
      label: PROVIDER_LABELS[id],
      environment: publicEnvironment(id),
      test_mode: publicEnvironment(id) !== "production",
    })),
    manual: { enabled: effectiveManualEnabled(settings, online), label: MANUAL_METHOD_LABEL },
    payment_window_minutes: config.window.ttlMinutes,
  };
}

function actionFor(attempt) {
  if (attempt.provider === "WEBPAY") return { type: "POST_FORM", url: attempt.redirect_url, fields: { token_ws: attempt.provider_token } };
  return { type: "REDIRECT", url: attempt.redirect_url };
}

function publicAttempt(attempt) {
  return {
    id: attempt.id,
    attempt_no: attempt.attempt_no,
    provider: attempt.provider,
    status: attempt.status,
    amount_clp: Number(attempt.amount_clp),
    currency: "CLP",
    expires_at: attempt.expires_at instanceof Date ? attempt.expires_at.toISOString() : attempt.expires_at,
  };
}

function replayResponse(attempt) {
  if (attempt.status === "PENDING" && attempt.redirect_url && (attempt.provider_token || attempt.provider_preference_id)) {
    return { payment: publicAttempt(attempt), action: actionFor(attempt), replay: true };
  }
  if (attempt.status === "CREATED") {
    throw appError(409, "PAYMENT_IN_PROGRESS", "Estamos preparando tu pago; intenta de nuevo en unos segundos.");
  }
  throw appError(409, "ATTEMPT_FINISHED", "Ese intento de pago ya terminó. Vuelve a iniciar el pago.");
}

function itemTitle(target) {
  return target.kind === "ORDER" ? `Pedido Dulce María ${target.order_code || target.order_no}` : `Abono torta Dulce María ${target.order_number}`;
}

/** Transacción corta: valida y registra el intento (CREATED). Sin HTTP. */
async function prepareAttempt({ accessToken, provider, clientRequestId, client, providerCfg, now }) {
  const config = runtime.getConfig();
  return withTransaction(async (tx) => {
    const ref = await targets.findRefByToken(tx, accessToken);
    if (!ref) throw notFound();
    const target = await targets.lockTarget(tx, ref);
    const attempts = await repo.listAttemptsForTarget(tx, ref, { lock: true });

    if (clientRequestId) {
      const existing = attempts.find((a) => a.client_request_id === clientRequestId);
      if (existing) return { replay: existing };
    }

    const settings = await getSalesSettings(tx);
    const payable = checkTargetPayable({ target, attempts, now, maxAttempts: config.window.maxAttempts, salesMode: settings.sales_mode });
    if (!payable.ok) {
      if (payable.code === "RESIDENTS_ONLY") {
        const body = residentsOnlyErrorBody(settings);
        throw appError(403, body.code, body.error, { whatsapp_number: body.whatsapp_number });
      }
      return { refused: payable, ref };
    }

    const amount = amountToCharge(target);
    if (provider === "MERCADOPAGO") {
      // La preferencia vigente de MP se reutiliza (el comprador puede reintentar dentro del mismo checkout).
      const reusable = attempts.find(
        (a) =>
          a.provider === "MERCADOPAGO" &&
          a.status === "PENDING" &&
          a.redirect_url &&
          a.environment === client.environmentCode &&
          Number(a.amount_clp) === amount.amountClp &&
          new Date(a.expires_at).getTime() - now.getTime() > MP_REUSE_MIN_REMAINING_MS
      );
      if (reusable) return { replay: reusable };
    }

    const cap = w.paymentCap(target, config.window);
    const can = w.checkCanStart({ deadline: target.payment_expires_at, cap, provider, now });
    if (!can.ok) {
      return {
        refused: { ok: false, httpStatus: 410, code: can.code, error: "El plazo para pagar este pedido venció. Vuelve a armar tu pedido o escríbenos por WhatsApp." },
        ref,
      };
    }

    const expiresAt = w.attemptExpiresAt({ provider, environment: providerCfg.environment, now, cap });
    const attemptId = crypto.randomUUID();
    const attemptNo = attempts.reduce((max, a) => Math.max(max, Number(a.attempt_no)), 0) + 1;
    let inserted = null;
    for (let i = 0; i < 3 && !inserted; i++) {
      const buyOrder = newBuyOrder(ref.kind === "ORDER" ? { kind: "ORDER", orderNo: Number(target.order_no) } : { kind: "CAKE" });
      await tx.query("SAVEPOINT sp_payment_insert");
      try {
        inserted = await repo.insertAttempt(tx, {
          id: attemptId,
          ...targets.attemptColumnsFor(ref),
          attemptNo,
          provider,
          environment: client.environmentCode,
          amountClp: amount.amountClp,
          buyOrder,
          sessionId: attemptId,
          clientRequestId,
          expiresAt,
          nextReconcileAt: new Date(now.getTime() + STALE_CHECK_MS),
        });
        await tx.query("RELEASE SAVEPOINT sp_payment_insert");
      } catch (error) {
        await tx.query("ROLLBACK TO SAVEPOINT sp_payment_insert");
        if (!isUniqueViolation(error, "payments_buy_order_key")) throw error;
      }
    }
    if (!inserted) throw unavailableError("PAYMENT_START_FAILED", "No pudimos iniciar el pago. Intenta de nuevo en unos segundos.");

    const deadline = w.extendDeadline({ deadline: target.payment_expires_at, attemptExpiresAt: expiresAt, cap });
    if (deadline && target.payment_expires_at && deadline.getTime() !== new Date(target.payment_expires_at).getTime()) {
      await targets.setTargetDeadline(tx, target, deadline);
    }
    await repo.recordEvent(tx, {
      paymentId: attemptId,
      ...targets.attemptColumnsFor(ref),
      provider,
      source: "API_CALL",
      type: "ATTEMPT_CREATED",
      to: "CREATED",
      payload: { attempt_no: attemptNo, amount_clp: amount.amountClp, basis: amount.basis, expires_at: expiresAt.toISOString() },
      processed: true,
    });
    return { created: inserted, target, ref };
  });
}

/** Llama al proveedor fuera de toda transacción y deja el intento PENDING (o FAILED). */
async function createAtProvider(attempt, target, { provider, client, providerCfg, now }) {
  try {
    if (provider === "WEBPAY") {
      const created = await client.createTransaction({
        buyOrder: attempt.buy_order,
        sessionId: attempt.session_id,
        amountClp: Number(attempt.amount_clp),
        returnUrl: providerCfg.returnUrl,
      });
      return applyOutcome(
        attempt.id,
        { kind: "CREATE_SUCCEEDED", problems: [], sanitized: created.sanitized },
        {
          source: "API_CALL",
          eventType: "CHECKOUT_CREATED",
          fields: {
            provider_token: created.token,
            redirect_url: created.url,
            next_reconcile_at: w.initialReconcileAt({ provider, expiresAt: attempt.expires_at, now }),
          },
        }
      );
    }
    const body = buildPreferenceBody({
      paymentId: attempt.id,
      buyOrder: attempt.buy_order,
      amountClp: Number(attempt.amount_clp),
      title: itemTitle(target),
      apiPublicUrl: providerCfg.backUrlBase,
      now,
      expiresAt: new Date(attempt.expires_at),
      statementDescriptor: providerCfg.statementDescriptor,
      maxInstallments: providerCfg.maxInstallments,
    });
    const created = await client.createPreference(body);
    return applyOutcome(
      attempt.id,
      { kind: "CREATE_SUCCEEDED", problems: [], sanitized: created.sanitized },
      {
        source: "API_CALL",
        eventType: "CHECKOUT_CREATED",
        fields: {
          provider_preference_id: created.preferenceId,
          redirect_url: created.initPoint,
          next_reconcile_at: w.initialReconcileAt({ provider, expiresAt: attempt.expires_at, now }),
        },
      }
    );
  } catch (error) {
    if (!(error instanceof ProviderHttpError)) throw error;
    // El cliente nunca recibió la URL: una transacción huérfana en el proveedor no se puede pagar.
    await applyOutcome(attempt.id, { kind: "CREATE_FAILED", problems: [] }, {
      source: "API_CALL",
      eventType: "CHECKOUT_FAILED",
      fields: { last_error: error.providerMessage || `${error.kind}${error.status ? ` (HTTP ${error.status})` : ""}` },
    });
    logPayment("payment.create_failed", { payment_id: attempt.id, provider, error: error.kind, http_status: error.status }, { level: "warn" });
    throw unavailableError("PROVIDER_UNAVAILABLE", "No pudimos conectar con el medio de pago. Intenta de nuevo en unos minutos o escríbenos por WhatsApp.");
  }
}

/**
 * POST /public/payments: inicia o reintenta el pago de una orden o torta.
 * El monto lo calcula el servidor (amountToCharge): total de la orden o abono de la torta.
 */
async function startPayment({ accessToken, provider, clientRequestId }) {
  if (!PAYMENT_PROVIDERS.includes(provider)) throw appError(400, "VALIDATION_ERROR", "Medio de pago inválido.");
  if (!runtime.isProviderEnabled(provider)) {
    throw unavailableError("PROVIDER_DISABLED", "Este medio de pago no está disponible en este momento. Elige otro o escríbenos por WhatsApp.");
  }
  if (!isAccessToken(accessToken)) throw notFound();
  const providerCfg = runtime.getConfig().providers[provider];
  const client = runtime.clientFor(provider);
  if (!client) throw unavailableError("PROVIDER_DISABLED", "Este medio de pago no está disponible en este momento.");
  const now = runtime.now();

  let prepared;
  try {
    prepared = await prepareAttempt({ accessToken, provider, clientRequestId, client, providerCfg, now });
  } catch (error) {
    // Doble envío simultáneo con el mismo client_request_id: gana uno; el otro lee
    // el ganador, solo si es de ESTE mismo pedido (nunca se entrega el intento de otro).
    if (clientRequestId && isUniqueViolation(error, "payments_client_request_id_key")) {
      const pool = getPool();
      const ref = await targets.findRefByToken(pool, accessToken);
      const r = await pool.query(`SELECT id, order_id, cake_order_id FROM payments WHERE client_request_id = $1`, [clientRequestId]);
      const winner = r.rows[0];
      const sameTarget = ref && winner && (ref.kind === "ORDER" ? winner.order_id === ref.id : winner.cake_order_id === ref.id);
      if (sameTarget) return replayResponse(await repo.findAttemptById(pool, winner.id));
      throw appError(409, "IDEMPOTENCY_CONFLICT", "Ese identificador de solicitud ya se usó en otro pago. Vuelve a intentar el pago.");
    }
    throw error;
  }

  if (prepared.replay) return replayResponse(prepared.replay);
  if (prepared.refused) {
    if (prepared.refused.code === "PAYMENT_WINDOW_EXPIRED") {
      try {
        await expireTargetIfDue(prepared.ref, { source: "API_CALL" });
      } catch (error) {
        logPayment("payment.expire_failed", { error: error?.code || error?.errorCode || "error" }, { level: "warn" });
      }
    }
    throw appError(prepared.refused.httpStatus, prepared.refused.code, prepared.refused.error);
  }

  const result = await createAtProvider(prepared.created, prepared.target, { provider, client, providerCfg, now });
  if (result.attempt.status !== "PENDING") {
    throw unavailableError("PROVIDER_UNAVAILABLE", "No pudimos iniciar el pago. Intenta de nuevo en unos minutos.");
  }
  return { payment: publicAttempt(result.attempt), action: actionFor(result.attempt), replay: false };
}

/**
 * POST /public/payments/status: estado sin datos personales + conciliación
 * perezosa (a lo más una consulta al proveedor por intento cada ≥ 30 s,
 * coordinada en la BD por next_reconcile_at y el lease).
 */
async function getPublicStatus({ accessToken }) {
  if (!isAccessToken(accessToken)) throw notFound();
  const pool = getPool();
  const ref = await targets.findRefByToken(pool, accessToken);
  if (!ref) throw notFound();
  const now = runtime.now();

  const before = await repo.listAttemptsForTarget(pool, ref);
  const due = before.filter((a) => isOpen(a.status) && a.next_reconcile_at && new Date(a.next_reconcile_at).getTime() <= now.getTime()).slice(-MAX_LAZY_RECONCILES);
  for (const attempt of due) {
    try {
      await reconcileAttempt(attempt.id, { source: "STATUS_POLL" });
    } catch (error) {
      logPayment("payment.lazy_reconcile_failed", { payment_id: attempt.id, error: error?.code || error?.errorCode || error?.kind || "error" }, { level: "warn" });
    }
  }
  try {
    await expireTargetIfDue(ref, { source: "STATUS_POLL" });
  } catch (error) {
    logPayment("payment.expire_failed", { error: error?.code || error?.errorCode || "error" }, { level: "warn" });
  }

  const target = await targets.loadTarget(pool, ref);
  if (!target) throw notFound();
  const attempts = await repo.listAttemptsForTarget(pool, ref);
  const items = await targets.loadTargetItems(pool, target);
  const settings = await getSalesSettings(pool);
  const payability = checkTargetPayable({
    target,
    attempts,
    now: runtime.now(),
    maxAttempts: runtime.getConfig().window.maxAttempts,
    salesMode: settings.sales_mode,
  });
  return buildPublicStatus({ target, items, attempts, providers: runtime.enabledProviders(), payability, now: runtime.now() });
}

module.exports = { listMethods, startPayment, getPublicStatus, actionFor, publicAttempt };
