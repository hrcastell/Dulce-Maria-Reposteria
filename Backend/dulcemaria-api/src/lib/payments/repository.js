/**
 * SQL de pagos (payments, payment_events, payment_refunds). Cada función
 * recibe `db` (pool o el client de una transacción abierta).
 *
 * Coordinación sin memoria (varios procesos de Passenger):
 *   - claimCommit: UPDATE condicional PENDING → COMMITTING, una sola vez por
 *     intento (commit_attempts 0 → 1; además lo garantiza el CHECK
 *     payments_commit_once_check). Quien no obtiene la fila no llama al commit.
 *   - claimReconcileLease / claimDueAttempts: lease de conciliación de 2 min
 *     (FOR UPDATE SKIP LOCKED), sin mantener bloqueos durante el HTTP.
 *   - recordEvent con dedupe_key UNIQUE: un retorno o webhook repetido se
 *     cuenta (received_count) y no se reprocesa si ya tiene processed_at.
 */

const crypto = require("crypto");
const { OPEN_STATUSES } = require("./stateMachine");

const ATTEMPT_COLUMNS = `id, order_id, cake_order_id, attempt_no, provider, environment, status, amount_clp, currency,
  buy_order, session_id, client_request_id, provider_token, provider_preference_id, provider_payment_id, redirect_url,
  provider_status, provider_status_detail, response_code, authorization_code, card_last4, payment_type, payment_method_id,
  installments_number, installments_amount_clp, accounting_date, transaction_date, refunded_amount_clp, review_reason,
  target_applied, last_error, commit_started_at, commit_attempts, expires_at, next_reconcile_at, reconcile_attempts,
  reconcile_lease_until, last_reconciled_at, finalized_at, created_at, updated_at`;

// Columnas que applyOutcome / el flujo de creación pueden escribir.
const UPDATABLE = new Set([
  "status",
  "provider_token",
  "provider_preference_id",
  "provider_payment_id",
  "redirect_url",
  "provider_status",
  "provider_status_detail",
  "response_code",
  "authorization_code",
  "card_last4",
  "payment_type",
  "payment_method_id",
  "installments_number",
  "installments_amount_clp",
  "accounting_date",
  "transaction_date",
  "refunded_amount_clp",
  "review_reason",
  "target_applied",
  "provider_payload",
  "last_error",
  "next_reconcile_at",
  "finalized_at",
]);

function targetFilter(ref) {
  return ref.kind === "ORDER" ? "order_id" : "cake_order_id";
}

