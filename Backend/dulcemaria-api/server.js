require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const { validateEnv, getTrustProxyHops } = require("./src/config/env");
const { isProductionMode } = require("./src/config/runtime");
const {
  GENERIC_INTERNAL_ERROR,
  installSpanishErrorMap,
  coerceErrorBody,
  logServerError,
} = require("./src/lib/httpErrors");

// Mensajes de validación (zod) en español para todas las rutas.
installSpanishErrorMap();

const authRoutes = require("./src/routes/auth");
const publicCatalogRoutes = require("./src/routes/public.catalog");
const publicOrdersRoutes = require("./src/routes/public.orders");
const adminUsersRoutes = require("./src/routes/admin.users");
const adminProductsRoutes = require("./src/routes/admin.products");
const adminCustomersRoutes = require("./src/routes/admin.customers");
const adminOrdersRoutes = require("./src/routes/admin.orders");
const adminReportsRoutes = require("./src/routes/admin.reports");
const adminSuppliesRoutes = require("./src/routes/admin.supplies");
const adminProvidersRoutes = require("./src/routes/admin.providers");
const adminRecipesRoutes = require("./src/routes/admin.recipes");
const adminEquipmentRoutes = require("./src/routes/admin.equipment");
const adminCakeRoutes = require("./src/routes/admin.cake");
const adminConfigRoutes = require("./src/routes/admin.config");
const adminPlatformFeesRoutes = require("./src/routes/admin.platformFees");
const adminHeroRoutes = require("./src/routes/admin.hero");
const publicCakeRoutes = require("./src/routes/public.cake");
const publicHeroRoutes = require("./src/routes/public.hero");
const publicSettingsRoutes = require("./src/routes/public.settings");
const adminSettingsRoutes = require("./src/routes/admin.settings");
const publicPaymentsRoutes = require("./src/routes/public.payments");
const adminPaymentsRoutes = require("./src/routes/admin.payments");
const internalPaymentsRoutes = require("./src/routes/internal.payments");
const { runCompleteMigrations } = require("./src/migrations/complete");
const { autoBootstrapSuperadmin } = require("./src/bootstrap/autoSuperadmin");
const { getPool } = require("./src/db");
const { initPayments } = require("./src/lib/payments/runtime");
const { redactUrlForLog } = require("./src/lib/payments/sanitize");

const { requireAuth, requireTrustedOrigin } = require("./src/middleware/auth");
const { publicApiLimiter, publicOrderLimiter, adminApiLimiter, cronLimiter } = require("./src/middleware/rate-limit");
const { createCorsMiddleware, requireAdminFetchContext } = require("./src/middleware/originGuards");
const { getOriginPolicy } = require("./src/lib/originPolicy");
const { serveUploads, mapUploadError } = require("./src/lib/uploads");

const production = isProductionMode();
const originPolicy = getOriginPolicy();

const app = express();
app.disable("x-powered-by");
// Express usa su propio "env" para algunos defaults: alinearlo con el modo efectivo.
app.set("env", production ? "production" : process.env.NODE_ENV);
app.set("trust proxy", getTrustProxyHops());

app.use(helmet({
  crossOriginResourcePolicy: false,
  hsts: production
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
}));
// Log de acceso sin secretos: los valores de la query (token_ws, TBK_TOKEN,
// ids de Mercado Pago, búsquedas con datos personales) y los segmentos de ruta
// con forma de token se ocultan; el fragmento nunca se registra.
morgan.token("url", (req) => redactUrlForLog(req.originalUrl || req.url));
morgan.token("referrer", (req) => redactUrlForLog(req.get("referer") || req.get("referrer") || undefined));
app.use(morgan(production ? "combined" : "dev"));

