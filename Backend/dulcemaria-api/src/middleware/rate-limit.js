/**
 * Rate Limiting Middleware
 * 
 * Protege los endpoints contra ataques de fuerza bruta y DDoS
 */

const rateLimit = require("express-rate-limit");

// Rate limiter para login (más estricto)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // 5 intentos por ventana
  message: {
    ok: false,
    error: "Demasiados intentos de login. Intenta de nuevo en 15 minutos.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Usar IP del cliente (considerando proxy)
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress;
  },
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
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress;
  },
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
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress;
  },
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
  keyGenerator: (req) => {
    // Para usuarios autenticados, usar el user ID si está disponible
    return req.user?.sub || req.ip || req.connection.remoteAddress;
  },
});

module.exports = {
  loginLimiter,
  bootstrapLimiter,
  publicApiLimiter,
  adminApiLimiter,
};
