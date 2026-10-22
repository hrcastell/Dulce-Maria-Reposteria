const test = require("node:test");
const assert = require("node:assert/strict");

const { buildMigrationStatements } = require("../src/migrations/complete");
const { extractSchemaManifest, normalizeSql } = require("../src/migrations/schemaTools");

const statements = buildMigrationStatements();
const manifest = extractSchemaManifest(statements);
const allSql = statements.map(normalizeSql).join("\n");

test("el esquema define la auditoría de órdenes (order_events)", () => {
  const columns = manifest.tables.get("order_events");
  assert.ok(columns, "falta la tabla order_events");
  for (const column of ["id", "order_id", "cake_order_id", "event_type", "from_value", "to_value", "actor_user_id", "actor_email", "actor_role", "source", "data", "created_at"]) {
    assert.ok(columns.has(column), `falta order_events.${column}`);
  }
  assert.ok(manifest.constraints.has("order_events_target_check"));
  assert.ok(manifest.indexes.has("idx_order_events_order"));
  assert.ok(manifest.indexes.has("idx_order_events_cake_order"));
});

test("orders gana las columnas del dominio de pedidos y de residentes", () => {
  const columns = manifest.tables.get("orders");
  for (const column of [
    "stock_reservation_status",
    "cancellation_source",
    "client_request_id",
    "residency_unit",
    "residency_declared_at",
    "delivery_address",
    "delivery_date",
    "notes",
    "contact_email",
    "paid_at",
  ]) {
    assert.ok(columns.has(column), `falta orders.${column}`);
  }
  for (const column of ["client_request_id", "residency_unit", "residency_declared_at", "delivery_date"]) {
    assert.ok(manifest.tables.get("cake_orders").has(column), `falta cake_orders.${column}`);
  }
  assert.ok(manifest.tables.get("customers").has("source"));
  assert.ok(manifest.tables.get("users").has("permissions_configured_at"));
});

test("restricciones de dominio: una sola lista de estados por tabla y montos no negativos", () => {
  assert.ok(manifest.constraints.has("orders_status_check_v3"));
  assert.equal(manifest.constraints.has("orders_status_check_v2"), false);
  assert.equal(manifest.constraints.has("orders_status_check"), false);
  for (const name of [
    "cake_orders_status_check",
    "orders_stock_reservation_status_check",
    "orders_cancellation_source_check",
    "orders_residency_check",
    "cake_orders_residency_check",
    "orders_money_nonneg",
    "order_items_money_nonneg",
    "cake_orders_money_nonneg",
    "supplies_stock_qty_nonneg",
    "customers_source_check",
  ]) {
    assert.ok(manifest.constraints.has(name), `falta la restricción ${name}`);
    assert.ok(manifest.mustBeValidated.has(name), `${name} debe validarse`);
  }
  assert.ok(manifest.mustBeValidated.has("orders_status_check_v3"));
});

test("índices únicos de idempotencia y de código de orden", () => {
  for (const name of ["uq_orders_client_request_id", "uq_cake_orders_client_request_id", "uq_orders_order_code", "idx_order_items_variant_id"]) {
    assert.ok(manifest.indexes.has(name), `falta el índice ${name}`);
  }
});

test("la configuración de venta se siembra de forma idempotente", () => {
  for (const key of ["sales_mode", "condo_name", "condo_address", "whatsapp_number"]) {
    assert.match(allSql, new RegExp(`INSERT INTO system_config \\(key, value\\) VALUES \\('${key}', '[^']+'\\) ON CONFLICT \\(key\\) DO NOTHING;`));
  }
});

test("el trigger de stock suma solo variantes activas", () => {
  const fn = statements.find((sql) => /CREATE OR REPLACE FUNCTION update_product_stock_from_variants/.test(sql));
  assert.match(normalizeSql(fn), /is_active/);
  const trigger = statements.find((sql) => /CREATE TRIGGER trg_update_stock_variants_insert_update/.test(sql));
  assert.match(normalizeSql(trigger), /UPDATE OF stock_qty, product_id, is_active/);
});

test("todo es compatible con PostgreSQL 10", () => {
  assert.equal(/gen_random_uuid\(/i.test(allSql), false);
  assert.equal(/CREATE TYPE/i.test(allSql), false);
  assert.equal(/ADD VALUE/i.test(allSql), false);
  assert.equal(/GENERATED ALWAYS AS \(/i.test(allSql), false);
  assert.equal(/EXECUTE FUNCTION/i.test(allSql), false);
});