// Diagnóstico temporal para calibrar TRUST_PROXY_HOPS en el hosting: registra
// las primeras 20 solicitudes con la IP que ve Express y la cadena recibida.
if (String(process.env.TRUST_PROXY_DIAGNOSTIC).toLowerCase() === "true") {
  let remaining = 20;
  app.use((req, res, next) => {
    if (remaining > 0) {
      remaining--;
      console.log(
        `[trust-proxy] req.ip=${req.ip} socket=${req.socket.remoteAddress} x-forwarded-for="${req.get("x-forwarded-for") || ""}"`
      );
    }
    next();
  });
}

// ==========================================
// ARCHIVOS SUBIDOS (/uploads y /dulcemaria/uploads)
// Imágenes públicas: CORS sin credenciales, nosniff, CSP sin ejecución y caché
// larga (nombres únicos). Van antes del no-store de la API.
// ==========================================
const uploadsCors = createCorsMiddleware({
  isAllowed: (origin) => originPolicy.public.has(origin) || originPolicy.admin.has(origin),
  credentials: false,
  methods: ["GET", "HEAD", "OPTIONS"],
});
const uploadsHandler = serveUploads();
app.use("/uploads", uploadsCors, uploadsHandler);
app.use("/dulcemaria/uploads", uploadsCors, uploadsHandler);

// Respuestas de la API: nunca en caché de proxies/CDN de cPanel.
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  next();
});

app.use(express.json({ limit: "2mb" }));

// Contrato de errores: `error` siempre es un texto en español; un 5xx nunca
// expone el detalle interno (se registra en el log del servidor).
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === "object" && body.ok === false) {
      if (res.statusCode >= 500 && res.statusCode !== 503) {
        if (body.error !== undefined && body.error !== GENERIC_INTERNAL_ERROR) {
          logServerError(`${req.method} ${req.originalUrl.split("?")[0]} → ${res.statusCode}`, body.error);
        }
        return originalJson({ ok: false, error: GENERIC_INTERNAL_ERROR });
      }
      return originalJson(coerceErrorBody(body));
    }
    return originalJson(body);
  };
  next();
});

// ==========================================
// DEFINICIÓN DE RUTAS (API ROUTER)
// Montado en "/" y en "/dulcemaria": toda política vive dentro del router
// para que ambos prefijos se comporten exactamente igual.
// ==========================================
const apiRouter = express.Router();

// CORS separado: el panel recibe CORS con credenciales; el sitio público, sin
// credenciales. Un Origin desconocido no recibe cabeceras CORS, pero la
// solicitud llega igual a la ruta (p. ej. el retorno de Webpay).
const adminCors = createCorsMiddleware({
  isAllowed: (origin) => originPolicy.admin.has(origin),
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});
const publicCors = createCorsMiddleware({
  isAllowed: (origin) => originPolicy.public.has(origin),
  credentials: false,
  methods: ["GET", "HEAD", "POST", "OPTIONS"],
});
apiRouter.use(["/auth", "/admin"], adminCors, requireAdminFetchContext(() => originPolicy.admin));
apiRouter.use(["/health", "/catalog", "/public"], publicCors);

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
apiRouter.use("/public/cake-builder/orders", publicOrderLimiter);
apiRouter.use("/public/cake-builder", publicApiLimiter, publicCakeRoutes);
apiRouter.use("/public/orders", publicOrderLimiter, publicApiLimiter, publicOrdersRoutes);
apiRouter.use("/public/hero", publicApiLimiter, publicHeroRoutes);
apiRouter.use("/public/settings", publicApiLimiter, publicSettingsRoutes);
// Pagos en línea: límites por ruta dentro del router. El retorno de Webpay
// (POST de formulario desde Transbank) y los webhooks llegan aunque el Origin
// sea ajeno: el CORS de /public nunca rechaza (ver originGuards.js).
apiRouter.use("/public/payments", publicPaymentsRoutes);
// Disparador HTTP del conciliador para el cron (404 si PAYMENTS_CRON_TOKEN no está configurado).
apiRouter.use("/internal/payments", cronLimiter, internalPaymentsRoutes);

