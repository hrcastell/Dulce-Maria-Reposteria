/**
 * Rate Limiting Middleware
 *
 * Protege los endpoints contra ataques de fuerza bruta y DDoS
 *
 * Claves: `req.ip`, que Express calcula según `trust proxy`
 * (TRUST_PROXY_HOPS = cantidad de proxies de confianza delante de Node; ver
 * SECURITY_TRANSBANK.md). Si el valor no coincide con la cadena real, la
 * clave es falsificable con X-Forwarded-For (valor muy alto) o todos los
 * clientes comparten la IP del proxy (valor muy bajo).
 *
 * Limitación conocida: el almacenamiento es en memoria y por proceso. Con
 * varios procesos de Passenger cada uno cuenta por separado (el límite
 * efectivo se multiplica) y un reinicio los pone en cero. Para límites
 * globales haría falta un store compartido (p. ej. en PostgreSQL).
 */

const rateLimit = require("express-rate-limit");
const { rateLimitKeyFromIp, normalizeLoginEmail } = require("../lib/clientIp");

const keyByIp = (req) => rateLimitKeyFromIp(req.ip);

// Rate limiter para login (más estricto)
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 10, // 10 intentos por ventana
  message: {
    ok: false,
    error: "Demasiados intentos de login. Intenta de nuevo en 5 minutos.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByIp,
});

// Limitador por cuenta: cuenta solo intentos fallidos por email, aunque
// vengan de muchas IP distintas. Contrapartida: alguien puede bloquear
// temporalmente el login de una cuenta concreta (15 min como máximo).
const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: {
    ok: false,
    error: "Demasiados intentos fallidos para esta cuenta. Intenta de nuevo en 15 minutos.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `cuenta:${normalizeLoginEmail(req.body?.email) || "sin-email"}`,
});

// Rate limiter para bootstrap (muy estricto)
const bootstrapLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 3, // 3 intentos por hora
  message: {
    ok: false,
    error: "Demasiados intentos de bootstrap. Intenta de nuevo en 1 hora.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByIp,
});

// Rate limiter para API pública (catálogo)
const publicApiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 100, // 100 requests por minuto
  message: {
    ok: false,
    error: "Demasiadas solicitudes. Intenta de nuevo en un momento.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByIp,
});

const publicOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    ok: false,
    error: "Demasiados intentos de pedido. Intenta nuevamente en 15 minutos.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByIp,
});

// Rate limiter para admin API (menos estricto porque ya está autenticado)
const adminApiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 200, // 200 requests por minuto
  message: {
    ok: false,
    error: "Demasiadas solicitudes. Intenta de nuevo en un momento.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Para usuarios autenticados se usa el id del usuario (no la IP).
  keyGenerator: (req) => (req.user?.sub ? `usuario:${req.user.sub}` : keyByIp(req)),
});

// --- Pagos en línea (payments-design §9.7) ---------------------------------
// La correctitud del dinero no depende de estos límites (viven en memoria por
// proceso): las consultas al proveedor se coordinan en la base (leases y
// next_reconcile_at). Solo frenan abusos.

function paymentLimiter(windowMs, max, error) {
  return rateLimit({
    windowMs,
    max,
    message: { ok: false, error, code: "RATE_LIMITED" },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyByIp,
  });
}

// Iniciar/reintentar un pago (crea recursos en el proveedor). Más holgado que
// la creación de pedidos (10 / 15 min por IP): los residentes del condominio
// pueden compartir una IP pública y cada pedido admite reintentos. El abuso ya
// lo acota el token de acceso (256 bits) y el máximo de intentos por pedido.
const paymentStartLimiter = paymentLimiter(15 * 60 * 1000, 30, "Demasiados intentos de pago. Intenta de nuevo en 15 minutos.");
// Consulta de estado desde la página de pago (polling).
const paymentStatusLimiter = paymentLimiter(60 * 1000, 120, "Demasiadas consultas. Intenta de nuevo en un momento.");
// Retornos del navegador desde Webpay / Mercado Pago.
const paymentReturnLimiter = paymentLimiter(60 * 1000, 30, "Demasiadas solicitudes. Intenta de nuevo en un momento.");
// Webhooks de Mercado Pago (la firma se valida después y es barata).
const webhookLimiter = paymentLimiter(60 * 1000, 300, "Demasiadas notificaciones.");
// Disparador HTTP del conciliador (cron).
const cronLimiter = paymentLimiter(60 * 1000, 6, "Demasiadas ejecuciones del conciliador.");

module.exports = {
  loginLimiter,
  loginAccountLimiter,
  bootstrapLimiter,
  publicApiLimiter,
  publicOrderLimiter,
  adminApiLimiter,
  paymentStartLimiter,
  paymentStatusLimiter,
  paymentReturnLimiter,
  webhookLimiter,
  cronLimiter,
};
