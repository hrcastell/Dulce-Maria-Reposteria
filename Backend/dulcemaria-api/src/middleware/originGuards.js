/**
 * Middlewares de CORS y Fetch Metadata (la decisión vive en lib/originPolicy.js).
 *
 * CORS nunca responde 403: un origen no permitido simplemente no recibe
 * cabeceras CORS (el navegador bloquea la lectura) y la solicitud sigue su
 * curso. Los preflight se responden siempre con 204.
 */

const { buildCorsHeaders, decideFetchMetadata } = require("../lib/originPolicy");

/**
 * @param {object} options
 * @param {(origin: string) => boolean} options.isAllowed
 * @param {boolean} options.credentials
 * @param {string[]} options.methods
 * @param {string[]} [options.allowHeaders]
 * @param {number} [options.maxAgeSeconds]
 */
function createCorsMiddleware({ isAllowed, credentials, methods, allowHeaders = ["Content-Type", "Accept"], maxAgeSeconds = 600 }) {
  return function corsMiddleware(req, res, next) {
    const origin = req.get("origin");
    const preflight = req.method === "OPTIONS" && Boolean(req.get("access-control-request-method"));
    res.vary("Origin");
    if (preflight) {
      res.vary("Access-Control-Request-Method");
      res.vary("Access-Control-Request-Headers");
    }
    const headers = buildCorsHeaders({
      origin,
      allowed: Boolean(origin) && isAllowed(origin),
      credentials,
      preflight,
      methods,
      allowHeaders,
      maxAgeSeconds,
    });
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    if (preflight) return res.status(204).end();
    return next();
  };
}

/**
 * Rechaza solicitudes de navegador hacia rutas con sesión que no vienen del
 * panel (p. ej. el sitio público, que es "same-site" respecto de la API).
 */
function requireAdminFetchContext(getAdminOrigins) {
  return function adminFetchContext(req, res, next) {
    const decision = decideFetchMetadata({
      site: req.get("sec-fetch-site"),
      origin: req.get("origin"),
      adminOrigins: getAdminOrigins(),
    });
    if (decision.allowed) return next();
    return res.status(403).json({ ok: false, error: "Origen de la solicitud no permitido." });
  };
}

module.exports = { createCorsMiddleware, requireAdminFetchContext };
