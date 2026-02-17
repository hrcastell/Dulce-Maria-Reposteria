/**
 * Script ejecutable de migración completa
 * 
 * Ejecutar: node scripts/migrate-complete.js
 */

require("dotenv").config();
const { runCompleteMigrations } = require("../src/migrations/complete");

console.log("🚀 Dulce María - Complete Database Migration");
console.log("=" .repeat(60));

runCompleteMigrations()
  .then(() => {
    console.log("=" .repeat(60));
    console.log("✅ Migration completed successfully!");
    console.log("\n💡 Next step: Run validation with 'node scripts/validate-schema.js'");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Migration failed:");
    console.error(error);
    process.exit(1);
  });
