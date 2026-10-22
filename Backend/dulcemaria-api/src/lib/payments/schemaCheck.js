/**
 * Verificación del esquema de pagos (payments-design §4.6).
 *
 * El runner de migraciones es tolerante en producción: una sentencia de pagos
 * que falle no detiene el arranque. Por eso, al arrancar, se verifica que el
 * esquema de pagos esté completo y correcto; si no, los pagos en línea quedan
 * DESHABILITADOS (la tienda sigue vendiendo por WhatsApp) y se registra el
 * motivo. `npm run db:validate` usa la misma verificación.
 *
 * Además de los nombres (que ya revisa el manifiesto de complete.js), revisa
 * semántica que el manifiesto no ve: columnas que deben admitir NULL, índices
 * que deben ser UNIQUE y parciales, y la definición de restricciones clave.
 */

const PAYMENTS_SCHEMA_REQUIREMENTS = Object.freeze({
  columns: Object.freeze({
    payments: [
      "id", "order_id", "cake_order_id", "attempt_no", "provider", "environment", "status", "amount_clp", "currency", "buy_order",
      "session_id", "client_request_id", "provider_token", "provider_preference_id", "provider_payment_id", "redirect_url",
      "provider_status", "provider_status_detail", "response_code", "authorization_code", "card_last4", "payment_type",
      "payment_method_id", "installments_number", "installments_amount_clp", "accounting_date", "transaction_date",
      "refunded_amount_clp", "review_reason", "target_applied", "provider_payload", "last_error", "commit_started_at",
      "commit_attempts", "expires_at", "next_reconcile_at", "reconcile_attempts", "reconcile_lease_until", "last_reconciled_at",
      "finalized_at", "created_at", "updated_at",
    ],
    payment_events: [
      "id", "payment_id", "order_id", "cake_order_id", "provider", "source", "event_type", "dedupe_key", "from_status", "to_status",
      "signature_valid", "http_status", "payload", "error", "received_count", "processed_at", "actor_user_id", "created_at", "last_received_at",
    ],
    payment_refunds: [
      "id", "payment_id", "amount_clp", "status", "provider_refund_id", "provider_type", "reason", "requested_by", "client_request_id",
      "provider_payload", "error", "created_at", "updated_at", "resolved_at",
    ],
    orders: [
      "payment_provider", "public_token", "payment_expires_at", "channel", "stock_reservation_status", "cancellation_source",
      "client_request_id", "paid_at", "residency_declared_at", "payment_link_created_at",
    ],
    cake_orders: [
      "payment_method", "payment_provider", "public_token", "payment_expires_at", "payment_link_created_at", "deposit_status", "deposit_paid_at",
      "deposit_payment_method", "balance_status", "balance_paid_at", "balance_payment_method", "balance_amount_clp",
      "cancellation_source", "client_request_id", "residency_declared_at",
    ],
  }),
  nullable: Object.freeze([
    ["payments", "order_id"],
    ["payments", "cake_order_id"],
  ]),
  uniquePartialIndexes: Object.freeze([
    "uq_payments_one_success_per_order",
    "uq_payments_one_success_per_cake_order",
    "uq_payments_order_attempt",
    "uq_payments_cake_order_attempt",
    "uq_orders_public_token",
    "uq_cake_orders_public_token",
    "uq_payment_refunds_one_open",
  ]),
  constraints: Object.freeze({
    payments_target_check: { table: "payments", mustContain: "num_nonnulls" },
    payments_commit_once_check: { table: "payments", mustContain: "commit_attempts <= 1" },
    payments_status_check: { table: "payments", mustContain: "NEEDS_REVIEW" },
    payments_buy_order_key: { table: "payments", mustContain: "UNIQUE" },
    payments_provider_token_key: { table: "payments", mustContain: "UNIQUE" },
    payment_events_dedupe_key_key: { table: "payment_events", mustContain: "UNIQUE" },
    payment_refunds_client_request_id_key: { table: "payment_refunds", mustContain: "UNIQUE" },
  }),
});

