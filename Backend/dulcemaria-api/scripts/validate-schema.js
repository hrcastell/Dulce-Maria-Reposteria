/**
 * Database Schema Validator
 * 
 * Valida que la base de datos tenga todas las tablas, columnas, índices y triggers
 * según el schema canonical.
 * 
 * Ejecutar: node scripts/validate-schema.js
 */

require("dotenv").config();
const { getPool } = require("../src/db");

const EXPECTED_SCHEMA = {
  tables: [
    {
      name: "users",
      columns: ["id", "email", "password_hash", "full_name", "role", "is_active", "created_at", "updated_at"],
    },
    {
      name: "products",
      columns: ["id", "name", "slug", "description", "price_clp", "stock_qty", "is_active", "created_at", "updated_at"],
    },
    {
      name: "customers",
      columns: ["id", "email", "full_name", "phone", "address", "notes", "created_at", "updated_at"],
    },
    {
      name: "orders",
      columns: ["id", "order_no", "customer_id", "status", "payment_status", "payment_method", "delivery_method", "subtotal_clp", "delivery_fee_clp", "total_clp", "created_at", "updated_at"],
    },
    {
      name: "order_items",
      columns: ["id", "order_id", "product_id", "product_name_snapshot", "unit_price_clp", "qty", "line_total_clp", "created_at"],
    },
    {
      name: "product_images",
      columns: ["id", "product_id", "url_original", "url_large", "url_thumb", "sort_order", "is_primary", "created_at"],
    },
  ],
  
  indexes: [
    "idx_users_email",
    "idx_users_role",
    "idx_users_is_active",
    "idx_products_slug",
    "idx_products_is_active",
    "idx_products_created_at",
    "idx_product_images_product_id",
    "idx_product_images_primary",
    "idx_customers_email_unique",
    "idx_orders_created_at",
    "idx_orders_customer",
    "idx_orders_status",
    "idx_orders_payment_status",
    "idx_order_items_order",
    "idx_order_items_product",
  ],
  
  triggers: [
    "trg_users_updated_at",
    "trg_products_updated_at",
    "trg_customers_updated_at",
    "trg_orders_updated_at",
  ],
};

async function validateSchema() {
  const pool = getPool();
  const issues = [];
  let allGood = true;

  console.log("🔍 Validating database schema...\n");

  // Validar tablas y columnas
  console.log("📋 Checking tables and columns:");
  for (const table of EXPECTED_SCHEMA.tables) {
    try {
      // Verificar si tabla existe
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = $1
        ) AS exists
      `, [table.name]);

      if (!tableCheck.rows[0].exists) {
        issues.push(`❌ Table missing: ${table.name}`);
        allGood = false;
        console.log(`   ❌ ${table.name} - MISSING`);
        continue;
      }

      // Verificar columnas
      const columnsCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
      `, [table.name]);

      const actualColumns = columnsCheck.rows.map(r => r.column_name);
      const missingColumns = table.columns.filter(col => !actualColumns.includes(col));

      if (missingColumns.length > 0) {
        issues.push(`❌ Table ${table.name} missing columns: ${missingColumns.join(", ")}`);
        allGood = false;
        console.log(`   ❌ ${table.name} - Missing columns: ${missingColumns.join(", ")}`);
      } else {
        console.log(`   ✅ ${table.name} - OK (${actualColumns.length} columns)`);
      }
    } catch (error) {
      issues.push(`❌ Error checking table ${table.name}: ${error.message}`);
      allGood = false;
      console.log(`   ❌ ${table.name} - ERROR: ${error.message}`);
    }
  }

  // Validar índices
  console.log("\n📇 Checking indexes:");
  for (const indexName of EXPECTED_SCHEMA.indexes) {
    try {
      const indexCheck = await pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = $1
        ) AS exists
      `, [indexName]);

      if (!indexCheck.rows[0].exists) {
        issues.push(`❌ Index missing: ${indexName}`);
        allGood = false;
        console.log(`   ❌ ${indexName} - MISSING`);
      } else {
        console.log(`   ✅ ${indexName} - OK`);
      }
    } catch (error) {
      issues.push(`❌ Error checking index ${indexName}: ${error.message}`);
      allGood = false;
      console.log(`   ❌ ${indexName} - ERROR`);
    }
  }

  // Validar triggers
  console.log("\n⚡ Checking triggers:");
  for (const triggerName of EXPECTED_SCHEMA.triggers) {
    try {
      const triggerCheck = await pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = $1
        ) AS exists
      `, [triggerName]);

      if (!triggerCheck.rows[0].exists) {
        issues.push(`❌ Trigger missing: ${triggerName}`);
        allGood = false;
        console.log(`   ❌ ${triggerName} - MISSING`);
      } else {
        console.log(`   ✅ ${triggerName} - OK`);
      }
    } catch (error) {
      issues.push(`❌ Error checking trigger ${triggerName}: ${error.message}`);
      allGood = false;
      console.log(`   ❌ ${triggerName} - ERROR`);
    }
  }

  // Validar función set_updated_at
  console.log("\n🔧 Checking functions:");
  try {
    const funcCheck = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'set_updated_at'
      ) AS exists
    `);

    if (!funcCheck.rows[0].exists) {
      issues.push(`❌ Function missing: set_updated_at`);
      allGood = false;
      console.log(`   ❌ set_updated_at - MISSING`);
    } else {
      console.log(`   ✅ set_updated_at - OK`);
    }
  } catch (error) {
    issues.push(`❌ Error checking function set_updated_at: ${error.message}`);
    allGood = false;
    console.log(`   ❌ set_updated_at - ERROR`);
  }

  // Resumen
  console.log("\n" + "=".repeat(60));
  if (allGood) {
    console.log("✅ SCHEMA VALIDATION PASSED");
    console.log("   All tables, columns, indexes, and triggers are present.");
  } else {
    console.log("❌ SCHEMA VALIDATION FAILED");
    console.log(`   Found ${issues.length} issue(s):\n`);
    issues.forEach(issue => console.log(`   ${issue}`));
    console.log("\n💡 Run migration to fix: node scripts/migrate-complete.js");
  }
  console.log("=".repeat(60));

  await pool.end();
  process.exit(allGood ? 0 : 1);
}

// Ejecutar validación
validateSchema().catch(error => {
  console.error("❌ Validation script failed:", error);
  process.exit(1);
});
