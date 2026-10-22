/**
 * Database Schema Validator
 *
 * Compara la base de datos con el esquema canónico de src/migrations/complete.js.
 * Lo esperado (tablas, columnas, índices, triggers, funciones y restricciones)
 * se deduce de las propias sentencias de complete.js, así que este chequeo
 * nunca queda desfasado del esquema real.
 *
 * Informa además el estado de la última aplicación (huella y fallos
 * persistentes en schema_migration_state) y verifica la semántica del esquema
 * de pagos que el manifiesto no ve (src/lib/payments/schemaCheck.js: columnas
 * que deben admitir NULL, índices UNIQUE parciales y restricciones clave).
 *
 * Ejecutar: npm run db:validate      (código de salida 1 si falta algo)
 */

require("dotenv").config();
const { getPool } = require("../src/db");
const { buildMigrationStatements } = require("../src/migrations/complete");
const {
  computeSchemaFingerprint,
  extractSchemaManifest,
  diffSchema,
} = require("../src/migrations/schemaTools");
const { checkPaymentsSchema } = require("../src/lib/payments/schemaCheck");

async function readActualSchema(pool) {
  const columns = new Map();
  const colRes = await pool.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`
  );
  for (const row of colRes.rows) {
    if (!columns.has(row.table_name)) columns.set(row.table_name, new Set());
    columns.get(row.table_name).add(row.column_name);
  }

  const idxRes = await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`);
  const indexes = new Set(idxRes.rows.map((row) => row.indexname));

  const trgRes = await pool.query(
    `SELECT t.tgname, c.relname
     FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal AND n.nspname = 'public'`
  );
  const triggers = new Map(trgRes.rows.map((row) => [row.tgname, { table: row.relname }]));

  const fnRes = await pool.query(
    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`
  );
  const functions = new Set(fnRes.rows.map((row) => row.proname));

  const conRes = await pool.query(
    `SELECT con.conname, con.contype, con.convalidated, rel.relname
     FROM pg_constraint con
     JOIN pg_class rel ON rel.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = rel.relnamespace
     WHERE n.nspname = 'public'`
  );
  const constraints = new Map(
    conRes.rows.map((row) => [row.conname, { table: row.relname, type: row.contype, validated: row.convalidated }])
  );

  return { columns, indexes, triggers, functions, constraints };
}

async function readMigrationState(pool) {
  const rel = await pool.query("SELECT to_regclass('public.schema_migration_state') AS rel");
  if (!rel.rows[0].rel) return null;
  const r = await pool.query("SELECT fingerprint, applied_at, failures FROM schema_migration_state WHERE id = 1");
  return r.rows[0] || null;
}

async function validateSchema() {
  const pool = getPool();
  const statements = buildMigrationStatements();
  const expected = extractSchemaManifest(statements);
  const fingerprint = computeSchemaFingerprint(statements);

  console.log("🔍 Validando el esquema de la base contra src/migrations/complete.js...\n");

  const actual = await readActualSchema(pool);
  const { missing, warnings } = diffSchema(expected, actual);
  const state = await readMigrationState(pool);
  const payments = await checkPaymentsSchema(pool);
  for (const item of payments.missing) if (!missing.includes(item)) missing.push(`[pagos] ${item}`);
  warnings.push(...payments.warnings.map((w) => `[pagos] ${w}`));
  console.log(`💳 Esquema de pagos en línea: ${payments.ok ? "completo" : "INCOMPLETO (los pagos en línea quedan deshabilitados)"}.`);

  const expectedColumns = [...expected.tables.values()].reduce((n, cols) => n + cols.size, 0);
  console.log(
    `📋 Esperado: ${expected.tables.size} tablas, ${expectedColumns} columnas, ${expected.indexes.size} índices, ` +
      `${expected.triggers.size} triggers, ${expected.functions.size} funciones, ${expected.constraints.size} restricciones.`
  );

  console.log("\n🧾 Estado de la última aplicación del esquema:");
  if (!state) {
    console.log("   ⚠️  No existe schema_migration_state: la API todavía no arrancó con esta versión.");
  } else {
    const current = state.fingerprint === fingerprint;
    console.log(
      `   ${current ? "✅" : "⚠️ "} Huella ${String(state.fingerprint).slice(0, 12)} aplicada el ${new Date(state.applied_at).toISOString()}` +
        (current ? " (coincide con el código actual)." : ` — el código actual es ${fingerprint.slice(0, 12)}: reinicia la API para aplicarlo.`)
    );
    const failures = Array.isArray(state.failures) ? state.failures : [];
    for (const failure of failures) {
      console.log(`   ❌ Sentencia fallida ${failure.id} [${failure.code || "sin código"}]: ${failure.message}`);
    }
  }

  if (warnings.length) {
    console.log("\n⚠️  Advertencias:");
    for (const warning of warnings) console.log(`   - ${warning}`);
  }

  const persistedFailures = Array.isArray(state?.failures) ? state.failures.length : 0;
  const ok = missing.length === 0 && persistedFailures === 0;

  console.log("\n" + "=".repeat(60));
  if (ok) {
    console.log("✅ VALIDACIÓN DEL ESQUEMA APROBADA");
    console.log("   Todas las tablas, columnas, índices, triggers, funciones y restricciones están presentes.");
  } else {
    console.log("❌ VALIDACIÓN DEL ESQUEMA FALLIDA");
    for (const item of missing) console.log(`   - Falta ${item}`);
    if (persistedFailures) console.log(`   - ${persistedFailures} sentencia(s) fallaron en la última aplicación (ver arriba).`);
    console.log("\n💡 El esquema se aplica solo al arrancar la API. Corrige la causa (datos heredados, permisos)");
    console.log("   y reinicia la API con MIGRATIONS_FORCE=true para re-aplicarlo (luego quita la variable).");
  }
  console.log("=".repeat(60));

  await pool.end();
  process.exit(ok ? 0 : 1);
}

validateSchema().catch(async (error) => {
  console.error("❌ El validador falló:", error?.message || error);
  process.exit(1);
});