/**
 * Evalúa los hechos leídos de la base (función pura).
 * facts = { columns: Map<tabla, Map<col, {nullable}>>, indexes: Map<nombre, indexdef>,
 *           constraints: Map<nombre, {table, definition}>, configKeys: Set, legacyTable: boolean }
 */
function evaluatePaymentsSchema(facts) {
  const missing = [];
  const warnings = [];
  const req = PAYMENTS_SCHEMA_REQUIREMENTS;

  for (const [table, columns] of Object.entries(req.columns)) {
    const actual = facts.columns.get(table);
    if (!actual) {
      missing.push(`tabla ${table}`);
      continue;
    }
    for (const column of columns) if (!actual.has(column)) missing.push(`columna ${table}.${column}`);
  }
  for (const [table, column] of req.nullable) {
    const info = facts.columns.get(table)?.get(column);
    if (info && !info.nullable) missing.push(`la columna ${table}.${column} debe admitir NULL (pagos de órdenes o de tortas)`);
  }
  for (const name of req.uniquePartialIndexes) {
    const def = facts.indexes.get(name);
    if (!def) missing.push(`índice ${name}`);
    else if (!/^CREATE UNIQUE INDEX/i.test(def) || !/\sWHERE\s/i.test(def)) missing.push(`el índice ${name} debe ser UNIQUE y parcial`);
  }
  for (const [name, { table, mustContain }] of Object.entries(req.constraints)) {
    const found = facts.constraints.get(name);
    if (!found || found.table !== table) missing.push(`restricción ${name} (${table})`);
    else if (!String(found.definition).includes(mustContain)) missing.push(`la restricción ${name} no tiene la definición esperada`);
  }
  if (!facts.configKeys.has("payments_manual_enabled")) {
    warnings.push("Falta system_config.payments_manual_enabled: se usa el valor por defecto (flujo manual activo).");
  }
  if (facts.legacyTable) {
    warnings.push("Existe la tabla payments_legacy (tabla payments heredada de los scripts sql antiguos): revísala y bórrala cuando ya no sirva.");
  }
  return { ok: missing.length === 0, missing, warnings };
}

/** Lee los hechos del esquema de pagos (pool o client). */
async function readPaymentsSchemaFacts(db) {
  const tables = Object.keys(PAYMENTS_SCHEMA_REQUIREMENTS.columns);
  const cols = await db.query(
    `SELECT table_name, column_name, is_nullable FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
    [tables]
  );
  const columns = new Map();
  for (const row of cols.rows) {
    if (!columns.has(row.table_name)) columns.set(row.table_name, new Map());
    columns.get(row.table_name).set(row.column_name, { nullable: row.is_nullable === "YES" });
  }
  const idx = await db.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ANY($1::text[])`, [
    [...PAYMENTS_SCHEMA_REQUIREMENTS.uniquePartialIndexes],
  ]);
  const indexes = new Map(idx.rows.map((row) => [row.indexname, row.indexdef]));
  const con = await db.query(
    `SELECT c.conname, r.relname, pg_get_constraintdef(c.oid) AS definition
     FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = current_schema() AND c.conname = ANY($1::text[])`,
    [Object.keys(PAYMENTS_SCHEMA_REQUIREMENTS.constraints)]
  );
  const constraints = new Map(con.rows.map((row) => [row.conname, { table: row.relname, definition: row.definition }]));
  let configKeys = new Set();
  try {
    const cfg = await db.query(`SELECT key FROM system_config WHERE key = 'payments_manual_enabled'`);
    configKeys = new Set(cfg.rows.map((row) => row.key));
  } catch {
    configKeys = new Set();
  }
  const legacy = await db.query(`SELECT to_regclass('payments_legacy') IS NOT NULL AS present`);
  return { columns, indexes, constraints, configKeys, legacyTable: Boolean(legacy.rows[0]?.present) };
}

async function checkPaymentsSchema(db) {
  return evaluatePaymentsSchema(await readPaymentsSchemaFacts(db));
}

module.exports = { PAYMENTS_SCHEMA_REQUIREMENTS, evaluatePaymentsSchema, readPaymentsSchemaFacts, checkPaymentsSchema };
