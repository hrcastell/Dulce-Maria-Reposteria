require("dotenv").config();
const express = require("express");
const { runCompleteMigrations } = require("../src/migrations/complete");

const app = express();

app.get("/run-migrations-now", async (req, res) => {
  if (req.query.token !== process.env.BOOTSTRAP_TOKEN) {
    return res.status(403).send("Forbidden");
  }
  try {
    await runCompleteMigrations();
    res.send("✅ MIGRACIONES COMPLETADAS — tablas: product_variants, supplies, expense_records, cake_config_category, cake_config_option, cake_orders");
  } catch (e) {
    res.status(500).send("❌ ERROR: " + e.message + "\n\n" + e.stack);
  }
});

app.listen(3002, () => console.log("Migration helper listo"));