// Admin (protegido): autenticación, Origin de mutaciones y límite, UNA sola
// vez para todo /admin (antes se repetían en tres montajes).
apiRouter.use("/admin", requireAuth, requireTrustedOrigin, adminApiLimiter);
apiRouter.use("/admin/customers", adminCustomersRoutes);
apiRouter.use("/admin/orders", adminOrdersRoutes);
apiRouter.use("/admin/reports", adminReportsRoutes);
apiRouter.use("/admin/users", adminUsersRoutes);
apiRouter.use("/admin/products", adminProductsRoutes);
apiRouter.use("/admin/supplies", adminSuppliesRoutes);
apiRouter.use("/admin/providers", adminProvidersRoutes);
apiRouter.use("/admin/recipes", adminRecipesRoutes);
apiRouter.use("/admin/equipment", adminEquipmentRoutes);
apiRouter.use("/admin/cake", adminCakeRoutes);
apiRouter.use("/admin/config", adminConfigRoutes);
// Motor de Tarifa: requirePlatformOwner (el gate real, exclusivo del dueño
// de la plataforma) vive dentro del propio router de admin.platformFees.js.
apiRouter.use("/admin/platform-fees", adminPlatformFeesRoutes);
apiRouter.use("/admin/hero", adminHeroRoutes);
apiRouter.use("/admin/settings", adminSettingsRoutes);
apiRouter.use("/admin/payments", adminPaymentsRoutes);

// Montar API en raíz y en /dulcemaria (para robustez con Passenger)
app.use("/", apiRouter);
app.use("/dulcemaria", apiRouter);


// ==========================================
// Frontend ahora se sirve desde subdominios independientes
// La API solo maneja /uploads para imágenes
// ==========================================

// 404 (Solo si no coincidió con nada anterior)
app.use((req, res) =>
  res.status(404).json({
    ok: false,
    error: "No encontrado.",
    method: req.method,
    path: req.originalUrl.split("?")[0],
  })
);

// Error handler (JSON)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ ok: false, error: "El cuerpo de la solicitud no es JSON válido." });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ ok: false, error: "La solicitud es demasiado grande." });
  }
  if (typeof err?.code === "string" && err.code.startsWith("LIMIT_")) {
    // Respaldo: las rutas de subida ya traducen estos errores (lib/uploads.js).
    const mapped = mapUploadError(err, { field: err.field || "image", maxFiles: 8, maxFileSizeMb: 10 });
    return res.status(mapped.status).json({ ok: false, error: mapped.error });
  }
  const status = Number(err?.status || err?.statusCode || 500);
  if (status >= 500) {
    logServerError(`${req.method} ${req.originalUrl.split("?")[0]}`, err);
    return res.status(500).json({ ok: false, error: GENERIC_INTERNAL_ERROR });
  }
  return res.status(status).json({ ok: false, error: String(err?.message || "Solicitud inválida.") });
});

// Una promesa rechazada sin manejar no debe tumbar el proceso (Passenger lo
// reiniciaría cortando las demás solicitudes en curso): se registra.
process.on("unhandledRejection", (reason) => {
  logServerError("unhandledRejection", reason);
});

(async () => {
  try {
    validateEnv();
    await runCompleteMigrations();
  } catch (e) {
    console.error("❌ Startup failed:", e?.message || e);
    process.exit(1);
  }

  // Pagos en línea: verifica el esquema de pagos y registra qué proveedores
  // quedan habilitados. Nunca bota la app (sin esquema o sin configuración,
  // los pagos en línea quedan deshabilitados y se vende por WhatsApp).
  try {
    await initPayments(getPool());
  } catch (e) {
    console.error("❌ Pagos en línea deshabilitados: no se pudo inicializar el módulo de pagos:", e?.message || e);
  }

  // Comodidad de desarrollo: crea el primer SUPERADMIN si la BD está vacía.
  // No corre en producción y nunca bloquea el arranque (ver el módulo).
  await autoBootstrapSuperadmin();

  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, () => console.log(`Dulce Maria API listening on port ${PORT}`));
})();
