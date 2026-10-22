const test = require("node:test");
const assert = require("node:assert/strict");

const { buildMigrationStatements } = require("../../src/migrations/complete");
const { extractSchemaManifest, normalizeSql } = require("../../src/migrations/schemaTools");

const statements = buildMigrationStatements();
const manifest = extractSchemaManifest(statements);
const allSql = statements.map(normalizeSql).join("\n");

test("tablas de pagos con sus columnas clave", () => {
  const payments = manifest.tables.get("payments");
  assert.ok(payments, "falta payments");
  for (const column of [
    "id", "order_id", "cake_order_id", "attempt_no", "provider", "environment", "status", "amount_clp", "currency", "buy_order",
    "session_id", "client_request_id", "provider_token", "provider_preference_id", "provider_payment_id", "redirect_url",
    "response_code", "authorization_code", "card_last4", "payment_type", "refunded_amount_clp", "review_reason", "target_applied",
    "provider_payload", "last_error", "commit_started_at", "commit_attempts", "expires_at", "next_reconcile_at",
    "reconcile_attempts", "reconcile_lease_until", "finalized_at",
  ]) {
    assert.ok(payments.has(column), `falta payments.${column}`);
  }
  for (const column of ["payment_id", "order_id", "cake_order_id", "provider", "source", "event_type", "dedupe_key", "signature_valid", "payload", "received_count", "processed_at"]) {
    assert.ok(manifest.tables.get("payment_events").has(column), `falta payment_events.${column}`);
  }
  for (const column of ["payment_id", "amount_clp", "status", "provider_refund_id", "provider_type", "reason", "requested_by", "client_request_id"]) {
    assert.ok(manifest.tables.get("payment_refunds").has(column), `falta payment_refunds.${column}`);
  }
});

test("columnas de pago en línea en orders y en cake_orders (abono/saldo, D1)", () => {
  for (const column of ["payment_provider", "public_token", "payment_expires_at", "channel"]) {
    assert.ok(manifest.tables.get("orders").has(column), `falta orders.${column}`);
  }
  for (const column of [
    "payment_method", "payment_provider", "public_token", "payment_expires_at", "deposit_status", "deposit_paid_at",
    "deposit_payment_method", "balance_status", "balance_paid_at", "balance_payment_method", "balance_amount_clp", "cancellation_source",
  ]) {
    assert.ok(manifest.tables.get("cake_orders").has(column), `falta cake_orders.${column}`);
  }
});

test("garantías en la base: un intento exitoso por destino, commit a lo más una vez, un reembolso abierto, destino único", () => {
  for (const index of [
    "uq_payments_one_success_per_order",
    "uq_payments_one_success_per_cake_order",
    "uq_payments_order_attempt",
    "uq_payments_cake_order_attempt",
    "idx_payments_reconcile",
    "uq_orders_public_token",
    "uq_cake_orders_public_token",
    "idx_orders_online_pending_expiry",
    "idx_cake_orders_online_pending_expiry",
    "uq_payment_refunds_one_open",
  ]) {
    assert.ok(manifest.indexes.has(index), `falta el índice ${index}`);
  }
  for (const name of ["payments_target_check", "payments_commit_once_check", "payments_buy_order_key", "payments_provider_token_key", "payment_events_dedupe_key_key", "payment_refunds_client_request_id_key"]) {
    assert.ok(manifest.constraints.has(name), `falta la restricción ${name}`);
  }
  assert.match(allSql, /CONSTRAINT payments_target_check CHECK \(num_nonnulls\(order_id, cake_order_id\) = 1\)/);
  assert.match(allSql, /CONSTRAINT payments_commit_once_check CHECK \(commit_attempts BETWEEN 0 AND 1\)/);
  assert.match(allSql, /uq_payments_one_success_per_order ON payments\(order_id\) WHERE order_id IS NOT NULL AND status IN \('PAID','PARTIALLY_REFUNDED','REFUNDED'\)/);
  assert.ok(manifest.triggers.has("trg_payments_updated_at"));
  assert.ok(manifest.triggers.has("trg_payment_refunds_updated_at"));
});

test("las restricciones nuevas sobre tablas existentes se agregan NOT VALID y se validan aparte", () => {
  for (const name of [
    "orders_payment_provider_check",
    "orders_public_token_format",
    "orders_channel_check",
    "cake_orders_payment_method_check",
    "cake_orders_deposit_status_check",
    "cake_orders_balance_status_check",
    "cake_orders_cancellation_source_check",
  ]) {
    assert.ok(manifest.constraints.has(name), `falta ${name}`);
    assert.ok(manifest.mustBeValidated.has(name), `${name} debe validarse`);
  }
});

test("la tabla payments heredada de los scripts sql/*.sql se renombra antes de crear la canónica", () => {
  const renameIndex = statements.findIndex((sql) => /RENAME TO payments_legacy/.test(sql));
  const createIndex = statements.findIndex((sql) => /CREATE TABLE IF NOT EXISTS payments \(/.test(sql));
  assert.ok(renameIndex >= 0, "falta el renombre de la tabla heredada");
  assert.ok(renameIndex < createIndex, "el renombre debe ir antes de crear la tabla");
  assert.match(normalizeSql(statements[renameIndex]), /column_name = 'buy_order'/);
});

test("el flujo manual se siembra activo y todo sigue siendo compatible con PostgreSQL 10", () => {
  assert.match(allSql, /INSERT INTO system_config \(key, value\) VALUES \('payments_manual_enabled', 'true'\) ON CONFLICT \(key\) DO NOTHING;/);
  assert.equal(/gen_random_uuid\(/i.test(allSql), false);
  assert.equal(/CREATE TYPE/i.test(allSql), false);
  assert.equal(/GENERATED ALWAYS AS \(/i.test(allSql), false);
  assert.equal(/EXECUTE FUNCTION/i.test(allSql), false);
  assert.equal(/ADD CONSTRAINT IF NOT EXISTS/i.test(allSql), false);
  assert.equal(/CREATE PROCEDURE/i.test(allSql), false);
});
