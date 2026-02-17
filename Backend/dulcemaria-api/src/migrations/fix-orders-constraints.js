/**
 * Corrección de CHECK constraints en tabla orders
 * Elimina constraints viejos y crea nuevos con valores correctos
 */

const { getPool } = require("../db");

async function fixOrdersConstraints() {
  const pool = getPool();
  const statements = [];
  let applied = 0;

  console.log("🔧 Fixing orders CHECK constraints...");

  try {
    // 1. Eliminar constraints viejos si existen
    const dropConstraints = [
      `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check`,
      `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check`,
      `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check`,
      `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_delivery_method_check`,
    ];

    for (const sql of dropConstraints) {
      try {
        await pool.query(sql);
        statements.push({ sql, success: true });
        applied++;
        console.log(`✅ Dropped old constraint`);
      } catch (e) {
        statements.push({ sql, success: false, error: e.message });
        console.log(`⚠️  Constraint might not exist: ${e.message}`);
      }
    }

    // 2. Crear constraints nuevos con valores correctos
    const createConstraints = [
      {
        name: "orders_status_check",
        sql: `ALTER TABLE orders ADD CONSTRAINT orders_status_check 
              CHECK (status IN ('PENDING_CONFIRMATION','CONFIRMED','PREPARING','READY','DELIVERED','CANCELLED'))`
      },
      {
        name: "orders_payment_status_check",
        sql: `ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check 
              CHECK (payment_status IN ('PENDING','PAID','FAILED','REFUNDED'))`
      },
      {
        name: "orders_payment_method_check",
        sql: `ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check 
              CHECK (payment_method IN ('TRANSFER','CASH','ONLINE'))`
      },
      {
        name: "orders_delivery_method_check",
        sql: `ALTER TABLE orders ADD CONSTRAINT orders_delivery_method_check 
              CHECK (delivery_method IN ('PICKUP','DELIVERY'))`
      }
    ];

    for (const constraint of createConstraints) {
      try {
        await pool.query(constraint.sql);
        statements.push({ sql: constraint.sql, success: true });
        applied++;
        console.log(`✅ Created constraint: ${constraint.name}`);
      } catch (e) {
        statements.push({ sql: constraint.sql, success: false, error: e.message });
        console.log(`❌ Failed to create ${constraint.name}: ${e.message}`);
      }
    }

    console.log(`\n✅ Orders constraints fixed: ${applied} operations completed`);

    return {
      success: true,
      applied,
      total: dropConstraints.length + createConstraints.length,
      statements
    };

  } catch (error) {
    console.error("❌ Error fixing constraints:", error);
    throw error;
  }
}

module.exports = { fixOrdersConstraints };
