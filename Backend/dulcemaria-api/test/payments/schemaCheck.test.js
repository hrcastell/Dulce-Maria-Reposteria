const test = require("node:test");
const assert = require("node:assert/strict");

const { PAYMENTS_SCHEMA_REQUIREMENTS, evaluatePaymentsSchema } = require("../../src/lib/payments/schemaCheck");

/** Hechos de una base sana construidos desde los propios requisitos. */
function healthyFacts() {
  const columns = new Map();
  for (const [table, cols] of Object.entries(PAYMENTS_SCHEMA_REQUIREMENTS.columns)) {
    columns.set(table, new Map(cols.map((c) => [c, { nullable: PAYMENTS_SCHEMA_REQUIREMENTS.nullable.some(([t, n]) => t === table && n === c) }])));
  }
  const indexes = new Map(
    PAYMENTS_SCHEMA_REQUIREMENTS.uniquePartialIndexes.map((name) => [name, `CREATE UNIQUE INDEX ${name} ON public.x USING btree (y) WHERE (y IS NOT NULL)`])
  );
  const constraints = new Map(
    Object.entries(PAYMENTS_SCHEMA_REQUIREMENTS.constraints).map(([name, { table, mustContain }]) => [name, { table, definition: `CHECK (${mustContain})` }])
  );
  return { columns, indexes, constraints, configKeys: new Set(["payments_manual_enabled"]), legacyTable: false };
}

test("una base con todo el esquema de pagos → ok, sin advertencias", () => {
  assert.deepEqual(evaluatePaymentsSchema(healthyFacts()), { ok: true, missing: [], warnings: [] });
});

test("faltan tablas o columnas → no ok, con el detalle", () => {
  const facts = healthyFacts();
  facts.columns.delete("payment_refunds");
  facts.columns.get("orders").delete("public_token");
  const result = evaluatePaymentsSchema(facts);
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("tabla payment_refunds"));
  assert.ok(result.missing.includes("columna orders.public_token"));
});

test("payments.order_id/cake_order_id deben admitir NULL (pagos de órdenes O de tortas)", () => {
  const facts = healthyFacts();
  facts.columns.get("payments").set("order_id", { nullable: false });
  const result = evaluatePaymentsSchema(facts);
  assert.equal(result.ok, false);
  assert.ok(result.missing.some((m) => /payments\.order_id/.test(m) && /NULL/.test(m)));
});

test("los índices de unicidad deben ser UNIQUE y parciales", () => {
  const facts = healthyFacts();
  facts.indexes.set("uq_payments_one_success_per_order", "CREATE INDEX uq_payments_one_success_per_order ON public.payments USING btree (order_id)");
  facts.indexes.delete("uq_orders_public_token");
  const result = evaluatePaymentsSchema(facts);
  assert.equal(result.ok, false);
  assert.ok(result.missing.some((m) => /uq_payments_one_success_per_order/.test(m)));
  assert.ok(result.missing.some((m) => /uq_orders_public_token/.test(m)));
});

test("restricciones clave con su definición (commit una sola vez, destino único)", () => {
  const facts = healthyFacts();
  facts.constraints.set("payments_commit_once_check", { table: "payments", definition: "CHECK (commit_attempts >= 0)" });
  facts.constraints.delete("payments_target_check");
  const result = evaluatePaymentsSchema(facts);
  assert.equal(result.ok, false);
  assert.ok(result.missing.some((m) => /payments_commit_once_check/.test(m)));
  assert.ok(result.missing.some((m) => /payments_target_check/.test(m)));
});

test("advertencias no bloqueantes: semilla del flujo manual ausente y tabla heredada renombrada", () => {
  const facts = healthyFacts();
  facts.configKeys = new Set();
  facts.legacyTable = true;
  const result = evaluatePaymentsSchema(facts);
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 2);
});
