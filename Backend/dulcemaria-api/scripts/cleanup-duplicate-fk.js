/**
 * Cleanup de FOREIGN KEY duplicadas
 *
 * `ALTER TABLE ... ADD COLUMN IF NOT EXISTS col REFERENCES...` no es idempotente
 * para el constraint: si la columna ya existe, Postgres omite el ADD COLUMN pero
 * igual reintenta agregar el FK con nombre auto-generado en cada boot de
 * complete.js. Este script deja un único constraint con el nombre canónico que
 * complete.js espera, para que el chequeo `IF NOT EXISTS (pg_constraint...)` lo
 * reconozca y no vuelva a acumular duplicados.
 *
 * Dry-run por defecto (solo reporta). Ejecutar con --apply para limpiar de verdad.
 *
 * Ejecutar: node scripts/cleanup-duplicate-fk.js [--apply]
 */

require("dotenv").config();
const { getPool } = require("../src/db");

const TARGETS = [
  {
    table: "order_items",
    column: "variant_id",
    refTable: "product_variants",
    refColumn: "id",
    onDelete: "SET NULL",
    canonicalName: "order_items_variant_id_fkey",
  },
  {
    table: "cake_orders",
    column: "theme_option_id",
    refTable: "cake_config_option",
    refColumn: "id",
    onDelete: null,
    canonicalName: "cake_orders_theme_option_id_fkey",
  },
  {
    table: "expense_records",
    column: "provider_id",
    refTable: "providers",
    refColumn: "id",
    onDelete: "SET NULL",
    canonicalName: "expense_records_provider_id_fkey",
  },
];

async function findDuplicateConstraints(client, table, column) {
  const { rows: existsRows } = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [table]
  );
  if (!existsRows[0].exists) return null; // tabla no existe todavía (ej: feature no desplegada)

  const { rows } = await client.query(
    `SELECT c.conname
     FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE c.conrelid = $1::regclass
       AND c.contype = 'f'
       AND a.attname = $2
     ORDER BY c.conname`,
    [table, column]
  );
  return rows.map((r) => r.conname);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = getPool();
  const client = await pool.connect();

  console.log(apply ? "🔧 Modo APPLY: se van a limpiar los duplicados.\n" : "🔍 Modo DRY-RUN (sin --apply, no se modifica nada).\n");

  try {
    for (const t of TARGETS) {
      const found = await findDuplicateConstraints(client, t.table, t.column);

      if (found === null) {
        console.log(`⏭️  ${t.table}.${t.column} — tabla no existe, se omite.`);
        continue;
      }

      console.log(`📋 ${t.table}.${t.column} — ${found.length} constraint(s) FK encontrado(s):`);
      found.forEach((name) => console.log(`   - ${name}`));

      if (found.length <= 1 && found[0] === t.canonicalName) {
        console.log(`   ✅ Ya está limpio (nombre canónico único).\n`);
        continue;
      }

      if (!apply) {
        console.log(`   ⚠️  Se limpiarían con --apply (se dejaría solo "${t.canonicalName}").\n`);
        continue;
      }

      await client.query("BEGIN");
      try {
        for (const conname of found) {
          await client.query(`ALTER TABLE ${t.table} DROP CONSTRAINT ${client.escapeIdentifier(conname)}`);
        }
        const onDeleteClause = t.onDelete ? ` ON DELETE ${t.onDelete}` : "";
        await client.query(
          `ALTER TABLE ${t.table} ADD CONSTRAINT ${t.canonicalName}
             FOREIGN KEY (${t.column}) REFERENCES ${t.refTable}(${t.refColumn})${onDeleteClause}`
        );
        await client.query("COMMIT");
        console.log(`   ✅ Limpiado: ${found.length} → 1 ("${t.canonicalName}").\n`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`   ❌ Falló la limpieza de ${t.table}.${t.column}, se hizo rollback: ${err.message}\n`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log(apply ? "Listo." : "Dry-run terminado. Correr de nuevo con --apply para aplicar los cambios.");
}

main().catch((error) => {
  console.error("❌ Script falló:", error);
  process.exit(1);
});