async function findAttemptById(db, id) {
  const r = await db.query(`SELECT ${ATTEMPT_COLUMNS} FROM payments WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

async function lockAttemptById(client, id) {
  const r = await client.query(`SELECT ${ATTEMPT_COLUMNS} FROM payments WHERE id = $1 FOR UPDATE`, [id]);
  return r.rows[0] || null;
}

async function findAttemptByProviderToken(db, token) {
  const r = await db.query(`SELECT ${ATTEMPT_COLUMNS} FROM payments WHERE provider = 'WEBPAY' AND provider_token = $1`, [token]);
  return r.rows[0] || null;
}

async function findAttemptByBuyOrder(db, buyOrder, provider) {
  const r = await db.query(`SELECT ${ATTEMPT_COLUMNS} FROM payments WHERE buy_order = $1 AND provider = $2`, [buyOrder, provider]);
  return r.rows[0] || null;
}

/** Intentos de un destino, en orden; con `lock` los bloquea (después de bloquear el destino). */
async function listAttemptsForTarget(db, ref, { lock = false } = {}) {
  const r = await db.query(
    `SELECT ${ATTEMPT_COLUMNS} FROM payments WHERE ${targetFilter(ref)} = $1 ORDER BY attempt_no${lock ? " FOR UPDATE" : ""}`,
    [ref.id]
  );
  return r.rows;
}

async function insertAttempt(client, a) {
  const r = await client.query(
    `INSERT INTO payments (
       id, order_id, cake_order_id, attempt_no, provider, environment, status, amount_clp, currency,
       buy_order, session_id, client_request_id, expires_at, next_reconcile_at
     ) VALUES ($1,$2,$3,$4,$5,$6,'CREATED',$7,'CLP',$8,$9,$10,$11,$12)
     RETURNING ${ATTEMPT_COLUMNS}`,
    [
      a.id,
      a.orderId || null,
      a.cakeOrderId || null,
      a.attemptNo,
      a.provider,
      a.environment,
      a.amountClp,
      a.buyOrder,
      a.sessionId,
      a.clientRequestId || null,
      a.expiresAt,
      a.nextReconcileAt,
    ]
  );
  return r.rows[0];
}

/** UPDATE condicional (estado actual) con columnas de una lista blanca. */
async function updateAttempt(client, id, fromStatus, fields) {
  const sets = [];
  const values = [id, fromStatus];
  for (const [column, value] of Object.entries(fields)) {
    if (!UPDATABLE.has(column)) throw new Error(`Columna no actualizable: ${column}`);
    values.push(column === "provider_payload" && value !== null ? JSON.stringify(value) : value);
    sets.push(`${column} = $${values.length}${column === "provider_payload" ? "::jsonb" : ""}`);
  }
  if (!sets.length) return null;
  const r = await client.query(`UPDATE payments SET ${sets.join(", ")} WHERE id = $1 AND status = $2 RETURNING ${ATTEMPT_COLUMNS}`, values);
  return r.rows[0] || null;
}

/** PENDING → COMMITTING, a lo más una vez por intento (Webpay). null = otro proceso lo tomó o ya no corresponde. */
async function claimCommit(db, id) {
  const r = await db.query(
    `UPDATE payments
     SET status = 'COMMITTING', commit_started_at = NOW(), commit_attempts = commit_attempts + 1,
         next_reconcile_at = NOW() + interval '30 seconds'
     WHERE id = $1 AND provider = 'WEBPAY' AND status = 'PENDING' AND commit_attempts = 0
     RETURNING ${ATTEMPT_COLUMNS}`,
    [id]
  );
  return r.rows[0] || null;
}

/** Lease de conciliación de un intento (2 min). `force` ignora next_reconcile_at, nunca un lease vigente. */
async function claimReconcileLease(db, id, { force = false } = {}) {
  const r = await db.query(
    `UPDATE payments
     SET reconcile_lease_until = NOW() + interval '2 minutes', reconcile_attempts = reconcile_attempts + 1
     WHERE id = $1
       AND (reconcile_lease_until IS NULL OR reconcile_lease_until < NOW())
       AND ($2::boolean OR (status = ANY($3::text[]) AND next_reconcile_at IS NOT NULL AND next_reconcile_at <= NOW()))
     RETURNING ${ATTEMPT_COLUMNS}`,
    [id, force, [...OPEN_STATUSES]]
  );
  return r.rows[0] || null;
}

/** Lote del conciliador: intentos abiertos vencidos para revisar, sin bloquear a otros procesos. */
async function claimDueAttempts(db, limit) {
  const r = await db.query(
    `UPDATE payments
     SET reconcile_lease_until = NOW() + interval '2 minutes', reconcile_attempts = reconcile_attempts + 1
     WHERE id IN (
       SELECT id FROM payments
       WHERE status = ANY($2::text[])
         AND next_reconcile_at IS NOT NULL AND next_reconcile_at <= NOW()
         AND (reconcile_lease_until IS NULL OR reconcile_lease_until < NOW())
       ORDER BY next_reconcile_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING ${ATTEMPT_COLUMNS}`,
    [limit, [...OPEN_STATUSES]]
  );
  return r.rows;
}

/** Libera el lease y agenda la próxima consulta (null = no volver a consultar). */
async function releaseLease(db, id, nextReconcileAt) {
  await db.query(
    `UPDATE payments
     SET reconcile_lease_until = NULL, last_reconciled_at = NOW(),
         next_reconcile_at = CASE WHEN status = ANY($3::text[]) THEN $2::timestamptz ELSE NULL END
     WHERE id = $1`,
    [id, nextReconcileAt, [...OPEN_STATUSES]]
  );
}

/** Reagenda la conciliación de un intento abierto (p. ej. commit ambiguo → 20 s). */
async function scheduleReconcile(db, id, at) {
  await db.query(`UPDATE payments SET next_reconcile_at = $2 WHERE id = $1 AND status = ANY($3::text[])`, [id, at, [...OPEN_STATUSES]]);
}

/**
 * Inserta un evento de pago. Con `dedupeKey`, uno repetido incrementa
 * received_count y devuelve el existente (`duplicate: true`).
 */
async function recordEvent(db, event) {
  const values = [
    crypto.randomUUID(),
    event.paymentId || null,
    event.orderId || null,
    event.cakeOrderId || null,
    event.provider,
    event.source,
    event.type,
    event.dedupeKey || null,
    event.from || null,
    event.to || null,
    event.signatureValid ?? null,
    event.httpStatus ?? null,
    event.payload ? JSON.stringify(event.payload) : null,
    event.error || null,
    event.processed ? new Date() : null,
    event.actorUserId || null,
  ];
  const r = await db.query(
    `INSERT INTO payment_events (
       id, payment_id, order_id, cake_order_id, provider, source, event_type, dedupe_key, from_status, to_status,
       signature_valid, http_status, payload, error, processed_at, actor_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16)
     ON CONFLICT (dedupe_key) DO UPDATE
       SET received_count = payment_events.received_count + 1, last_received_at = NOW()
     RETURNING id, processed_at, received_count, (xmax = 0) AS inserted`,
    values
  );
  const row = r.rows[0];
  return { id: row.id, processedAt: row.processed_at, receivedCount: Number(row.received_count), duplicate: !row.inserted };
}

async function markEventProcessed(db, id, { httpStatus = null, error = null, paymentId = null, orderId = null, cakeOrderId = null } = {}) {
  await db.query(
    `UPDATE payment_events
     SET processed_at = COALESCE(processed_at, NOW()), http_status = COALESCE($2, http_status), error = COALESCE($3, error),
         payment_id = COALESCE(payment_id, $4), order_id = COALESCE(order_id, $5), cake_order_id = COALESCE(cake_order_id, $6)
     WHERE id = $1`,
    [id, httpStatus, error, paymentId, orderId, cakeOrderId]
  );
}

// ---------------------------------------------------------------------------
// Reembolsos
// ---------------------------------------------------------------------------

const REFUND_COLUMNS = `id, payment_id, amount_clp, status, provider_refund_id, provider_type, reason, requested_by,
  client_request_id, error, created_at, updated_at, resolved_at`;

async function findRefundByClientRequestId(db, clientRequestId) {
  const r = await db.query(`SELECT ${REFUND_COLUMNS} FROM payment_refunds WHERE client_request_id = $1`, [clientRequestId]);
  return r.rows[0] || null;
}

async function lockRefund(client, id) {
  const r = await client.query(`SELECT ${REFUND_COLUMNS} FROM payment_refunds WHERE id = $1 FOR UPDATE`, [id]);
  return r.rows[0] || null;
}

async function findRefund(db, id) {
  const r = await db.query(`SELECT ${REFUND_COLUMNS} FROM payment_refunds WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

async function listOpenRefunds(db, paymentId) {
  const r = await db.query(`SELECT ${REFUND_COLUMNS} FROM payment_refunds WHERE payment_id = $1 AND status IN ('REQUESTED','UNKNOWN')`, [paymentId]);
  return r.rows;
}

async function insertRefund(client, { id, paymentId, amountClp, reason, requestedBy, clientRequestId }) {
  const r = await client.query(
    `INSERT INTO payment_refunds (id, payment_id, amount_clp, status, reason, requested_by, client_request_id)
     VALUES ($1,$2,$3,'REQUESTED',$4,$5,$6) RETURNING ${REFUND_COLUMNS}`,
    [id, paymentId, amountClp, reason, requestedBy || null, clientRequestId]
  );
  return r.rows[0];
}

async function updateRefund(client, id, { status, providerRefundId, providerType, payload, error }) {
  const r = await client.query(
    `UPDATE payment_refunds
     SET status = $2, provider_refund_id = COALESCE($3, provider_refund_id), provider_type = COALESCE($4, provider_type),
         provider_payload = COALESCE($5::jsonb, provider_payload), error = $6,
         resolved_at = CASE WHEN $2 IN ('SUCCEEDED','FAILED') THEN NOW() ELSE resolved_at END
     WHERE id = $1 RETURNING ${REFUND_COLUMNS}`,
    [id, status, providerRefundId || null, providerType || null, payload ? JSON.stringify(payload) : null, error || null]
  );
  return r.rows[0] || null;
}

module.exports = {
  ATTEMPT_COLUMNS,
  findAttemptById,
  lockAttemptById,
  findAttemptByProviderToken,
  findAttemptByBuyOrder,
  listAttemptsForTarget,
  insertAttempt,
  updateAttempt,
  claimCommit,
  claimReconcileLease,
  claimDueAttempts,
  releaseLease,
  scheduleReconcile,
  recordEvent,
  markEventProcessed,
  findRefundByClientRequestId,
  findRefund,
  lockRefund,
  listOpenRefunds,
  insertRefund,
  updateRefund,
};
