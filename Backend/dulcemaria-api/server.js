require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const { validateEnv } = require("./src/config/env");

const authRoutes = require("./src/routes/auth");
const publicCatalogRoutes = require("./src/routes/public.catalog");
const publicOrdersRoutes = require("./src/routes/public.orders");
const adminUsersRoutes = require("./src/routes/admin.users");
const adminProductsRoutes = require("./src/routes/admin.products");
const adminCustomersRoutes = require("./src/routes/admin.customers");
const adminOrdersRoutes = require("./src/routes/admin.orders");
const adminReportsRoutes = require("./src/routes/admin.reports");
const adminSuppliesRoutes = require("./src/routes/admin.supplies");
const adminCakeRoutes = require("./src/routes/admin.cake");
const publicCakeRoutes = require("./src/routes/public.cake");
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

// Evitar que el proxy/CDN de cPanel cachee respuestas de la API
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  next();
});

// Servir archivos subidos con CORP permisivo para permitir carga cross-origin
const serveUploads = (req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
};

app.use("/uploads", serveUploads, express.static(path.join(__dirname, "uploads")));
app.use("/dulcemaria/uploads", serveUploads, express.static(path.join(__dirname, "uploads")));

// ==========================================
// DEFINICIÓN DE RUTAS (API ROUTER)
// ==========================================
const apiRouter = express.Router();

// Health
apiRouter.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "dulcemaria-api",
    build: "2026-02-19-prod",
    time: new Date().toISOString(),
  });
});

// Rutas de API
apiRouter.use("/auth", authRoutes);
apiRouter.use("/catalog", publicApiLimiter, publicCatalogRoutes);
apiRouter.use("/public/cake-builder", publicApiLimiter, publicCakeRoutes);
apiRouter.use("/public/orders", publicApiLimiter, publicOrdersRoutes);

// Admin (protegido)
apiRouter.use("/admin", requireAuth, adminApiLimiter);
apiRouter.use("/admin/customers", adminCustomersRoutes);
apiRouter.use("/admin/orders", adminOrdersRoutes);
apiRouter.use("/admin/reports", adminReportsRoutes);
apiRouter.use("/admin/users", adminUsersRoutes);
apiRouter.use("/admin/products", adminProductsRoutes);
apiRouter.use("/admin/supplies", adminSuppliesRoutes);
apiRouter.use("/admin/cake", adminCakeRoutes);

// Montar API en raíz y en /dulcemaria (para robustez con Passenger)
app.use("/", apiRouter);
app.use("/dulcemaria", apiRouter);


// ==========================================
// SERVIR FRONTEND ESTÁTICO (Rutas Absolutas)
// ==========================================

const PATH_BASE = "/home/hernanci/public_html/hrcastell.com/dulcemaria";
const PATH_PORTAL = path.join(PATH_BASE, "portal");
const PATH_SITE = path.join(PATH_BASE, "site");

// Función para servir SPA
const serveSpa = (folderPath) => (req, res) => {
  res.sendFile(path.join(folderPath, "index.html"), (err) => {
    if (err && !res.headersSent) res.status(404).send("File not found");
  });
};

// 1. Portal Admin
app.use("/portal", express.static(PATH_PORTAL));
app.use("/dulcemaria/portal", express.static(PATH_PORTAL));

// SPA Fallback para Portal
app.get("/portal/*", serveSpa(PATH_PORTAL));
app.get("/dulcemaria/portal/*", serveSpa(PATH_PORTAL));

// 2. Sitio Web
app.use("/site", express.static(PATH_SITE));
app.use("/dulcemaria/site", express.static(PATH_SITE));

// 3. Redirecciones Raíz
app.get("/", (req, res) => res.redirect("site"));
app.get("/dulcemaria", (req, res) => res.redirect("dulcemaria/site"));
app.get("/dulcemaria/", (req, res) => res.redirect("site"));

// ==========================================

// 404 (Solo si no coincidió con nada anterior)
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
