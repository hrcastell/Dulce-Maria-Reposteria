require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error("Falta DATABASE_URL en el panel.");

  const sql = fs.readFileSync(path.join(__dirname, "..", "sql", "schema.sql"), "utf-8");
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    await pool.query(sql);
    console.log("✅ Tablas creadas.");
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
