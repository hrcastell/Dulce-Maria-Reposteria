require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const { validateEnv } = require("./src/config/env");

const authRoutes = require("./src/routes/auth");
const publicCatalogRoutes = require("./src/routes/public.catalog");
const adminUsersRoutes = require("./src/routes/admin.users");
const adminProductsRoutes = require("./src/routes/admin.products");
const adminCustomersRoutes = require("./src/routes/admin.customers");
const adminOrdersRoutes = require("./src/routes/admin.orders");
const adminReportsRoutes = require("./src/routes/admin.reports");
const { runCompleteMigrations } = require("./src/migrations/complete");

const { requireAuth } = require("./src/middleware/auth");
const { publicApiLimiter, adminApiLimiter } = require("./src/middleware/rate-limit");
const { getPool } = require("./src/db");

const app = express();
app.set("trust proxy", 1);

// CORS restrictivo
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173", // Vite dev
  "https://hrcastell.com",
  "https://www.hrcastell.com",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (Postman, curl, misma app)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
}));

app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("combined"));

// Servir archivos subidos
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Health
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "dulcemaria-api",
    build: "2026-02-05-fixed",
    time: new Date().toISOString(),
  });
});

// DB check
app.get("/db-check", async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.query("SELECT NOW() AS now");
    res.json({ ok: true, dbTime: r.rows?.[0]?.now ?? null });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Auth (ya tiene rate limiting específico en cada endpoint)
app.use("/auth", authRoutes);

// Catálogo público (rate limiting para prevenir scraping)
app.use("/catalog", publicApiLimiter, publicCatalogRoutes);

// Admin (portal) — protegido + rate limiting
app.use("/admin", requireAuth, adminApiLimiter);
app.use("/admin/customers", adminCustomersRoutes);
app.use("/admin/orders", adminOrdersRoutes);
app.use("/admin/reports", adminReportsRoutes);
app.use("/admin/users", adminUsersRoutes);
app.use("/admin/products", adminProductsRoutes);

// 404 (incluye path para debug)
app.use((req, res) =>
  res.status(404).json({
    ok: false,
    error: "Not found",
    method: req.method,
    path: req.originalUrl,
  })
);

// Error handler (JSON)
app.use((err, req, res, next) => {
  console.error("UNHANDLED_ERROR:", err);

  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ ok: false, error: "Imagen supera el límite (10MB)." });
  }
  if (err && err.code === "LIMIT_FILE_COUNT") {
    return res.status(400).json({ ok: false, error: "Máximo 8 imágenes por request." });
  }
  if (err && err.code === "LIMIT_UNEXPECTED_FILE") {
    return res.status(400).json({ ok: false, error: "Campo inválido. Debe ser 'images'." });
  }
  return res.status(500).json({ ok: false, error: err?.message || "Internal Server Error" });
});

(async () => {
  try {
    validateEnv();
    await runCompleteMigrations();
    console.log("✅ Database migrations completed successfully");
  } catch (e) {
    console.error("❌ Startup failed:", e?.message || e);
    process.exit(1);
  }

  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, () => console.log(`Dulce Maria API listening on port ${PORT}`));
})();
